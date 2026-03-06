import { storage } from "../storage";
import { newShopSession, takeScreenshot } from "./browser";
import { executeRecipe, type ShopRecipeData, type OrderResult } from "./recipe-engine";
import { navigateWithAI, type LiveStep } from "./ai-navigator";
import { executeEmailRecipe } from "../email-recipe-engine";
import { decrypt } from "./crypto";
import type { ShopRecipe, RetailcrmOrderCache } from "@shared/schema";
import fs from "fs";
import path from "path";

export interface CheckResult {
  crmOrderId: string;
  shopDomain: string;
  shopOrderId: string;
  previousStatus: string | null;
  newStatus: string | null;
  trackingNumber: string | null;
  referenceNumber: string | null;
  estimatedDeliveryDate: string | null;
  checkResult: "success" | "login_failed" | "not_found" | "review_needed" | "error";
  errorMessage: string | null;
  screenshotPath: string | null;
  stepsLog: string | null;
  durationMs: number;
  aiTokensUsed: number;
  recipeUsed: boolean;
}

export type { LiveStep } from "./ai-navigator";

export interface CheckProgress {
  total: number;
  completed: number;
  current: string | null;
  status: "idle" | "running" | "done" | "error";
  results: CheckResult[];
  startedAt: number | null;
  liveSteps: LiveStep[];
  currentUrl: string | null;
}

// Global progress state (simple in-memory; one check at a time)
let currentProgress: CheckProgress = {
  total: 0,
  completed: 0,
  current: null,
  status: "idle",
  results: [],
  startedAt: null,
  liveSteps: [],
  currentUrl: null,
};

export function getCheckProgress(): CheckProgress {
  return { ...currentProgress };
}

/** Extract shop domain from a URL string */
function extractDomain(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0];
  }
}

/** Normalize shipmentStore name to domain: "modivo-de" → "modivo.de" */
function storeToDomain(shipmentStore: string): string {
  if (!shipmentStore) return "";
  if (shipmentStore.includes(".")) return extractDomain(shipmentStore);
  // Replace last hyphen-suffix (2-3 letter TLD) with dot: "modivo-de" → "modivo.de"
  return shipmentStore.replace(/-([a-z]{2,3})$/, ".$1");
}

interface OrderGroup {
  domain: string;
  loginUrl: string;
  email: string;
  password: string;
  legalEntity: string;
  orders: Array<{
    crmOrderId: string;
    shopOrderId: string;
    currentStatus: string;
  }>;
}

/** Get orders that need checking from CRM cache */
export async function getOrdersForChecking(): Promise<RetailcrmOrderCache[]> {
  return storage.getCachedOrdersByStatuses(["vystavlen-invoice-klientu"]);
}

/** Load credentials from shop_credentials table as a fallback map: "domain:email" → password */
async function loadCredentialsMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const creds = await storage.getShopCredentials();
    for (const cred of creds) {
      if (cred.encryptedPassword) {
        try {
          const decrypted = decrypt(cred.encryptedPassword);
          map.set(`${cred.domain}:${cred.email}`, decrypted);
        } catch (err) {
          console.error(`[shop-agent] Failed to decrypt credential for ${cred.domain}:${cred.email}:`, err);
        }
      }
    }
    console.log(`[shop-agent] Loaded ${map.size} fallback credentials`);
  } catch (err) {
    console.error("[shop-agent] Failed to load credentials:", err);
  }
  return map;
}

/** Group orders by domain+email for batch processing.
 *  Credentials come from CRM payload (order_email_address + order_email_password).
 *  Falls back to shop_credentials table if CRM has no password.
 */
function groupOrders(orders: RetailcrmOrderCache[], credentialsMap?: Map<string, string>): OrderGroup[] {
  const groups = new Map<string, OrderGroup>();

  for (const order of orders) {
    const payload = order.payload as any;
    const customFields = payload?.customFields || {};

    // Склад отгрузки = shipmentStore (top-level field)
    const shipmentStore = payload?.shipmentStore || "";
    if (!shipmentStore) continue;

    const domain = storeToDomain(shipmentStore);

    const shopOrderId = customFields.id_zakaza_y_sklada_otgruzki || "";
    if (!shopOrderId) continue;

    // Credentials from CRM custom fields
    const email = customFields.order_email_address || "";
    let password = customFields.order_email_password || "";

    // Fallback: check shop_credentials table if CRM has no password
    if (!password && email && credentialsMap) {
      password = credentialsMap.get(`${domain}:${email}`) || "";
      if (password) {
        console.log(`[shop-agent] Using credentials table password for ${domain}:${email}`);
      }
    }

    if (!email || !password) continue;

    // legalEntity from CRM (determines which Fastmail account to search)
    const legalEntity = customFields.iul_vykupa1c || "";

    const groupKey = `${domain}:${email}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        domain,
        loginUrl: `https://${domain}`,
        email,
        password,
        legalEntity,
        orders: [],
      });
    }

    groups.get(groupKey)!.orders.push({
      crmOrderId: order.orderId,
      shopOrderId,
      currentStatus: order.status,
    });
  }

  return Array.from(groups.values());
}

/** Run checks for specific order IDs or all eligible orders.
 *  @param storeFilter - optional domain filter, e.g. "modivo.de". Only orders from this store will be checked.
 */
export async function checkOrders(orderIds?: string[], hints?: Record<string, string>, storeFilter?: string): Promise<CheckResult[]> {
  if (currentProgress.status === "running") {
    throw new Error("A check is already in progress");
  }

  currentProgress = {
    total: 0,
    completed: 0,
    current: null,
    status: "running",
    results: [],
    startedAt: Date.now(),
    liveSteps: [],
    currentUrl: null,
  };

  try {
    // Get orders to check
    let orders: RetailcrmOrderCache[];
    if (orderIds && orderIds.length > 0) {
      const allOrders = await getOrdersForChecking();
      orders = allOrders.filter((o) => orderIds.includes(o.orderId));
    } else {
      orders = await getOrdersForChecking();
    }

    // Apply store filter if specified (e.g. "modivo.de")
    if (storeFilter) {
      orders = orders.filter((o) => {
        const payload = o.payload as any;
        const shipmentStore = payload?.shipmentStore || "";
        const domain = storeToDomain(shipmentStore);
        return domain === storeFilter;
      });
      console.log(`[shop-agent] Store filter "${storeFilter}": ${orders.length} orders`);
    }

    // Load fallback credentials from shop_credentials table
    const credentialsMap = await loadCredentialsMap();

    // Group by domain + credentials (from CRM payload + fallback)
    const groups = groupOrders(orders, credentialsMap);
    const allResults: CheckResult[] = [];

    let totalOrders = 0;
    for (const g of groups) {
      totalOrders += g.orders.length;
    }
    currentProgress.total = totalOrders;

    console.log(`[shop-agent] ${groups.length} groups, ${totalOrders} orders to check`);

    // Process each group
    for (const group of groups) {
      currentProgress.current = `${group.domain} (${group.email})`;
      currentProgress.liveSteps = [];
      currentProgress.currentUrl = null;

      try {
        const groupResults = await processGroup(group, hints);
        allResults.push(...groupResults);

        // Save results to DB
        for (const result of groupResults) {
          await storage.createShopOrderCheck({
            crmOrderId: result.crmOrderId,
            shopDomain: result.shopDomain,
            shopOrderId: result.shopOrderId,
            previousStatus: result.previousStatus,
            newStatus: result.newStatus,
            trackingNumber: result.trackingNumber,
            referenceNumber: result.referenceNumber,
            estimatedDeliveryDate: result.estimatedDeliveryDate,
            checkResult: result.checkResult,
            errorMessage: result.errorMessage,
            stepsLog: result.stepsLog,
            screenshotPath: result.screenshotPath,
            durationMs: result.durationMs,
            aiTokensUsed: result.aiTokensUsed,
            recipeUsed: result.recipeUsed,
          });
        }
      } catch (err) {
        console.error(`[shop-agent] Error processing group ${group.domain}:`, err);
        // Create error results for all orders in the group
        for (const order of group.orders) {
          const errResult: CheckResult = {
            crmOrderId: order.crmOrderId,
            shopDomain: group.domain,
            shopOrderId: order.shopOrderId,
            previousStatus: order.currentStatus,
            newStatus: null,
            trackingNumber: null,
            referenceNumber: null,
            estimatedDeliveryDate: null,
            checkResult: "error",
            errorMessage: err instanceof Error ? err.message : "Unknown error",
            screenshotPath: null,
            stepsLog: null,
            durationMs: 0,
            aiTokensUsed: 0,
            recipeUsed: false,
          };
          allResults.push(errResult);
          await storage.createShopOrderCheck({
            crmOrderId: errResult.crmOrderId,
            shopDomain: errResult.shopDomain,
            shopOrderId: errResult.shopOrderId,
            previousStatus: errResult.previousStatus,
            newStatus: errResult.newStatus,
            trackingNumber: errResult.trackingNumber,
            referenceNumber: errResult.referenceNumber,
            estimatedDeliveryDate: errResult.estimatedDeliveryDate,
            checkResult: errResult.checkResult,
            errorMessage: errResult.errorMessage,
            screenshotPath: errResult.screenshotPath,
            durationMs: errResult.durationMs,
            aiTokensUsed: errResult.aiTokensUsed,
            recipeUsed: errResult.recipeUsed,
          });
        }
      }

      currentProgress.completed += group.orders.length;
      currentProgress.results = allResults;
    }

    currentProgress.status = "done";
    currentProgress.current = null;
    return allResults;
  } catch (err) {
    currentProgress.status = "error";
    throw err;
  }
}

async function processGroup(group: OrderGroup, hints?: Record<string, string>): Promise<CheckResult[]> {
  const startTime = Date.now();
  const results: CheckResult[] = [];

  // Check for existing recipe
  const recipe = await storage.getShopRecipeByDomain(group.domain);

  // Open browser session
  const session = await newShopSession(group.loginUrl);

  try {
    if (recipe) {
      // Use existing recipe
      const recipeData = recipe.recipeJson as unknown as ShopRecipeData;
      const orderIds = group.orders.map((o) => o.shopOrderId);

      // Load existing tracking numbers to avoid redundant OCR
      const existingTracking = new Map<string, string>();
      try {
        const prevChecks = await storage.getLatestTrackingForOrders(orderIds);
        for (const [orderId, tracking] of prevChecks) {
          existingTracking.set(orderId, tracking);
        }
        if (existingTracking.size > 0) {
          console.log(`[shop-agent] Loaded ${existingTracking.size} existing tracking numbers (will skip OCR for these)`);
        }
      } catch (err) {
        console.log(`[shop-agent] Could not load existing tracking (will OCR all): ${(err as Error).message?.substring(0, 80)}`);
      }

      try {
        const orderResults = await executeRecipe(
          session.page,
          recipeData,
          { email: group.email, password: group.password },
          orderIds,
          existingTracking,
        );

        // Build a map of extracted results keyed by shopOrderId for O(1) lookup
        // When multiple jsExtract steps exist (e.g. main orders + cancelled tab),
        // success results must never be overwritten by error results from later steps
        const extractedMap = new Map<string, (typeof orderResults)[0]>();
        for (const r of orderResults) {
          if (r.shopOrderId) {
            const existing = extractedMap.get(r.shopOrderId);
            if (!existing || (r.success && !existing.success)) {
              extractedMap.set(r.shopOrderId, r);
            }
          }
        }
        console.log(`[shop-agent] Recipe returned ${orderResults.length} results, matched ${extractedMap.size} unique order IDs`);

        for (let i = 0; i < group.orders.length; i++) {
          const order = group.orders[i];
          // ONLY match by shopOrderId — never use index fallback (causes data corruption)
          const extracted = extractedMap.get(order.shopOrderId);

          results.push({
            crmOrderId: order.crmOrderId,
            shopDomain: group.domain,
            shopOrderId: order.shopOrderId,
            previousStatus: order.currentStatus,
            newStatus: extracted?.status || null,
            trackingNumber: extracted?.trackingNumber || null,
            referenceNumber: extracted?.referenceNumber || null,
            estimatedDeliveryDate: extracted?.estimatedDeliveryDate || null,
            checkResult: extracted ? (extracted.success ? "success" : "error") : "not_found",
            errorMessage: extracted?.error || (extracted ? null : "Order not found on website"),
            screenshotPath: null,
            stepsLog: extracted ? "Recipe executed" : "Order not found in recipe results",
            durationMs: Date.now() - startTime,
            aiTokensUsed: 0,
            recipeUsed: true,
          });
        }

        // Step 2: For results without trackingNumber, search email to find tracking
        // Step 2a: orders with referenceNumber → search by reference (SEUR → DPD)
        // Step 2b: orders without referenceNumber → search by order ID
        if (group.legalEntity) {
          const noTracking = results.filter(
            r => !r.trackingNumber && (r.checkResult === "success" || r.checkResult === "not_found")
          );
          if (noTracking.length > 0) {
            try {
              const emailRecipe = await storage.getEmailRecipeByDomain(group.domain);
              if (emailRecipe) {
                const emailRecipeJson = emailRecipe.recipeJson as any;
                const withRef = noTracking.filter(r => r.referenceNumber);
                const withoutRef = noTracking.filter(r => !r.referenceNumber);
                console.log(`[agent] Step 2: ${noTracking.length} orders need email lookup (${withRef.length} by reference, ${withoutRef.length} by order ID)`);

                // Step 2a: search by SEUR reference
                for (const result of withRef) {
                  try {
                    console.log(`[agent] Step 2a: searching email for reference ${result.referenceNumber} (order ${result.shopOrderId})`);
                    const emailResult = await executeEmailRecipe(
                      emailRecipeJson,
                      result.shopOrderId,
                      group.legalEntity,
                      result.referenceNumber!
                    );
                    if (emailResult.found && emailResult.trackingNumber) {
                      console.log(`[agent] Step 2a: found tracking ${emailResult.trackingNumber} (carrier: ${emailResult.carrierName}) for reference ${result.referenceNumber}`);
                      result.trackingNumber = emailResult.trackingNumber;
                      result.stepsLog = JSON.stringify({
                        step1: "Recipe executed",
                        step2: `Email lookup by reference ${result.referenceNumber}`,
                        emailCarrier: emailResult.carrierName,
                        emailTrack: emailResult.trackingNumber,
                      });
                    }
                  } catch (emailErr) {
                    console.error(`[agent] Step 2a failed for ${result.referenceNumber}:`, emailErr);
                  }
                }

                // Step 2b: search by order ID (for orders without reference on website)
                for (const result of withoutRef) {
                  try {
                    console.log(`[agent] Step 2b: searching email for order ${result.shopOrderId}`);
                    const emailResult = await executeEmailRecipe(
                      emailRecipeJson,
                      result.shopOrderId,
                      group.legalEntity
                      // no searchTerm → searches by shopOrderId
                    );
                    if (emailResult.found && emailResult.trackingNumber) {
                      console.log(`[agent] Step 2b: found tracking ${emailResult.trackingNumber} (carrier: ${emailResult.carrierName}) for order ${result.shopOrderId}`);
                      result.trackingNumber = emailResult.trackingNumber;
                      result.stepsLog = JSON.stringify({
                        step1: "Recipe executed",
                        step2: `Email lookup by order ID ${result.shopOrderId}`,
                        emailCarrier: emailResult.carrierName,
                        emailTrack: emailResult.trackingNumber,
                      });
                    }
                  } catch (emailErr) {
                    console.error(`[agent] Step 2b failed for order ${result.shopOrderId}:`, emailErr);
                  }
                }
              }
            } catch (err) {
              console.error(`[agent] Step 2: failed to load email recipe for ${group.domain}:`, err);
            }
          }
        }

        // Update recipe success count
        await storage.updateShopRecipe(recipe.id, {
          successCount: (recipe.successCount || 0) + 1,
          lastUsedAt: new Date(),
        });
      } catch (err) {
        // Recipe failed - take screenshot and mark failure
        const screenshotPath = await saveErrorScreenshot(session.page, group.domain);

        await storage.updateShopRecipe(recipe.id, {
          failCount: (recipe.failCount || 0) + 1,
        });

        for (const order of group.orders) {
          results.push({
            crmOrderId: order.crmOrderId,
            shopDomain: group.domain,
            shopOrderId: order.shopOrderId,
            previousStatus: order.currentStatus,
            newStatus: null,
            trackingNumber: null,
            referenceNumber: null,
            estimatedDeliveryDate: null,
            checkResult: "error",
            errorMessage: `Recipe failed: ${err instanceof Error ? err.message : "unknown"}`,
            screenshotPath,
            stepsLog: "Recipe execution failed",
            durationMs: Date.now() - startTime,
            aiTokensUsed: 0,
            recipeUsed: true,
          });
        }
      }
    } else {
      // No recipe - use AI navigator
      const orderIds = group.orders.map((o) => o.shopOrderId);

      // Live progress callback
      const onStep = (step: LiveStep) => {
        // Replace or add step
        const idx = currentProgress.liveSteps.findIndex((s) => s.step === step.step);
        if (idx >= 0) {
          currentProgress.liveSteps[idx] = step;
        } else {
          currentProgress.liveSteps.push(step);
        }
        currentProgress.currentUrl = step.url || null;
      };

      const navResult = await navigateWithAI(
        session.page,
        { email: group.email, password: group.password },
        orderIds,
        group.domain,
        hints?.[group.domain] || undefined,
        onStep,
      );

      // Save recipe if AI built one
      if (navResult.recipe) {
        try {
          await storage.createShopRecipe({
            domain: group.domain,
            loginType: navResult.recipe.loginType,
            recipeJson: navResult.recipe as any,
          });
        } catch (err) {
          console.error(`[shop-agent] Failed to save recipe for ${group.domain}:`, err);
        }
      }

      // Build a map of extracted results keyed by shopOrderId for O(1) lookup
      const navExtractedMap = new Map<string, (typeof navResult.results)[0]>();
      for (const r of navResult.results) {
        if (r.shopOrderId) {
          navExtractedMap.set(r.shopOrderId, r);
        }
      }

      for (let i = 0; i < group.orders.length; i++) {
        const order = group.orders[i];
        // ONLY match by shopOrderId — never use index fallback
        const extracted = navExtractedMap.get(order.shopOrderId);

        results.push({
          crmOrderId: order.crmOrderId,
          shopDomain: group.domain,
          shopOrderId: order.shopOrderId,
          previousStatus: order.currentStatus,
          newStatus: extracted?.status || null,
          trackingNumber: extracted?.trackingNumber || null,
          referenceNumber: extracted?.referenceNumber || null,
          estimatedDeliveryDate: extracted?.estimatedDeliveryDate || null,
          checkResult: extracted ? (extracted.success ? "success" : "error") : "not_found",
          errorMessage: extracted?.error || (extracted ? null : "Order not found on website"),
          screenshotPath: null,
          stepsLog: navResult.stepsLog.join("\n"),
          durationMs: Date.now() - startTime,
          aiTokensUsed: navResult.tokensUsed,
          recipeUsed: false,
        });
      }
    }
  } finally {
    await session.close();
  }

  return results;
}

async function saveErrorScreenshot(page: any, domain: string): Promise<string | null> {
  try {
    const screenshotDir = path.join(process.cwd(), "screenshots");
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const fileName = `${domain}-${Date.now()}.png`;
    const filePath = path.join(screenshotDir, fileName);
    const buffer = await takeScreenshot(page);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  } catch {
    return null;
  }
}
