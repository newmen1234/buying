// 17track API v2.4 integration service

const API_BASE = "https://api.17track.net/track/v2.4";

interface Track17Response {
  code: number;
  data: {
    accepted?: Array<{
      number: string;
      carrier: number;
    }>;
    rejected?: Array<{
      number: string;
      error: {
        code: number;
        message: string;
      };
    }>;
  };
}

interface TrackingEvent {
  a: string; // address/location
  z: string; // description
  d: string; // date (UTC)
}

interface TrackInfoResponse {
  code: number;
  data: {
    accepted?: Array<{
      number: string;
      carrier: number;
      param: any;
      tag: string;
      track_info: {
        shipping_info: {
          shipper_address: {
            country: string;
            state: string;
            city: string;
          };
          recipient_address: {
            country: string;
            state: string;
            city: string;
          };
        };
        latest_status: {
          status: string;
          sub_status: string;
        };
        latest_event: {
          time_iso: string;
          time_utc: string;
          description: string;
          location: string;
        };
        time_metrics: {
          days_after_order: number;
          days_of_transit: number;
          days_of_transit_done: number;
          days_after_last_update: number;
          estimated_delivery_date: {
            source: string;
            from: string;
            to: string;
          };
        };
        misc_info: {
          risk_factor: number;
          service_type: string;
          weight_raw: string;
          weight_kg: number;
          pieces: number;
          dimensions: string;
          customer_number: string;
          reference_number: string;
          local_number: string;
          local_provider: number;
          local_key: number;
        };
        milestone: any[];
        provider: Array<{
          events: TrackingEvent[];
        }>;
      };
    }>;
    rejected?: Array<{
      number: string;
      error: {
        code: number;
        message: string;
      };
    }>;
  };
}

// Verified carrier codes from https://res.17track.net/asset/carrier/info/apicarrier.all.json
const CARRIER_CODES: Record<string, number> = {
  dhl_paket: 7041,     // DHL Paket (Germany domestic)
  dhl_express: 100001, // DHL Express (international)
  ups: 100002,         // UPS
  fedex: 100003,       // FedEx
  gls: 100005,         // GLS
  dpd_de: 100007,      // DPD (DE)
  hermes_de: 100031,   // Hermes (DE)
  amazon: 100308,      // Amazon Shipping
  unknown: 0,          // Auto-detect
};

// Carriers for retry when format is not recognized
export const DE_CARRIER_CANDIDATES: Array<{ code: number; name: string }> = [
  { code: 7041, name: "DHL Paket" },
  { code: 100007, name: "DPD (DE)" },
  { code: 100005, name: "GLS" },
  { code: 100031, name: "Hermes (DE)" },
  { code: 100001, name: "DHL Express" },
  { code: 100003, name: "FedEx" },
];

// --- Carrier detection by tracking number format ---

export type CarrierDetection =
  | { type: "carrier"; code: number; name: string; normalizedNumber?: string }
  | { type: "skip"; reason: string }
  | { type: "auto" };

const FORMAT_RULES: Array<{ pattern: RegExp; result: CarrierDetection }> = [
  // ── Skip rules ──
  // Внутренний номер склада — 13 digits starting with 21
  { pattern: /^21\d{11}$/, result: { type: "skip", reason: "Не отслеживается — внутренний номер склада" } },
  // Amazon DE — skip (обрабатывается через Google Sheet)
  { pattern: /^DE\d{8,12}$/, result: { type: "skip", reason: "В пути — прочее" } },
  // SF Express — skip (requires phone number, не отслеживается)
  { pattern: /^SF\d+$/, result: { type: "skip", reason: "Не отслеживается — SF" } },

  // ── DHL Paket / Deutsche Post (code 7041) ──
  // 20 digits starting with 00 (Identcode/Leitcode: 0034, 0005, 0037 etc.)
  { pattern: /^00\d{18}$/, result: { type: "carrier", code: 7041, name: "DHL Paket" } },
  // 18 digits starting with 17 (e.g. 173300070033210286)
  { pattern: /^17\d{16}$/, result: { type: "carrier", code: 7041, name: "DHL Paket" } },
  // JJD + 17-24 digits (DHL Paket / DHL Global Forwarding)
  { pattern: /^JJD\d{17,24}$/, result: { type: "carrier", code: 7041, name: "DHL Paket" } },
  // JJ + 19 alphanumeric (non-JJD, e.g. JJATA8217862001168981 → DHL PARCEL Connect)
  { pattern: /^JJ[A-Z0-9]{19}$/, result: { type: "carrier", code: 7041, name: "DHL Paket" } },

  // ── UPS (code 100002) ──
  // 1Z + 16 alphanumeric
  { pattern: /^1Z[A-Z0-9]{16}$/, result: { type: "carrier", code: 100002, name: "UPS" } },

  // ── Hermes DE (code 100031) ──
  // H10x + 16 digits (20 total)
  { pattern: /^H10\d{17}$/, result: { type: "carrier", code: 100031, name: "Hermes (DE)" } },
  // 14 digits starting with 22 (e.g. 22055117300545)
  { pattern: /^22\d{12}$/, result: { type: "carrier", code: 100031, name: "Hermes (DE)" } },
  // 14 digits starting with 0405/0406
  { pattern: /^040[56]\d{10}$/, result: { type: "carrier", code: 100031, name: "Hermes (DE)" } },

  // ── GLS (code 100005) ──
  // JVGL prefix
  { pattern: /^JVGL\d+$/, result: { type: "carrier", code: 100005, name: "GLS" } },
  // 11/12-digit specific prefixes (5003, 5427)
  { pattern: /^5003\d{7,8}$/, result: { type: "carrier", code: 100005, name: "GLS" } },
  { pattern: /^5427\d{7,8}$/, result: { type: "carrier", code: 100005, name: "GLS" } },

  // ── DHL Paket — 14 digits: 015x, 016x, 017x only (confirmed: 0159 has delivered tracks) ──
  { pattern: /^01[567]\d{11}$/, result: { type: "carrier", code: 7041, name: "DHL Paket" } },

  // ── DPD DE (code 100007) ──
  // 14-15 digit specific prefixes (15-digit is DPD reference variant)
  { pattern: /^0502\d{10,11}$/, result: { type: "carrier", code: 100007, name: "DPD (DE)" } },
  { pattern: /^0717\d{10,11}$/, result: { type: "carrier", code: 100007, name: "DPD (DE)" } },
  { pattern: /^0944\d{10,11}$/, result: { type: "carrier", code: 100007, name: "DPD (DE)" } },
  { pattern: /^0516\d{10,11}$/, result: { type: "carrier", code: 100007, name: "DPD (DE)" } },
  // 14-digit DPD: 013x, 014x, 018x, 019x (confirmed: 01805059420156 = DPD Group on 17track)
  { pattern: /^01[3489]\d{11}$/, result: { type: "carrier", code: 100007, name: "DPD (DE)" } },
  // 14-digit DPD: starting with 13
  { pattern: /^13\d{12}$/, result: { type: "carrier", code: 100007, name: "DPD (DE)" } },
  // DPK prefix (Klassik Paket, e.g. DPK364845469572)
  { pattern: /^DPK\d+$/, result: { type: "carrier", code: 100007, name: "DPD (DE)" } },

  // ── Chronopost France (code 4041) ──
  // UPU S10 format: XW + 9 digits + JF (Chronopost identifier)
  { pattern: /^XW\d{9}JF$/, result: { type: "carrier", code: 4041, name: "Chronopost France" } },

  // ── FedEx (code 100003) ──
  // 12-digit: 888x, 8890
  { pattern: /^88[89]\d{9}$/, result: { type: "carrier", code: 100003, name: "FedEx" } },

  // ── Hermes catch-all: 14 digits with "05" at positions 3-4 (e.g. xx05xxxxxxxxxx) ──
  // AFTER 040[56] Hermes, 01[567] DHL, 01[3489] DPD, 13xx DPD — those are more specific
  { pattern: /^\d{2}05\d{10}$/, result: { type: "carrier", code: 100031, name: "Hermes (DE)" } },
  // ── DPD catch-all: 14 digits starting with 01 (remaining 01xx not caught by DHL/DPD above) ──
  { pattern: /^01\d{12}$/, result: { type: "carrier", code: 100007, name: "DPD (DE)" } },
  // ── GLS: 12 digits starting with 63 (before 12-digit DHL catch-all) ──
  { pattern: /^63\d{10}$/, result: { type: "carrier", code: 100005, name: "GLS" } },

  // ── Catch-all by length (MUST be last) ──
  // 12-digit numeric → DHL Paket (most common DE 12-digit carrier)
  { pattern: /^\d{12}$/, result: { type: "carrier", code: 7041, name: "DHL Paket" } },
  // 11-digit numeric → GLS (only major DE carrier with 11-digit format)
  { pattern: /^\d{11}$/, result: { type: "carrier", code: 100005, name: "GLS" } },
];

export function detectCarrierByFormat(trackingNumber: string): CarrierDetection {
  // Normalize to uppercase for consistent regex matching
  trackingNumber = trackingNumber.trim().toUpperCase();

  // DPD normalization: 13-digit starting with 71/94/51 → prepend 0 for 14-digit format
  // e.g. 7174010148207 → 07174010148207 (matches ^07\d{12}$)
  if (/^(71|94|51)\d{11}$/.test(trackingNumber)) {
    return { type: "carrier", code: 100007, name: "DPD (DE)", normalizedNumber: "0" + trackingNumber };
  }

  // Check known format rules first (before length check, so long JJD tracks match)
  for (const rule of FORMAT_RULES) {
    if (rule.pattern.test(trackingNumber)) {
      return rule.result;
    }
  }

  // No skip — let 17track API decide if the format is invalid
  return { type: "auto" };
}

// --- Status translation ---

const STATUS_MAP: Record<string, string> = {
  NotFound: "Не отслеживается — прочее",
  InfoReceived: "В пути — создана отправка",
  InTransit: "В пути — прочее",
  Expired: "Проблема — данные устарели",
  AvailableForPickup: "В пути — ожидает в пункте выдачи",
  OutForDelivery: "В пути — передана курьеру",
  DeliveryFailure: "Проблема — доставка не удалась",
  Delivered: "Доставлена",
  Exception: "Проблема — прочее",
};

const SUB_STATUS_MAP: Record<string, string> = {
  // NotFound
  NotFound_Other: "Не отслеживается — прочее",
  NotFound_InvalidCode: "Не отслеживается — прочее",
  // InTransit
  InTransit_Other: "В пути — прочее",
  InTransit_PickedUp: "В пути — забрана у отправителя",
  InTransit_Departure: "В пути — отправлена с пункта",
  InTransit_Arrival: "В пути — прибыла в страну назначения",
  InTransit_Arrived: "В пути — прибыла на промежуточный пункт",
  InTransit_CustomsProcessing: "В пути — на таможне",
  InTransit_CustomsReleased: "В пути — таможня пройдена",
  InTransit_CustomsRequiringInformation: "В пути — таможня запросила документы",
  // Expired
  Expired_Other: "Проблема — данные устарели",
  // AvailableForPickup
  AvailableForPickup_Other: "В пути — ожидает в пункте выдачи",
  // OutForDelivery
  OutForDelivery_Other: "В пути — передана курьеру",
  // DeliveryFailure
  DeliveryFailure_Other: "Проблема — доставка не удалась",
  DeliveryFailure_NoBody: "Проблема — получатель отсутствовал",
  DeliveryFailure_Security: "Проблема — не прошла проверку",
  DeliveryFailure_Rejected: "Проблема — отказ получателя",
  DeliveryFailure_InvalidAddress: "Проблема — неверный адрес",
  // Delivered
  Delivered_Other: "Доставлена",
  // Exception
  Exception_Other: "Проблема — прочее",
  Exception_Returning: "Проблема — возвращается отправителю",
  Exception_Returned: "Проблема — возвращена отправителю",
  Exception_NoBody: "Проблема — получатель недоступен",
  Exception_Security: "Проблема — задержана при проверке",
  Exception_Damage: "Проблема — повреждена",
  Exception_Rejected: "Проблема — отказ от получения",
  Exception_Delayed: "Проблема — задержка",
  Exception_Lost: "Проблема — утеряна",
  Exception_Destroyed: "Проблема — уничтожена",
  Exception_Cancel: "Проблема — отправка отменена",
  Exception_Held: "Проблема — удержана перевозчиком",
};

export function translateStatus(status: string, subStatus?: string): string {
  // Try sub-status first (more specific)
  if (subStatus) {
    const subTranslation = SUB_STATUS_MAP[subStatus];
    if (subTranslation) return subTranslation;
  }
  // Fall back to main status
  return STATUS_MAP[status] || status;
}

// --- API functions ---

export async function registerTrackingNumbers(
  trackingNumbers: Array<{ number: string; carrier?: number }>
): Promise<{ accepted: string[]; rejected: Array<{ number: string; error: string }> }> {
  const apiKey = process.env.TRACK17_API_KEY;
  if (!apiKey) {
    throw new Error("TRACK17_API_KEY not configured");
  }

  const body = trackingNumbers.map((t) => {
    const entry: { number: string; carrier?: number } = { number: t.number };
    if (t.carrier) entry.carrier = t.carrier;
    return entry;
  });

  const response = await fetch(`${API_BASE}/register`, {
    method: "POST",
    headers: {
      "17token": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data: Track17Response = await response.json();

  if (data.code !== 0) {
    throw new Error(`17track API error: ${data.code}`);
  }

  return {
    accepted: data.data.accepted?.map((a) => a.number) || [],
    rejected: data.data.rejected?.map((r) => ({
      number: r.number,
      error: r.error.message,
    })) || [],
  };
}

type TrackInfoResult = { status: string; subStatus: string; lastEvent: string; lastLocation: string; lastUpdate: string; deliveryTime: string | null; firstEventDate: string | null; lastEventDate: string | null };

export async function getTrackingInfo(
  trackingNumbers: Array<{ number: string }>
): Promise<{ results: Map<string, TrackInfoResult>; staleRegistrations: Array<{ number: string; carrier: number }> }> {
  const apiKey = process.env.TRACK17_API_KEY;
  if (!apiKey) {
    throw new Error("TRACK17_API_KEY not configured");
  }

  const body = trackingNumbers.map((t) => ({
    number: t.number,
  }));

  const response = await fetch(`${API_BASE}/gettrackinfo`, {
    method: "POST",
    headers: {
      "17token": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data: TrackInfoResponse = await response.json();

  if (data.code !== 0) {
    throw new Error(`17track API error: ${data.code}`);
  }

  const results = new Map<string, TrackInfoResult>();
  // Track NotFound registrations (carrier) per number — these are stale/wrong registrations
  const notFoundCarriers = new Map<string, number[]>();
  // Track which numbers got a real (non-NotFound) result
  const hasRealResult = new Set<string>();

  for (const item of data.data.accepted || []) {
    const trackInfo = item.track_info;
    const latestEvent = trackInfo?.latest_event;
    const rawStatus = trackInfo?.latest_status?.status || "NotFound";
    const rawSubStatus = trackInfo?.latest_status?.sub_status || "";
    const itemCarrier = (item as any).carrier as number | undefined;

    const deliveryTime = rawStatus === "Delivered" ? (latestEvent?.time_utc || null) : null;

    let firstEventDate: string | null = null;
    let lastEventDate: string | null = null;
    const allEventDates: string[] = [];

    // Try providers from track_info directly (v2.4 structure)
    if (Array.isArray(trackInfo?.provider)) {
      for (const prov of trackInfo.provider) {
        if (Array.isArray(prov.events)) {
          for (const ev of prov.events) {
            if (ev.d) allEventDates.push(ev.d);
          }
        }
      }
    }
    // Fallback: try tracking.providers path
    const providers = (trackInfo as any)?.tracking?.providers;
    if (allEventDates.length === 0 && Array.isArray(providers)) {
      for (const prov of providers) {
        if (Array.isArray(prov.events)) {
          for (const ev of prov.events) {
            if (ev.time_utc) allEventDates.push(ev.time_utc);
          }
        }
      }
    }
    if (allEventDates.length > 0) {
      allEventDates.sort();
      firstEventDate = allEventDates[0];
      lastEventDate = allEventDates[allEventDates.length - 1];
    }

    const translatedStatus = translateStatus(rawStatus, rawSubStatus);
    const isNotFound = rawStatus === "NotFound";

    if (isNotFound && itemCarrier) {
      const arr = notFoundCarriers.get(item.number) || [];
      arr.push(itemCarrier);
      notFoundCarriers.set(item.number, arr);
    }

    // If we already have a real status for this number, don't overwrite with NotFound
    // (17track can return multiple entries for the same number registered under different carriers)
    const existing = results.get(item.number);
    const existingIsReal = existing && hasRealResult.has(item.number);

    if (!existingIsReal || !isNotFound) {
      results.set(item.number, {
        status: translatedStatus,
        subStatus: rawSubStatus,
        lastEvent: latestEvent?.description || "",
        lastLocation: latestEvent?.location || "",
        lastUpdate: latestEvent?.time_utc || "",
        deliveryTime,
        firstEventDate,
        lastEventDate,
      });
      if (!isNotFound) {
        hasRealResult.add(item.number);
      }
    }
  }

  // Stale registrations: NotFound carriers for numbers that ONLY have NotFound results
  // (if a number has a real result under a different carrier, NotFound ones are just noise — clean them up too)
  const staleRegistrations: Array<{ number: string; carrier: number }> = [];
  notFoundCarriers.forEach((carriers, number) => {
    for (const carrier of carriers) {
      staleRegistrations.push({ number, carrier });
    }
  });

  return { results, staleRegistrations };
}

export async function registerAndGetStatus(
  trackingNumbers: Array<{ number: string; carrier?: string }>,
  alreadyReregistered?: Set<string>
): Promise<Map<string, { status: string; subStatus: string; lastEvent: string; lastLocation: string; lastUpdate: string; deliveryTime: string | null; firstEventDate: string | null; lastEventDate: string | null; registered: boolean; reregistered?: boolean }>> {
  const results = new Map<string, { status: string; subStatus: string; lastEvent: string; lastLocation: string; lastUpdate: string; deliveryTime: string | null; firstEventDate: string | null; lastEventDate: string | null; registered: boolean; reregistered?: boolean }>();

  // Separate tracks by detection result
  const toRegister: Array<{ number: string; carrier?: number }> = [];
  const skipped: Array<{ number: string; reason: string }> = [];
  // Map normalized → original number (for DPD 13→14 digit etc.)
  const normalizedToOriginal = new Map<string, string>();

  for (const t of trackingNumbers) {
    const detection = detectCarrierByFormat(t.number);
    if (detection.type === "skip") {
      skipped.push({ number: t.number, reason: detection.reason });
    } else if (detection.type === "carrier") {
      const num = detection.normalizedNumber || t.number;
      toRegister.push({ number: num, carrier: detection.code });
      if (detection.normalizedNumber) {
        normalizedToOriginal.set(num, t.number);
      }
    } else {
      toRegister.push({ number: t.number });
    }
  }

  // Set skip statuses immediately
  for (const s of skipped) {
    results.set(s.number, {
      status: s.reason,
      subStatus: "",
      lastEvent: "",
      lastLocation: "",
      lastUpdate: "",
      deliveryTime: null,
      firstEventDate: null,
      lastEventDate: null,
      registered: false,
    });
  }

  // Register the rest
  if (toRegister.length > 0) {
    try {
      const registerResult = await registerTrackingNumbers(toRegister);

      for (const num of registerResult.accepted) {
        results.set(num, {
          status: "В пути — ожидание данных",
          subStatus: "",
          lastEvent: "",
          lastLocation: "",
          lastUpdate: "",
          deliveryTime: null,
          firstEventDate: null,
          lastEventDate: null,
          registered: true,
        });
      }

      for (const rejected of registerResult.rejected) {
        // All rejections = track exists in 17track, treat as registered
        results.set(rejected.number, {
          status: "",
          subStatus: rejected.error,
          lastEvent: "",
          lastLocation: "",
          lastUpdate: "",
          deliveryTime: null,
          firstEventDate: null,
          lastEventDate: null,
          registered: true,
        });
      }
      if (registerResult.rejected.length > 0) {
        const uniqueErrors: string[] = [];
        registerResult.rejected.forEach(r => { if (!uniqueErrors.includes(r.error)) uniqueErrors.push(r.error); });
        console.log(`[17track] ${registerResult.rejected.length} tracks rejected at register (${uniqueErrors.join("; ")})`);
      }
    } catch (error: any) {
      console.error(`[17track] register error (${toRegister.length} tracks):`, error.message || error);
    }
  }

  // Get tracking info for all numbers (including rejected — they may already exist under a different carrier)
  const registeredNumbers = toRegister;

  if (registeredNumbers.length > 0) {
    try {
      const { results: trackingInfo, staleRegistrations } = await getTrackingInfo(registeredNumbers.map(t => ({ number: t.number })));

      trackingInfo.forEach((info, number) => {
        const existing = results.get(number);
        // Don't overwrite with NotFound/прочее if we already have a more specific error status
        const infoIsNotFound = info.status.includes("прочее") || info.status.includes("нет данных") || info.status === "NotFound";
        const existingIsError = existing && existing.status === "Не отслеживается — не принято API";
        if (existingIsError && infoIsNotFound) return;
        results.set(number, {
          ...info,
          registered: existing?.registered ?? true,
        });
      });

      // Fix NotFound tracks registered under wrong carrier.
      // Step 1: try changecarrier (FREE, 0 credits)
      // Step 2: if already tried changecarrier before (alreadyReregistered), do delete+register (1 credit, once)
      const correctCarrierMap = new Map<string, number>();
      for (const t of toRegister) {
        if (t.carrier) correctCarrierMap.set(t.number, t.carrier);
      }

      const wrongCarrier: Array<{ number: string; staleCarrier: number; correctCarrier: number }> = [];
      for (const stale of staleRegistrations) {
        const correctCarrier = correctCarrierMap.get(stale.number);
        if (correctCarrier && correctCarrier !== stale.carrier) {
          if (!wrongCarrier.some(w => w.number === stale.number)) {
            wrongCarrier.push({ number: stale.number, staleCarrier: stale.carrier, correctCarrier });
          }
        }
      }

      if (wrongCarrier.length > 0) {
        // Split: already tried before → delete+register (once); new → changecarrier (free)
        const toChangeCarrier = wrongCarrier.filter(w => !alreadyReregistered || !alreadyReregistered.has(w.number));
        const toDeleteAndRegister = wrongCarrier.filter(w => alreadyReregistered && alreadyReregistered.has(w.number));

        if (toChangeCarrier.length > 0) {
          console.log(`[17track] Trying changecarrier (free) for ${toChangeCarrier.length} tracks with wrong carrier`);
          try {
            await changeCarrier(toChangeCarrier.map(w => ({ number: w.number, carrier: w.correctCarrier })));
          } catch (e: any) {
            console.error("[17track] changecarrier error:", e.message);
          }
          // Mark these as reregistered so next check uses delete+register if still NotFound
          for (const w of toChangeCarrier) {
            const existing = results.get(w.number);
            if (existing) results.set(w.number, { ...existing, reregistered: true });
          }
        }

        if (toDeleteAndRegister.length > 0) {
          console.log(`[17track] changecarrier didn't help for ${toDeleteAndRegister.length} tracks, using delete+register (1 credit each)`);
          try {
            await deleteTrack17(toDeleteAndRegister.map(w => ({ number: w.number, carrier: w.staleCarrier })));
            await new Promise(r => setTimeout(r, 300));
            const reReg = await registerTrackingNumbers(toDeleteAndRegister.map(w => ({ number: w.number, carrier: w.correctCarrier })));
            console.log(`[17track] Re-registered: ${reReg.accepted.length} accepted, ${reReg.rejected.length} rejected`);
          } catch (e: any) {
            console.error("[17track] delete+register error:", e.message);
          }
          for (const w of toDeleteAndRegister) {
            const existing = results.get(w.number);
            if (existing) results.set(w.number, { ...existing, reregistered: true });
          }
        }
      }

      // Also handle NotFound tracks where carrier matches (registered correctly but still NotFound)
      // — try changecarrier once to force re-check (free)
      const notFoundCorrectCarrier: Array<{ number: string; carrier: number }> = [];
      for (const stale of staleRegistrations) {
        const correctCarrier = correctCarrierMap.get(stale.number);
        if (correctCarrier && correctCarrier === stale.carrier && (!alreadyReregistered || !alreadyReregistered.has(stale.number))) {
          if (!notFoundCorrectCarrier.some(w => w.number === stale.number) && !wrongCarrier.some(w => w.number === stale.number)) {
            notFoundCorrectCarrier.push({ number: stale.number, carrier: correctCarrier });
          }
        }
      }
      if (notFoundCorrectCarrier.length > 0) {
        console.log(`[17track] ${notFoundCorrectCarrier.length} NotFound tracks with correct carrier — trying retrack (free)`);
        try {
          // Use changecarrier with same carrier to trigger re-fetch
          await changeCarrier(notFoundCorrectCarrier);
        } catch (_) {}
        for (const w of notFoundCorrectCarrier) {
          const existing = results.get(w.number);
          if (existing) results.set(w.number, { ...existing, reregistered: true });
        }
      }
    } catch (error: any) {
      console.error(`[17track] getinfo error (${registeredNumbers.length} tracks):`, error.message || error);
    }
  }

  // Reverse-map normalized numbers back to originals
  normalizedToOriginal.forEach((original, normalized) => {
    const data = results.get(normalized);
    if (data) {
      results.delete(normalized);
      results.set(original, data);
    }
  });

  return results;
}

export async function deleteTrack17(
  trackingNumbers: Array<{ number: string; carrier: number }>
): Promise<{ accepted: string[]; rejected: Array<{ number: string; error: string }> }> {
  const apiKey = process.env.TRACK17_API_KEY;
  if (!apiKey) throw new Error("TRACK17_API_KEY not configured");

  const response = await fetch(`${API_BASE}/deletetrack`, {
    method: "POST",
    headers: { "17token": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(trackingNumbers.map(t => ({ number: t.number, carrier: t.carrier }))),
  });
  const data = await response.json() as Track17Response;
  if (data.code !== 0) throw new Error(`17track deletetrack error: ${data.code}`);
  return {
    accepted: data.data.accepted?.map(a => a.number) || [],
    rejected: data.data.rejected?.map(r => ({ number: r.number, error: r.error.message })) || [],
  };
}

export async function changeCarrier(
  trackingNumbers: Array<{ number: string; carrier: number }>
): Promise<{ accepted: string[]; rejected: Array<{ number: string; error: string }> }> {
  const apiKey = process.env.TRACK17_API_KEY;
  if (!apiKey) throw new Error("TRACK17_API_KEY not configured");

  const response = await fetch(`${API_BASE}/changecarrier`, {
    method: "POST",
    headers: { "17token": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(trackingNumbers.map(t => ({ number: t.number, carrier: t.carrier }))),
  });
  const data = await response.json() as Track17Response;
  if (data.code !== 0) throw new Error(`17track changecarrier error: ${data.code}`);
  return {
    accepted: data.data.accepted?.map(a => a.number) || [],
    rejected: data.data.rejected?.map(r => ({ number: r.number, error: r.error.message })) || [],
  };
}

export async function retryErrorTracksWithCarriers(
  errorTrackNumbers: string[],
  onProgress?: (msg: string) => void,
): Promise<Map<string, { status: string; subStatus: string; lastEvent: string; lastLocation: string; lastUpdate: string; deliveryTime: string | null; firstEventDate: string | null; lastEventDate: string | null; carrierName: string }>> {
  const results = new Map<string, { status: string; subStatus: string; lastEvent: string; lastLocation: string; lastUpdate: string; deliveryTime: string | null; firstEventDate: string | null; lastEventDate: string | null; carrierName: string }>();
  if (errorTrackNumbers.length === 0) return results;

  // Filter out tracks that should be skipped or already have a known carrier
  const toRetry: string[] = [];
  for (const num of errorTrackNumbers) {
    const detection = detectCarrierByFormat(num);
    if (detection.type === "skip") {
      results.set(num, {
        status: detection.reason,
        subStatus: "",
        lastEvent: "",
        lastLocation: "",
        lastUpdate: "",
        deliveryTime: null,
        firstEventDate: null,
        lastEventDate: null,
        carrierName: "",
      });
    } else {
      toRetry.push(num);
    }
  }

  if (toRetry.length === 0) return results;

  let remaining = [...toRetry];
  onProgress?.(`Retry ${remaining.length} error tracks with ${DE_CARRIER_CANDIDATES.length} carriers...`);

  for (const carrier of DE_CARRIER_CANDIDATES) {
    if (remaining.length === 0) break;
    onProgress?.(`Trying carrier ${carrier.name} (${carrier.code}) for ${remaining.length} tracks...`);

    const CHUNK = 40;
    const stillRemaining: string[] = [];

    for (let i = 0; i < remaining.length; i += CHUNK) {
      const chunk = remaining.slice(i, i + CHUNK);

      try {
        await changeCarrier(chunk.map(n => ({ number: n, carrier: carrier.code })));
      } catch (e: any) {
        console.error(`[17track] changeCarrier failed for ${carrier.name}: ${e.message}`);
      }

      await new Promise(r => setTimeout(r, 1500));

      try {
        const { results: info } = await getTrackingInfo(chunk.map(n => ({ number: n })));

        for (const num of chunk) {
          const trackData = info.get(num);
          if (trackData && !trackData.status.startsWith("Не отслеживается") && trackData.status !== "NotFound") {
            results.set(num, { ...trackData, carrierName: carrier.name });
          } else {
            stillRemaining.push(num);
          }
        }
      } catch (e: any) {
        console.error(`[17track] getTrackingInfo failed after carrier change ${carrier.name}: ${e.message}`);
        for (const num of chunk) {
          if (!results.has(num)) stillRemaining.push(num);
        }
      }

      if (i + CHUNK < remaining.length) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    remaining = stillRemaining;
    onProgress?.(`After ${carrier.name}: ${results.size} resolved, ${remaining.length} still unresolved`);
  }

  for (const num of remaining) {
    if (!results.has(num)) {
      results.set(num, {
        status: "Не отслеживается — перевозчик не определён",
        subStatus: "",
        lastEvent: "",
        lastLocation: "",
        lastUpdate: "",
        deliveryTime: null,
        firstEventDate: null,
        lastEventDate: null,
        carrierName: "",
      });
    }
  }

  onProgress?.(`Carrier retry complete: ${results.size - remaining.length} resolved, ${remaining.length} still in error`);
  return results;
}

export interface Track17Quota {
  quotaTotal: number;
  quotaUsed: number;
  quotaRemain: number;
  todayUsed: number;
}

export async function getQuota(): Promise<Track17Quota> {
  const apiKey = process.env.TRACK17_API_KEY;
  if (!apiKey) {
    throw new Error("TRACK17_API_KEY not configured");
  }

  const response = await fetch("https://api.17track.net/track/v2/getquota", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "17token": apiKey,
    },
    body: JSON.stringify([]),
  });

  if (!response.ok) {
    throw new Error(`17track getquota failed: ${response.status}`);
  }

  const json = await response.json() as {
    code: number;
    data: {
      quota_total: number;
      quota_used: number;
      quota_remain: number;
      today_used: number;
    };
  };

  if (json.code !== 0) {
    throw new Error(`17track getquota error code: ${json.code}`);
  }

  return {
    quotaTotal: json.data.quota_total,
    quotaUsed: json.data.quota_used,
    quotaRemain: json.data.quota_remain,
    todayUsed: json.data.today_used,
  };
}
