import { newShopSession, takeScreenshot } from "./browser";
import { autoDismissCookieBanner } from "./cookie-utils";
import fs from "fs";

const EMAIL = "carolkoch01@outlook.com";
const PASSWORD = "New20-25-25Ns!";

async function main() {
  console.log("Starting modivo.de exploration...");

  const session = await newShopSession("https://modivo.de/login");
  const page = session.page;

  try {
    // Step 1: Handle cookie consent
    console.log("\n=== Step 1: Cookie consent ===");
    await page.waitForTimeout(3000);

    // Take initial screenshot
    const s0 = await takeScreenshot(page);
    fs.writeFileSync("/tmp/modivo-0-initial.png", s0);

    // Try to find and dismiss cookie consent
    await autoDismissCookieBanner(page);
    await page.waitForTimeout(1000);

    // Look for specific consent buttons
    const consentDismissed = await page.evaluate(() => {
      // Look for consent-related buttons
      const allBtns = Array.from(document.querySelectorAll("button"));
      for (const btn of allBtns) {
        const t = (btn.textContent || "").trim().toLowerCase();
        if (t.includes("nur notwendige") || t.includes("alle ablehnen") || t.includes("reject all") ||
            t.includes("nur erforderliche") || t.includes("decline") || t.includes("schließen")) {
          console.log("Clicking consent:", t);
          btn.click();
          return t;
        }
      }
      // Check for "Einstellungen" link or "Ablehnen"
      for (const btn of allBtns) {
        const t = (btn.textContent || "").trim().toLowerCase();
        if (t.includes("einstellungen ändern")) {
          btn.click();
          return "clicked settings: " + t;
        }
      }
      return null;
    });
    console.log("Consent dismissed:", consentDismissed);
    await page.waitForTimeout(2000);

    // If "Einstellungen ändern" was clicked, look for reject buttons in settings
    if (consentDismissed?.includes("einstellungen")) {
      const secondDismiss = await page.evaluate(() => {
        const allBtns = Array.from(document.querySelectorAll("button"));
        for (const btn of allBtns) {
          const t = (btn.textContent || "").trim().toLowerCase();
          if (t.includes("speichern") || t.includes("ablehnen") || t.includes("reject") || t.includes("nur notwendige")) {
            btn.click();
            return t;
          }
        }
        return null;
      });
      console.log("Second dismiss:", secondDismiss);
      await page.waitForTimeout(2000);
    }

    const s1 = await takeScreenshot(page);
    fs.writeFileSync("/tmp/modivo-1-after-consent.png", s1);

    // Step 2: Login
    console.log("\n=== Step 2: Login ===");
    const emailInput = await page.$('input[type="email"]');
    const pwdInput = await page.$('input[type="password"]');
    console.log("Email:", !!emailInput, "Password:", !!pwdInput);

    if (emailInput && pwdInput) {
      await emailInput.fill(EMAIL);
      await pwdInput.fill(PASSWORD);

      const s2 = await takeScreenshot(page);
      fs.writeFileSync("/tmp/modivo-2-filled.png", s2);

      // Try page.click with force
      try {
        const loginBtn = await page.$('button:has-text("Einloggen")');
        if (loginBtn) {
          console.log("Clicking Einloggen with force...");
          await loginBtn.click({ force: true });
        }
      } catch (e) {
        console.log("Force click failed, trying evaluate...");
        await page.evaluate(() => {
          const form = document.querySelector("form");
          if (form) { form.submit(); return; }
          const btns = Array.from(document.querySelectorAll("button"));
          for (const b of btns) {
            if ((b.textContent || "").toLowerCase().includes("einloggen")) {
              b.click(); return;
            }
          }
        });
      }

      // Wait for navigation
      console.log("Waiting for login to complete...");
      await page.waitForTimeout(8000);
      console.log("After login URL:", page.url());

      const s3 = await takeScreenshot(page);
      fs.writeFileSync("/tmp/modivo-3-after-login.png", s3);

      // Check login state
      const pageText = await page.evaluate(() => document.body.innerText.substring(0, 500));
      console.log("Page text:", pageText.replace(/\n/g, " | ").substring(0, 300));

      const isLoggedIn = !page.url().includes("/login");
      console.log("Is logged in:", isLoggedIn);

      if (!isLoggedIn) {
        // Maybe the password is wrong or there's another issue
        console.log("Login seems to have failed. Checking for error messages...");
        const errors = await page.evaluate(() => {
          const errEls = document.querySelectorAll("[class*='error'], [class*='alert'], [role='alert']");
          return Array.from(errEls).map(e => e.textContent?.trim().substring(0, 200));
        });
        console.log("Errors:", errors);

        // Try once more with keyboard Enter
        await emailInput.fill(EMAIL);
        await pwdInput.fill(PASSWORD);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(8000);
        console.log("After Enter URL:", page.url());
      }
    }

    // Step 3: Orders
    console.log("\n=== Step 3: Orders ===");
    await page.goto("https://modivo.de/customer/orders", { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(5000);

    console.log("Orders URL:", page.url());
    const s4 = await takeScreenshot(page);
    fs.writeFileSync("/tmp/modivo-4-orders.png", s4);

    // Check if we're actually on orders page
    if (page.url().includes("/login")) {
      console.log("STILL NOT LOGGED IN. Redirected to login.");

      // Let me try a different approach - wait for network and check response
      const pageContent = await page.evaluate(() => document.body.innerText.substring(0, 300));
      console.log("Content:", pageContent.replace(/\n/g, " | "));
    } else {
      // Analyze orders
      const ordersData = await page.evaluate(() => {
        const body = document.body.innerText;
        const demOrders = body.match(/DEM\d{9}/g);

        const tables = Array.from(document.querySelectorAll("table"));
        const firstTable = tables[0];

        let sampleRow = null;
        if (firstTable) {
          const rows = firstTable.querySelectorAll("tbody tr");
          if (rows.length > 0) {
            const cells = Array.from(rows[0].querySelectorAll("td"));
            sampleRow = {
              cellTexts: cells.map(c => c.textContent?.trim()),
              links: Array.from(rows[0].querySelectorAll("a")).map(a => ({
                text: a.textContent?.trim(),
                href: a.getAttribute("href"),
              })),
              html: rows[0].outerHTML.substring(0, 1500),
            };
          }
        }

        // Find "Weiter" button
        const weiterBtn = Array.from(document.querySelectorAll("button, a")).filter(el =>
          (el.textContent || "").trim() === "Weiter"
        ).map(e => ({
          tag: e.tagName, className: e.className.substring(0, 80),
          href: e.getAttribute("href"),
        }));

        // "Details anzeigen" links
        const detailLinks = Array.from(document.querySelectorAll("a")).filter(a =>
          (a.textContent || "").includes("Details anzeigen")
        ).map(a => ({ href: a.getAttribute("href") })).slice(0, 3);

        // "Sendung verfolgen" links on list page
        const svLinks = Array.from(document.querySelectorAll("a")).filter(a =>
          (a.textContent || "").includes("Sendung verfolgen")
        ).map(a => ({ href: a.getAttribute("href"), text: a.textContent?.trim() })).slice(0, 3);

        return {
          demOrders: demOrders?.slice(0, 5),
          totalDem: demOrders?.length || 0,
          tableCount: tables.length,
          sampleRow,
          weiterBtn,
          detailLinks,
          svLinks,
          bodyPreview: body.substring(0, 600),
        };
      });
      console.log("Orders:", JSON.stringify(ordersData, null, 2));

      // Step 4: Visit first detail page
      if (ordersData.detailLinks.length > 0) {
        const href = ordersData.detailLinks[0].href!;
        const detailUrl = href.startsWith("/") ? `https://modivo.de${href}` : href;
        console.log("\n=== Step 4: Detail page ===", detailUrl);

        await page.goto(detailUrl, { waitUntil: "networkidle", timeout: 30000 });
        await page.waitForTimeout(3000);

        const s5 = await takeScreenshot(page);
        fs.writeFileSync("/tmp/modivo-5-detail.png", s5);

        const detail = await page.evaluate(() => {
          const body = document.body.innerText;
          const statusMatch = body.match(/Bestellstatus[:\s]*([^\n]+)/i);
          const svBtns = Array.from(document.querySelectorAll("button, a")).filter(el =>
            (el.textContent || "").includes("Sendung verfolgen")
          );
          return {
            url: window.location.href,
            statusValue: statusMatch ? statusMatch[1].trim() : null,
            hasTrackingBtn: svBtns.length > 0,
            svBtnInfo: svBtns.map(b => ({ tag: b.tagName, cls: b.className.substring(0, 80) })),
            bodyPreview: body.substring(0, 1000),
          };
        });
        console.log("Detail:", JSON.stringify(detail, null, 2));

        // Step 5: Click Sendung verfolgen
        if (detail.hasTrackingBtn) {
          console.log("\n=== Step 5: Tracking ===");
          await page.evaluate(() => {
            const el = Array.from(document.querySelectorAll("button, a")).find(e =>
              (e.textContent || "").includes("Sendung verfolgen")
            );
            if (el) (el as HTMLElement).click();
          });
          await page.waitForTimeout(5000);

          const s6 = await takeScreenshot(page);
          fs.writeFileSync("/tmp/modivo-6-tracking.png", s6);

          const tracking = await page.evaluate(() => {
            const body = document.body.innerText;
            const paketMatch = body.match(/Paketnummer[:\s]*([A-Z0-9]+)/i);
            const trackNums = body.match(/(?:JJD|JD|RR|LX|CX|LP|UZ)\d{10,30}/g);
            return {
              paketNumber: paketMatch?.[1],
              trackNumbers: trackNums,
              bodySnippet: body.substring(0, 2000),
            };
          });
          console.log("Tracking:", JSON.stringify(tracking, null, 2));
        }
      }
    }

  } catch (err) {
    console.error("Error:", err);
  } finally {
    await session.close();
    process.exit(0);
  }
}

main();
