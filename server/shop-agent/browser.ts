import type { Browser, Page, BrowserContext } from "playwright";

// Lazy import playwright to avoid crash if not installed
let chromium: typeof import("playwright").chromium;

async function getChromium() {
  if (!chromium) {
    const pw = await import("playwright");
    chromium = pw.chromium;
  }
  return chromium;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
];

function randomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

let browserInstance: Browser | null = null;

export async function launchBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.isConnected()) {
    return browserInstance;
  }

  const pw = await getChromium();
  browserInstance = await pw.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  return browserInstance;
}

export async function newShopSession(url: string): Promise<{ page: Page; context: BrowserContext; close: () => Promise<void> }> {
  const browser = await launchBrowser();

  const context = await browser.newContext({
    userAgent: randomUserAgent(),
    viewport: { width: 1366, height: 768 },
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    javaScriptEnabled: true,
  });

  // Remove webdriver flag
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(45000);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

  return {
    page,
    context,
    close: async () => {
      await context.close().catch(() => {});
    },
  };
}

export async function takeScreenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ fullPage: false, type: "png" }) as Promise<Buffer>;
}

export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}
