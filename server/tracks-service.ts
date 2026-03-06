// Tracking number detection and parsing service

export interface TrackingInfo {
  trackingNumber: string;
  carrier: "dhl" | "ups" | "fedex" | "dpd" | "unknown";
  orderId?: string;
}

// Regex patterns for different carriers
const TRACKING_PATTERNS = {
  dhl: [
    /\b(\d{10,11})\b/g, // Standard DHL
    /\b([A-Z]{2}\d{9}[A-Z]{2})\b/g, // DHL Express international
    /\b(JJD\d{18})\b/g, // JJD format
    /\b(\d{12,14})\b/g, // DHL Paket Germany
    /\b(0034\d{16,18})\b/g, // DHL Paket long format (20-22 digits starting with 0034)
  ],
  ups: [
    /\b(1Z[A-Z0-9]{16})\b/gi, // UPS standard
    /\b(T\d{10})\b/g, // UPS Mail Innovations
  ],
  fedex: [
    /\b(\d{12})\b/g, // FedEx Express (12 digits only)
    /\b(\d{15})\b/g, // FedEx Ground (15 digits)
  ],
  dpd: [
    /\b(\d{14})\b/g, // DPD standard
    /\b([A-Z]{2}\d{9})\b/g, // DPD alternate
    /\b(0\d{13})\b/g, // DPD Germany
  ],
};

// Order ID patterns
const ORDER_PATTERNS = [
  /(?:order|bestellung|commande|ordine|pedido|zamówienie)[\s#:]*([A-Z0-9-]{5,30})/gi,
  /(?:order|bestellung)[\s]*(?:number|nummer|nr\.?)[\s:]*([A-Z0-9-]{5,30})/gi,
  /#([A-Z0-9-]{5,20})/g,
  /(?:bestell-?nr\.?|order-?id|auftragsnummer)[\s:]*([A-Z0-9-]{5,30})/gi,
];

export function extractTrackingNumbers(text: string, subject: string = ""): TrackingInfo[] {
  const results: TrackingInfo[] = [];
  const foundNumbers = new Set<string>();
  const combinedText = `${subject} ${text}`;
  
  // Extract order ID first
  let orderId: string | undefined;
  for (const pattern of ORDER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(combinedText)) !== null) {
      if (match[1] && match[1].length >= 5) {
        orderId = match[1];
        break;
      }
    }
    if (orderId) break;
  }
  
  // Check each carrier's patterns
  for (const [carrier, patterns] of Object.entries(TRACKING_PATTERNS)) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(combinedText)) !== null) {
        const trackingNumber = match[1];
        if (trackingNumber && !foundNumbers.has(trackingNumber)) {
          // Validate based on carrier-specific rules
          if (isValidTrackingNumber(trackingNumber, carrier as keyof typeof TRACKING_PATTERNS)) {
            foundNumbers.add(trackingNumber);
            results.push({
              trackingNumber,
              carrier: carrier as "dhl" | "ups" | "fedex" | "dpd",
              orderId,
            });
          }
        }
      }
    }
  }
  
  return results;
}

function isValidTrackingNumber(num: string, carrier: keyof typeof TRACKING_PATTERNS): boolean {
  switch (carrier) {
    case "ups":
      // UPS 1Z format validation
      if (num.toUpperCase().startsWith("1Z") && num.length === 18) {
        return true;
      }
      return num.length >= 10 && num.length <= 18;
    
    case "dhl":
      // DHL various formats
      if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(num)) return true;
      if (/^JJD\d{18}$/.test(num)) return true;
      if (/^\d{10,14}$/.test(num)) return true;
      return false;
    
    case "fedex":
      // FedEx: 12, 15, 20, or 22 digits
      return [12, 15, 20, 22].includes(num.length) && /^\d+$/.test(num);
    
    case "dpd":
      // DPD: typically 14 digits
      if (/^\d{14}$/.test(num)) return true;
      if (/^0\d{13}$/.test(num)) return true;
      if (/^[A-Z]{2}\d{9}$/.test(num)) return true;
      return false;
    
    default:
      return num.length >= 8;
  }
}

export function detectCarrier(trackingNumber: string): "dhl" | "ups" | "fedex" | "dpd" | "unknown" {
  const num = trackingNumber.toUpperCase();
  
  // UPS: starts with 1Z
  if (num.startsWith("1Z") && num.length === 18) {
    return "ups";
  }
  
  // DHL Express International
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(num)) {
    return "dhl";
  }
  
  // DHL JJD format
  if (num.startsWith("JJD")) {
    return "dhl";
  }
  
  // DPD starts with 0 and 14 digits
  if (/^0\d{13}$/.test(num)) {
    return "dpd";
  }
  
  // FedEx specific lengths
  if (/^\d{12}$/.test(num) || /^\d{15}$/.test(num) || /^\d{20}$/.test(num) || /^\d{22}$/.test(num)) {
    return "fedex";
  }
  
  // DHL Paket (10-11 digits)
  if (/^\d{10,11}$/.test(num)) {
    return "dhl";
  }
  
  // DPD 14 digits
  if (/^\d{14}$/.test(num)) {
    return "dpd";
  }
  
  return "unknown";
}

export function getCarrierName(carrier: string): string {
  const names: Record<string, string> = {
    dhl: "DHL",
    ups: "UPS",
    fedex: "FedEx",
    dpd: "DPD",
    unknown: "Неизвестно",
  };
  return names[carrier] || carrier.toUpperCase();
}

export function getCarrierTrackingUrl(trackingNumber: string, carrier: string): string {
  switch (carrier) {
    case "dhl":
      return `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`;
    case "ups":
      return `https://www.ups.com/track?tracknum=${trackingNumber}`;
    case "fedex":
      return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
    case "dpd":
      return `https://tracking.dpd.de/parcelstatus?query=${trackingNumber}`;
    default:
      return `https://www.google.com/search?q=${trackingNumber}+tracking`;
  }
}
