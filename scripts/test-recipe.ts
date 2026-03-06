/**
 * Test a shop recipe by running it against a single account.
 * Usage: npx tsx scripts/test-recipe.ts <domain> [email] [orderId1,orderId2,...]
 *
 * If email is not provided, uses the first credential from shop_credentials table.
 * If orderIds are not provided, extracts all orders (for jsExtract with extractAllOrders).
 */
import { storage } from '../server/storage';
import { executeRecipe, type ShopRecipeData, type OrderResult } from '../server/shop-agent/recipe-engine';
import { decrypt } from '../server/shop-agent/crypto';
import { chromium } from 'playwright';

const domain = process.argv[2];
const emailArg = process.argv[3];
const orderIdsArg = process.argv[4];

if (!domain) {
  console.error('Usage: npx tsx scripts/test-recipe.ts <domain> [email] [orderId1,orderId2,...]');
  process.exit(1);
}

async function main() {
  console.log(`\n=== Testing recipe for ${domain} ===\n`);

  // 1. Load recipe (browser recipes, not email_parsing)
  const recipe = await storage.getShopRecipeByDomain(domain);
  if (!recipe) {
    console.error(`No browser recipe found for ${domain}`);
    process.exit(1);
  }
  const recipeData = recipe.recipeJson as unknown as ShopRecipeData;
  console.log(`Recipe loaded: ${recipeData.steps.length} steps, extraction: ${recipeData.jsExtractConfig ? 'jsExtract' : recipeData.apiExtractConfig ? 'apiExtract' : recipeData.domExtractConfig ? 'domExtract' : 'basic'}`);

  // 2. Load credentials
  let email = emailArg;
  let password = '';

  const creds = await storage.getShopCredentials();
  const domainCreds = creds.filter(c => c.domain === domain);

  if (!email) {
    if (domainCreds.length === 0) {
      console.error(`No credentials found for ${domain}`);
      process.exit(1);
    }
    email = domainCreds[0].email;
  }

  const matchingCred = domainCreds.find(c => c.email === email);
  if (!matchingCred?.encryptedPassword) {
    console.error(`No password found for ${email}@${domain}`);
    process.exit(1);
  }
  password = decrypt(matchingCred.encryptedPassword);
  console.log(`Credentials: ${email} / ${'*'.repeat(password.length)}`);

  // 3. Parse order IDs
  const targetOrderIds = orderIdsArg ? orderIdsArg.split(',') : [];
  console.log(`Target orders: ${targetOrderIds.length ? targetOrderIds.join(', ') : '(all - extractAllOrders mode)'}`);

  // 4. Launch browser
  console.log('\nLaunching browser...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    // 5. Execute recipe
    console.log('\nExecuting recipe...\n');
    const results = await executeRecipe(
      page,
      recipeData,
      { email, password },
      targetOrderIds.length > 0 ? targetOrderIds : ['TEST_DUMMY_ORDER_ID'],
    );

    // 6. Print results
    console.log('\n\n=== RESULTS ===\n');
    console.log(`Total orders extracted: ${results.length}`);
    console.log(`Successful: ${results.filter(r => r.success).length}`);
    console.log(`Failed: ${results.filter(r => !r.success).length}`);

    for (const r of results) {
      console.log(`\n  Order: ${r.shopOrderId}`);
      console.log(`    Status: ${r.status || '(none)'} (raw: ${r.rawStatus || '(none)'})`);
      console.log(`    Tracking: ${r.trackingNumber || '(none)'}`);
      if (r.referenceNumber) console.log(`    Reference: ${r.referenceNumber}`);
      if ((r as any).courier) console.log(`    Courier: ${(r as any).courier}`);
      if (r.estimatedDeliveryDate) console.log(`    Delivery date: ${r.estimatedDeliveryDate}`);
      if (r.error) console.log(`    Error: ${r.error}`);
    }

    // 7. Save screenshot of final page
    const screenshotPath = `/tmp/test-recipe-${domain}-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`\nFinal screenshot saved: ${screenshotPath}`);
    console.log(`Final URL: ${page.url()}`);

  } catch (err) {
    console.error('\nRecipe execution failed:', (err as Error).message);

    // Save error screenshot
    const screenshotPath = `/tmp/test-recipe-${domain}-error-${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => {});
    console.error(`Error screenshot: ${screenshotPath}`);
    console.error(`Current URL: ${page.url()}`);

    // Get page text for debugging
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500)).catch(() => '');
    console.error(`Page text: ${bodyText.replace(/\n/g, ' | ').substring(0, 300)}`);
  } finally {
    await browser.close();
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
