import { db } from "./db";
import { currencyRates } from "@shared/schema";
import { inArray } from "drizzle-orm";

const ratesCache: Record<string, Record<string, number>> = {};
let lastKnownRates: Record<string, number> | null = null;

function formatDateForCBR(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${y}/${m}/${d}`;
}

function nearestBusinessDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2);
  else if (day === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

function prevBusinessDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) {
    d.setDate(d.getDate() - 1);
  }
  return d.toISOString().split("T")[0];
}

function parseRatesFromData(valute: any): Record<string, number> {
  const norm = (v: any) => (v?.Value || 0) / (v?.Nominal || 1);

  const rates: Record<string, number> = { RUB: 1 };
  for (const [code, data] of Object.entries(valute)) {
    const rate = norm(data);
    if (rate > 0) rates[code] = rate;
  }
  if (!rates.USD) rates.USD = 75;
  if (!rates.EUR) rates.EUR = 90;
  return rates;
}

async function fetchCBR(url: string): Promise<Record<string, number> | null> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    return parseRatesFromData(data.Valute || {});
  } catch {
    return null;
  }
}

async function loadRatesFromDB(dates: string[]): Promise<Record<string, Record<string, number>>> {
  if (dates.length === 0) return {};
  const rows = await db.select().from(currencyRates).where(inArray(currencyRates.date, dates));
  const result: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    if (!result[row.date]) result[row.date] = { RUB: 1 };
    result[row.date][row.currencyCode] = row.rate;
  }
  return result;
}

async function saveRatesToDB(dateStr: string, rates: Record<string, number>): Promise<void> {
  try {
    const rows = Object.entries(rates)
      .filter(([code]) => code !== "RUB")
      .map(([code, rate]) => ({
        date: dateStr,
        currencyCode: code,
        rate,
      }));
    if (rows.length > 0) {
      await db.insert(currencyRates).values(rows).onConflictDoNothing();
    }
  } catch (e) {
    console.warn(`CBR: failed to save rates to DB for ${dateStr}:`, e);
  }
}

async function fetchAndCacheFromCBR(dateStr: string, retriesLeft = 2): Promise<Record<string, number>> {
  const today = new Date().toISOString().split("T")[0];
  let url: string;

  if (dateStr >= today) {
    url = "https://www.cbr-xml-daily.ru/daily_json.js";
  } else {
    const formatted = formatDateForCBR(dateStr);
    url = `https://www.cbr-xml-daily.ru/archive/${formatted}/daily_json.js`;
  }

  const rates = await fetchCBR(url);
  if (rates) {
    ratesCache[dateStr] = rates;
    lastKnownRates = rates;
    await saveRatesToDB(dateStr, rates);
    return rates;
  }

  if (retriesLeft > 0 && dateStr < today) {
    const prev = prevBusinessDay(dateStr);
    const fallbackRates = await fetchAndCacheFromCBR(prev, retriesLeft - 1);
    ratesCache[dateStr] = fallbackRates;
    return fallbackRates;
  }

  if (lastKnownRates) {
    ratesCache[dateStr] = lastKnownRates;
    return lastKnownRates;
  }

  const fallback = getFallbackRates();
  ratesCache[dateStr] = fallback;
  return fallback;
}

export async function getRatesForDate(dateStr: string): Promise<Record<string, number>> {
  if (ratesCache[dateStr]) {
    return ratesCache[dateStr];
  }

  const bizDay = nearestBusinessDay(dateStr);

  if (ratesCache[bizDay]) {
    ratesCache[dateStr] = ratesCache[bizDay];
    return ratesCache[bizDay];
  }

  const dbRates = await loadRatesFromDB([bizDay]);
  if (dbRates[bizDay] && dbRates[bizDay].EUR && dbRates[bizDay].USD) {
    ratesCache[bizDay] = dbRates[bizDay];
    ratesCache[dateStr] = dbRates[bizDay];
    lastKnownRates = dbRates[bizDay];
    return dbRates[bizDay];
  }

  return fetchAndCacheFromCBR(bizDay);
}

function getFallbackRates(): Record<string, number> {
  return {
    RUB: 1, USD: 75, EUR: 90, CNY: 11, GBP: 95,
    JPY: 0.5, TRY: 2.5, PLN: 20, AED: 21,
    KZT: 0.17, UAH: 2.3, BYN: 27, SEK: 7.5,
    HKD: 9.5, SGD: 55, MXN: 4.5,
  };
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  "₽": "RUB",
  "$": "USD",
  "€": "EUR",
  "元": "CNY",
  "¥": "CNY",
  "£": "GBP",
  "zł": "PLN",
};

const CURRENCY_CODES: Record<string, string> = {
  "AED": "AED",
  "TL": "TRY",
  "PLN": "PLN",
  "RUB": "RUB",
};

export function detectCurrencyFromStoreName(storeName: string): string {
  const parts = storeName.split(/\s*[—\-–]\s*/);

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i].trim();

    for (const [symbol, currency] of Object.entries(CURRENCY_SYMBOLS)) {
      if (part.includes(symbol)) {
        return currency;
      }
    }

    const upper = part.toUpperCase();
    for (const [code, currency] of Object.entries(CURRENCY_CODES)) {
      if (upper === code) {
        return currency;
      }
    }
  }

  return "RUB";
}

export function convertToRub(amount: number, currency: string, rates: Record<string, number>): number {
  if (currency === "RUB" || !currency) return amount;
  const rate = rates[currency] || getFallbackRates()[currency];
  if (!rate) {
    return amount;
  }
  return amount * rate;
}

export function convertToEur(amount: number, currency: string, rates: Record<string, number>): number {
  if (currency === "EUR") return amount;
  const amountRub = convertToRub(amount, currency, rates);
  const eurRate = rates["EUR"] || 90;
  return amountRub / eurRate;
}

export async function batchPreloadRates(dates: string[]): Promise<void> {
  const uniqueRaw = Array.from(new Set(dates));
  const bizDayMap: Record<string, string> = {};
  const bizDays = new Set<string>();

  for (const d of uniqueRaw) {
    if (ratesCache[d]) continue;
    const biz = nearestBusinessDay(d);
    bizDayMap[d] = biz;
    if (!ratesCache[biz]) bizDays.add(biz);
  }

  const missingBizDays = Array.from(bizDays);
  if (missingBizDays.length === 0) return;

  const dbRates = await loadRatesFromDB(missingBizDays);

  const stillMissing: string[] = [];
  for (const biz of missingBizDays) {
    if (dbRates[biz] && dbRates[biz].EUR && dbRates[biz].USD) {
      ratesCache[biz] = dbRates[biz];
      lastKnownRates = dbRates[biz];
    } else {
      stillMissing.push(biz);
    }
  }

  if (stillMissing.length > 0) {
    console.log(`CBR: fetching ${stillMissing.length} dates from API (not in DB)...`);
    const BATCH_SIZE = 5;
    for (let i = 0; i < stillMissing.length; i += BATCH_SIZE) {
      const batch = stillMissing.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(d => fetchAndCacheFromCBR(d)));
    }
  }

  for (const [originalDate, bizDay] of Object.entries(bizDayMap)) {
    if (!ratesCache[originalDate] && ratesCache[bizDay]) {
      ratesCache[originalDate] = ratesCache[bizDay];
    }
  }
}
