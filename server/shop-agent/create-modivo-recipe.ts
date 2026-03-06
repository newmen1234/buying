import { storage } from "../storage";

const modivoRecipe = {
  domain: "modivo.de",
  loginType: "email_password" as const,
  loginUrl: "https://modivo.de/login",
  steps: [
    { type: "goto" as const, selector: "https://modivo.de/login", description: "Go to login page" },
    { type: "sleep" as const, timeout: 3000, description: "Wait for SPA render" },
    // Cookie consent dismissal via JS (scoped to .consents container)
    { type: "jsClick" as const, selector: ".consents button", value: "Einstellungen ändern", description: "Open cookie settings", optional: true },
    { type: "sleep" as const, timeout: 2000, description: "Wait for settings panel" },
    { type: "jsClick" as const, selector: ".consents button", value: "Änderungen speichern", description: "Save cookie settings", optional: true },
    { type: "sleep" as const, timeout: 4000, description: "Wait for consent to close" },
    // Login (use jsFill + jsClick for Vue SPA compatibility — NO reload after consent!)
    { type: "jsFill" as const, selector: "input[type='email']", value: "{{email}}", description: "Fill email via JS" },
    { type: "jsFill" as const, selector: "input[type='password']", value: "{{password}}", description: "Fill password via JS" },
    { type: "jsClick" as const, value: "Einloggen", description: "Click login via JS (SPA compatibility)" },
    { type: "sleep" as const, timeout: 10000, description: "Wait for login to complete" },
    // Navigate to orders page (triggers the orders API call which we intercept)
    { type: "goto" as const, selector: "https://modivo.de/customer/orders", description: "Go to orders page", timeout: 60000 },
    { type: "wait" as const, selector: "table tbody tr", timeout: 30000, description: "Wait for orders table to render", optional: true },
    { type: "sleep" as const, timeout: 2000, description: "Extra buffer for API response" },
    // Extract orders via API interception (fast! no DOM scraping)
    { type: "apiExtract" as const, description: "Extract orders via API interception + public tracking API" },
  ],
  orderListSelector: "table tbody tr",
  extractionRules: {
    orderId: "td.col.id",
    status: "td.col.status",
  },
  statusMapping: {
    "Versendet": "Отправлен",
    "Geliefert": "Доставлен",
    "In Bearbeitung": "В обработке",
    "Storniert": "Отменён",
    "Sendung verfolgen": "Отправлен",
    "Retourniert": "Возврат",
  },
  apiExtractConfig: {
    ordersApiPattern: "getCustomerOrdersExt",
    ordersPath: "data.customerOrdersExt.items",
    orderNumberField: "order_number",
    statusField: "status_label",
    trackingIdField: "tracking_identifier",
    // Public tracking API — no auth needed, just the hash
    trackingApiUrl: "https://dexter.modivo.io/api/v2/order-trackings-details/{trackingId}",
    trackingNumberPath: "sendersTrackings[0].trackings[0].number",
    trackingCarrierPath: "sendersTrackings[0].trackings[0].carrier",
    // Pagination
    paginationNextSelector: "button.next-button",
    paginationDelay: 3000,
    // Status mapping
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
  // Check if recipe already exists
  const existing = await storage.getShopRecipeByDomain("modivo.de");
  if (existing) {
    console.log(`Recipe already exists (id=${existing.id}). Updating...`);
    await storage.updateShopRecipe(existing.id, {
      recipeJson: modivoRecipe,
      loginType: "email_password",
    });
    console.log("Recipe updated.");
  } else {
    const recipe = await storage.createShopRecipe({
      domain: "modivo.de",
      loginType: "email_password",
      recipeJson: modivoRecipe,
    });
    console.log("Recipe created, id:", recipe.id);
  }

  process.exit(0);
}

main().catch(console.error);
