/**
 * Cookie banner auto-dismiss utilities.
 * Shared between ai-navigator and recipe-engine.
 *
 * IMPORTANT: Never remove overlay DOM elements ("nuclear" approach) — this can break
 * session cookies and login persistence. Instead, try to click the accept button.
 * If no button found, proceed anyway — Playwright can interact with elements behind overlays.
 */
import type { Page } from "playwright";

/**
 * Try to dismiss cookie consent banners by clicking accept buttons.
 * Returns true if a banner was found and dismissed.
 * If no accept button found, returns false — caller should proceed regardless.
 */
export async function autoDismissCookieBanner(page: Page, initialWaitMs: number = 500): Promise<boolean> {
  // Wait for consent managers to render (longer on first page load)
  await page.waitForTimeout(initialWaitMs);

  // Phase 1: evaluate()-based approach (fast, handles Shadow DOM)
  const dismissed = await page.evaluate(() => {
    function clickButtonByText(root: Document | ShadowRoot, keywords: string[]): boolean {
      const elements = root.querySelectorAll(
        "button, a[role='button'], [role='button'], a.btn, div[role='button'], span[role='button'], input[type='submit'], input[type='button']"
      );
      for (const btn of elements) {
        const text = (btn as HTMLElement).textContent?.toLowerCase().trim() || "";
        const val = (btn as HTMLInputElement).value?.toLowerCase().trim() || "";
        for (const kw of keywords) {
          if (text.includes(kw) || val.includes(kw)) {
            (btn as HTMLElement).click();
            return true;
          }
        }
      }
      return false;
    }

    const acceptKeywords = [
      "alle akzeptieren", "akzeptieren", "accept all", "accept",
      "alle annehmen", "annehmen", "einverstanden",
      "zustimmen", "agree", "allow all", "allow",
      "consent", "ich stimme zu",
    ];

    // 1. Usercentrics (Shadow DOM)
    const ucRoot = document.querySelector("#usercentrics-root");
    if (ucRoot?.shadowRoot) {
      if (clickButtonByText(ucRoot.shadowRoot, acceptKeywords)) return "usercentrics";
    }

    // 2. OneTrust
    const otBanner = document.querySelector("#onetrust-consent-sdk");
    if (otBanner) {
      const acceptBtn = otBanner.querySelector("#onetrust-accept-btn-handler, .onetrust-close-btn-handler") as HTMLElement;
      if (acceptBtn) { acceptBtn.click(); return "onetrust"; }
      if (otBanner.shadowRoot && clickButtonByText(otBanner.shadowRoot, acceptKeywords)) return "onetrust-shadow";
    }

    // 3. CookieBot
    const cbAllow = document.querySelector("#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll, #CybotCookiebotDialogBodyButtonAccept") as HTMLElement;
    if (cbAllow) { cbAllow.click(); return "cookiebot"; }

    // 4. Klaro
    const klaroBtn = document.querySelector(".klaro .cm-btn-accept-all, .klaro .cm-btn-accept") as HTMLElement;
    if (klaroBtn) { klaroBtn.click(); return "klaro"; }

    // 5. Complianz
    const cmplzBtn = document.querySelector(".cmplz-accept, .cmplz-btn.cmplz-accept") as HTMLElement;
    if (cmplzBtn) { cmplzBtn.click(); return "complianz"; }

    // 6. Cookie Notice
    const cnBtn = document.querySelector("#cookie-notice .cn-set-cookie, #cookie-law-info-bar .cli-plugin-button") as HTMLElement;
    if (cnBtn) { cnBtn.click(); return "cookie-notice"; }

    // 7. Borlabs Cookie
    const borlabsBtn = document.querySelector("a#CookieBoxSaveButton, .cookie-preference-accept-all, ._brlbs-btn-accept-all") as HTMLElement;
    if (borlabsBtn) { borlabsBtn.click(); return "borlabs"; }

    // 8. Generic consent wrappers
    const consentWrappers = [
      ".consent-banner", ".cookie-consent", ".cookie-banner", "#cookie-banner",
      "#consent-banner", ".cc-window", ".cc-banner", "#cookieconsent",
      "[class*='cookie']", "[class*='consent']", "[id*='cookie']", "[id*='consent']",
      "[class*='privacy']", "[id*='privacy']",
    ];

    for (const selector of consentWrappers) {
      try {
        const wrapper = document.querySelector(selector);
        if (wrapper && (wrapper as HTMLElement).offsetHeight > 0) {
          if (clickButtonByText(wrapper as unknown as Document, acceptKeywords)) return `generic:${selector}`;
        }
      } catch {}
    }

    // 9. Global button search (exact match for accept-all text)
    if (clickButtonByText(document, ["alle akzeptieren", "accept all", "alle annehmen"])) return "global-button";

    // 10. Any <a> tags that look like accept buttons
    const allLinks = document.querySelectorAll("a");
    for (const link of allLinks) {
      const text = link.textContent?.toLowerCase().trim() || "";
      if (text === "alle akzeptieren" || text === "accept all" || text === "akzeptieren") {
        link.click();
        return "link-button";
      }
    }

    // NOT removing overlays — this breaks session cookies!
    return null;
  }).catch(() => null);

  if (dismissed) {
    console.log(`[cookie-utils] Cookie banner dismissed via: ${dismissed}`);
    await page.waitForTimeout(1000);
    return true;
  }

  // Phase 2: Playwright locators (catches iframes, complex rendering)
  const locatorStrategies = [
    { label: "pw-alle-akzeptieren", locator: page.locator('button:has-text("Alle akzeptieren"), a:has-text("Alle akzeptieren"), [role="button"]:has-text("Alle akzeptieren")').first() },
    { label: "pw-accept-all", locator: page.locator('button:has-text("Accept all"), a:has-text("Accept all")').first() },
    { label: "pw-akzeptieren", locator: page.locator('button:has-text("Akzeptieren"), a:has-text("Akzeptieren")').first() },
    { label: "pw-alle-annehmen", locator: page.locator('button:has-text("Alle annehmen"), a:has-text("Alle annehmen")').first() },
    { label: "pw-zustimmen", locator: page.locator('button:has-text("Zustimmen"), a:has-text("Zustimmen")').first() },
    { label: "pw-einverstanden", locator: page.locator('button:has-text("Einverstanden"), a:has-text("Einverstanden")').first() },
  ];

  for (const strategy of locatorStrategies) {
    try {
      if (await strategy.locator.isVisible({ timeout: 500 })) {
        await strategy.locator.click({ timeout: 3000 });
        console.log(`[cookie-utils] Cookie banner dismissed via: ${strategy.label}`);
        await page.waitForTimeout(1000);
        return true;
      }
    } catch {}
  }

  // Phase 3: Check iframes
  try {
    const frames = page.frames();
    for (const frame of frames) {
      if (frame === page.mainFrame()) continue;
      const frameUrl = frame.url().toLowerCase();
      if (frameUrl.includes("consent") || frameUrl.includes("cookie") || frameUrl.includes("privacy") || frameUrl.includes("cmp")) {
        try {
          const acceptBtn = frame.locator('button:has-text("Alle akzeptieren"), button:has-text("Accept all"), a:has-text("Alle akzeptieren")').first();
          if (await acceptBtn.isVisible({ timeout: 1500 })) {
            await acceptBtn.click({ timeout: 3000 });
            console.log(`[cookie-utils] Cookie banner dismissed via: iframe (${frameUrl.substring(0, 60)})`);
            await page.waitForTimeout(1000);
            return true;
          }
        } catch {}
      }
    }
  } catch {}

  // Phase 4: Smart overlay button detection — for custom overlays that use
  // CSS-rendered text (::before/::after) or obfuscated class names.
  // Finds fixed overlays with high z-index, then clicks the most prominent
  // cursor:pointer element that looks like an accept button.
  const smartClicked = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));

    // Find fixed position overlays
    const overlays = all.filter(el => {
      const style = window.getComputedStyle(el as HTMLElement);
      return style.position === "fixed"
        && parseInt(style.zIndex || "0") > 500
        && (el as HTMLElement).offsetWidth > 200
        && (el as HTMLElement).offsetHeight > 100;
    });

    for (const overlay of overlays) {
      const candidates = Array.from(overlay.querySelectorAll("*")).filter(el => {
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        const rect = htmlEl.getBoundingClientRect();
        // Must be cursor:pointer, reasonable button size, not a link/svg
        return style.cursor === "pointer"
          && rect.width > 80 && rect.height > 20
          && rect.width < 500 && rect.height < 80
          && el.tagName !== "A" && el.tagName !== "SVG" && el.tagName !== "LINE"
          && el.tagName !== "SPAN" && el.tagName !== "LABEL"
          && !el.classList.contains("hidden")
          && style.display !== "none"
          && rect.width > 0 && rect.height > 0;
      });

      if (candidates.length > 0) {
        // Pick the widest visible candidate — most likely the primary accept button
        candidates.sort((a, b) =>
          (b as HTMLElement).getBoundingClientRect().width - (a as HTMLElement).getBoundingClientRect().width
        );
        (candidates[0] as HTMLElement).click();
        return `smart-overlay:${(candidates[0] as HTMLElement).className?.toString().substring(0, 40)}`;
      }
    }
    return null;
  }).catch(() => null);

  if (smartClicked) {
    console.log(`[cookie-utils] Cookie banner dismissed via: ${smartClicked}`);
    await page.waitForTimeout(1000);
    return true;
  }

  // If nothing worked, log and return false — caller will proceed anyway
  // Playwright can fill/click/evaluate behind overlays
  console.log("[cookie-utils] No cookie banner found or could not dismiss — proceeding behind overlay");
  return false;
}
