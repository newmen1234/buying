// Fastmail JMAP email search service for order tracking
import { extractTrackingNumbers } from "./tracks-service";

export interface EmailMatch {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  snippet: string;
}

export interface EmailSearchResult {
  found: boolean;
  emails: EmailMatch[];
  orderStatus?: string;
  trackingNumber?: string;
  carrierName?: string;
  trackingUrl?: string;
  rawSubject?: string;
  receivedAt?: string;
  deliveryDate?: string;
}

// ============= Parsed email with full body (for recipe engine) =============
export interface ParsedEmail {
  id: string;
  subject: string;
  from: string;
  receivedAt: string;
  textBody: string;
  htmlBody: string;
}

// ============= JMAP Session Helper =============

export function getTokenForEntity(legalEntity: string): string | null {
  const le = legalEntity.toLowerCase();
  if (le === "newmen" || le.includes("newmen")) {
    return process.env.FASTMAIL_NEWMEN_TOKEN || null;
  }
  if (le === "vatebo" || le.includes("vatebo")) {
    return process.env.FASTMAIL_VATEBO_TOKEN || null;
  }
  if (le === "anecy" || le.includes("anecy")) {
    return process.env.FASTMAIL_ANECY_TOKEN || null;
  }
  if (le === "croxl" || le.includes("croxl")) {
    return process.env.FASTMAIL_CROXL_TOKEN || null;
  }
  return null;
}

export interface JmapSession {
  apiUrl: string;
  accountId: string;
  token: string;
}

export async function getJmapSession(legalEntity: string): Promise<JmapSession> {
  const token = getTokenForEntity(legalEntity);
  if (!token) {
    throw new Error(`No Fastmail token for entity: ${legalEntity}`);
  }
  const sessionRes = await fetch("https://api.fastmail.com/jmap/session", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!sessionRes.ok) {
    throw new Error(`Fastmail session error: ${sessionRes.status} ${sessionRes.statusText}`);
  }
  const session = await sessionRes.json();
  const apiUrl = session.apiUrl;
  // Find the account that supports JMAP mail (not just contacts)
  const accounts = session.accounts || {};
  let accountId = "";
  for (const [id, acct] of Object.entries(accounts)) {
    const caps = (acct as any).accountCapabilities || {};
    if ("urn:ietf:params:jmap:mail" in caps) {
      accountId = id;
      break;
    }
  }
  if (!accountId) {
    // Fallback to first account if none has mail capability explicitly
    accountId = Object.keys(accounts)[0] || "";
  }
  if (!accountId) {
    throw new Error("No Fastmail account found in session");
  }
  return { apiUrl, accountId, token };
}

// ============= JMAP email fetching =============

/** Execute a JMAP Email/query + Email/get and return parsed emails */
export async function fetchEmails(
  jmap: JmapSession,
  filter: any,
  limit: number = 10
): Promise<ParsedEmail[]> {
  const response = await fetch(jmap.apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jmap.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
      methodCalls: [
        [
          "Email/query",
          {
            accountId: jmap.accountId,
            filter,
            sort: [{ property: "receivedAt", isAscending: false }],
            limit,
          },
          "0",
        ],
        [
          "Email/get",
          {
            accountId: jmap.accountId,
            "#ids": { resultOf: "0", name: "Email/query", path: "/ids" },
            properties: ["id", "subject", "from", "receivedAt", "textBody", "htmlBody", "bodyValues"],
            fetchTextBodyValues: true,
            fetchHTMLBodyValues: true,
          },
          "1",
        ],
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Fastmail API error: ${response.status} ${response.statusText}`);
  }
  const data = await response.json();
  const queryResponse = data.methodResponses?.[0];
  if (queryResponse?.[0] === "error") {
    throw new Error(`JMAP query error: ${queryResponse[1]?.type || "unknown"}`);
  }

  const rawEmails = data.methodResponses?.[1]?.[1]?.list || [];
  return rawEmails.map((email: any) => {
    let textBody = "";
    let htmlBody = "";
    if (email.bodyValues) {
      for (const part of email.textBody || []) {
        if (email.bodyValues[part.partId]) {
          textBody += email.bodyValues[part.partId].value || "";
        }
      }
      for (const part of email.htmlBody || []) {
        if (email.bodyValues[part.partId]) {
          htmlBody += email.bodyValues[part.partId].value || "";
        }
      }
      if (!textBody && htmlBody) {
        textBody = htmlBody.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
    return {
      id: email.id,
      subject: email.subject || "",
      from: email.from?.[0]?.email || email.from?.[0]?.name || "",
      receivedAt: email.receivedAt || "",
      textBody,
      htmlBody,
    };
  });
}

// ============= Recipe-targeted email search =============

/** Search Fastmail for emails from specific senders about a specific order */
export async function searchEmailsByRecipe(
  shopOrderId: string,
  legalEntity: string,
  senderPatterns: string[]
): Promise<ParsedEmail[]> {
  const jmap = await getJmapSession(legalEntity);

  // Build sender filter: OR conditions for each sender pattern
  const fromConditions = senderPatterns
    .filter(p => !p.startsWith("@")) // exact addresses
    .map(p => ({ from: p }));

  // For @domain patterns, use from filter with domain
  const domainPatterns = senderPatterns
    .filter(p => p.startsWith("@"))
    .map(p => ({ from: p.slice(1) }));

  const allFromConditions = [...fromConditions, ...domainPatterns];

  let filter: any;
  if (allFromConditions.length > 0) {
    filter = {
      operator: "AND",
      conditions: [
        { text: shopOrderId },
        allFromConditions.length === 1
          ? allFromConditions[0]
          : { operator: "OR", conditions: allFromConditions },
      ],
    };
  } else {
    filter = { text: shopOrderId };
  }

  return fetchEmails(jmap, filter, 20);
}

/** Search Fastmail for sample emails from a shop domain (for recipe creation) */
export async function searchSampleEmails(
  shopDomain: string,
  legalEntity: string,
  limit: number = 20
): Promise<ParsedEmail[]> {
  const jmap = await getJmapSession(legalEntity);
  return fetchEmails(jmap, { from: shopDomain }, limit);
}

// ============= Original generic search (backward compatible) =============

/** Search Fastmail for emails containing the given order ID */
export async function searchOrderInEmail(
  shopOrderId: string,
  legalEntity: string
): Promise<EmailSearchResult> {
  const token = getTokenForEntity(legalEntity);
  if (!token) {
    return { found: false, emails: [], orderStatus: `No Fastmail token for entity: ${legalEntity}` };
  }

  try {
    const jmap = await getJmapSession(legalEntity);
    const emails = await fetchEmails(jmap, { text: shopOrderId }, 10);

    if (emails.length === 0) {
      return { found: false, emails: [] };
    }

    const matches: EmailMatch[] = [];
    let bestStatus: string | undefined;
    let bestTracking: string | undefined;
    let bestCarrier: string | undefined;

    for (const email of emails) {
      matches.push({
        id: email.id,
        subject: email.subject,
        from: email.from,
        receivedAt: email.receivedAt,
        snippet: email.textBody.slice(0, 300),
      });

      const trackingResults = extractTrackingNumbers(email.textBody, email.subject);
      if (trackingResults.length > 0 && !bestTracking) {
        bestTracking = trackingResults[0].trackingNumber;
        bestCarrier = trackingResults[0].carrier;
      }

      const statusResult = detectOrderStatus(email.textBody, email.subject);
      if (statusResult && !bestStatus) {
        bestStatus = statusResult;
      }
    }

    return {
      found: true,
      emails: matches,
      orderStatus: bestStatus,
      trackingNumber: bestTracking,
      carrierName: bestCarrier,
      rawSubject: matches[0]?.subject,
      receivedAt: matches[0]?.receivedAt,
    };
  } catch (error: any) {
    if (error.message?.includes("No Fastmail token")) {
      return { found: false, emails: [], orderStatus: error.message };
    }
    throw error;
  }
}

/** Detect order status from email text using multilingual regex patterns */
export function detectOrderStatus(text: string, subject: string): string | undefined {
  const combined = `${subject} ${text}`.toLowerCase();

  if (/versandt|versended|shipped|dispatched|envoy[eé]|enviado|wysłan|отправлен|выслан|versendet/i.test(combined)) {
    return "shipped";
  }
  if (/cancel|storn|annull|отмен|storniert|annulé/i.test(combined)) {
    return "cancelled";
  }
  if (/deliver|zugestellt|livr[eé]|entregad|dostarczono|доставлен/i.test(combined)) {
    return "delivered";
  }
  if (/return|rücksendung|retour|devoluci|zwrot|возврат/i.test(combined)) {
    return "returned";
  }
  if (/processing|bearbeitung|traitement|elaboración|przetwarzanie|обработк|in bearbeitung/i.test(combined)) {
    return "processing";
  }
  if (/confirm|bestätigung|bestätigt|подтвержд/i.test(combined)) {
    return "confirmed";
  }

  return undefined;
}
