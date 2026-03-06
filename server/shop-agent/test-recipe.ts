/**
 * Test recipe execution WITHOUT AI — verifies the saved recipe works.
 */
import { chromium } from "playwright";
import { executeRecipe, type ShopRecipeData } from "./recipe-engine";
import { storage } from "../storage";

async function main() {
  const dotenv = await import("dotenv").catch(() => null);
  dotenv?.config?.();

  const domain = process.argv[2] || "www.beautywelt.de";
  const email = process.argv[3] || "sergey-40948221-0447-1@newmen.me";
  const password = process.argv[4] || "40948221!Ns";
  const orderId = process.argv[5] || "BW4662167";

  console.log(`Loading recipe for ${domain}...`);
  const recipe = await storage.getShopRecipeByDomain(domain);
  if (!recipe) {
    console.error("No recipe found for domain:", domain);
    process.exit(1);
  }

  const recipeData = recipe.recipeJson as unknown as ShopRecipeData;
  console.log("Recipe:", JSON.stringify(recipeData, null, 2));

  console.log("\nLaunching browser...");
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
  // Don't navigate to root — let the recipe handle navigation
  console.log("Page ready, executing recipe directly...");

  console.log("\nExecuting recipe...");
  const startTime = Date.now();

  try {
    const results = await executeRecipe(
      page,
      recipeData,
      { email, password },
      [orderId],
    );

    const elapsed = Date.now() - startTime;
    console.log(`\n=== RESULTS (${elapsed}ms) ===`);
    console.log(JSON.stringify(results, null, 2));

    // Take screenshot
    await page.screenshot({ path: "/tmp/bw-recipe-test.png" });
    console.log("Screenshot: /tmp/bw-recipe-test.png");
    console.log("Final URL:", page.url());
  } catch (err) {
    console.error("Recipe execution failed:", err);
    await page.screenshot({ path: "/tmp/bw-recipe-error.png" });
  }

  await context.close();
  await browser.close();
}

main().catch(console.error);
