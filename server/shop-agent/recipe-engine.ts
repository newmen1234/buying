import type { Page } from "playwright";
import { autoDismissCookieBanner } from "./cookie-utils";

export interface RecipeStep {
  type: "goto" | "fill" | "jsFill" | "click" | "jsClick" | "wait" | "extractOrders" | "extractSingle" | "sleep" | "domExtract" | "apiExtract" | "jsExtract";
  /** CSS selector or URL (for goto) */
  selector?: string;
  /** Value for fill steps. Supports {{email}}, {{password}}, {{orderId}} templates */
  value?: string;
  /** Description for debugging */
  description?: string;
  /** Timeout in ms for wait steps */
  timeout?: number;
  /** If true, step failure is silently ignored (useful for optional consent banners) */
  optional?: boolean;
  /** If true, click with force:true immediately (bypass overlay) */
  force?: boolean;
}

export interface ExtractionRules {
  orderId: string;    // CSS selector
  status: string;     // CSS selector
  trackingNumber?: string; // CSS selector
}

export interface DomExtractConfig {
  /** CSS selector for order rows on the list page */
  orderRowSelector: string;
  /** CSS selector for detail link within each order row */
  detailLinkSelector: string;
  /** Regex patterns to find tracking number on detail page (group 1 = tracking) */
  trackingPatterns: string[];
  /** Text phrases meaning "no tracking yet" */
  noTrackingTexts: string[];
  /** Map raw status text → normalized status */
  statusMapping: Record<string, string>;

  // --- Pagination support ---
  /** CSS selector for "next page" button (e.g. "Weiter") */
  paginationNextSelector?: string;
  /** Delay in ms after clicking next page (for slow-loading pages) */
  paginationDelay?: number;

  // --- Detail page extraction ---
  /** Skip detail page navigation entirely — use only list-level data (faster for SPAs) */
  skipDetailPages?: boolean;
  /** CSS selector to extract status text from detail page (instead of from list row) */
  detailStatusSelector?: string;
  /** Regex to extract status from detail page text if selector not enough (group 1 = status) */
  detailStatusPattern?: string;

  // --- Inline tracking (click element on list page → modal popup) ---
  /** Config for extracting tracking from inline modal on list page */
  inlineTracking?: {
    /** CSS selector for the tracking clickable element within each order row (e.g. "span.order-status") */
    clickSelector: string;
    /** Delay in ms after click for modal to appear (default: 4000) */
    modalDelay?: number;
    /** Regex to extract status from popup text (group 1 = status) */
    statusPattern?: string;
    /** Regex to extract tracking number from popup text (group 1 = tracking) */
    trackingPattern?: string;
  };

  // --- Detail page tracking (legacy — navigates to detail page) ---
  /** CSS selector for button that opens tracking popup on detail page */
  trackingButtonSelector?: string;
  /** CSS selector for tracking number text inside popup/modal */
  trackingPopupSelector?: string;
  /** Regex to extract tracking from popup text (group 1 = tracking number) */
  trackingPopupPattern?: string;
  /** Delay in ms after clicking tracking button for popup to appear */
  trackingPopupDelay?: number;
}

/**
 * API-based extraction: intercept SPA API responses + call public tracking API.
 * Much faster than DOM scraping — no pagination clicking or detail page navigation.
 */
export interface ApiExtractConfig {
  /** URL pattern to match the orders API response (substring match) */
  ordersApiPattern: string;
  /** Dot-separated path to orders array in API response (e.g. "data.customerOrdersExt.items") */
  ordersPath: string;
  /** Dot-path to order number (e.g. "order_number" or "data.orderId"). Supports array index: "items[0].id" */
  orderNumberField: string;
  /** Dot-path to status label (e.g. "status_label" or "orderState"). Supports nested: "lineItems[0].status" */
  statusField: string;
  /** Dot-path to tracking identifier/hash (e.g. "tracking_identifier" or "shippingInfo.deliveries[0].trackingId") */
  trackingIdField: string;
  /** Dot-path to carrier name directly in the order object (e.g. "shippingInfo.deliveries[0].carrier") */
  carrierField?: string;
  /** URL template for public tracking details API. Use {trackingId} placeholder.
   *  If not set, trackingId from the order is used directly as the tracking number. */
  trackingApiUrl?: string;
  /** Dot-separated path to tracking number in tracking API response */
  trackingNumberPath?: string;
  /** Dot-separated path to carrier name in tracking API response */
  trackingCarrierPath?: string;
  /** Status mapping (raw → normalized) */
  statusMapping: Record<string, string>;
  /** CSS selector for "next page" button for SPA pagination */
  paginationNextSelector?: string;
  /** JavaScript to execute for loading more results (instead of clicking paginationNextSelector).
   *  Useful for buttons with dynamic class names — e.g. find by text content. */
  paginationScript?: string;
  /** Delay in ms after clicking next page */
  paginationDelay?: number;
}

/**
 * JS-based extraction: run custom JavaScript in the page context.
 * Most flexible extraction method — handles any DOM structure.
 * The script receives `targetOrderIds` string[] and must return
 * Array<{ shopOrderId, status, rawStatus, trackingNumber, success, error? }>
 */
export interface JsExtractConfig {
  /** JavaScript function body to evaluate in page context.
   *  Receives `targetOrderIds` (string[]) as parameter.
   *  Must return array of { shopOrderId, status, rawStatus, trackingNumber, success, error? } */
  extractScript: string;
  /** If true, the extractScript extracts ALL orders on the page (not just target ones).
   *  The engine will filter for target orders but save all extracted data to DB.
   *  This is efficient for shops with thousands of orders — extract all on each page,
   *  stop pagination when all target orders are found. */
  extractAllOrders?: boolean;
  /** CSS selector for "load more" or pagination button */
  paginationSelector?: string;
  /** JavaScript to execute for loading more results (instead of clicking paginationSelector).
   *  e.g. "ver_mas_pedidos()" — useful when the load-more button is hidden but the function exists. */
  paginationScript?: string;
  /** Delay in ms after clicking pagination */
  paginationDelay?: number;
  /** Max pages to load (default: 50) */
  maxPages?: number;
}

export interface ShopRecipeData {
  domain: string;
  loginType: "email_password" | "order_lookup" | "guest_tracking";
  loginUrl: string;
  steps: RecipeStep[];
  orderListSelector?: string;
  extractionRules: ExtractionRules;
  statusMapping: Record<string, string>; // "Versendet" → "shipped"
  /** DOM extraction config with detail page navigation */
  domExtractConfig?: DomExtractConfig;
  /** API-based extraction config (faster, intercepts SPA API calls) */
  apiExtractConfig?: ApiExtractConfig;
  /** JS-based extraction config (most flexible, custom JS in page context) */
  jsExtractConfig?: JsExtractConfig;
}

export interface OrderResult {
  shopOrderId: string;
  status: string | null;       // normalized status
  rawStatus: string | null;    // original text
  trackingNumber: string | null;
  referenceNumber: string | null; // e.g. SEUR reference
  estimatedDeliveryDate: string | null; // e.g. "2026-03-04"
  success: boolean;
  error?: string;
}

interface Credentials {
  email: string;
  password: string;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] || "");
}

async function executeStep(page: Page, step: RecipeStep, vars: Record<string, string>): Promise<void> {
  console.log(`[recipe-engine] executeStep: ${step.type} ${step.selector?.substring(0, 60) || ""}${step.optional ? " (optional)" : ""}`);
  try {
    switch (step.type) {
    case "goto": {
      const url = interpolate(step.selector || "", vars);
      console.log(`[recipe-engine]   goto: ${url}`);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: step.timeout || 30000 });
      } catch (err) {
        // Timeout is OK — page might be heavy SPA that doesn't fire domcontentloaded quickly
        console.log(`[recipe-engine]   goto timeout (proceeding): ${(err as Error).message?.substring(0, 80)}`);
      }
      console.log(`[recipe-engine]   arrived: ${page.url()}`);
      break;
    }
    case "fill": {
      const value = interpolate(step.value || "", vars);
      const isPassword = step.value?.includes("password");
      console.log(`[recipe-engine]   fill: ${step.selector} = ${isPassword ? "***" : value.substring(0, 30)}`);
      await page.waitForSelector(step.selector!, { timeout: step.timeout || 10000 });
      await page.fill(step.selector!, value);
      break;
    }
    case "jsFill": {
      // Fill input via page.evaluate() for SPA compatibility (Vue/React v-model)
      // Triggers native input events that Vue/React listen to
      // Uses state: 'attached' because the element may be in the DOM but hidden (e.g. login modals)
      const value = interpolate(step.value || "", vars);
      const isPassword = step.value?.includes("password");
      console.log(`[recipe-engine]   jsFill: ${step.selector} = ${isPassword ? "***" : value.substring(0, 30)}`);
      await page.waitForSelector(step.selector!, { timeout: step.timeout || 10000, state: "attached" });
      const filled = await page.evaluate(({ sel, val }) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (!el) return false;
        // Focus + set value + dispatch events for Vue/React reactivity
        el.focus();
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value"
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(el, val);
        } else {
          el.value = val;
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, { sel: step.selector!, val: value });
      console.log(`[recipe-engine]   jsFill result: ${filled ? "OK" : "NOT FOUND"}`);
      if (!filled && !step.optional) {
        throw new Error(`jsFill: element not found: ${step.selector}`);
      }
      break;
    }
    case "click": {
      // Check if selector is a form — use form.submit() instead of click
      const isForm = step.selector!.startsWith("form") && !step.selector!.includes(" ");
      console.log(`[recipe-engine]   click: ${step.selector} (isForm=${isForm}, force=${!!step.force})`);
      if (isForm) {
        await page.waitForSelector(step.selector!, { timeout: step.timeout || 10000 });
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
          page.evaluate((sel) => {
            const form = document.querySelector(sel) as HTMLFormElement;
            if (form) form.submit();
          }, step.selector!),
        ]);
        await page.waitForTimeout(2000);
        console.log(`[recipe-engine]   after submit: ${page.url()}`);
        const text = await page.evaluate(() => document.body.innerText.substring(0, 200));
        console.log(`[recipe-engine]   page text: ${text.replace(/\n/g, " | ").substring(0, 120)}`);
      } else if (step.force) {
        // Force click immediately (for overlay-blocked buttons)
        await page.waitForSelector(step.selector!, { timeout: step.timeout || 10000 });
        await page.click(step.selector!, { force: true });
      } else {
        await page.waitForSelector(step.selector!, { timeout: step.timeout || 10000 });
        try {
          await page.click(step.selector!, { timeout: 5000 });
        } catch {
          // Retry with force if intercepted by overlay
          await page.click(step.selector!, { force: true });
        }
      }
      // Wait for potential navigation
      await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
      break;
    }
    case "jsClick": {
      // Click element via page.evaluate() for SPA compatibility (Vue/React event handlers)
      // If both selector and value are provided: find elements by selector, filter by text
      // If only selector: click first match
      // If only value: search all clickable elements by text
      const searchText = step.value || "";
      const cssSel = step.selector || "";
      console.log(`[recipe-engine]   jsClick: text="${searchText}" selector="${cssSel}"`);
      const clicked = await page.evaluate(({ text, sel }) => {
        // If both selector and text provided: find within selector scope, filter by text
        if (sel && text) {
          const els = Array.from(document.querySelectorAll(sel));
          for (const el of els) {
            const t = (el.textContent || "").trim();
            if (t.toLowerCase().includes(text.toLowerCase())) {
              (el as HTMLElement).click();
              return `selector+text: ${t.substring(0, 50)}`;
            }
          }
          return null;
        }
        // Only CSS selector — click first match
        if (sel) {
          const el = document.querySelector(sel) as HTMLElement | null;
          if (el) { el.click(); return `selector: ${el.textContent?.trim().substring(0, 50)}`; }
        }
        // Only text — search all clickable elements
        if (text) {
          const els = Array.from(document.querySelectorAll("button, a, [role='button'], input[type='submit']"));
          for (const el of els) {
            const t = (el.textContent || "").trim();
            if (t.toLowerCase().includes(text.toLowerCase())) {
              (el as HTMLElement).click();
              return `text: ${t.substring(0, 50)}`;
            }
          }
        }
        return null;
      }, { text: searchText, sel: cssSel });
      console.log(`[recipe-engine]   jsClick result: ${clicked || "NOT FOUND"}`);
      if (!clicked && !step.optional) {
        throw new Error(`jsClick: element not found (text="${searchText}", selector="${cssSel}")`);
      }
      await page.waitForTimeout(1000);
      break;
    }
    case "wait": {
      await page.waitForSelector(step.selector!, { timeout: step.timeout || 15000 });
      break;
    }
    case "sleep": {
      await page.waitForTimeout(step.timeout || 2000);
      break;
    }
    case "extractOrders":
    case "extractSingle":
    case "domExtract":
    case "apiExtract":
    case "jsExtract":
      // Extraction is handled separately in the executeRecipe loop
      break;
    }
  } catch (err) {
    if (step.optional) {
      console.log(`[recipe-engine]   optional step failed (ignored): ${(err as Error).message?.substring(0, 80)}`);
    } else {
      throw err;
    }
  }
}

async function extractOrderData(
  page: Page,
  rules: ExtractionRules,
  statusMapping: Record<string, string>,
  orderListSelector?: string,
): Promise<OrderResult[]> {
  const results: OrderResult[] = [];

  if (orderListSelector) {
    // Multiple orders on page
    const orderElements = await page.$$(orderListSelector);
    for (const el of orderElements) {
      try {
        const shopOrderId = await el.$eval(rules.orderId, (e) => e.textContent?.trim() || "").catch(() => "");
        const rawStatus = await el.$eval(rules.status, (e) => e.textContent?.trim() || "").catch(() => null);
        const trackingNumber = rules.trackingNumber
          ? await el.$eval(rules.trackingNumber, (e) => e.textContent?.trim() || "").catch(() => null)
          : null;

        const normalizedStatus = rawStatus ? (statusMapping[rawStatus] || rawStatus.toLowerCase()) : null;

        results.push({
          shopOrderId,
          status: normalizedStatus,
          rawStatus,
          trackingNumber,
          success: true,
        });
      } catch (err) {
        results.push({
          shopOrderId: "",
          status: null,
          rawStatus: null,
          trackingNumber: null,
          referenceNumber: null,
          success: false,
          error: err instanceof Error ? err.message : "Extraction failed",
        });
      }
    }
  } else {
    // Single order on page
    try {
      const shopOrderId = await page.$eval(rules.orderId, (e) => e.textContent?.trim() || "").catch(() => "");
      const rawStatus = await page.$eval(rules.status, (e) => e.textContent?.trim() || "").catch(() => null);
      const trackingNumber = rules.trackingNumber
        ? await page.$eval(rules.trackingNumber, (e) => e.textContent?.trim() || "").catch(() => null)
        : null;

      const normalizedStatus = rawStatus ? (statusMapping[rawStatus] || rawStatus.toLowerCase()) : null;

      results.push({
        shopOrderId,
        status: normalizedStatus,
        rawStatus,
        trackingNumber,
        referenceNumber: null,
        success: true,
      });
    } catch (err) {
      results.push({
        shopOrderId: "",
        status: null,
        rawStatus: null,
        trackingNumber: null,
        referenceNumber: null,
        success: false,
        error: err instanceof Error ? err.message : "Extraction failed",
      });
    }
  }

  return results;
}

/**
 * Scrape order IDs and detail links from the current page.
 */
async function scrapeOrderListPage(
  page: Page,
  config: DomExtractConfig,
  targetOrderIds: string[],
): Promise<Array<{ targetId: string; found: boolean; rawStatus: string | null; detailUrl: string | null; rowText: string }>> {
  return page.evaluate(({ targetIds, rowSel, linkSel, statusKeys }) => {
    const results: Array<{
      targetId: string;
      found: boolean;
      rawStatus: string | null;
      detailUrl: string | null;
      rowText: string;
    }> = [];

    const rows = Array.from(document.querySelectorAll(rowSel));

    for (const targetId of targetIds) {
      // Search in table/list rows
      for (const row of rows) {
        const text = row.textContent || "";
        if (!text.includes(targetId)) continue;

        // Find detail link
        let detailUrl: string | null = null;
        const selectorLinks = Array.from(row.querySelectorAll(linkSel));
        for (const link of selectorLinks) {
          const href = link.getAttribute("href");
          if (href) { detailUrl = href; break; }
        }
        // Fallback: any link with relevant text/href
        if (!detailUrl) {
          const allLinks = Array.from(row.querySelectorAll("a[href]"));
          for (const link of allLinks) {
            const href = link.getAttribute("href") || "";
            const lt = (link.textContent || "").toLowerCase();
            if (href.includes("bestellung") || href.includes("order") ||
                lt.includes("anzeigen") || lt.includes("details") || lt.includes("view")) {
              detailUrl = href;
              break;
            }
          }
        }

        // Find status keyword in row text
        let rawStatus: string | null = null;
        const textLower = text.toLowerCase();
        for (const key of statusKeys) {
          if (textLower.includes(key.toLowerCase())) { rawStatus = key; break; }
        }

        results.push({ targetId, found: true, rawStatus, detailUrl, rowText: text.substring(0, 500) });
        break;
      }
    }
    return results;
  }, {
    targetIds: targetOrderIds,
    rowSel: config.orderRowSelector,
    linkSel: config.detailLinkSelector,
    statusKeys: Object.keys(config.statusMapping),
  });
}

/**
 * DOM-based extraction: find orders on list page (with pagination).
 * Per-page processing: scan rows → extract tracking via inline modal → paginate.
 * Works WITHOUT AI — uses CSS selectors and regex patterns from config.
 */
async function executeDomExtract(
  page: Page,
  config: DomExtractConfig,
  targetOrderIds: string[],
): Promise<OrderResult[]> {
  const ordersPageUrl = page.url();

  // Debug: dump page content
  const pagePreview = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log(`[recipe-engine] domExtract on: ${ordersPageUrl}`);
  console.log(`[recipe-engine] page text: ${pagePreview.replace(/\n/g, " | ").substring(0, 300)}`);
  console.log(`[recipe-engine] looking for ${targetOrderIds.length} orders: ${targetOrderIds.join(", ")}`);

  const results: OrderResult[] = [];
  const remainingIds = new Set(targetOrderIds);
  let pageNum = 1;
  const MAX_PAGES = 50;

  // ============= Per-page processing: scan → extract tracking → paginate =============
  while (remainingIds.size > 0 && pageNum <= MAX_PAGES) {
    console.log(`[recipe-engine] Page ${pageNum}: scanning for ${remainingIds.size} remaining orders`);

    // --- Step 1: Find target orders on this page ---
    const pageResults = await scrapeOrderListPage(page, config, [...remainingIds]);
    const foundOnThisPage = pageResults.filter(r => r.found);

    if (foundOnThisPage.length > 0) {
      console.log(`[recipe-engine] Page ${pageNum}: found ${foundOnThisPage.length} orders: ${foundOnThisPage.map(r => r.targetId).join(", ")}`);
    }

    // --- Step 2: For each found order, extract tracking via inline modal ---
    for (const info of foundOnThisPage) {
      remainingIds.delete(info.targetId);

      let status = info.rawStatus
        ? (config.statusMapping[info.rawStatus] || info.rawStatus)
        : null;
      let trackingNumber: string | null = null;

      // Try inline tracking (click element on list page → modal popup)
      if (config.inlineTracking) {
        try {
          // Dismiss any existing modals first
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(500);

          // Click the tracking element in the order's row
          const clicked = await page.evaluate(({ targetId, rowSel, clickSel }) => {
            const rows = Array.from(document.querySelectorAll(rowSel));
            for (const row of rows) {
              if (!(row.textContent || "").includes(targetId)) continue;
              const el = row.querySelector(clickSel) as HTMLElement;
              if (el) {
                el.click();
                return true;
              }
            }
            return false;
          }, { targetId: info.targetId, rowSel: config.orderRowSelector, clickSel: config.inlineTracking.clickSelector });

          if (clicked) {
            const modalDelay = config.inlineTracking.modalDelay || 4000;
            console.log(`[recipe-engine]   Clicked tracking for ${info.targetId}, waiting ${modalDelay}ms...`);
            await page.waitForTimeout(modalDelay);

            // Extract status and tracking from the modal
            const modalData = await page.evaluate(({ statusPat, trackPats, noTexts, statusMap }) => {
              const bodyText = document.body.innerText;
              let extractedStatus: string | null = null;
              let tracking: string | null = null;

              // Extract status from modal
              if (statusPat) {
                const m = bodyText.match(new RegExp(statusPat, "i"));
                if (m?.[1]) extractedStatus = m[1].trim();
              }

              // Extract tracking number
              for (const pat of trackPats) {
                const m = bodyText.match(new RegExp(pat, "i"));
                if (m?.[1]) { tracking = m[1].trim(); break; }
              }

              // Check "no tracking" texts
              if (!tracking) {
                const bodyLower = bodyText.toLowerCase();
                for (const nt of noTexts) {
                  if (bodyLower.includes(nt.toLowerCase())) { tracking = null; break; }
                }
              }

              return { status: extractedStatus, tracking };
            }, {
              statusPat: config.inlineTracking.statusPattern || null,
              trackPats: config.trackingPatterns,
              noTexts: config.noTrackingTexts,
              statusMap: config.statusMapping,
            });

            if (modalData.status) {
              status = config.statusMapping[modalData.status] || modalData.status;
              console.log(`[recipe-engine]   Modal status for ${info.targetId}: "${modalData.status}" → "${status}"`);
            }
            if (modalData.tracking) {
              trackingNumber = modalData.tracking;
              console.log(`[recipe-engine]   Tracking for ${info.targetId}: ${trackingNumber}`);
            }

            // Close modal
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(800);
            // Close any additional popups (loyalty club etc.)
            await page.keyboard.press("Escape").catch(() => {});
            await page.waitForTimeout(300);
          } else {
            console.log(`[recipe-engine]   No tracking element found for ${info.targetId}`);
          }
        } catch (err) {
          console.log(`[recipe-engine]   Inline tracking error for ${info.targetId}: ${(err as Error).message?.substring(0, 80)}`);
          // Try to close any open modal
          await page.keyboard.press("Escape").catch(() => {});
          await page.waitForTimeout(500);
        }
      }

      results.push({
        shopOrderId: info.targetId,
        status,
        rawStatus: info.rawStatus || status,
        trackingNumber,
        referenceNumber: null,
        success: true,
      });
    }

    // --- Step 3: Check if we need to paginate ---
    if (remainingIds.size === 0 || !config.paginationNextSelector) break;

    const hasNext = await page.evaluate((sel) => {
      const btn = document.querySelector(sel) as HTMLButtonElement;
      return btn && !btn.disabled;
    }, config.paginationNextSelector);
    if (!hasNext) {
      console.log(`[recipe-engine] No more pages (pagination button not found or disabled)`);
      break;
    }

    // Click next page (use JS click for SPA compatibility)
    try {
      const clicked = await page.evaluate((sel) => {
        const btn = document.querySelector(sel) as HTMLElement;
        if (btn && !(btn as HTMLButtonElement).disabled) {
          btn.click();
          return true;
        }
        return false;
      }, config.paginationNextSelector);

      if (!clicked) {
        console.log(`[recipe-engine] Pagination button disabled or not clickable`);
        break;
      }

      const delay = config.paginationDelay || 3000;
      console.log(`[recipe-engine] Page ${pageNum} → ${pageNum + 1}, waiting ${delay}ms...`);
      await page.waitForTimeout(delay);
      // Wait for new content to appear
      if (config.orderRowSelector) {
        await page.waitForSelector(config.orderRowSelector, { timeout: 15000 }).catch(() => {});
      }
      pageNum++;
    } catch (err) {
      console.log(`[recipe-engine] Pagination click failed: ${(err as Error).message?.substring(0, 80)}`);
      break;
    }
  }

  // Mark unfound orders
  for (const id of remainingIds) {
    results.push({
      shopOrderId: id,
      status: null, rawStatus: null, trackingNumber: null, referenceNumber: null,
      success: false, error: `Order ${id} not found on ${pageNum} pages`,
    });
  }

  console.log(`[recipe-engine] domExtract done: ${results.filter(r => r.success).length}/${targetOrderIds.length} found across ${pageNum} pages`);
  return results;
}

/** Resolve a dot-separated path in a nested object (e.g. "data.items[0].name") */
function resolvePath(obj: any, path: string): any {
  return path.split(".").reduce((acc, key) => {
    if (acc == null) return null;
    // Handle array index notation: "items[0]"
    const match = key.match(/^(\w+)\[(\d+)\]$/);
    if (match) {
      return acc[match[1]]?.[parseInt(match[2])];
    }
    return acc[key];
  }, obj);
}

/**
 * API-based extraction: intercept SPA API responses → get orders + tracking.
 * 1. Set up response interceptor for the orders API
 * 2. Navigate to orders page (SPA makes API call)
 * 3. Match target orders from API response → get status + tracking_identifier
 * 4. Call public tracking API directly for tracking numbers
 * 5. Paginate via JS click if needed
 */
async function executeApiExtract(
  page: Page,
  config: ApiExtractConfig,
  targetOrderIds: string[],
  capturedApiResponse?: any,
): Promise<OrderResult[]> {
  const results: OrderResult[] = [];
  const remainingIds = new Set(targetOrderIds);
  const foundOrders = new Map<string, { status: string | null; rawStatus: string | null; trackingId: string | null; carrier: string | null }>();

  // Use captured response from executeRecipe or set up new interceptor
  let latestOrdersResponse: any = capturedApiResponse || null;
  const responseHandler = async (response: any) => {
    const url = response.url();
    if (url.includes(config.ordersApiPattern)) {
      try {
        latestOrdersResponse = await response.json();
      } catch { /* non-json */ }
    }
  };
  page.on("response", responseHandler);

  try {
    let pageNum = 1;
    const MAX_PAGES = 50;

    // Wait for the initial orders API response if not already captured
    if (!latestOrdersResponse) {
      console.log(`[recipe-engine] apiExtract: waiting for API response (pattern: ${config.ordersApiPattern})...`);
      for (let i = 0; i < 30; i++) {
        if (latestOrdersResponse) break;
        await page.waitForTimeout(500);
      }
    } else {
      console.log(`[recipe-engine] apiExtract: using pre-captured API response`);
    }

    while (remainingIds.size > 0 && pageNum <= MAX_PAGES) {
      if (!latestOrdersResponse) {
        console.log(`[recipe-engine] apiExtract: no API response received on page ${pageNum}`);
        break;
      }

      // Extract orders from API response
      const orders = resolvePath(latestOrdersResponse, config.ordersPath);
      if (!Array.isArray(orders)) {
        console.log(`[recipe-engine] apiExtract: orders array not found at path "${config.ordersPath}"`);
        break;
      }

      console.log(`[recipe-engine] apiExtract page ${pageNum}: ${orders.length} orders in API response, searching for ${remainingIds.size} target orders`);

      for (const order of orders) {
        const orderNumber = resolvePath(order, config.orderNumberField);
        if (!orderNumber || !remainingIds.has(orderNumber)) continue;

        remainingIds.delete(orderNumber);
        const rawStatus = resolvePath(order, config.statusField) || null;
        const trackingId = resolvePath(order, config.trackingIdField) || null;
        const carrier = config.carrierField ? resolvePath(order, config.carrierField) || null : null;
        const status = rawStatus ? (config.statusMapping[rawStatus] || rawStatus) : null;

        foundOrders.set(orderNumber, { status, rawStatus, trackingId, carrier });
        console.log(`[recipe-engine]   Found ${orderNumber}: status="${rawStatus}" → "${status}", trackingId=${trackingId?.substring(0, 20) || "none"}${carrier ? ` (${carrier})` : ""}`);
      }

      // Check if we need to paginate
      if (remainingIds.size === 0 || (!config.paginationNextSelector && !config.paginationScript)) break;

      // Check if there's a next page button/action
      let hasNext = false;
      if (config.paginationScript) {
        hasNext = true; // Script will handle its own check
      } else if (config.paginationNextSelector) {
        hasNext = await page.evaluate((sel) => {
          const btn = document.querySelector(sel) as HTMLButtonElement;
          return btn && !btn.disabled;
        }, config.paginationNextSelector);
      }

      if (!hasNext) {
        console.log(`[recipe-engine] apiExtract: no more pages`);
        break;
      }

      // Click next page and wait for new API response
      latestOrdersResponse = null;

      // Set up a promise that resolves when the new API response arrives
      const responsePromise = new Promise<void>((resolve) => {
        const onResp = async (response: any) => {
          if (response.url().includes(config.ordersApiPattern)) {
            try {
              latestOrdersResponse = await response.json();
              console.log(`[recipe-engine] apiExtract: captured page ${pageNum + 1} API response`);
              page.off("response", onResp);
              resolve();
            } catch { /* non-json */ }
          }
        };
        page.on("response", onResp);
      });

      let clicked = false;
      if (config.paginationScript) {
        // Execute custom pagination script (find button by text, call function, etc.)
        clicked = await page.evaluate(async (script) => {
          try { return await eval(script); } catch { return false; }
        }, config.paginationScript) as boolean;
      } else if (config.paginationNextSelector) {
        clicked = await page.evaluate((sel) => {
          const btn = document.querySelector(sel) as HTMLElement;
          if (btn && !(btn as HTMLButtonElement).disabled) {
            btn.click();
            return true;
          }
          return false;
        }, config.paginationNextSelector);
      }

      if (!clicked) break;

      const timeout = 30000; // 30s — production may be slower
      console.log(`[recipe-engine] apiExtract: page ${pageNum} → ${pageNum + 1}, waiting up to ${timeout}ms for API response...`);

      // Wait for response with timeout
      await Promise.race([responsePromise, page.waitForTimeout(timeout)]);

      // If response hasn't arrived yet, give it extra time (may be arriving right now)
      if (!latestOrdersResponse) {
        console.log(`[recipe-engine] apiExtract: no response after ${timeout}ms on page ${pageNum + 1}, retrying 10s more...`);
        await Promise.race([responsePromise, page.waitForTimeout(10000)]);
      }

      if (!latestOrdersResponse) {
        console.log(`[recipe-engine] apiExtract: no API response on page ${pageNum + 1} after 40s — stopping pagination`);
        break;
      }
      pageNum++;
    }

    // --- Phase 2: Fetch tracking numbers from public API ---
    if (config.trackingApiUrl && config.trackingNumberPath) {
      console.log(`[recipe-engine] apiExtract: fetching tracking for ${foundOrders.size} orders...`);

      for (const [orderId, info] of foundOrders) {
        if (!info.trackingId) continue;

        const trackingUrl = config.trackingApiUrl.replace("{trackingId}", info.trackingId);
        try {
          // Call tracking API directly from the page context (same-origin or CORS-friendly)
          const trackingData = await page.evaluate(async (url) => {
            try {
              const resp = await fetch(url, { mode: "cors" });
              if (!resp.ok) return null;
              return await resp.json();
            } catch {
              return null;
            }
          }, trackingUrl);

          if (trackingData) {
            const trackingNumber = resolvePath(trackingData, config.trackingNumberPath);
            const carrier = config.trackingCarrierPath ? resolvePath(trackingData, config.trackingCarrierPath) : null;
            if (trackingNumber) {
              console.log(`[recipe-engine]   ${orderId}: tracking=${trackingNumber}${carrier ? ` (${carrier})` : ""}`);
              // Update the order info with tracking
              (info as any).trackingNumber = trackingNumber;
            }
          }
        } catch (err) {
          console.log(`[recipe-engine]   Tracking API error for ${orderId}: ${(err as Error).message?.substring(0, 80)}`);
        }
      }
    }

    // Build results
    for (const [orderId, info] of foundOrders) {
      // If no secondary tracking API, use trackingId directly as tracking number
      const trackingNumber = (info as any).trackingNumber || (!config.trackingApiUrl ? info.trackingId : null);
      results.push({
        shopOrderId: orderId,
        status: info.status,
        rawStatus: info.rawStatus,
        trackingNumber: trackingNumber || null,
        referenceNumber: null,
        estimatedDeliveryDate: null,
        success: true,
        courier: info.carrier || undefined,
      } as any);
    }

    // Mark unfound orders
    for (const id of remainingIds) {
      results.push({
        shopOrderId: id,
        status: null, rawStatus: null, trackingNumber: null, referenceNumber: null,
        success: false, error: `Order ${id} not found via API`,
      });
    }

    console.log(`[recipe-engine] apiExtract done: ${foundOrders.size}/${targetOrderIds.length} found`);
  } finally {
    page.off("response", responseHandler);
  }

  return results;
}

/**
 * Build a tracking URL for a REAL carrier tracking number.
 * SEUR refs are handled separately via buildReferenceUrl.
 * spring-gds with H-prefix numbers are actually Hermes.
 */
function buildTrackingUrl(tracking: string, courier?: string): string {
  const c = (courier || "").toLowerCase();
  // DPD: courier hint or starts with 0 + 13-14 digits
  if (c === "dpd" || /^0\d{12,13}$/.test(tracking))
    return `https://my.dpd.de/myParcel.aspx?parcelno=${tracking}`;
  // GLS: courier hint or 10-12 pure digits
  if (c === "gls" || (c === "" && /^\d{10,12}$/.test(tracking)))
    return `https://gls-group.com/DE/de/paketverfolgung?match=${tracking}`;
  // Hermes: courier hint OR spring-gds with H-prefix (actually Hermes)
  if (c === "hermes" || c === "spring-gds" || /^H\d{18,20}$/.test(tracking))
    return `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#${tracking}`;
  // Correos Express
  if (c === "correos" || c === "correos express")
    return `https://s.correosexpress.com/SegusimientoSin498/search?shippingNumber=${tracking}`;
  // DHL
  if (c === "dhl")
    return `https://www.dhl.com/de-de/home/tracking/tracking-parcel.html?submit=1&tracking-id=${tracking}`;
  // UPS
  if (c === "ups")
    return `https://www.ups.com/track?tracknum=${tracking}`;
  // Fallback: just return the tracking number
  return tracking;
}

/**
 * Build a reference/tracking URL for SEUR reference numbers.
 */
function buildReferenceUrl(ref: string, courier?: string): string {
  if ((courier || "").toLowerCase() === "seur")
    return `https://www.seur.com/livetracking/?segOnlineIdentificador=${ref}`;
  return ref;
}

/**
 * JS-based extraction: run custom JavaScript in the page context.
 * The extractScript receives targetOrderIds as parameter and returns OrderResult[].
 * Supports pagination via selector click + re-extraction.
 * If extractScript returns `courier` field, tracking URL is built automatically via buildTrackingUrl.
 */
async function executeJsExtract(
  page: Page,
  config: JsExtractConfig,
  targetOrderIds: string[],
): Promise<OrderResult[]> {
  const allResults: OrderResult[] = [];
  const remainingIds = new Set(targetOrderIds);
  let pageNum = 1;
  const maxPages = config.maxPages || 50;
  let totalExtracted = 0;

  console.log(`[recipe-engine] jsExtract: looking for ${targetOrderIds.length} orders${config.extractAllOrders ? " (extractAllOrders mode)" : ""}`);

  while (remainingIds.size > 0 && pageNum <= maxPages) {
    // Run the extraction script in page context
    const rawResults: any[] = await page.evaluate(
      ({ script, orderIds }) => {
        const fn = new Function("targetOrderIds", script);
        return fn(orderIds);
      },
      { script: config.extractScript, orderIds: [...remainingIds] },
    );

    const pageResults = Array.isArray(rawResults) ? rawResults.length : 0;
    totalExtracted += pageResults;

    if (Array.isArray(rawResults)) {
      let foundOnPage = 0;
      for (const r of rawResults) {
        if (!r.shopOrderId) continue;

        // In extractAllOrders mode, check if this is a target order
        const isTarget = remainingIds.has(r.shopOrderId);
        if (isTarget) {
          remainingIds.delete(r.shopOrderId);
          foundOnPage++;
          // Store raw tracking number and reference (URLs built at display time)
          const trackingValue = r.trackingNumber || null;
          const referenceValue = r.referenceNumber || null;
          allResults.push({
            shopOrderId: r.shopOrderId,
            status: r.status || null,
            rawStatus: r.rawStatus || null,
            trackingNumber: trackingValue,
            referenceNumber: referenceValue,
            estimatedDeliveryDate: r.estimatedDeliveryDate || null,
            success: r.success !== false,
            error: r.error,
          });
          console.log(`[recipe-engine]   FOUND ${r.shopOrderId}: status="${r.status}", tracking=${trackingValue || "none"}${r.courier ? ` (${r.courier})` : ""}${referenceValue ? `, ref=${referenceValue}` : ""}`);
        }
      }
      console.log(`[recipe-engine] jsExtract page ${pageNum}: ${pageResults} orders extracted, ${foundOnPage} targets found, ${remainingIds.size} remaining`);
    } else {
      console.log(`[recipe-engine] jsExtract page ${pageNum}: no results`);
    }

    // Check if we need to paginate
    if (remainingIds.size === 0) {
      console.log(`[recipe-engine] jsExtract: all ${targetOrderIds.length} target orders found!`);
      break;
    }
    if (!config.paginationSelector && !config.paginationScript) break;

    // Check if extraction returned 0 new results (page is exhausted)
    if (pageResults === 0) {
      console.log(`[recipe-engine] jsExtract: no new orders on page ${pageNum}, stopping`);
      break;
    }

    if (config.paginationScript) {
      // Execute custom pagination function (e.g. "ver_mas_pedidos()")
      await page.evaluate(async (script) => {
        try { await eval(script); } catch {}
      }, config.paginationScript);
      const delay = config.paginationDelay || 5000;
      await page.waitForTimeout(delay);
    } else if (config.paginationSelector) {
      const hasNext = await page.evaluate((sel) => {
        const btn = document.querySelector(sel) as HTMLElement;
        return btn && !(btn as HTMLButtonElement).disabled;
      }, config.paginationSelector);

      if (!hasNext) {
        console.log(`[recipe-engine] jsExtract: no more pages`);
        break;
      }

      // Click pagination
      await page.evaluate((sel) => {
        const btn = document.querySelector(sel) as HTMLElement;
        if (btn) btn.click();
      }, config.paginationSelector);

      const delay = config.paginationDelay || 3000;
      await page.waitForTimeout(delay);
    }

    pageNum++;
  }

  // Mark unfound orders
  for (const id of remainingIds) {
    allResults.push({
      shopOrderId: id,
      status: null, rawStatus: null, trackingNumber: null, referenceNumber: null,
      success: false, error: `Order ${id} not found across ${pageNum} pages (${totalExtracted} total orders scanned)`,
    });
  }

  const withTracking = allResults.filter(r => r.trackingNumber).length;
  console.log(`[recipe-engine] jsExtract done: ${allResults.filter(r => r.success).length}/${targetOrderIds.length} targets found, ${withTracking} with tracking, ${totalExtracted} total orders scanned across ${pageNum} pages`);

  return allResults;
}

export async function executeRecipe(
  page: Page,
  recipe: ShopRecipeData,
  credentials: Credentials,
  orderIds: string[],
  existingTracking?: Map<string, string>,
): Promise<OrderResult[]> {
  const allResults: OrderResult[] = [];

  const vars: Record<string, string> = {
    email: credentials.email,
    password: credentials.password,
  };

  // Dismiss cookie banner before starting (longer wait on first page load)
  // Skip auto-dismiss for recipes that handle consent explicitly in their steps
  const hasExplicitConsent = recipe.steps.some(s => s.description?.toLowerCase().includes("cookie") || s.description?.toLowerCase().includes("consent"));
  if (!hasExplicitConsent) {
    await autoDismissCookieBanner(page, 2000);
  } else {
    console.log("[recipe-engine] Recipe has explicit consent steps — skipping auto cookie dismiss");
  }

  // Set up API interceptor early if recipe uses apiExtract
  // This captures the API response when the SPA makes its call (during goto/wait steps)
  let capturedApiResponse: any = null;
  if (recipe.apiExtractConfig) {
    const pattern = recipe.apiExtractConfig.ordersApiPattern;
    // Capture API RESPONSE
    page.on("response", async (response) => {
      if (response.url().includes(pattern)) {
        try {
          capturedApiResponse = await response.json();
          const items = resolvePath(capturedApiResponse, recipe.apiExtractConfig!.ordersPath);
          console.log(`[recipe-engine] Captured API response: ${pattern} (${Array.isArray(items) ? items.length : "error"} items)`);
        } catch { /* ok */ }
      }
    });
  }

  // Execute login and navigation steps
  for (const step of recipe.steps) {
    if (step.type === "apiExtract") {
      // API-based extraction (intercept SPA API + public tracking API)
      if (recipe.apiExtractConfig) {
        const extracted = await executeApiExtract(page, recipe.apiExtractConfig, orderIds, capturedApiResponse);
        allResults.push(...extracted);
      }
      continue;
    }

    if (step.type === "domExtract") {
      // DOM-based extraction with detail page navigation
      if (recipe.domExtractConfig) {
        const extracted = await executeDomExtract(page, recipe.domExtractConfig, orderIds);
        allResults.push(...extracted);
      }
      continue;
    }

    if (step.type === "jsExtract") {
      // JS-based extraction (custom JavaScript in page context)
      if (recipe.jsExtractConfig) {
        try {
          const extracted = await executeJsExtract(page, recipe.jsExtractConfig, orderIds);
          allResults.push(...extracted);
        } catch (err) {
          if (step.optional) {
            console.log(`[recipe-engine] optional jsExtract failed (ignored): ${(err as Error).message?.substring(0, 80)}`);
          } else {
            throw err;
          }
        }
      }
      continue;
    }

    if (step.type === "extractOrders") {
      // Extract all visible orders
      const extracted = await extractOrderData(
        page,
        recipe.extractionRules,
        recipe.statusMapping,
        recipe.orderListSelector,
      );
      allResults.push(...extracted);
      continue;
    }

    if (step.type === "extractSingle") {
      // For each order ID, navigate and extract
      for (const orderId of orderIds) {
        vars.orderId = orderId;
        // Re-execute the goto step with the orderId
        if (step.selector) {
          const url = interpolate(step.selector, vars);
          await page.goto(url, { waitUntil: "domcontentloaded" });
        }
        const extracted = await extractOrderData(page, recipe.extractionRules, recipe.statusMapping);
        allResults.push(...extracted);
      }
      continue;
    }

    // For fill steps that reference orderId, we need to handle each order
    await executeStep(page, step, vars);
  }

  return allResults;
}
