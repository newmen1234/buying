#!/usr/bin/env npx tsx
/**
 * Search Fastmail for sample emails from a shop domain.
 * Usage: npx tsx scripts/search-shop-emails.ts <domain> <legalEntity> [limit]
 * Example: npx tsx scripts/search-shop-emails.ts amazon.de newmen 20
 *
 * Output: JSON with email subjects, from, receivedAt, textBody (first 2000 chars)
 */

import { searchSampleEmails, getTokenForEntity } from "../server/fastmail-search";

async function main() {
  const [domain, legalEntity, limitStr] = process.argv.slice(2);

  if (!domain || !legalEntity) {
    console.error("Usage: npx tsx scripts/search-shop-emails.ts <domain> <legalEntity> [limit]");
    console.error("Example: npx tsx scripts/search-shop-emails.ts amazon.de newmen 20");
    process.exit(1);
  }

  const limit = parseInt(limitStr || "20", 10);

  // Verify token exists
  const token = getTokenForEntity(legalEntity);
  if (!token) {
    console.error(`No Fastmail token for entity: ${legalEntity}`);
    console.error("Known entities: newmen, vatebo");
    process.exit(1);
  }

  console.error(`Searching Fastmail (${legalEntity}) for emails from "${domain}" (limit: ${limit})...`);

  try {
    const emails = await searchSampleEmails(domain, legalEntity, limit);

    if (emails.length === 0) {
      console.error("No emails found.");
      console.log(JSON.stringify({ domain, legalEntity, count: 0, emails: [] }, null, 2));
      return;
    }

    console.error(`Found ${emails.length} emails.`);

    const output = {
      domain,
      legalEntity,
      count: emails.length,
      emails: emails.map((e) => ({
        id: e.id,
        subject: e.subject,
        from: e.from,
        receivedAt: e.receivedAt,
        textBody: e.textBody.slice(0, 2000),
      })),
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (error: any) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

main();
