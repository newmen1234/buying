import type { Page } from "playwright";
import OpenAI from "openai";
import { buildPageContext } from "./html-utils";
import type { ShopRecipeData, RecipeStep, OrderResult, DomExtractConfig } from "./recipe-engine";
import { storage } from "../storage";
import { detectPlatform, buildPlatformContext, type PlatformInfo } from "./platform-detector";
import { autoDismissCookieBanner } from "./cookie-utils";

// ── Config ───────────────────────────────────────────────────────
const AI_MODEL = "gpt-4o";          // Smarter model for reliable navigation
const MAX_STEPS = 25;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;

// ── Types ────────────────────────────────────────────────────────

interface AIAction {
  action: "goto" | "fill" | "click" | "wait" | "form_submit" | "extract_done";
  selector?: string;
  value?: string;
  description?: string;
  extractedData?: {
    orders: Array<{
      orderId: string;
      status: string;
      trackingNumber?: string;
    }>;
    statusMapping?: Record<string, string>;
    extractionRules?: {
      orderId: string;
      status: string;
      trackingNumber?: string;
    };
    orderListSelector?: string;
  };
}

/** Plan produced by Phase 1 */
interface NavigationPlan {
  steps: string[];
  loginUrl: string;
  ordersUrl: string;
  platform: string;
  notes: string;
}

interface NavigationResult {
  results: OrderResult[];
  recipe: ShopRecipeData | null;
  tokensUsed: number;
  stepsLog: string[];
}

export interface LiveStep {
  step: number;
  action: string;
  description: string;
  status: "ok" | "failed" | "skipped" | "running";
  url?: string;
}

// ── OpenAI client ────────────────────────────────────────────────

function getOpenAIClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ── Default system prompt ────────────────────────────────────────

export const DEFAULT_SYSTEM_PROMPT = `You are an expert web automation agent that navigates German e-commerce shop websites to check order statuses.

You receive BOTH a screenshot of the current page AND a compact HTML summary (forms, links, page text).
Use the screenshot as the PRIMARY source of truth — it shows you exactly what a user sees (buttons, layout, popups).
Use the HTML summary for precise CSS selectors when you need to interact with elements.

YOUR GOAL:
1. Log in with the provided credentials
2. Navigate to the order history/status page
3. Extract order status and tracking numbers for the target orders

CRITICAL RULES:
- Cookie banners are handled automatically BEFORE you start. IGNORE any cookie/consent banners you see — focus on login and navigation.
- ALWAYS look at the screenshot first to understand what's on the page
- Use "goto" with direct URLs whenever you know the target path — this is MUCH faster and more reliable than clicking links
- If the NAVIGATION PLAN provides a loginUrl, go DIRECTLY there with "goto" as your first action
- After login, go DIRECTLY to the orders URL from the plan
- If a selector fails, try alternative selectors or navigate via URL
- NEVER re-use a selector from the FAILED SELECTORS list
- If you tried a cookie-related action and it failed, SKIP cookies entirely and proceed with login
- If stuck, try common German shop URLs: /mein-konto, /account, /account/login, /customer/account/login, /my-account
- IMPORTANT: Many pages have MULTIPLE forms (login + registration). ALWAYS use form-specific selectors like "form#loginForm input[name='email']" instead of just "input[name='email']" to avoid filling the wrong form!
- If PLATFORM TIPS provide specific selectors, USE THEM — they are tested and correct for this platform
- After filling email and password, submit the form. PREFER "form_submit" over "click" when platform tips recommend it — form_submit uses JavaScript form.submit() which is more reliable than clicking buttons (overlays can intercept clicks).
- If "click" on a submit button fails, try "form_submit" with the form selector instead.

German vocabulary:
- Anmelden/Einloggen = Sign in, E-Mail-Adresse = Email, Passwort = Password
- Bestellungen/Meine Bestellungen = My Orders, Bestellübersicht = Order overview
- Versendet = Shipped, In Bearbeitung = Processing, Storniert = Cancelled
- Geliefert/Zugestellt = Delivered, Sendungsnummer = Tracking number
- Konto = Account, bezahlt = paid

Respond with ONE JSON action:
- {"action": "fill", "selector": "CSS_SELECTOR", "value": "VALUE", "description": "..."}
- {"action": "click", "selector": "CSS_SELECTOR", "description": "..."}
- {"action": "form_submit", "selector": "FORM_CSS_SELECTOR", "description": "..."} — submits form via JS, more reliable than click
- {"action": "goto", "selector": "URL", "description": "..."}
- {"action": "wait", "selector": "CSS_SELECTOR", "description": "..."}
- {"action": "extract_done", "description": "...", "extractedData": {"orders": [{"orderId": "...", "status": "...", "trackingNumber": "..."}]}}

Use {{email}}, {{password}}, {{orderId}} as credential/order placeholders in fill values.`;

async function getSystemPrompt(): Promise<string> {
  try {
    const saved = await storage.getAppSetting("shop_agent_system_prompt");
    if (saved && saved.trim().length > 0) return saved;
  } catch (err) {
    console.error("[ai-navigator] Failed to load prompt from DB, using default:", err);
  }
  return DEFAULT_SYSTEM_PROMPT;
}

// ── Helpers ──────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Take a screenshot and return base64 */
async function screenshotBase64(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: "jpeg", quality: 60, fullPage: false });
  return buffer.toString("base64");
}

/** Call GPT-4o with vision (screenshot + text) */
async function callAIWithVision(
  client: OpenAI,
  systemPrompt: string,
  screenshot: string,
  textMessage: string,
): Promise<{ action: AIAction; tokensUsed: number }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: AI_MODEL,
        max_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${screenshot}`, detail: "low" },
              },
              { type: "text", text: textMessage },
            ],
          },
        ],
      });

      const text = response.choices[0]?.message?.content || "{}";
      const tokensUsed = (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);

      const action = JSON.parse(text) as AIAction;
      if (!action.action) {
        throw new Error(`Invalid action response: ${text.substring(0, 200)}`);
      }
      return { action, tokensUsed };
    } catch (err: any) {
      lastError = err;
      const isRateLimit = err?.status === 429;
      const isServerError = err?.status >= 500;
      const isParseError = err instanceof SyntaxError || err?.message?.includes("Invalid action");

      if ((isRateLimit || isServerError || isParseError) && attempt < MAX_RETRIES - 1) {
        const delay = RETRY_DELAY_MS * (attempt + 1);
        console.log(`[ai-navigator] Error (${err?.status || "parse"}), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

/** Call GPT-4o text-only (for planning phase) */
async function callAIText(
  client: OpenAI,
  systemPrompt: string,
  userMessage: string,
): Promise<{ text: string; tokensUsed: number }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: AI_MODEL,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
      });

      const text = response.choices[0]?.message?.content || "{}";
      const tokensUsed = (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);
      return { text, tokensUsed };
    } catch (err: any) {
      lastError = err;
      if ((err?.status === 429 || err?.status >= 500) && attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error("Max retries exceeded");
}

// ── Human-readable descriptions ──────────────────────────────────

function buildHumanDescription(action: AIAction): string {
  const desc = action.description || "";
  switch (action.action) {
    case "goto":
      return `Переход на ${action.selector || "страницу"}`;
    case "fill": {
      if (action.value?.includes("{{email}}")) return "Ввод email";
      if (action.value?.includes("{{password}}")) return "Ввод пароля";
      if (action.value?.includes("{{orderId}}")) return "Ввод номера заказа";
      return desc || "Заполнение поля";
    }
    case "click": {
      const lower = (desc + " " + (action.selector || "")).toLowerCase();
      if (lower.includes("cookie") || lower.includes("akzeptieren") || lower.includes("consent") || lower.includes("accept"))
        return "Закрытие cookie-баннера";
      if (lower.includes("login") || lower.includes("anmeld") || lower.includes("einlog") || lower.includes("sign"))
        return "Нажатие кнопки входа";
      if (lower.includes("submit") || lower.includes("absend"))
        return "Отправка формы";
      if (lower.includes("order") || lower.includes("bestell") || lower.includes("meine"))
        return "Переход к заказам";
      if (lower.includes("konto") || lower.includes("account") || lower.includes("profil"))
        return "Переход в личный кабинет";
      return desc || `Клик: ${(action.selector || "").substring(0, 40)}`;
    }
    case "form_submit":
      return "Отправка формы (JS)";
    case "wait":
      return desc || "Ожидание загрузки";
    case "extract_done":
      return "Извлечение данных заказа";
    default:
      return desc || action.action;
  }
}

// ── Phase 1: Explore & Plan ──────────────────────────────────────

async function buildNavigationPlan(
  client: OpenAI,
  page: Page,
  platformInfo: PlatformInfo,
  domain: string,
  orderIds: string[],
  hints?: string,
): Promise<{ plan: NavigationPlan; tokensUsed: number }> {
  const html = await page.content();
  const pageContext = buildPageContext(html, page.url());
  const platformContext = buildPlatformContext(platformInfo);

  const planPrompt = `You are analyzing a German e-commerce website to create a navigation plan.

Given the homepage HTML and detected platform info, produce a JSON plan with:
- "steps": array of human-readable steps to reach the orders page (e.g. ["Go to login page", "Fill email", "Fill password", "Submit login", "Navigate to orders"])
- "loginUrl": the best URL to navigate to for logging in (full URL with https://)
- "ordersUrl": the best URL for the order history page (full URL with https://)
- "platform": detected platform name
- "notes": any important observations about this site

Use the platform detection hints if available — they contain known URL patterns and selectors for this shop platform.
If platform is unknown, analyze the HTML to find login forms and account links.`;

  let userMessage = `Domain: ${domain}\nTarget orders: ${orderIds.join(", ")}\n\n`;
  if (platformContext) userMessage += `${platformContext}\n\n`;
  if (hints) userMessage += `USER HINTS: ${hints}\n\n`;
  userMessage += `Current page:\n${pageContext}`;

  const result = await callAIText(client, planPrompt, userMessage);

  try {
    const plan = JSON.parse(result.text) as NavigationPlan;
    return { plan, tokensUsed: result.tokensUsed };
  } catch {
    // Fallback plan from platform detection
    const baseUrl = `https://${domain}`;
    return {
      plan: {
        steps: ["Navigate to login", "Fill credentials", "Submit login", "Go to orders", "Extract data"],
        loginUrl: platformInfo.loginUrl || `${baseUrl}/account/login`,
        ordersUrl: platformInfo.ordersUrl || `${baseUrl}/account/orders`,
        platform: platformInfo.platform,
        notes: "Plan generated from platform detection (AI planning failed)",
      },
      tokensUsed: result.tokensUsed,
    };
  }
}

// ── Checkpoint: save/load partial progress ───────────────────────

interface Checkpoint {
  domain: string;
  steps: RecipeStep[];
  plan: NavigationPlan;
  updatedAt: string;
}

async function loadCheckpoint(domain: string): Promise<Checkpoint | null> {
  try {
    const raw = await storage.getAppSetting(`checkpoint:${domain}`);
    if (!raw) return null;
    const cp = JSON.parse(raw) as Checkpoint;
    // Expire checkpoints older than 24h
    if (Date.now() - new Date(cp.updatedAt).getTime() > 24 * 60 * 60 * 1000) {
      await storage.setAppSetting(`checkpoint:${domain}`, "");
      return null;
    }
    return cp;
  } catch { return null; }
}

async function saveCheckpoint(domain: string, steps: RecipeStep[], plan: NavigationPlan): Promise<void> {
  try {
    const cp: Checkpoint = { domain, steps, plan, updatedAt: new Date().toISOString() };
    await storage.setAppSetting(`checkpoint:${domain}`, JSON.stringify(cp));
  } catch (err) {
    console.error("[ai-navigator] Failed to save checkpoint:", err);
  }
}

async function clearCheckpoint(domain: string): Promise<void> {
  try {
    await storage.setAppSetting(`checkpoint:${domain}`, "");
  } catch {}
}

/** Replay checkpoint steps (goto, fill, click) — no AI needed */
async function replayCheckpoint(
  page: Page,
  checkpoint: Checkpoint,
  credentials: { email: string; password: string },
  orderIds: string[],
  onStep?: (step: LiveStep) => void,
): Promise<{ ok: boolean; stepsReplayed: number }> {
  const vars: Record<string, string> = {
    email: credentials.email,
    password: credentials.password,
    orderId: orderIds[0] || "",
  };

  for (let i = 0; i < checkpoint.steps.length; i++) {
    const step = checkpoint.steps[i];
    const stepNum = i + 1;
    const desc = step.description || `${step.type} ${step.selector || ""}`;

    onStep?.({ step: stepNum, action: step.type, description: `♻️ ${desc}`, status: "running", url: page.url() });

    try {
      switch (step.type) {
        case "goto": {
          let url = step.selector || "";
          if (url.startsWith("/")) url = new URL(url, page.url()).href;
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
          await autoDismissCookieBanner(page);
          break;
        }
        case "fill": {
          const value = (step.value || "")
            .replace("{{email}}", vars.email)
            .replace("{{password}}", vars.password)
            .replace("{{orderId}}", vars.orderId);
          await page.waitForSelector(step.selector!, { timeout: 10000 });
          await page.fill(step.selector!, value);
          break;
        }
        case "click": {
          await page.waitForSelector(step.selector!, { timeout: 10000 });
          try {
            await page.click(step.selector!, { timeout: 5000 });
          } catch {
            await page.click(step.selector!, { force: true });
          }
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
          await autoDismissCookieBanner(page);
          break;
        }
        case "wait": {
          await page.waitForSelector(step.selector!, { timeout: 15000 });
          break;
        }
      }
      onStep?.({ step: stepNum, action: step.type, description: `♻️ ${desc}`, status: "ok", url: page.url() });
    } catch (err) {
      console.log(`[ai-navigator] Checkpoint replay failed at step ${stepNum}: ${(err as Error).message?.substring(0, 80)}`);
      onStep?.({ step: stepNum, action: step.type, description: `♻️ ${desc} — не удалось`, status: "failed", url: page.url() });
      return { ok: false, stepsReplayed: i };
    }

    await page.waitForTimeout(300);
  }

  return { ok: true, stepsReplayed: checkpoint.steps.length };
}

// ── DOM Extraction (replaces AI hallucinated data) ──────────────

async function extractOrdersFromDOM(
  page: Page,
  targetOrderIds: string[],
  onStep?: (step: LiveStep) => void,
  stepOffset: number = 100,
): Promise<{ results: OrderResult[]; domExtractConfig: DomExtractConfig }> {
  const config: DomExtractConfig = {
    orderRowSelector: "table tbody tr, .order-item, [class*='order-row']",
    detailLinkSelector: "a[href*='bestellung='], a[href*='order/'], a[href*='order_detail']",
    trackingPatterns: [
      "Sendungsnummer[:\\s]+([A-Z0-9]{8,30})",
      "Tracking[:\\s-]+([A-Z0-9]{8,30})",
      "Paketnummer[:\\s]+([A-Z0-9]{8,30})",
    ],
    noTrackingTexts: ["noch nicht versendet"],
    statusMapping: {
      "bezahlt": "Оплачен",
      "versendet": "Отправлен",
      "storniert": "Отменен",
      "in bearbeitung": "В обработке",
      "offen": "Открыт",
      "geliefert": "Доставлен",
      "zugestellt": "Доставлен",
      "noch nicht versendet": "Еще не отправлен",
    },
  };

  // Phase 1: collect order info from the list page
  const pagePreview = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log(`[ai-navigator] DOM extract page preview: ${pagePreview.substring(0, 200).replace(/\n/g, " | ")}`);
  onStep?.({ step: stepOffset, action: "domExtract", description: "DOM: сбор данных со страницы заказов", status: "running", url: page.url() });

  const orderInfos = await page.evaluate(({ targetIds, rowSel, linkSel, statusKeys }) => {
    const results: Array<{
      targetId: string;
      found: boolean;
      rawStatus: string | null;
      detailUrl: string | null;
      rowText: string;
    }> = [];

    const rows = Array.from(document.querySelectorAll(rowSel));

    for (const targetId of targetIds) {
      let found = false;

      for (const row of rows) {
        const text = row.textContent || "";
        if (!text.includes(targetId)) continue;

        let detailUrl: string | null = null;
        const selectorLinks = Array.from(row.querySelectorAll(linkSel));
        for (const link of selectorLinks) {
          const href = link.getAttribute("href");
          if (href) { detailUrl = href; break; }
        }
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

        let rawStatus: string | null = null;
        const textLower = text.toLowerCase();
        for (const key of statusKeys) {
          if (textLower.includes(key.toLowerCase())) { rawStatus = key; break; }
        }

        results.push({ targetId, found: true, rawStatus, detailUrl, rowText: text.substring(0, 500) });
        found = true;
        break;
      }

      // Fallback: search whole page
      if (!found) {
        const allCells = Array.from(document.querySelectorAll("td, li, div, span, p"));
        for (const el of allCells) {
          const t = el.textContent || "";
          if (!t.includes(targetId) || t.length > 800) continue;
          let parent = el.parentElement;
          let detailUrl: string | null = null;
          for (let i = 0; i < 6 && parent; i++) {
            const link = parent.querySelector('a[href*="bestellung"], a[href*="order"]') as HTMLAnchorElement;
            if (link) { detailUrl = link.getAttribute("href"); break; }
            parent = parent.parentElement;
          }
          const ctx = (parent || el.parentElement)?.textContent || "";
          let rawStatus: string | null = null;
          for (const key of statusKeys) {
            if (ctx.toLowerCase().includes(key.toLowerCase())) { rawStatus = key; break; }
          }
          results.push({ targetId, found: true, rawStatus, detailUrl, rowText: ctx.substring(0, 500) });
          found = true;
          break;
        }
      }

      if (!found) {
        results.push({ targetId, found: false, rawStatus: null, detailUrl: null, rowText: "" });
      }
    }
    return results;
  }, {
    targetIds: targetOrderIds,
    rowSel: config.orderRowSelector,
    linkSel: config.detailLinkSelector,
    statusKeys: Object.keys(config.statusMapping),
  });

  const foundCount = orderInfos.filter(o => o.found).length;
  console.log(`[ai-navigator] DOM extraction: found ${foundCount}/${targetOrderIds.length} orders`);
  onStep?.({ step: stepOffset, action: "domExtract", description: `DOM: найдено ${foundCount}/${targetOrderIds.length} заказов`, status: foundCount > 0 ? "ok" : "failed", url: page.url() });

  // Phase 2: visit detail pages for tracking
  const results: OrderResult[] = [];

  for (let i = 0; i < orderInfos.length; i++) {
    const info = orderInfos[i];

    if (!info.found) {
      results.push({
        shopOrderId: info.targetId, status: null, rawStatus: null,
        trackingNumber: null, success: false, error: `Order ${info.targetId} not found on page`,
      });
      continue;
    }

    const status = info.rawStatus ? (config.statusMapping[info.rawStatus] || info.rawStatus) : null;
    let trackingNumber: string | null = null;

    if (info.detailUrl) {
      let detailUrl = info.detailUrl;
      if (detailUrl.startsWith("/")) detailUrl = new URL(detailUrl, page.url()).href;

      const stepNum = stepOffset + 1 + i;
      onStep?.({ step: stepNum, action: "goto", description: `Детали заказа ${info.targetId}`, status: "running", url: detailUrl });

      try {
        await page.goto(detailUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(1000);
        await autoDismissCookieBanner(page);

        const detail = await page.evaluate(({ trackPats, noTexts }) => {
          const bodyText = document.body.innerText;

          for (const pat of trackPats) {
            const m = bodyText.match(new RegExp(pat, "i"));
            if (m?.[1]) return { tracking: m[1], noTrackingMatch: null };
          }

          const bodyLower = bodyText.toLowerCase();
          for (const nt of noTexts) {
            if (bodyLower.includes(nt.toLowerCase())) {
              return { tracking: null, noTrackingMatch: nt };
            }
          }

          // Carrier tracking links
          const carriers = Array.from(document.querySelectorAll("a")).filter(a => {
            const h = (a.getAttribute("href") || "").toLowerCase();
            return h.includes("dhl.") || h.includes("hermes") || h.includes("dpd.") ||
                   h.includes("gls-") || h.includes("ups.") || h.includes("tracking") || h.includes("sendung");
          });
          if (carriers.length > 0) {
            return { tracking: carriers[0].textContent?.trim() || null, noTrackingMatch: null };
          }

          return { tracking: null, noTrackingMatch: null };
        }, { trackPats: config.trackingPatterns, noTexts: config.noTrackingTexts });

        if (detail.tracking) {
          trackingNumber = detail.tracking;
          onStep?.({ step: stepNum, action: "domExtract", description: `Трек: ${trackingNumber}`, status: "ok", url: page.url() });
        } else if (detail.noTrackingMatch) {
          trackingNumber = config.statusMapping[detail.noTrackingMatch] || "Еще не отправлен";
          onStep?.({ step: stepNum, action: "domExtract", description: `${trackingNumber}`, status: "ok", url: page.url() });
        } else {
          onStep?.({ step: stepNum, action: "domExtract", description: "Трек не найден", status: "ok", url: page.url() });
        }
      } catch (err) {
        onStep?.({ step: stepOffset + 1 + i, action: "domExtract", description: `Ошибка: ${(err as Error).message?.substring(0, 50)}`, status: "failed", url: page.url() });
      }
    }

    results.push({
      shopOrderId: info.targetId,
      status,
      rawStatus: info.rawStatus,
      trackingNumber,
      success: true,
    });
  }

  return { results, domExtractConfig: config };
}

// ── Phase 2: Execute with Vision ─────────────────────────────────

export async function navigateWithAI(
  page: Page,
  credentials: { email: string; password: string },
  orderIds: string[],
  domain: string,
  hints?: string,
  onStep?: (step: LiveStep) => void,
): Promise<NavigationResult> {
  const client = getOpenAIClient();
  const systemPrompt = await getSystemPrompt();
  const recordedSteps: RecipeStep[] = [];
  let totalTokens = 0;
  const stepSummaries: string[] = [];
  const failedSelectors = new Set<string>();

  // ─── Platform Detection ──────────────────────────────────────
  const initialHtml = await page.content();
  const platformInfo = detectPlatform(initialHtml, page.url());

  if (platformInfo.platform !== "unknown") {
    console.log(`[ai-navigator] Detected platform: ${platformInfo.platform} (${Math.round(platformInfo.confidence * 100)}%)`);
    onStep?.({ step: 0, action: "detect", description: `Платформа: ${platformInfo.platform} (${Math.round(platformInfo.confidence * 100)}%)`, status: "ok", url: page.url() });
  } else {
    console.log("[ai-navigator] Platform not detected, using full AI mode");
    onStep?.({ step: 0, action: "detect", description: "Платформа не определена — полный AI режим", status: "ok", url: page.url() });
  }

  // ─── Try checkpoint replay first ─────────────────────────────
  const checkpoint = await loadCheckpoint(domain);
  if (checkpoint && checkpoint.steps.length > 0) {
    console.log(`[ai-navigator] Found checkpoint for ${domain}: ${checkpoint.steps.length} steps`);
    onStep?.({ step: 0, action: "checkpoint", description: `Восстановление: ${checkpoint.steps.length} сохранённых шагов`, status: "running", url: page.url() });

    // Auto-dismiss cookie first
    await autoDismissCookieBanner(page);

    const replay = await replayCheckpoint(page, checkpoint, credentials, orderIds, onStep);
    if (replay.ok) {
      console.log(`[ai-navigator] Checkpoint replayed successfully: ${replay.stepsReplayed} steps`);
      onStep?.({ step: 0, action: "checkpoint", description: `Восстановлено ${replay.stepsReplayed} шагов`, status: "ok", url: page.url() });
      // Copy replayed steps to recordedSteps
      recordedSteps.push(...checkpoint.steps);
      stepSummaries.push(`CHECKPOINT: replayed ${replay.stepsReplayed} steps from previous session`);
    } else {
      console.log(`[ai-navigator] Checkpoint replay failed at step ${replay.stepsReplayed + 1}, falling back to AI`);
      onStep?.({ step: 0, action: "checkpoint", description: "Checkpoint не удался — AI с начала", status: "failed", url: page.url() });
      // Reset page to start
      await page.goto(`https://${domain}`, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await clearCheckpoint(domain);
    }
  }

  // ─── Phase 1: Plan ───────────────────────────────────────────
  // Use checkpoint plan if available, otherwise build new one
  let plan: NavigationPlan;
  if (checkpoint?.plan && recordedSteps.length > 0) {
    plan = checkpoint.plan;
    stepSummaries.push(`PLAN (from checkpoint): platform=${plan.platform}, login=${plan.loginUrl}, orders=${plan.ordersUrl}`);
  } else {
    onStep?.({ step: 0, action: "plan", description: "Анализ сайта и построение плана", status: "running", url: page.url() });
    try {
      const planResult = await buildNavigationPlan(client, page, platformInfo, domain, orderIds, hints);
      plan = planResult.plan;
      totalTokens += planResult.tokensUsed;
      console.log(`[ai-navigator] Plan built: login=${plan.loginUrl}, orders=${plan.ordersUrl}, platform=${plan.platform}`);
      stepSummaries.push(`PLAN: platform=${plan.platform}, login=${plan.loginUrl}, orders=${plan.ordersUrl}`);
      onStep?.({ step: 0, action: "plan", description: `План: ${plan.platform} → ${plan.steps.length} шагов`, status: "ok", url: page.url() });
    } catch (err) {
      console.error("[ai-navigator] Planning failed:", err);
      const baseUrl = `https://${domain}`;
      plan = {
        steps: [],
        loginUrl: platformInfo.loginUrl || `${baseUrl}/account/login`,
        ordersUrl: platformInfo.ordersUrl || `${baseUrl}/account`,
        platform: platformInfo.platform,
        notes: "Planning failed, using defaults",
      };
      onStep?.({ step: 0, action: "plan", description: "План не удался, используем стандартные пути", status: "failed", url: page.url() });
    }
  }

  // ─── Auto-dismiss cookie banner (if no checkpoint was used) ────
  if (recordedSteps.length === 0) {
    onStep?.({ step: 0, action: "cookie", description: "Закрытие cookie-баннера", status: "running", url: page.url() });
    const cookieDismissed = await autoDismissCookieBanner(page, 2000);
    if (cookieDismissed) {
      stepSummaries.push("Cookie banner dismissed automatically");
      onStep?.({ step: 0, action: "cookie", description: "Cookie-баннер закрыт автоматически", status: "ok", url: page.url() });
    } else {
      stepSummaries.push("No cookie banner found or could not dismiss — proceeding");
      onStep?.({ step: 0, action: "cookie", description: "Cookie-баннер не найден — продолжаем", status: "ok", url: page.url() });
    }
  }

  // ─── Build enriched context for AI steps ─────────────────────
  const platformContext = buildPlatformContext(platformInfo);

  const orderContext = orderIds.length > 0
    ? `\nTarget orders: ${orderIds.join(", ")}`
    : "";

  const hintsContext = hints?.trim()
    ? `\nUSER HINTS for ${domain}:\n${hints.trim()}\n`
    : "";

  const planContext = `\nNAVIGATION PLAN:\n- Login URL: ${plan.loginUrl}\n- Orders URL: ${plan.ordersUrl}\n- Platform: ${plan.platform}\n- Steps: ${plan.steps.join(" → ")}\n${plan.notes ? `Notes: ${plan.notes}` : ""}`;

  let cookieAttempts = 0; // Track how many times AI tries cookie actions
  const MAX_COOKIE_ATTEMPTS = 2; // After this, force-skip all cookie actions

  // ─── Phase 2: Execute with vision on every step ──────────────
  for (let step = 0; step < MAX_STEPS; step++) {
    // Take screenshot of current page
    let screenshot: string;
    try {
      screenshot = await screenshotBase64(page);
    } catch (err) {
      console.error("[ai-navigator] Screenshot failed:", err);
      stepSummaries.push("screenshot capture failed");
      continue;
    }

    // Build compact page context (HTML)
    const html = await page.content();
    const pageContext = buildPageContext(html, page.url());

    // Compose the text part of the message
    let textMessage = "";
    if (stepSummaries.length > 0) {
      textMessage += `Previous steps:\n${stepSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n`;
    }
    if (failedSelectors.size > 0) {
      textMessage += `FAILED SELECTORS (do NOT use these again):\n${Array.from(failedSelectors).join("\n")}\n\n`;
    }
    if (platformContext) {
      textMessage += `${platformContext}\n\n`;
    }
    textMessage += `${planContext}\n\n`;
    textMessage += `Current page:\n${pageContext}${orderContext}${hintsContext}\n\nLook at the screenshot and HTML above. What should I do next?`;

    // Call AI with vision
    let action: AIAction;
    try {
      const result = await callAIWithVision(client, systemPrompt, screenshot, textMessage);
      action = result.action;
      totalTokens += result.tokensUsed;
      console.log(`[ai-navigator] Step ${step + 1}: ${action.action} ${action.selector || ""} (${result.tokensUsed} tok)`);
    } catch (err) {
      console.error("[ai-navigator] AI call failed:", err);
      return {
        results: [{
          shopOrderId: orderIds[0] || "",
          status: null,
          rawStatus: null,
          trackingNumber: null,
          success: false,
          error: `AI error: ${err instanceof Error ? err.message : "unknown"}`,
        }],
        recipe: null,
        tokensUsed: totalTokens,
        stepsLog: stepSummaries,
      };
    }

    // ─── Anti-loop: skip known-failed selectors ──────────────
    if (action.selector && failedSelectors.has(action.selector) && ["click", "fill", "wait"].includes(action.action)) {
      const msg = `${action.action} "${action.selector}" — SKIPPED (already failed)`;
      stepSummaries.push(msg);
      console.log(`[ai-navigator] Step ${step + 1}: ${msg}`);
      onStep?.({ step: step + 1, action: action.action, description: "Пропущено (уже не сработало)", status: "skipped", url: page.url() });
      continue;
    }

    // ─── Anti-loop: skip repeated identical actions ──────────
    const repeatCount = stepSummaries.filter((s) => s.startsWith(`${action.action} "${action.selector}"`)).length;
    if (repeatCount >= 2 && action.action !== "extract_done") {
      const msg = `${action.action} "${action.selector}" — SKIPPED (repeated ${repeatCount}x, stuck)`;
      stepSummaries.push(msg);
      console.log(`[ai-navigator] Step ${step + 1}: ${msg}`);
      if (action.selector) failedSelectors.add(action.selector);
      onStep?.({ step: step + 1, action: action.action, description: "Зацикливание — пропуск", status: "skipped", url: page.url() });
      continue;
    }

    // ─── Anti-cookie-loop: if AI keeps trying cookie actions, force skip ──
    const isCookieAction = (() => {
      const lower = ((action.description || "") + " " + (action.selector || "")).toLowerCase();
      return lower.includes("cookie") || lower.includes("consent") || lower.includes("akzeptieren")
        || lower.includes("accept") || lower.includes("usercentrics") || lower.includes("onetrust");
    })();
    if (isCookieAction) {
      cookieAttempts++;
      if (cookieAttempts > MAX_COOKIE_ATTEMPTS) {
        const msg = `${action.action} "${action.selector}" — SKIPPED (cookie attempts exceeded, moving on)`;
        stepSummaries.push(msg);
        console.log(`[ai-navigator] Step ${step + 1}: ${msg}`);
        if (action.selector) failedSelectors.add(action.selector);
        onStep?.({ step: step + 1, action: action.action, description: "Cookie — пропуск, переходим к навигации", status: "skipped", url: page.url() });
        continue;
      }
    }

    // ─── Human description & logging ─────────────────────────
    const humanDesc = buildHumanDescription(action);
    stepSummaries.push(`${action.action}${action.selector ? ` "${action.selector}"` : ""}${action.description ? ` — ${action.description}` : ""}`);
    onStep?.({ step: step + 1, action: action.action, description: humanDesc, status: "running", url: page.url() });

    // ─── Handle extract_done ─────────────────────────────────
    if (action.action === "extract_done") {
      // Don't trust AI's extractedData — do DOM extraction instead
      onStep?.({ step: step + 1, action: "extract_done", description: "AI завершил навигацию → DOM-извлечение", status: "ok", url: page.url() });

      const domResult = await extractOrdersFromDOM(page, orderIds, onStep, step + 2);

      // Add domExtract step to recipe
      recordedSteps.push({ type: "domExtract", description: "DOM extraction with detail page navigation" });

      const recipe: ShopRecipeData = {
        domain,
        loginType: "email_password",
        loginUrl: plan.loginUrl,
        steps: recordedSteps,
        extractionRules: { orderId: "", status: "" },
        statusMapping: domResult.domExtractConfig.statusMapping,
        domExtractConfig: domResult.domExtractConfig,
      };

      const successCount = domResult.results.filter(r => r.success).length;
      console.log(`[ai-navigator] Done! DOM extracted ${successCount} orders in ${step + 1} steps, ${totalTokens} tokens`);
      onStep?.({ step: step + 2 + orderIds.length, action: "extract_done", description: `Извлечено: ${successCount} заказ(ов)`, status: "ok", url: page.url() });

      await clearCheckpoint(domain);
      return { results: domResult.results, recipe, tokensUsed: totalTokens, stepsLog: stepSummaries };
    }

    // ─── Execute the action ──────────────────────────────────
    try {
      switch (action.action) {
        case "goto": {
          if (action.selector) {
            // Resolve relative URLs
            let targetUrl = action.selector;
            if (targetUrl.startsWith("/")) {
              targetUrl = new URL(targetUrl, page.url()).href;
            }
            await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
            // Auto-dismiss cookie banner after each navigation
            await autoDismissCookieBanner(page);
            recordedSteps.push({ type: "goto", selector: action.selector, description: action.description });
          }
          break;
        }
        case "fill": {
          if (action.selector && action.value) {
            const recipeValue = action.value;
            const actualValue = action.value
              .replace("{{email}}", credentials.email)
              .replace("{{password}}", credentials.password)
              .replace("{{orderId}}", orderIds[0] || "");

            await page.waitForSelector(action.selector, { timeout: 10000 });
            await page.fill(action.selector, actualValue);
            recordedSteps.push({ type: "fill", selector: action.selector, value: recipeValue, description: action.description });
          }
          break;
        }
        case "click": {
          if (action.selector) {
            await page.waitForSelector(action.selector, { timeout: 10000 });
            try {
              await page.click(action.selector, { timeout: 5000 });
            } catch (clickErr: any) {
              // If element is intercepted by overlay, retry with force
              const msg = clickErr?.message || "";
              if (msg.includes("intercept") || msg.includes("Timeout")) {
                console.log(`[ai-navigator] Click intercepted, retrying with force: ${action.selector}`);
                await page.click(action.selector, { force: true });
              } else {
                throw clickErr;
              }
            }
            await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
            // Auto-dismiss cookie banner after click-navigation
            await autoDismissCookieBanner(page);
            recordedSteps.push({ type: "click", selector: action.selector, description: action.description });
          }
          break;
        }
        case "form_submit": {
          if (action.selector) {
            await page.waitForSelector(action.selector, { timeout: 10000 });
            // Use waitForNavigation to properly handle form submission redirects
            await Promise.all([
              page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
              page.evaluate((sel) => {
                const form = document.querySelector(sel) as HTMLFormElement;
                if (form) form.submit();
              }, action.selector),
            ]);
            // Extra wait for login session to settle
            await page.waitForTimeout(2000);
            recordedSteps.push({ type: "click", selector: action.selector, description: action.description });
          }
          break;
        }
        case "wait": {
          if (action.selector) {
            await page.waitForSelector(action.selector, { timeout: 15000 });
            recordedSteps.push({ type: "wait", selector: action.selector, description: action.description });
          }
          break;
        }
      }
      // Success — save checkpoint after each successful step
      onStep?.({ step: step + 1, action: action.action, description: humanDesc, status: "ok", url: page.url() });
      // Save checkpoint so we can resume from here on next attempt
      if (!isCookieAction && recordedSteps.length > 0) {
        await saveCheckpoint(domain, recordedSteps, plan);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "unknown error";
      stepSummaries[stepSummaries.length - 1] += ` [FAILED: ${errorMsg.substring(0, 80)}]`;
      console.log(`[ai-navigator] Step ${step + 1} action failed: ${errorMsg.substring(0, 100)}`);

      if (action.selector) {
        failedSelectors.add(action.selector);
      }

      onStep?.({ step: step + 1, action: action.action, description: `${humanDesc} — не удалось`, status: "failed", url: page.url() });
    }

    // Brief pause between steps
    await page.waitForTimeout(500);
  }

  // Max steps reached
  return {
    results: [{
      shopOrderId: orderIds[0] || "",
      status: null,
      rawStatus: null,
      trackingNumber: null,
      success: false,
      error: "Max navigation steps reached without extracting order data",
    }],
    recipe: null,
    tokensUsed: totalTokens,
    stepsLog: stepSummaries,
  };
}
