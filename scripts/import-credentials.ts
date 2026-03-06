#!/usr/bin/env npx tsx
/**
 * Import shop credentials from CSV file into shop_credentials table
 * Usage: npx tsx scripts/import-credentials.ts /path/to/file.csv <legalEntity>
 */

import fs from "fs";
import path from "path";

const csvPath = process.argv[2];
const legalEntity = process.argv[3] || "Newmen";

if (!csvPath) {
  console.error("Usage: npx tsx scripts/import-credentials.ts <csv-path> <legalEntity>");
  process.exit(1);
}

// Russian password patterns to skip
const RUSSIAN_SKIP_PATTERNS = [
  /как гость/i,
  /код.*почт/i,
  /код.*протон/i,
  /код.*proton/i,
  /по коду/i,
  /регистр.*нет/i,
  /сделать акк/i,
  /создать.*акк/i,
  /у василиади/i,
  /нет.*выкуп/i,
  /нет лк/i,
  /[а-яё]{3,}/i, // any 3+ consecutive Cyrillic chars
];

function isRussianPassword(pwd: string): boolean {
  return RUSSIAN_SKIP_PATTERNS.some((p) => p.test(pwd));
}

/** Extract clean domain from shop field */
function cleanDomain(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  // Remove annotations like (фид), (feed), etc.
  s = s.replace(/\s*\(.*?\)\s*/g, "").trim();
  // Remove leading/trailing slashes and paths like /de
  s = s.replace(/\/.*$/, "").trim();
  // Remove protocol
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "").trim();
  if (!s || !s.includes(".")) return null;
  return s.toLowerCase();
}

/** Extract clean email from login field */
function cleanEmail(raw: string): { email: string | null; warning: string | null } {
  let s = raw.trim().replace(/\n/g, "").replace(/\r/g, "").trim();
  if (!s) return { email: null, warning: null };

  // Try to extract email first (even if there's Russian text around it)
  const emailMatch = s.match(/[\w.+-]+@[\w.-]+\.\w{2,}/);
  if (emailMatch) {
    return { email: emailMatch[0].toLowerCase().trim(), warning: null };
  }

  // No email found
  if (/[а-яё]{3,}/i.test(s)) {
    return { email: null, warning: `Russian text, no email: "${s}"` };
  }

  return { email: null, warning: `Not an email: "${s}"` };
}

// Parse CSV with quoted fields and multiline values
function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  while (i < content.length) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"' && content[i + 1] === '"') {
        field += '"';
        i += 2;
      } else if (ch === '"') {
        inQuotes = false;
        i++;
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ",") {
        current.push(field);
        field = "";
        i++;
      } else if (ch === "\n" || (ch === "\r" && content[i + 1] === "\n")) {
        current.push(field);
        field = "";
        if (current.length >= 2) {
          rows.push(current);
        }
        current = [];
        i += ch === "\r" ? 2 : 1;
      } else {
        field += ch;
        i++;
      }
    }
  }
  // Last field
  if (field || current.length > 0) {
    current.push(field);
    if (current.length >= 2) {
      rows.push(current);
    }
  }

  return rows;
}

async function main() {
  const raw = fs.readFileSync(csvPath, "utf-8");
  const rows = parseCSV(raw);

  // Skip header
  const header = rows[0];
  console.log("Header:", header);
  const data = rows.slice(1);

  const imported: { domain: string; email: string; password: string }[] = [];
  const skipped: { line: number; reason: string; raw: string }[] = [];
  const warnings: { line: number; warning: string }[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const rawShop = row[0] || "";
    const rawLogin = row[1] || "";
    const rawPassword = (row[2] || "").trim().replace(/\n/g, "").replace(/\r/g, "").trim();
    const lineNum = i + 2; // +2 for header + 0-index

    // Skip empty password
    if (!rawPassword) {
      skipped.push({ line: lineNum, reason: "Empty password", raw: `${rawShop} | ${rawLogin}` });
      continue;
    }

    // Skip Russian passwords
    if (isRussianPassword(rawPassword)) {
      skipped.push({ line: lineNum, reason: `Russian password: "${rawPassword}"`, raw: `${rawShop} | ${rawLogin}` });
      continue;
    }

    // Clean domain
    const domain = cleanDomain(rawShop);
    if (!domain) {
      skipped.push({ line: lineNum, reason: "Invalid domain", raw: rawShop });
      continue;
    }

    // Clean email
    const { email, warning } = cleanEmail(rawLogin);
    if (warning) {
      warnings.push({ line: lineNum, warning });
    }
    if (!email) {
      skipped.push({ line: lineNum, reason: warning || "No email", raw: `${rawShop} | ${rawLogin}` });
      continue;
    }

    imported.push({ domain, email, password: rawPassword });
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Total rows: ${data.length}`);
  console.log(`To import: ${imported.length}`);
  console.log(`Skipped: ${skipped.length}`);

  if (warnings.length > 0) {
    console.log(`\n=== WARNINGS (${warnings.length}) ===`);
    warnings.forEach((w) => console.log(`  Line ${w.line}: ${w.warning}`));
  }

  // Generate SQL
  const sqlLines: string[] = [];
  for (const entry of imported) {
    const d = entry.domain.replace(/'/g, "''");
    const e = entry.email.replace(/'/g, "''");
    const p = entry.password.replace(/'/g, "''");
    const le = legalEntity.replace(/'/g, "''");
    sqlLines.push(
      `INSERT INTO shop_credentials (domain, email, encrypted_password, legal_entity, status) VALUES ('${d}', '${e}', '${p}', '${le}', 'active') ON CONFLICT (domain, email) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password, legal_entity = EXCLUDED.legal_entity;`
    );
  }

  const sqlFile = csvPath.replace(/\.csv$/, "-import.sql");
  fs.writeFileSync(sqlFile, sqlLines.join("\n") + "\n", "utf-8");
  console.log(`\nSQL written to: ${sqlFile}`);
  console.log(`Run: PGPASSWORD=puppeteer psql -h 127.0.0.1 -U puppeteer -d puppeteer -f ${sqlFile}`);

  // Also write a JSON summary
  const summaryFile = csvPath.replace(/\.csv$/, "-summary.json");
  fs.writeFileSync(summaryFile, JSON.stringify({ imported: imported.length, skipped: skipped.length, skippedDetails: skipped.slice(0, 50) }, null, 2), "utf-8");
}

main().catch(console.error);
