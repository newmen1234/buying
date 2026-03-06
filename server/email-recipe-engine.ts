// Email Recipe Engine — executes per-shop email parsing recipes against Fastmail
import { searchEmailsByRecipe, type ParsedEmail } from "./fastmail-search";

// ============= Email Recipe Types =============

export interface EmailRecipeJson {
  version: number;
  shopName: string;
  senderPatterns: string[]; // ["versandbestaetigung@amazon.de", "@amazon.de"]
  emailTypes: EmailTypeRule[];
  statusPriority: string[]; // ["confirmed", "processing", "shipped", "cancelled", "returned", "delivered"]
  carrierAliases?: Record<string, string>; // e.g. {"Spring GDS": "Hermes"} — normalize carrier names
  searchTermPattern?: string; // regex to transform shopOrderId before searching, capture group 1 used as search term
}

export interface EmailTypeRule {
  type: string; // "shipping_confirmation", "delivery_confirmation", "cancellation", etc.
  match: {
    subjectContains?: string[];  // any of these in subject (case-insensitive)
    subjectPattern?: string;     // regex for subject
    fromExact?: string;          // exact from address
    bodyContains?: string[];     // any of these in body (case-insensitive)
  };
  impliedStatus: string; // "shipped", "delivered", "cancelled", etc.
  extraction: {
    orderIdPatterns?: string[];      // regex with capture group 1
    trackingPatterns?: string[];     // regex with capture group 1
    carrierPatterns?: string[];      // regex with capture group 1
    deliveryDatePatterns?: string[]; // regex with capture group 1
    referencePatterns?: string[];    // regex with capture group 1
    defaultCarrier?: string;         // fallback carrier if patterns don't match (e.g. "DHL")
  };
}

// ============= Result Types =============

export interface EmailRecipeResult {
  found: boolean;
  status: string | null;
  trackingNumber: string | null;
  carrierName: string | null;
  deliveryDate: string | null;
  referenceNumber: string | null;
  emailsAnalyzed: number;
  matchedEmails: MatchedEmail[];
  recipeDomain: string;
}

export interface MatchedEmail {
  emailId: string;
  subject: string;
  from: string;
  receivedAt: string;
  matchedType: string;
  extractedStatus: string;
  extractedTracking: string | null;
  extractedCarrier: string | null;
  extractedDeliveryDate: string | null;
  extractedReference: string | null;
}

// ============= Execution =============

/** Execute an email recipe: search Fastmail + parse using recipe rules
 *  If searchTerm is provided, search by it instead of shopOrderId (e.g. SEUR reference)
 *  and skip orderIdPatterns validation */
export async function executeEmailRecipe(
  recipe: EmailRecipeJson,
  shopOrderId: string,
  legalEntity: string,
  searchTerm?: string
): Promise<EmailRecipeResult> {
  const recipeDomain = recipe.shopName || "unknown";
  let term = searchTerm || shopOrderId;
  const skipOrderIdValidation = !!searchTerm; // skip when searching by reference

  // Apply searchTermPattern to transform shopOrderId before searching
  if (!searchTerm && recipe.searchTermPattern) {
    try {
      const m = new RegExp(recipe.searchTermPattern).exec(shopOrderId);
      if (m && m[1]) {
        term = m[1];
        console.log(`[email-recipe] Transformed search term: "${shopOrderId}" → "${term}"`);
      }
    } catch (e) {
      console.error(`[email-recipe] Invalid searchTermPattern: ${recipe.searchTermPattern}`);
    }
  }

  // 1. Search Fastmail with recipe's sender patterns
  let emails: ParsedEmail[];
  try {
    emails = await searchEmailsByRecipe(term, legalEntity, recipe.senderPatterns);
  } catch (error: any) {
    console.error(`[email-recipe] Search failed for ${recipeDomain}:`, error.message);
    return {
      found: false, status: null, trackingNumber: null,
      carrierName: null, deliveryDate: null, referenceNumber: null,
      emailsAnalyzed: 0, matchedEmails: [], recipeDomain,
    };
  }

  if (emails.length === 0) {
    return {
      found: false, status: null, trackingNumber: null,
      carrierName: null, deliveryDate: null, referenceNumber: null,
      emailsAnalyzed: 0, matchedEmails: [], recipeDomain,
    };
  }

  // 2. Match each email against recipe types and extract data
  const matchedEmails: MatchedEmail[] = [];

  for (const email of emails) {
    const matchedType = matchEmailType(email, recipe.emailTypes);
    if (!matchedType) {
      console.log(`[email-recipe] Unmatched email: subject="${email.subject}" from="${email.from}"`);
      continue;
    }

    const extracted = extractFromEmail(
      email.textBody,
      email.subject,
      email.htmlBody,
      matchedType.extraction
    );

    // Verify order ID match (if patterns provided) — skip when searching by reference
    if (!skipOrderIdValidation && matchedType.extraction.orderIdPatterns && matchedType.extraction.orderIdPatterns.length > 0) {
      const extractedOrderId = extracted.orderId;
      if (extractedOrderId) {
        const directMatch = extractedOrderId.includes(shopOrderId) || shopOrderId.includes(extractedOrderId);
        // Also check numeric part match when searchTermPattern is used
        const numericMatch = term !== shopOrderId && (extractedOrderId.includes(term) || term.includes(extractedOrderId));
        if (!directMatch && !numericMatch) {
          continue; // Order ID doesn't match
        }
      }
    }

    matchedEmails.push({
      emailId: email.id,
      subject: email.subject,
      from: email.from,
      receivedAt: email.receivedAt,
      matchedType: matchedType.type,
      extractedStatus: matchedType.impliedStatus,
      extractedTracking: extracted.tracking,
      extractedCarrier: applyCarrierAlias(extracted.carrier, recipe.carrierAliases),
      extractedDeliveryDate: extracted.deliveryDate,
      extractedReference: extracted.reference,
    });
  }

  if (matchedEmails.length === 0) {
    return {
      found: false, status: null, trackingNumber: null,
      carrierName: null, deliveryDate: null, referenceNumber: null,
      emailsAnalyzed: emails.length, matchedEmails: [], recipeDomain,
    };
  }

  // 3. Resolve final status (highest priority wins)
  const finalStatus = resolveStatus(matchedEmails, recipe.statusPriority);

  // 4. Get best tracking/carrier/delivery date (from most recent relevant email)
  const bestTracking = matchedEmails.find(m => m.extractedTracking)?.extractedTracking || null;
  const bestCarrier = matchedEmails.find(m => m.extractedCarrier)?.extractedCarrier || null;
  const bestDeliveryDate = matchedEmails.find(m => m.extractedDeliveryDate)?.extractedDeliveryDate || null;
  const bestReference = matchedEmails.find(m => m.extractedReference)?.extractedReference || null;

  return {
    found: true,
    status: finalStatus,
    trackingNumber: bestTracking,
    carrierName: bestCarrier,
    deliveryDate: bestDeliveryDate,
    referenceNumber: bestReference,
    emailsAnalyzed: emails.length,
    matchedEmails,
    recipeDomain,
  };
}

// ============= Matching =============

/** Match an email against recipe email types. Returns first matching type. */
function matchEmailType(email: ParsedEmail, emailTypes: EmailTypeRule[]): EmailTypeRule | null {
  for (const rule of emailTypes) {
    if (matchesRule(email, rule.match)) {
      return rule;
    }
  }
  return null;
}

function matchesRule(email: ParsedEmail, match: EmailTypeRule["match"]): boolean {
  const subject = email.subject.toLowerCase();
  const body = email.textBody.toLowerCase();
  const from = email.from.toLowerCase();

  // fromExact
  if (match.fromExact && from !== match.fromExact.toLowerCase()) {
    return false;
  }

  // subjectContains — at least one must match
  if (match.subjectContains && match.subjectContains.length > 0) {
    const hasMatch = match.subjectContains.some(s => subject.includes(s.toLowerCase()));
    if (!hasMatch) return false;
  }

  // subjectPattern — regex
  if (match.subjectPattern) {
    try {
      if (!new RegExp(match.subjectPattern, "i").test(email.subject)) return false;
    } catch { return false; }
  }

  // bodyContains — at least one must match
  if (match.bodyContains && match.bodyContains.length > 0) {
    const hasMatch = match.bodyContains.some(s => body.includes(s.toLowerCase()));
    if (!hasMatch) return false;
  }

  return true;
}

// ============= Extraction =============

interface ExtractedData {
  orderId: string | null;
  tracking: string | null;
  carrier: string | null;
  deliveryDate: string | null;
  reference: string | null;
}

/** Extract all href URLs from HTML before stripping tags */
function extractHrefUrls(html: string): string {
  const urls: string[] = [];
  const hrefRegex = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = hrefRegex.exec(html)) !== null) {
    // Decode HTML entities in URL
    const url = m[1].replace(/&amp;/g, "&").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
    urls.push(url);
  }
  return urls.join("\n");
}

function extractFromEmail(
  textBody: string,
  subject: string,
  htmlBody: string,
  extraction: EmailTypeRule["extraction"]
): ExtractedData {
  // Extract href URLs from HTML before stripping tags (tracking numbers often hide in URLs)
  const hrefUrls = extractHrefUrls(htmlBody);
  const strippedHtml = htmlBody.replace(/<[^>]*>/g, " ");
  const searchTexts = [textBody, subject, strippedHtml, hrefUrls];
  const fullText = searchTexts.join("\n");

  return {
    orderId: runPatterns(fullText, extraction.orderIdPatterns),
    tracking: runPatterns(fullText, extraction.trackingPatterns),
    carrier: runPatterns(fullText, extraction.carrierPatterns) || extraction.defaultCarrier || null,
    deliveryDate: runPatterns(fullText, extraction.deliveryDatePatterns),
    reference: runPatterns(fullText, extraction.referencePatterns),
  };
}

/** Run regex patterns against text, return first capture group 1 match */
function runPatterns(text: string, patterns?: string[]): string | null {
  if (!patterns || patterns.length === 0) return null;
  for (const pattern of patterns) {
    try {
      const match = new RegExp(pattern, "i").exec(text);
      if (match && match[1]) {
        return match[1].trim();
      }
    } catch {
      // Invalid regex, skip
    }
  }
  return null;
}

// ============= Status Resolution =============

/** Resolve final status from matched emails using priority list.
 *  Higher index in statusPriority = higher priority.
 *  "delivered" > "shipped" > "processing" etc. */
function resolveStatus(matchedEmails: MatchedEmail[], statusPriority: string[]): string {
  let bestStatus = matchedEmails[0].extractedStatus;
  let bestPriority = statusPriority.indexOf(bestStatus);

  for (const m of matchedEmails) {
    const priority = statusPriority.indexOf(m.extractedStatus);
    if (priority > bestPriority) {
      bestPriority = priority;
      bestStatus = m.extractedStatus;
    }
  }

  return bestStatus;
}

// ============= Carrier Alias =============

/** Apply carrier alias mapping: e.g. "Spring GDS" → "Hermes" */
function applyCarrierAlias(carrier: string | null, aliases?: Record<string, string>): string | null {
  if (!carrier || !aliases) return carrier;
  // Case-insensitive lookup
  for (const [from, to] of Object.entries(aliases)) {
    if (carrier.toLowerCase() === from.toLowerCase()) return to;
  }
  return carrier;
}
