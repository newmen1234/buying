import { storage } from "./storage";
import * as retailcrmService from "./retailcrm-service";
import { getRatesForDate } from "./cbr-rates";

interface RetailcrmConfig {
  subdomain: string;
  apiKey: string;
}

export type PeriodType = "day" | "week" | "month" | "quarter" | "year";

export interface SyncProgressCallback {
  (message: string, current: number, total: number, extra?: Record<string, any>): void;
}

const MONTH_NAMES_RU: Record<number, string> = {
  0: "Январь", 1: "Февраль", 2: "Март", 3: "Апрель",
  4: "Май", 5: "Июнь", 6: "Июль", 7: "Август",
  8: "Сентябрь", 9: "Октябрь", 10: "Ноябрь", 11: "Декабрь",
};

const QUARTER_NAMES: Record<number, string> = {
  0: "I", 1: "II", 2: "III", 3: "IV",
};

function formatDateDDMMYYYY(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${d}.${m}.${y}`;
}

function getISOWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function formatPeriodLabel(dateFrom: string, dateTo: string, period: PeriodType): string {
  const from = new Date(dateFrom + "T00:00:00Z");

  switch (period) {
    case "day":
      return formatDateDDMMYYYY(dateFrom);
    case "week": {
      const weekNum = getISOWeekNumber(from);
      return `Неделя ${weekNum}, ${MONTH_NAMES_RU[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
    }
    case "month":
      return `${MONTH_NAMES_RU[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
    case "quarter": {
      const q = Math.floor(from.getUTCMonth() / 3);
      return `${QUARTER_NAMES[q]} квартал ${from.getUTCFullYear()}`;
    }
    case "year":
      return `${from.getUTCFullYear()}`;
    default:
      return `${MONTH_NAMES_RU[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
  }
}

export function computePeriodSegments(
  dateFrom: string,
  dateTo: string,
  period: PeriodType,
): { from: string; to: string }[] {
  const segments: { from: string; to: string }[] = [];
  const start = new Date(dateFrom + "T00:00:00Z");
  const end = new Date(dateTo + "T00:00:00Z");

  if (period === "day") {
    return [{ from: dateFrom, to: dateTo }];
  }

  if (period === "week") {
    let cursor = new Date(start);
    while (cursor <= end) {
      const segStart = cursor.toISOString().split("T")[0];
      const segEnd = new Date(cursor);
      segEnd.setUTCDate(segEnd.getUTCDate() + 6);
      const clampedEnd = segEnd > end ? end.toISOString().split("T")[0] : segEnd.toISOString().split("T")[0];
      segments.push({ from: segStart, to: clampedEnd });
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return segments;
  }

  if (period === "month") {
    let cursor = new Date(start);
    while (cursor <= end) {
      const segStart = cursor.toISOString().split("T")[0];
      const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
      const clampedEnd = monthEnd > end ? end.toISOString().split("T")[0] : monthEnd.toISOString().split("T")[0];
      segments.push({ from: segStart, to: clampedEnd });
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    }
    return segments;
  }

  if (period === "quarter") {
    let cursor = new Date(start);
    while (cursor <= end) {
      const segStart = cursor.toISOString().split("T")[0];
      const qEnd = new Date(Date.UTC(cursor.getUTCFullYear(), Math.floor(cursor.getUTCMonth() / 3) * 3 + 3, 0));
      const clampedEnd = qEnd > end ? end.toISOString().split("T")[0] : qEnd.toISOString().split("T")[0];
      segments.push({ from: segStart, to: clampedEnd });
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), Math.floor(cursor.getUTCMonth() / 3) * 3 + 3, 1));
    }
    return segments;
  }

  if (period === "year") {
    let cursor = new Date(start);
    while (cursor <= end) {
      const segStart = cursor.toISOString().split("T")[0];
      const yearEnd = new Date(Date.UTC(cursor.getUTCFullYear(), 11, 31));
      const clampedEnd = yearEnd > end ? end.toISOString().split("T")[0] : yearEnd.toISOString().split("T")[0];
      segments.push({ from: segStart, to: clampedEnd });
      cursor = new Date(Date.UTC(cursor.getUTCFullYear() + 1, 0, 1));
    }
    return segments;
  }

  return [{ from: dateFrom, to: dateTo }];
}

function getDatesInRange(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  const start = new Date(dateFrom + "T00:00:00Z");
  const end = new Date(dateTo + "T00:00:00Z");
  const d = new Date(start);
  while (d <= end) {
    dates.push(d.toISOString().split("T")[0]);
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

export async function isCacheCovered(dateFrom: string, dateTo: string): Promise<boolean> {
  const allDates = getDatesInRange(dateFrom, dateTo);
  const synced = await storage.getSyncedDates(dateFrom, dateTo);
  const syncedSet = new Set(synced.map(s => s.syncDate));
  return allDates.every(d => syncedSet.has(d));
}

export async function getCacheLastSyncTime(dateFrom: string, dateTo: string): Promise<Date | null> {
  return storage.getLatestSyncTime(dateFrom, dateTo);
}

function getMonthlyChunks(dateFrom: string, dateTo: string): { from: string; to: string }[] {
  const chunks: { from: string; to: string }[] = [];
  const start = new Date(dateFrom + "T00:00:00Z");
  const end = new Date(dateTo + "T00:00:00Z");

  let cursor = new Date(start);
  while (cursor <= end) {
    const chunkStart = cursor.toISOString().split("T")[0];
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const chunkEnd = monthEnd > end ? end.toISOString().split("T")[0] : monthEnd.toISOString().split("T")[0];
    chunks.push({ from: chunkStart, to: chunkEnd });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return chunks;
}

async function isChunkCovered(chunkFrom: string, chunkTo: string): Promise<boolean> {
  const dates = getDatesInRange(chunkFrom, chunkTo);
  const synced = await storage.getSyncedDates(chunkFrom, chunkTo);
  const syncedSet = new Set(synced.map(s => s.syncDate));
  return dates.every(d => syncedSet.has(d));
}

export async function syncOrdersForPeriod(
  config: RetailcrmConfig,
  dateFrom: string,
  dateTo: string,
  onProgress?: SyncProgressCallback,
  abortSignal?: AbortSignal,
  incremental: boolean = false,
  period: PeriodType = "month",
  atomic: boolean = false,
): Promise<{ ordersCount: number }> {
  const allDates = getDatesInRange(dateFrom, dateTo);
  const totalDays = allDates.length;

  const chunks = getMonthlyChunks(dateFrom, dateTo);
  const periodSegments = computePeriodSegments(dateFrom, dateTo, period);
  const totalSegments = periodSegments.length;
  const isSingleDay = period === "day" && dateFrom === dateTo;

  let chunksToSync = chunks;
  if (incremental) {
    const missing: typeof chunks = [];
    for (let i = 0; i < chunks.length; i++) {
      const pct = Math.round(((i + 1) / chunks.length) * 100);
      if (onProgress) onProgress(`Проверка кеша... ${pct}%`, i, chunks.length);
      const covered = await isChunkCovered(chunks[i].from, chunks[i].to);
      if (!covered) missing.push(chunks[i]);
    }
    chunksToSync = missing;
    if (chunksToSync.length === 0) {
      if (onProgress) onProgress("Все данные уже загружены", totalDays, totalDays);
      const cached = await storage.getCachedOrdersByDateRange(dateFrom, dateTo);
      return { ordersCount: cached.length };
    }
    const missingLabels = chunksToSync.map(c => {
      const d = new Date(c.from + "T00:00:00Z");
      return `${MONTH_NAMES_RU[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }).slice(0, 3).join(", ");
    const suffix = chunksToSync.length > 3 ? ` и ещё ${chunksToSync.length - 3}` : "";
    if (onProgress) onProgress(`Догрузка: ${missingLabels}${suffix}`, 0, chunksToSync.length);
  } else {
    if (atomic) {
      if (onProgress) onProgress("Подготовка атомарной синхронизации...", 0, totalDays);
      await storage.clearStagingCache();
    } else {
      if (onProgress) onProgress("Удаление старого кеша...", 0, totalDays);
      await storage.deleteCachedOrdersByDateRange(dateFrom, dateTo);
    }
  }

  let totalOrdersCount = 0;
  const allOrderRows: { orderId: string; createdDate: string; status: string; site: string | null; totalSum: number; payload: any }[] = [];
  const totalChunks = chunksToSync.length;

  for (let ci = 0; ci < totalChunks; ci++) {
    if (abortSignal?.aborted) throw new Error("Sync cancelled");

    const chunk = chunksToSync[ci];

    const overallProgress = Math.round((ci / totalChunks) * 100);
    const progressLabel = buildProgressLabel(chunk, ci, totalChunks, period, totalSegments, isSingleDay, overallProgress, dateFrom, dateTo);
    if (onProgress) onProgress(progressLabel, ci, totalChunks);

    const createdAtFrom = chunk.from + " 00:00:00";
    const createdAtTo = chunk.to + " 23:59:59";

    const chunkOrders = await retailcrmService.getAllOrdersForDateRange(
      config,
      createdAtFrom,
      createdAtTo,
      (page, total) => {
        if (onProgress) {
          const pageProgress = total > 0 ? Math.round((ci / totalChunks + (page / total) / totalChunks) * 100) : overallProgress;
          const msg = buildProgressLabel(chunk, ci, totalChunks, period, totalSegments, isSingleDay, pageProgress, dateFrom, dateTo);
          onProgress(msg, ci, totalChunks);
        }
      },
      abortSignal,
    );

    totalOrdersCount += chunkOrders.length;

    const orderRows = chunkOrders.map((order: any) => {
      let createdDate = chunk.from;
      if (order.createdAt) {
        const match = order.createdAt.match(/^(\d{4}-\d{2}-\d{2})/);
        if (match) createdDate = match[1];
      }
      return {
        orderId: String(order.id),
        createdDate,
        status: order.status || "unknown",
        site: order.site || null,
        totalSum: parseFloat(order.totalSumm) || parseFloat(order.summ) || 0,
        payload: order,
      };
    });

    if (atomic) {
      if (orderRows.length > 0) {
        await storage.insertStagingOrders(orderRows);
        allOrderRows.push(...orderRows);
      }
    } else {
      await storage.deleteCachedOrdersByDateRange(chunk.from, chunk.to);
      if (orderRows.length > 0) {
        await storage.upsertCachedOrders(orderRows);
        allOrderRows.push(...orderRows);
      }
    }

    if (!atomic) {
      const chunkDates = getDatesInRange(chunk.from, chunk.to);
      const ordersByDate: Record<string, number> = {};
      for (const row of orderRows) {
        ordersByDate[row.createdDate] = (ordersByDate[row.createdDate] || 0) + 1;
      }
      for (const d of chunkDates) {
        await storage.upsertSyncLog(d, ordersByDate[d] || 0);
      }
    }
  }

  if (onProgress) onProgress("Загрузка курсов валют...", totalDays - 1, totalDays);

  const uniqueDates = Array.from(new Set(allOrderRows.map(o => o.createdDate)));
  for (const d of uniqueDates) {
    const existingRates = await storage.getCurrencyRates(d);
    if (!existingRates) {
      const rates = await getRatesForDate(d);
      await storage.upsertCurrencyRates(d, rates);
    }
  }

  const today = new Date().toISOString().split("T")[0];
  if (allDates.includes(today)) {
    const todayRates = await getRatesForDate(today);
    await storage.upsertCurrencyRates(today, todayRates);
  }

  if (atomic) {
    if (onProgress) onProgress("Применение данных...", totalDays - 1, totalDays);
    await storage.swapStagingToMainCache(dateFrom, dateTo);

    const ordersByDate: Record<string, number> = {};
    for (const row of allOrderRows) {
      ordersByDate[row.createdDate] = (ordersByDate[row.createdDate] || 0) + 1;
    }
    for (const d of allDates) {
      await storage.upsertSyncLog(d, ordersByDate[d] || 0);
    }
  }

  if (onProgress) onProgress("Готово!", totalDays, totalDays);

  return { ordersCount: totalOrdersCount };
}

function findSegmentForChunk(
  chunkFrom: string,
  dateFrom: string,
  dateTo: string,
  period: PeriodType,
): { segIndex: number; segFrom: string; segTo: string } {
  const segments = computePeriodSegments(dateFrom, dateTo, period);
  const chunkDate = new Date(chunkFrom + "T00:00:00Z");
  for (let i = 0; i < segments.length; i++) {
    const segEnd = new Date(segments[i].to + "T00:00:00Z");
    const segStart = new Date(segments[i].from + "T00:00:00Z");
    if (chunkDate >= segStart && chunkDate <= segEnd) {
      return { segIndex: i, segFrom: segments[i].from, segTo: segments[i].to };
    }
  }
  return { segIndex: 0, segFrom: dateFrom, segTo: dateTo };
}

function buildProgressLabel(
  chunk: { from: string; to: string },
  chunkIndex: number,
  totalChunks: number,
  period: PeriodType,
  totalSegments: number,
  isSingleDay: boolean,
  progressPct: number,
  dateFrom: string,
  dateTo: string,
): string {
  if (isSingleDay) {
    return `${progressPct}%`;
  }

  const seg = findSegmentForChunk(chunk.from, dateFrom, dateTo, period);
  const label = formatPeriodLabel(seg.segFrom, seg.segTo, period);

  if (totalSegments <= 1) {
    return `${label}: ${progressPct}%`;
  }

  return `${label} (${seg.segIndex + 1} из ${totalSegments}): ${progressPct}%`;
}

export async function getCachedOrders(dateFrom: string, dateTo: string): Promise<any[]> {
  const cached = await storage.getCachedOrdersByDateRange(dateFrom, dateTo);
  return cached.map(row => row.payload as any);
}

export async function getCachedOrdersLean(dateFrom: string, dateTo: string) {
  return storage.getCachedOrdersLean(dateFrom, dateTo);
}

export async function getCachedOrdersLeanByStatuses(statusCodes: string[]) {
  return storage.getCachedOrdersLeanByStatuses(statusCodes);
}

export async function getCachedRatesForDate(dateStr: string): Promise<Record<string, number>> {
  const cached = await storage.getCurrencyRates(dateStr);
  if (cached) return cached;

  const rates = await getRatesForDate(dateStr);
  await storage.upsertCurrencyRates(dateStr, rates);
  return rates;
}

export function getRetailcrmConfig(): Promise<{ config: RetailcrmConfig; error?: string } | null> {
  return (async () => {
    const accounts = await storage.getRetailcrmAccounts(8);
    if (!accounts || accounts.length === 0) {
      return null;
    }
    const account = accounts[0];
    const apiKey = process.env[account.secretKey];
    if (!apiKey) {
      return null;
    }
    return { config: { subdomain: account.subdomain, apiKey } };
  })();
}
