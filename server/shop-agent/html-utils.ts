/**
 * Utilities for simplifying HTML before sending to AI.
 * Aggressively strips everything except interactive elements and visible text.
 * Goal: keep page under 3-4K chars so AI context stays small.
 */

/** Strip all non-essential HTML, keeping only structure, text, forms, links */
export function simplifyHtml(html: string): string {
  let result = html;

  // Remove script/style/noscript/svg/iframe/picture/video/audio
  result = result.replace(/<(script|style|noscript|svg|iframe|picture|video|audio|template|canvas)[\s\S]*?<\/\1>/gi, "");

  // Remove HTML comments
  result = result.replace(/<!--[\s\S]*?-->/g, "");

  // Remove all attributes except href, action, method, type, name, id, class, placeholder, value, role, aria-label
  result = result.replace(/<([a-z][a-z0-9]*)\s+([^>]*)>/gi, (match, tag, attrs) => {
    const kept: string[] = [];
    const allowedAttrs = /\b(href|action|method|type|name|id|class|placeholder|value|role|aria-label|for|src|alt)\s*=\s*("[^"]*"|'[^']*')/gi;
    let attrMatch;
    while ((attrMatch = allowedAttrs.exec(attrs)) !== null) {
      // Skip huge class strings (tailwind etc)
      if (attrMatch[1].toLowerCase() === "class" && attrMatch[2].length > 60) continue;
      // Skip data URIs in src
      if (attrMatch[1].toLowerCase() === "src" && attrMatch[2].includes("data:")) continue;
      kept.push(`${attrMatch[1]}=${attrMatch[2]}`);
    }
    return kept.length > 0 ? `<${tag} ${kept.join(" ")}>` : `<${tag}>`;
  });

  // Remove tags that add no navigational value (keep their children)
  const stripTags = ["header", "footer", "nav", "aside", "figure", "figcaption", "picture", "source", "meta", "link", "head", "title"];
  for (const tag of stripTags) {
    result = result.replace(new RegExp(`<${tag}[^>]*>`, "gi"), "");
    result = result.replace(new RegExp(`</${tag}>`, "gi"), "");
  }

  // Remove img tags (not useful for form navigation)
  result = result.replace(/<img[^>]*>/gi, "");

  // Remove br tags
  result = result.replace(/<br\s*\/?>/gi, " ");

  // Remove empty tags
  result = result.replace(/<(div|span|p|a|li|ul|ol|section|article|main|label|td|tr|th|table|tbody|thead)\s*>\s*<\/\1>/gi, "");

  // Collapse whitespace
  result = result.replace(/\s{2,}/g, " ");
  result = result.replace(/>\s+</g, "> <");

  return result.trim();
}

/** Extract only form elements with their inputs — compact format */
export function extractForms(html: string): string {
  const forms: string[] = [];
  const formRegex = /<form[\s\S]*?<\/form>/gi;
  let match;

  while ((match = formRegex.exec(html)) !== null) {
    forms.push(simplifyHtml(match[0]));
  }

  // Also look for standalone inputs/buttons outside forms
  if (forms.length === 0) {
    const interactiveRegex = /<(input|button|select|textarea)[\s\S]*?(?:\/>|<\/\1>)/gi;
    const inputs: string[] = [];
    while ((match = interactiveRegex.exec(html)) !== null) {
      inputs.push(simplifyHtml(match[0]));
    }
    if (inputs.length > 0) {
      return inputs.join("\n");
    }
  }

  return forms.join("\n\n");
}

/** Extract navigation links — compact: "text → href" */
export function extractLinks(html: string): string[] {
  const links: string[] = [];
  const linkRegex = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].replace(/<[^>]*>/g, "").trim();
    if (href && text && text.length < 100 && !href.startsWith("javascript:") && !href.startsWith("#") && !href.startsWith("mailto:")) {
      links.push(`${text} → ${href}`);
    }
  }

  // Deduplicate
  return [...new Set(links)];
}

/** Extract visible text content — no HTML tags */
export function extractText(html: string): string {
  let text = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, "");
  text = text.replace(/<[^>]*>/g, " ");
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/\s{2,}/g, " ");
  return text.trim();
}

/** Truncate to max character count */
export function truncateHtml(html: string, maxLength: number = 8000): string {
  if (html.length <= maxLength) return html;
  return html.substring(0, maxLength) + "\n... [truncated]";
}

/**
 * Build a compact page context for AI: forms + links + snippet of visible text.
 * Target: ~3-4K chars total.
 */
export function buildPageContext(html: string, url: string): string {
  const forms = extractForms(html);
  const links = extractLinks(html);
  const simplified = simplifyHtml(html);

  let context = `URL: ${url}\n`;

  // Forms are most important for login/navigation
  if (forms) {
    context += `\nFORMS:\n${truncateHtml(forms, 3000)}\n`;
  }

  // Relevant links (order-related, account-related)
  const relevantLinks = links.filter(l => {
    const lower = l.toLowerCase();
    return lower.includes("order") || lower.includes("bestell") || lower.includes("konto") ||
      lower.includes("account") || lower.includes("login") || lower.includes("anmeld") ||
      lower.includes("track") || lower.includes("sendung") || lower.includes("status") ||
      lower.includes("mein") || lower.includes("profil") || lower.includes("history") ||
      lower.includes("verlauf") || lower.includes("übersicht");
  });

  if (relevantLinks.length > 0) {
    context += `\nRELEVANT LINKS:\n${relevantLinks.slice(0, 20).join("\n")}\n`;
  }

  // Compact page HTML — only if there's space left
  const remaining = 6000 - context.length;
  if (remaining > 500) {
    context += `\nPAGE:\n${truncateHtml(simplified, remaining)}`;
  }

  return context;
}
