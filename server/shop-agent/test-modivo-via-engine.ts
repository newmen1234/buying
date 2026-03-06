/**
 * Call executeRecipe directly from a clean context, minimal wrapper.
 */
import { chromium } from "playwright";
import { executeRecipe, type ShopRecipeData } from "./recipe-engine";

const EMAIL = "carolkoch01@outlook.com";
const PASSWORD = "New20-25-25Ns!";

const modivoRecipe: ShopRecipeData = {
  domain: "modivo.de",
  loginType: "email_password",
  loginUrl: "https://modivo.de/login",
  steps: [
    { type: "goto", selector: "https://modivo.de/login", description: "Go to login page" },
    { type: "sleep", timeout: 3000, description: "Wait for SPA render" },
    { type: "jsClick", selector: ".consents button", value: "Einstellungen ändern", description: "Open cookie settings", optional: true },
    { type: "sleep", timeout: 2000, description: "Wait for settings panel" },
    { type: "jsClick", selector: ".consents button", value: "Änderungen speichern", description: "Save cookie settings", optional: true },
    { type: "sleep", timeout: 4000, description: "Wait for consent to close" },
    { type: "jsFill", selector: "input[type='email']", value: "{{email}}", description: "Fill email via JS" },
    { type: "jsFill", selector: "input[type='password']", value: "{{password}}", description: "Fill password via JS" },
    { type: "jsClick", value: "Einloggen", description: "Click login via JS" },
    { type: "sleep", timeout: 10000, description: "Wait for login to complete" },
    { type: "goto", selector: "https://modivo.de/customer/orders", description: "Go to orders page", timeout: 60000 },
    { type: "wait", selector: "table tbody tr", timeout: 30000, description: "Wait for orders table", optional: true },
    { type: "sleep", timeout: 2000, description: "Extra buffer" },
    { type: "apiExtract", description: "Extract orders via API" },
  ],
  orderListSelector: "table tbody tr",
  extractionRules: { orderId: "td.col.id", status: "td.col.status" },
  statusMapping: {
    "Versendet": "Отправлен",
    "Geliefert": "Доставлен",
    "In Bearbeitung": "В обработке",
    "Storniert": "Отменён",
    "Retourniert": "Возврат",
  },
  apiExtractConfig: {
    ordersApiPattern: "getCustomerOrdersExt",
    ordersPath: "data.customerOrdersExt.items",
    orderNumberField: "order_number",
    statusField: "status_label",
    trackingIdField: "tracking_identifier",
    trackingApiUrl: "https://dexter.modivo.io/api/v2/order-trackings-details/{trackingId}",
    trackingNumberPath: "sendersTrackings[0].trackings[0].number",
    trackingCarrierPath: "sendersTrackings[0].trackings[0].carrier",
    paginationNextSelector: "button.next-button",
    paginationDelay: 3000,
    statusMapping: {
      "Versendet": "Отправлен",
      "Geliefert": "Доставлен",
      "In Bearbeitung": "В обработке",
      "Storniert": "Отменён",
      "Retourniert": "Возврат",
      "Abgeholt": "Получен",
      "Zugestellt": "Доставлен",
      "In Zustellung": "В доставке",
      "Unterwegs": "В пути",
    },
  },
};

async function main() {
  console.log("Email:", EMAIL);
  console.log("Password:", PASSWORD);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 },
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
  const page = await context.newPage();

  const startTime = Date.now();
  console.log("\nCalling executeRecipe...");
  const results = await executeRecipe(
    page,
    modivoRecipe,
    { email: EMAIL, password: PASSWORD },
    ["DEM000934407", "DEM000933259"],
  );

  const elapsed = Date.now() - startTime;
  console.log(`\nResults (${elapsed}ms):`, JSON.stringify(results, null, 2));
  console.log("Final URL:", page.url());

  await context.close();
  await browser.close();
  process.exit(0);
}

main().catch(console.error);
