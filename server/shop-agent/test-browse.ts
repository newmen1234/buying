/**
 * Test script: runs the full AI navigator on a shop domain
 * and SAVES the recipe to DB if successful.
 *
 * Run: npx tsx server/shop-agent/test-browse.ts [domain] [email] [password] [orderId]
 * Example: npx tsx server/shop-agent/test-browse.ts www.beautywelt.de user@mail.com pass123 BW-12345
 *
 * Without args: runs on beautywelt.de with test credentials (won't actually log in).
 */
import { chromium } from "playwright";
import { navigateWithAI, type LiveStep } from "./ai-navigator";
import { storage } from "../storage";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function main() {
  // Load env
  const dotenv = await import("dotenv").catch(() => null);
  dotenv?.config?.();

  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY not set!");
    process.exit(1);
  }

  // Parse CLI args
  const args = process.argv.slice(2);
  const domain = args[0] || "www.beautywelt.de";
  const email = args[1] || "test@example.com";
  const password = args[2] || "testpassword123";
  const orderId = args[3] || "BW-12345";

  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 768 },
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  const page = await context.newPage();
  const url = `https://${domain}`;

  console.log(`\n=== Opening ${url} ===`);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  console.log("URL:", page.url());

  const credentials = { email, password };
  const orderIds = [orderId];

  console.log("\n=== Starting AI Navigator ===");
  console.log(`Domain: ${domain}`);
  console.log(`Credentials: ${email}`);
  console.log(`Order IDs: ${orderIds.join(", ")}`);
  console.log("");

  const onStep = (step: LiveStep) => {
    const icon = step.status === "ok" ? "✅" : step.status === "failed" ? "❌" : step.status === "skipped" ? "⏭️" : "🔄";
    console.log(`${icon} Step ${step.step}: ${step.description} [${step.action}] ${step.url || ""}`);
  };

  try {
    const result = await navigateWithAI(
      page,
      credentials,
      orderIds,
      domain,
      undefined, // no hints
      onStep,
    );

    console.log("\n=== RESULT ===");
    console.log(`Tokens used: ${result.tokensUsed}`);
    console.log(`Steps: ${result.stepsLog.length}`);
    console.log("Results:", JSON.stringify(result.results, null, 2));

    if (result.recipe) {
      console.log("\nRecipe generated:");
      console.log(`  Login URL: ${result.recipe.loginUrl}`);
      console.log(`  Steps: ${result.recipe.steps.length}`);
      console.log(`  Steps detail:`, JSON.stringify(result.recipe.steps, null, 2));

      // SAVE recipe to DB
      try {
        // Check if recipe already exists for this domain
        const existing = await storage.getShopRecipeByDomain(domain);
        if (existing) {
          await storage.updateShopRecipe(existing.id, {
            recipeJson: result.recipe as any,
            successCount: (existing.successCount || 0) + 1,
            lastUsedAt: new Date(),
          });
          console.log(`\n✅ Recipe UPDATED in DB for ${domain} (id=${existing.id})`);
        } else {
          const saved = await storage.createShopRecipe({
            domain,
            loginType: result.recipe.loginType,
            recipeJson: result.recipe as any,
          });
          console.log(`\n✅ Recipe SAVED to DB for ${domain} (id=${saved.id})`);
        }
      } catch (err) {
        console.error(`\n❌ Failed to save recipe to DB:`, err);
      }
    } else {
      console.log("\n⚠️ No recipe generated (navigation did not complete successfully)");
    }

    // Take final screenshot
    await page.screenshot({ path: "/tmp/bw-final.png", fullPage: false });
    console.log("\nFinal screenshot: /tmp/bw-final.png");
    console.log("Final URL:", page.url());
  } catch (err) {
    console.error("Navigator error:", err);
  }

  await context.close();
  await browser.close();
  console.log("\nDone!");
}

main().catch(console.error);
