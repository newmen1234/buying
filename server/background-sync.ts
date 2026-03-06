import * as cacheSync from "./cache-sync";
import type { PeriodType } from "./cache-sync";
import { storage } from "./storage";
import * as track17Service from "./track17-service";
import { db } from "./db";
import { sql, eq } from "drizzle-orm";
import { syncHistory } from "../shared/schema";

// Clean up stale "syncing" records left over from server crash/restart
export async function cleanupStaleSyncHistory() {
  try {
    const result = await db.update(syncHistory)
      .set({ status: "error", errorMessage: "Прервано: сервер был перезагружен", completedAt: new Date() })
      .where(eq(syncHistory.status, "syncing"))
      .returning({ id: syncHistory.id });
    if (result.length > 0) {
      console.log(`[Sync] Cleaned up ${result.length} stale syncing records`);
    }
  } catch (err: any) {
    console.error("[Sync] Failed to cleanup stale records:", err.message);
  }

  // Auto-retry: if last sync was cancelled/error and was a scheduled sync, retry after 30s
  try {
    const lastSync = await db.select().from(syncHistory)
      .orderBy(sql`${syncHistory.id} DESC`)
      .limit(1);
    if (lastSync.length > 0) {
      const last = lastSync[0];
      const wasRecent = last.completedAt && (Date.now() - new Date(last.completedAt).getTime()) < 30 * 60 * 1000; // within 30 min
      const wasScheduled = last.jobType === "night" || last.jobType === "day" || last.jobType === "night_retry" || last.jobType === "day_retry";
      const wasFailed = last.status === "cancelled" || last.status === "error";
      if (wasRecent && wasScheduled && wasFailed) {
        console.log(`[Sync] Last ${last.jobType} sync was ${last.status} (${last.errorMessage || "cancelled by restart"}). Retrying in 30 seconds...`);
        setTimeout(() => {
          if (!scheduledSyncConfig) return;
          const syncDaysPromise = getSyncDays();
          syncDaysPromise.then(syncDays => {
            const dateTo = new Date().toISOString().split("T")[0];
            const dateFrom = new Date(Date.now() - syncDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
            triggerAtomicRangeSync(scheduledSyncConfig!, dateFrom, dateTo, `${last.jobType}_retry`, undefined, true);
          });
        }, 30_000);
      }
    }
  } catch (err: any) {
    console.error("[Sync] Failed to check for retry:", err.message);
  }
}

interface SyncJob {
  id: string;
  type: "day" | "cancelled" | "range" | "processing";
  params: Record<string, any>;
  status: "syncing" | "done" | "error" | "cancelled";
  progress: { message: string; current: number; total: number; [key: string]: any };
  result?: any;
  error?: string;
  startedAt: number;
  completedAt?: number;
  abortController?: AbortController;
}

const jobs: Map<string, SyncJob> = new Map();

setInterval(() => {
  const now = Date.now();
  const entries = Array.from(jobs.entries());
  for (const [id, job] of entries) {
    if (job.status !== "syncing" && job.completedAt && now - job.completedAt > 10 * 60 * 1000) {
      jobs.delete(id);
    }
  }
}, 60 * 1000);

function makeJobId(type: string, params: Record<string, any>): string {
  if (type === "day") return `day:${params.date}`;
  if (type === "cancelled") return `cancelled:${params.months}`;
  if (type === "range") return `range:${params.dateFrom}_${params.dateTo}`;
  return `${type}:${JSON.stringify(params)}`;
}

export function getJobStatus(jobId: string): SyncJob | null {
  return jobs.get(jobId) || null;
}

export function clearJob(jobId: string): void {
  jobs.delete(jobId);
}

export function getAllJobs(): SyncJob[] {
  return Array.from(jobs.values());
}

export function getActiveJobs(): SyncJob[] {
  return Array.from(jobs.values()).filter(j => j.status === "syncing");
}

function cleanOldJobs() {
  const now = Date.now();
  const entries = Array.from(jobs.entries());
  for (const [id, job] of entries) {
    if (job.status !== "syncing" && job.completedAt && now - job.completedAt > 10 * 60 * 1000) {
      jobs.delete(id);
    }
  }
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job || job.status !== "syncing") return false;
  if (job.abortController) {
    job.abortController.abort();
  }
  job.status = "cancelled";
  job.completedAt = Date.now();
  job.progress = { message: "Отменено", current: 0, total: 0 };
  return true;
}

export function cancelAllJobs(): number {
  let count = 0;
  for (const [, job] of Array.from(jobs.entries())) {
    if (job.status === "syncing") {
      if (job.abortController) job.abortController.abort();
      job.status = "cancelled";
      job.completedAt = Date.now();
      job.progress = { message: "Отменено", current: 0, total: 0 };
      count++;
    }
  }
  return count;
}

export function triggerDaySync(
  config: { subdomain: string; apiKey: string },
  date: string,
): string {
  const jobId = makeJobId("day", { date });

  const existing = jobs.get(jobId);
  if (existing && existing.status === "syncing") {
    return jobId;
  }

  const abortController = new AbortController();
  const job: SyncJob = {
    id: jobId,
    type: "day",
    params: { date },
    status: "syncing",
    progress: { message: "Начало синхронизации...", current: 0, total: 1 },
    startedAt: Date.now(),
    abortController,
  };
  jobs.set(jobId, job);

  (async () => {
    try {
      await cacheSync.syncOrdersForPeriod(config, date, date, (msg, cur, tot) => {
        job.progress = { message: msg, current: cur, total: tot };
      }, abortController.signal, false, "day");
      job.status = "done";
      job.completedAt = Date.now();
      job.progress = { message: "Готово!", current: 1, total: 1 };
      await storage.setAppSetting("logistics_cache_updated_at", new Date().toISOString());
    } catch (err: any) {
      if (err.message === "Sync cancelled" || job.status === "cancelled") {
        job.status = "cancelled";
        job.progress = { message: "Отменено", current: 0, total: 0 };
      } else {
        job.status = "error";
        job.error = err.message || "Sync failed";
      }
      job.completedAt = Date.now();
    }
    cleanOldJobs();
  })();

  return jobId;
}

export function triggerRangeSync(
  config: { subdomain: string; apiKey: string },
  dateFrom: string,
  dateTo: string,
  incremental: boolean = false,
  period: PeriodType = "month",
): string {
  const jobId = makeJobId("range", { dateFrom, dateTo });

  const existing = jobs.get(jobId);
  if (existing && existing.status === "syncing") {
    return jobId;
  }

  const abortController = new AbortController();
  const job: SyncJob = {
    id: jobId,
    type: "range",
    params: { dateFrom, dateTo },
    status: "syncing",
    progress: { message: "Синхронизация...", current: 0, total: 1 },
    startedAt: Date.now(),
    abortController,
  };
  jobs.set(jobId, job);

  (async () => {
    try {
      await cacheSync.syncOrdersForPeriod(config, dateFrom, dateTo, (msg, cur, tot) => {
        job.progress = { message: msg, current: cur, total: tot };
      }, abortController.signal, incremental, period);
      job.status = "done";
      job.completedAt = Date.now();
      job.progress = { message: "Готово!", current: 1, total: 1 };
      await storage.setAppSetting("logistics_cache_updated_at", new Date().toISOString());
    } catch (err: any) {
      if (err.message === "Sync cancelled" || job.status === "cancelled") {
        job.status = "cancelled";
        job.progress = { message: "Отменено", current: 0, total: 0 };
      } else {
        job.status = "error";
        job.error = err.message || "Sync failed";
      }
      job.completedAt = Date.now();
    }
    cleanOldJobs();
  })();

  return jobId;
}

export interface MonthRange {
  label: string;
  dateFrom: string;
  dateTo: string;
  from: string;
  to: string;
}

export function triggerCancelledSync(
  config: { subdomain: string; apiKey: string },
  months: MonthRange[],
  periodKey: string,
  refresh: boolean,
): string {
  const jobId = `cancelled:${periodKey}`;

  const existing = jobs.get(jobId);
  if (existing && existing.status === "syncing") {
    return jobId;
  }

  const abortController = new AbortController();
  const job: SyncJob = {
    id: jobId,
    type: "cancelled",
    params: { period: periodKey },
    status: "syncing",
    progress: { message: "Синхронизация заказов...", current: 0, total: months.length },
    startedAt: Date.now(),
    abortController,
  };
  jobs.set(jobId, job);

  (async () => {
    try {
      for (let idx = 0; idx < months.length; idx++) {
        if (abortController.signal.aborted) throw new Error("Sync cancelled");
        const m = months[idx];
        const monthCovered = await cacheSync.isCacheCovered(m.dateFrom, m.dateTo);
        if (!monthCovered || refresh) {
          const totalLabel = months.length > 1 ? ` (${idx + 1} из ${months.length})` : "";
          job.progress = {
            message: `${m.label}${totalLabel}`,
            current: idx,
            total: months.length,
            monthLabel: m.label,
            page: 0,
            totalPages: 0,
          };
          await cacheSync.syncOrdersForPeriod(config, m.dateFrom, m.dateTo, (msg, cur, tot) => {
            const pct = tot > 0 ? ` ${Math.round((cur / tot) * 100)}%` : "";
            job.progress = {
              message: `${m.label}${totalLabel}:${pct}`,
              current: idx,
              total: months.length,
              monthLabel: m.label,
              page: cur,
              totalPages: tot,
            };
          }, abortController.signal);
        }
      }
      job.status = "done";
      job.completedAt = Date.now();
      job.progress = { message: "Готово!", current: months.length, total: months.length };
      await storage.setAppSetting("logistics_cache_updated_at", new Date().toISOString());
    } catch (err: any) {
      if (err.message === "Sync cancelled" || job.status === "cancelled") {
        job.status = "cancelled";
        job.progress = { message: "Отменено", current: 0, total: 0 };
      } else {
        job.status = "error";
        job.error = err.message || "Sync failed";
      }
      job.completedAt = Date.now();
    }
    cleanOldJobs();
  })();

  return jobId;
}

export function triggerProcessingJob(
  jobKey: string,
  processFn: (updateProgress: (message: string, current: number, total: number) => void) => Promise<any>,
): string {
  const jobId = `processing:${jobKey}`;

  const existing = jobs.get(jobId);
  if (existing && existing.status === "syncing") {
    return jobId;
  }
  if (existing && existing.status === "done" && existing.result) {
    return jobId;
  }

  const job: SyncJob = {
    id: jobId,
    type: "processing",
    params: { key: jobKey },
    status: "syncing",
    progress: { message: "Подготовка...", current: 0, total: 1 },
    startedAt: Date.now(),
  };
  jobs.set(jobId, job);

  (async () => {
    try {
      const result = await processFn((message, current, total) => {
        job.progress = { message, current, total };
      });
      job.status = "done";
      job.result = result;
      job.completedAt = Date.now();
    } catch (err: any) {
      job.status = "error";
      job.error = err.message || "Processing failed";
      job.completedAt = Date.now();
    }
  })();

  return jobId;
}

let scheduledSyncTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledSyncConfig: { subdomain: string; apiKey: string } | null = null;
let nextScheduledRun: Date | null = null;

function getNextMskRun(): Date {
  const now = new Date();
  const mskOffset = 3 * 60;
  const mskNow = new Date(now.getTime() + (mskOffset + now.getTimezoneOffset()) * 60000);

  const scheduleTimes = [5, 14];

  for (const hour of scheduleTimes) {
    const candidate = new Date(mskNow);
    candidate.setHours(hour, 0, 0, 0);
    if (candidate > mskNow) {
      const utc = new Date(candidate.getTime() - (mskOffset + now.getTimezoneOffset()) * 60000);
      return utc;
    }
  }

  const tomorrow = new Date(mskNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(scheduleTimes[0], 0, 0, 0);
  const utc = new Date(tomorrow.getTime() - (mskOffset + now.getTimezoneOffset()) * 60000);
  return utc;
}

function scheduleNextSync() {
  if (scheduledSyncTimer) {
    clearTimeout(scheduledSyncTimer);
    scheduledSyncTimer = null;
  }

  nextScheduledRun = getNextMskRun();
  const delay = nextScheduledRun.getTime() - Date.now();

  console.log(`CRM sync scheduled for ${nextScheduledRun.toISOString()} (in ${Math.round(delay / 60000)} min)`);

  scheduledSyncTimer = setTimeout(async () => {
    if (!scheduledSyncConfig) {
      console.log("Scheduled CRM sync: no config, skipping");
      scheduleNextSync();
      return;
    }

    console.log("Scheduled CRM sync: starting...");
    const syncDays = await getSyncDays();
    const dateTo = new Date().toISOString().split("T")[0];
    const dateFrom = new Date(Date.now() - syncDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    const now = new Date();
    const mskOffset = 3 * 60;
    const mskHour = new Date(now.getTime() + (mskOffset + now.getTimezoneOffset()) * 60000).getHours();
    const jobType = mskHour < 6 ? "night" : "day";

    triggerAtomicRangeSync(scheduledSyncConfig, dateFrom, dateTo, jobType);

    scheduleNextSync();
  }, Math.max(delay, 1000));
}

export function initScheduledSync(config: { subdomain: string; apiKey: string }) {
  scheduledSyncConfig = config;
  scheduleNextSync();
}

export function getNextScheduledRun(): string | null {
  return nextScheduledRun ? nextScheduledRun.toISOString() : null;
}

const DEFAULT_SYNC_DAYS = 125;
const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes

export async function getSyncDays(): Promise<number> {
  try {
    const val = await storage.getAppSetting("crm_sync_days");
    const n = val ? parseInt(val, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_SYNC_DAYS;
  } catch {
    return DEFAULT_SYNC_DAYS;
  }
}

export function triggerAtomicRangeSync(
  config: { subdomain: string; apiKey: string },
  dateFrom: string,
  dateTo: string,
  jobType: string = "manual",
  triggeredBy?: string,
  isRetry: boolean = false,
): string {
  const jobId = "scheduled-crm-sync";

  const existing = jobs.get(jobId);
  if (existing && existing.status === "syncing") {
    return jobId;
  }

  const abortController = new AbortController();
  const job: SyncJob = {
    id: jobId,
    type: "range",
    params: { dateFrom, dateTo, atomic: true },
    status: "syncing",
    progress: { message: "Синхронизация...", current: 0, total: 1 },
    startedAt: Date.now(),
    abortController,
  };
  jobs.set(jobId, job);

  (async () => {
    let historyId: number | null = null;
    try {
      historyId = await storage.insertSyncHistory(jobType, dateFrom, dateTo, triggeredBy);
    } catch (e: any) {
      console.error("Failed to insert sync_history:", e.message);
    }

    try {
      await cacheSync.syncOrdersForPeriod(config, dateFrom, dateTo, (msg, cur, tot) => {
        job.progress = { message: msg, current: cur, total: tot };
      }, abortController.signal, false, "month", true);
      job.status = "done";
      job.completedAt = Date.now();
      job.progress = { message: "Готово!", current: 1, total: 1 };
      await storage.setAppSetting("logistics_cache_updated_at", new Date().toISOString());

      if (historyId) {
        const totalOrders = job.progress.total || 0;
        await storage.updateSyncHistory(historyId, { status: "done", ordersCount: totalOrders, completedAt: new Date() }).catch(() => {});
      }

      if (scheduledSyncConfig) {
        // Sync shop agent tracks to CRM after main sync
        syncShopTracksToCrm().catch(err => console.error("[ShopTrackSync] Auto-sync error:", err.message));
      }
    } catch (err: any) {
      if (err.message === "Sync cancelled" || job.status === "cancelled") {
        job.status = "cancelled";
        job.progress = { message: "Отменено", current: 0, total: 0 };
        if (historyId) {
          await storage.updateSyncHistory(historyId, { status: "cancelled", completedAt: new Date() }).catch(() => {});
        }
      } else {
        job.status = "error";
        job.error = err.message || "Sync failed";
        console.error("Scheduled CRM sync error:", err.message);
        if (historyId) {
          await storage.updateSyncHistory(historyId, { status: "error", errorMessage: err.message || "Sync failed", completedAt: new Date() }).catch(() => {});
        }

        // Auto-retry once for scheduled syncs (night/day)
        if (!isRetry && (jobType === "night" || jobType === "day") && scheduledSyncConfig) {
          console.log(`[Sync] Will retry ${jobType} sync in 5 minutes...`);
          setTimeout(() => {
            if (scheduledSyncConfig) {
              triggerAtomicRangeSync(scheduledSyncConfig, dateFrom, dateTo, `${jobType}_retry`, undefined, true);
            }
          }, RETRY_DELAY_MS);
        }
      }
      job.completedAt = Date.now();
      try {
        await storage.clearStagingCache();
      } catch (_) {}
    }
    cleanOldJobs();
  })();

  return jobId;
}

let deTrackingTimer: ReturnType<typeof setTimeout> | null = null;
let nextDeTrackingRun: Date | null = null;
let deTrackingInProgress = false;
let lastDeTrackingRunAt: Date | null = null;
let lastDeTrackingChecked: number = 0;

// DE tracking schedule: 8:00, 8:30, 11:00, 11:30, 15:00, 15:30 MSK
// First pass (X:00) — 17track batch
// Second pass (X:30) — re-check tracks that were "Ожидание данных" on first pass, then trigger CRM export
// 30-min gap gives 17track enough time to fetch data from carriers
const DE_SCHEDULE_MSK: { hour: number; minute: number; triggerCrmExport: boolean }[] = [
  { hour: 8, minute: 0, triggerCrmExport: false },
  { hour: 8, minute: 30, triggerCrmExport: true },
  { hour: 11, minute: 0, triggerCrmExport: false },
  { hour: 11, minute: 30, triggerCrmExport: true },
  { hour: 15, minute: 0, triggerCrmExport: false },
  { hour: 15, minute: 30, triggerCrmExport: true },
];

function getNextDeRun(): { date: Date; triggerCrmExport: boolean } {
  const now = new Date();
  const mskOffset = 3 * 60;
  const mskNow = new Date(now.getTime() + (mskOffset + now.getTimezoneOffset()) * 60000);

  for (const slot of DE_SCHEDULE_MSK) {
    const candidate = new Date(mskNow);
    candidate.setHours(slot.hour, slot.minute, 0, 0);
    if (candidate > mskNow) {
      const utcCandidate = new Date(candidate.getTime() - (mskOffset + now.getTimezoneOffset()) * 60000);
      return { date: utcCandidate, triggerCrmExport: slot.triggerCrmExport };
    }
  }

  const tomorrow = new Date(mskNow);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(DE_SCHEDULE_MSK[0].hour, DE_SCHEDULE_MSK[0].minute, 0, 0);
  const utcTomorrow = new Date(tomorrow.getTime() - (mskOffset + now.getTimezoneOffset()) * 60000);
  return { date: utcTomorrow, triggerCrmExport: DE_SCHEDULE_MSK[0].triggerCrmExport };
}

function scheduleNextDeTracking() {
  if (deTrackingTimer) {
    clearTimeout(deTrackingTimer);
    deTrackingTimer = null;
  }

  const next = getNextDeRun();
  nextDeTrackingRun = next.date;
  const delay = next.date.getTime() - Date.now();

  console.log(`[17track] DE tracking scheduled for ${next.date.toISOString()} (in ${Math.round(delay / 60000)} min)${next.triggerCrmExport ? " + CRM export" : ""}`);

  deTrackingTimer = setTimeout(async () => {
    console.log("[17track] Scheduled DE tracking check starting...");
    if (!next.triggerCrmExport) {
      // First pass: 17track batch
      await runDeTrackingBatch();
    } else {
      // Second pass: 17track re-check + CRM export
      await runDeTrackingBatch();
      console.log("[17track] Second pass done, triggering CRM DE export...");
      runAutoCrmExportDe().catch(err => {
        console.error("[17track] Auto CRM DE export failed:", err.message);
      });
    }
    scheduleNextDeTracking();
  }, Math.max(delay, 1000));
}

export async function initDeTrackingSchedule() {
  // Load last check info from DB
  try {
    const lastCheckStr = await storage.getAppSetting("de_tracking_last_check");
    if (lastCheckStr) lastDeTrackingRunAt = new Date(lastCheckStr);
    const lastCountStr = await storage.getAppSetting("de_tracking_last_checked_count");
    if (lastCountStr) lastDeTrackingChecked = parseInt(lastCountStr, 10) || 0;
  } catch (_) {}
  scheduleNextDeTracking();
}

export function getNextDeTrackingRun(): string | null {
  return nextDeTrackingRun ? nextDeTrackingRun.toISOString() : null;
}

export function getDeTrackingScheduleInfo(): {
  lastCheckAt: string | null;
  lastCheckTracksCount: number;
  nextCheckAt: string | null;
  nextCheckIsSecondPass: boolean;
  schedule: { time: string; label: string }[];
} {
  const next = getNextDeRun();
  const schedule = DE_SCHEDULE_MSK.map((slot) => ({
    time: `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`,
    label: slot.triggerCrmExport ? "2-й проход → экспорт CRM" : "1-й проход",
  }));
  return {
    lastCheckAt: lastDeTrackingRunAt ? lastDeTrackingRunAt.toISOString() : null,
    lastCheckTracksCount: lastDeTrackingChecked,
    nextCheckAt: nextDeTrackingRun ? nextDeTrackingRun.toISOString() : null,
    nextCheckIsSecondPass: next.triggerCrmExport,
    schedule,
  };
}

export function getLastDeTrackingRun(): { at: string | null; tracksChecked: number } {
  return {
    at: lastDeTrackingRunAt ? lastDeTrackingRunAt.toISOString() : null,
    tracksChecked: lastDeTrackingChecked,
  };
}

export function isDeTrackingInProgress(): boolean {
  return deTrackingInProgress;
}

export async function runDeTrackingBatch(): Promise<{ total: number; checked: number; summary: string }> {
  if (deTrackingInProgress) {
    console.log("[17track] DE tracking batch already in progress, skipping");
    return { total: 0, checked: 0, summary: "Already in progress" };
  }

  deTrackingInProgress = true;
  console.log("[17track] Starting DE tracking batch...");
  let deHistoryId: number | null = null;
  const today = new Date().toISOString().split("T")[0];
  try { deHistoryId = await storage.insertSyncHistory("de_tracking", today, today); } catch (_) {}

  try {
    const parseTrackNumbers = (value: string | undefined | null): string[] => {
      if (!value || !value.trim()) return [];
      return value.split(/[,;]+/).map(s => s.trim().toUpperCase()).filter(s => s.length >= 5);
    };
    const isAmazonOrSF = (t: string) => /^DE\d{8,12}$/.test(t) || /^SF\d+$/.test(t);

    const allCachedRows = await db.execute(sql`
      SELECT payload FROM retailcrm_orders_cache
      WHERE status = 'otpravlen-magazinom'
        AND site NOT LIKE 'ip-shatskaia-%'
        AND site != 'darkstore-dubli-zakazov'
    `);

    const seenTracks = new Set<string>();
    const trackNumbers: string[] = [];
    const allKnownTracks = new Set<string>(); // All tracks including Amazon/SF — for stale cleanup

    for (const row of allCachedRows.rows as any[]) {
      const order = row.payload as any;
      // Консолидированные заказы проверяем — у них свои треки
      const warehouseTracks = parseTrackNumbers(order.customFields?.trek_nomer_cklada_otgruzki_nomer);
      const bulkTracks = parseTrackNumbers(order.customFields?.trek_nomer_sbornogo_vykupa);
      for (const t of [...warehouseTracks, ...bulkTracks]) {
        allKnownTracks.add(t);
        if (!seenTracks.has(t) && !isAmazonOrSF(t)) {
          seenTracks.add(t);
          trackNumbers.push(t);
        }
      }
    }

    // Фильтр: пропускаем доставленные; собираем уже перерегистрированные
    const existingStatuses = await storage.getDeParcelStatuses();
    const alreadyDelivered = new Set<string>();
    const alreadyReregistered = new Set<string>();
    for (const row of existingStatuses) {
      if (row.status && (
        row.status === "Доставлена" || row.status === "Доставлен" || row.status === "Delivered"
      )) {
        alreadyDelivered.add(row.trackingNumber);
      }
    }
    // Read reregistered_at via raw SQL (column may not exist yet)
    try {
      const reregRows = await db.execute(sql`SELECT tracking_number FROM de_parcel_statuses WHERE reregistered_at IS NOT NULL`);
      for (const row of reregRows.rows as any[]) {
        alreadyReregistered.add(row.tracking_number);
      }
    } catch (_) { /* column doesn't exist yet — no reregistered tracks */ }

    const toCheck = trackNumbers.filter(t => !alreadyDelivered.has(t));
    console.log(`[17track] DE batch: ${trackNumbers.length} total (excl. Amazon/SF), ${alreadyDelivered.size} delivered, ${toCheck.length} to check`);

    if (toCheck.length === 0) {
      if (deHistoryId) await storage.updateSyncHistory(deHistoryId, { status: "done", ordersCount: 0, completedAt: new Date() }).catch(() => {});
      return { total: 0, checked: 0, summary: "No tracks to check" };
    }

    const allResults: Record<string, any> = {};
    const CHUNK_SIZE = 40;

    for (let i = 0; i < toCheck.length; i += CHUNK_SIZE) {
      const chunk = toCheck.slice(i, i + CHUNK_SIZE);
      const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(toCheck.length / CHUNK_SIZE);

      try {
        const results = await track17Service.registerAndGetStatus(
          chunk.map(n => ({ number: n })),
          alreadyReregistered
        );

        const dbEntries: any[] = [];
        const reregisteredNums: string[] = [];
        for (const [num, info] of Array.from(results.entries())) {
          allResults[num] = info;
          const detection = track17Service.detectCarrierByFormat(num);
          const carrierName = detection.type === "carrier" ? detection.name : null;
          dbEntries.push({
            trackingNumber: num,
            carrier: carrierName,
            status: info.status,
            subStatus: info.subStatus || null,
            lastEvent: info.lastEvent || null,
            lastLocation: info.lastLocation || null,
            lastUpdate: info.lastUpdate || null,
            firstEventDate: info.firstEventDate || null,
            lastEventDate: info.lastEventDate || null,
          });
          if ((info as any).reregistered) {
            reregisteredNums.push(num);
            alreadyReregistered.add(num);
          }
        }
        await storage.upsertDeParcelStatuses(dbEntries);
        // Mark reregistered tracks via raw SQL (column added by migration)
        if (reregisteredNums.length > 0) {
          try {
            await db.execute(sql`UPDATE de_parcel_statuses SET reregistered_at = NOW() WHERE tracking_number = ANY(${sql.raw(`ARRAY[${reregisteredNums.map(n => `'${n.replace(/'/g, "''")}'`).join(",")}]::text[]`)}) AND reregistered_at IS NULL`);
          } catch (_) { /* column may not exist yet */ }
        }
      } catch (err: any) {
        console.error(`[17track] Scheduled batch chunk ${chunkNum}/${totalChunks} error:`, err.message);
      }

      if (i + CHUNK_SIZE < toCheck.length) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    // Mark unresolved tracks as "Не отслеживается — перевозчик не определён" (no retry — 96% of unknown formats are untraceable)
    const unresolvedEntries: any[] = [];
    for (const [num, info] of Object.entries(allResults) as [string, any][]) {
      // Skip already-categorized statuses
      if (info.status.startsWith("В пути") || info.status === "Доставлена" || info.status.startsWith("Проблема") || info.status.startsWith("Не отслеживается")) continue;
      // Everything else → unresolved
      allResults[num] = { ...info, status: "Не отслеживается — перевозчик не определён" };
      unresolvedEntries.push({
        trackingNumber: num,
        carrier: null,
        status: "Не отслеживается — перевозчик не определён",
        subStatus: null,
        lastEvent: null,
        lastLocation: null,
        lastUpdate: null,
        firstEventDate: null,
        lastEventDate: null,
      });
    }
    if (unresolvedEntries.length > 0) {
      console.log(`[17track] ${unresolvedEntries.length} tracks unresolved — marked as "Не отслеживается — перевозчик не определён"`);
      await storage.upsertDeParcelStatuses(unresolvedEntries);
    }

    // Clean up stale records not in current order set
    // Use allKnownTracks (includes Amazon/SF) to avoid deleting records managed by other sync sources
    const allDbRows = await storage.getDeParcelStatuses();
    const staleIds: number[] = [];
    for (const row of allDbRows) {
      if (!allKnownTracks.has(row.trackingNumber)) {
        staleIds.push(row.id);
      }
    }
    if (staleIds.length > 0) {
      await db.execute(sql`DELETE FROM de_parcel_statuses WHERE id = ANY(${sql.raw(`ARRAY[${staleIds.join(",")}]::int[]`)})`);
      console.log(`[17track] Cleaned ${staleIds.length} stale records from de_parcel_statuses`);
    }

    const statusCounts: Record<string, number> = {};
    for (const info of Object.values(allResults) as any[]) {
      statusCounts[info.status] = (statusCounts[info.status] || 0) + 1;
    }
    const summary = Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(", ");
    console.log(`[17track] Scheduled batch done: ${toCheck.length} checked. ${summary}`);

    lastDeTrackingRunAt = new Date();
    lastDeTrackingChecked = toCheck.length;
    await storage.setAppSetting("de_tracking_last_check", lastDeTrackingRunAt.toISOString());
    await storage.setAppSetting("de_tracking_last_checked_count", String(toCheck.length));
    if (deHistoryId) await storage.updateSyncHistory(deHistoryId, { status: "done", ordersCount: toCheck.length, completedAt: new Date() }).catch(() => {});

    return { total: toCheck.length, checked: Object.keys(allResults).length, summary };
  } catch (err: any) {
    console.error("[17track] Scheduled DE tracking batch error:", err.message);
    if (deHistoryId) await storage.updateSyncHistory(deHistoryId, { status: "error", errorMessage: err.message, completedAt: new Date() }).catch(() => {});
    return { total: 0, checked: 0, summary: `Error: ${err.message}` };
  } finally {
    deTrackingInProgress = false;
  }
}

// ===== AUTO CRM EXPORT FOR DE PARCELS =====

let crmExportDeAutoInProgress = false;

export async function runAutoCrmExportDe() {
  if (crmExportDeAutoInProgress) {
    console.log("[CRM DE Export] Already running, skipping");
    return;
  }

  crmExportDeAutoInProgress = true;
  let historyId: number | null = null;
  const today = new Date().toISOString().split("T")[0];
  try { historyId = await storage.insertSyncHistory("crm_export_de", today, today); } catch (_) {}

  try {
    console.log("[CRM DE Export] Starting...");

    const accounts = await storage.getRetailcrmAccounts(8);
    if (!accounts || accounts.length === 0) {
      throw new Error("RetailCRM account not configured");
    }
    const account = accounts[0];
    const apiKey = process.env[account.secretKey];
    if (!apiKey) {
      throw new Error("API key not configured");
    }
    const config = { subdomain: account.subdomain, apiKey };

    const retailcrmService = await import("./retailcrm-service");
    const statusesData = await retailcrmService.getStatuses(config);
    const allStatuses = statusesData.statuses || {};
    let targetCode: string | null = null;
    for (const s of Object.values(allStatuses) as any[]) {
      if (s.name === "Отправлен магазином") {
        targetCode = s.code;
        break;
      }
    }
    if (!targetCode) {
      throw new Error("Status 'Отправлен магазином' not found");
    }

    const parseTrackNumbers = (value: string | undefined | null): string[] => {
      if (!value || !value.trim()) return [];
      return value.split(/[,;]+/).map(s => s.trim().toUpperCase()).filter(s => s.length >= 5);
    };

    const cachedRows = await storage.getCachedOrdersByStatuses([targetCode]);
    const orderTracksMap = new Map<number, { tracks: string[]; site?: string }>();

    for (const row of cachedRows) {
      const order = row.payload as any;
      const warehouseTracks = parseTrackNumbers(order.customFields?.trek_nomer_cklada_otgruzki_nomer);
      const bulkTracks = parseTrackNumbers(order.customFields?.trek_nomer_sbornogo_vykupa);
      const tracks = Array.from(new Set([...warehouseTracks, ...bulkTracks]));
      if (tracks.length === 0) continue;
      const oid = typeof order.id === "string" ? parseInt(order.id, 10) : order.id;
      orderTracksMap.set(oid, { tracks, site: order.site || undefined });
    }

    const deStatuses = await storage.getDeParcelStatuses();
    const statusMap: Record<string, string> = {};
    const lastEventDateMap: Record<string, string> = {};
    for (const row of deStatuses) {
      if (row.status) statusMap[row.trackingNumber] = row.status;
      if (row.lastEventDate) lastEventDateMap[row.trackingNumber] = row.lastEventDate;
    }

    const ordersToExport: { orderId: number; site?: string; tracks: string[]; isMultiTrack: boolean }[] = [];
    for (const [orderId, orderData] of Array.from(orderTracksMap.entries())) {
      ordersToExport.push({
        orderId,
        site: orderData.site,
        tracks: orderData.tracks,
        isMultiTrack: orderData.tracks.length > 1,
      });
    }

    const exportableOrders = ordersToExport.filter(order => {
      if (order.isMultiTrack) return true;
      return !!statusMap[order.tracks[0]];
    });

    if (exportableOrders.length === 0) {
      console.log("[CRM DE Export] No exportable orders");
      if (historyId) await storage.updateSyncHistory(historyId, { status: "done", ordersCount: 0, completedAt: new Date() }).catch(() => {});
      return;
    }

    console.log(`[CRM DE Export] Exporting ${exportableOrders.length} orders...`);
    let updated = 0;
    let errors = 0;
    const DELAY_MS = 125;

    for (const order of exportableOrders) {
      try {
        const fields: Record<string, string | null> = {};

        if (order.isMultiTrack) {
          fields.status_dostavki_so_sklada_otgruzki = "Сборный заказ";
          const lines = order.tracks.map(track => {
            const st = statusMap[track] || "Не отслеживается — не проверен";
            return `- ${track} - ${st}`;
          });
          fields.status_dostavki_so_sklada_otgruzki_konsolidatsiia = lines.join("\n");
        } else {
          fields.status_dostavki_so_sklada_otgruzki = statusMap[order.tracks[0]];
        }

        const trackDates = order.tracks.map(t => lastEventDateMap[t]).filter(Boolean).sort();
        if (trackDates.length > 0) {
          const latest = trackDates[trackDates.length - 1];
          const d = new Date(latest);
          if (!isNaN(d.getTime())) {
            fields.data_statusa_dostavki_so_sklada_otgruzki = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          }
        }

        await retailcrmService.editOrderCustomFields(config, order.orderId, fields, order.site || undefined);
        updated++;
      } catch (err: any) {
        console.error(`[CRM DE Export] Error for order ${order.orderId}:`, err.message);
        errors++;
      }

      if (updated + errors < exportableOrders.length) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    }

    const skipped = ordersToExport.length - exportableOrders.length;
    console.log(`[CRM DE Export] Done: ${updated} updated, ${errors} errors, ${skipped} skipped`);
    if (historyId) await storage.updateSyncHistory(historyId, { status: "done", ordersCount: updated, completedAt: new Date() }).catch(() => {});
  } catch (err: any) {
    console.error("[CRM DE Export] Fatal error:", err.message);
    if (historyId) await storage.updateSyncHistory(historyId, { status: "error", errorMessage: err.message, completedAt: new Date() }).catch(() => {});
  } finally {
    crmExportDeAutoInProgress = false;
  }
}

// ========== Shop Agent: sync collected tracks → CRM ==========

function storeNameToDomain(name: string): string {
  if (!name) return name;
  if (name.includes(".")) return name;
  const lastHyphen = name.lastIndexOf("-");
  if (lastHyphen > 0) return name.slice(0, lastHyphen) + "." + name.slice(lastHyphen + 1);
  return name;
}

export async function syncShopTracksToCrm(): Promise<{ updated: number; skipped: number; errors: number }> {
  console.log("[ShopTrackSync] Starting...");
  const result = { updated: 0, skipped: 0, errors: 0 };

  // 1. Get CRM config
  const accounts = await storage.getRetailcrmAccounts(8);
  if (!accounts || accounts.length === 0) {
    console.error("[ShopTrackSync] RetailCRM account not configured");
    return result;
  }
  const account = accounts[0];
  const apiKey = process.env[account.secretKey];
  if (!apiKey) {
    console.error("[ShopTrackSync] API key not configured");
    return result;
  }
  const config = { subdomain: account.subdomain, apiKey };
  const retailcrmService = await import("./retailcrm-service");

  // 2. Get shops with crmExport enabled (from shop_profiles)
  const enabledShops = await storage.getShopsWithCrmExport();
  if (enabledShops.length === 0) {
    console.log("[ShopTrackSync] No shops with CRM export enabled");
    return result;
  }
  console.log(`[ShopTrackSync] Enabled shops: ${enabledShops.join(", ")}`);

  // 3. Get all orders with status "vystavlen-invoice-klientu"
  const allOrders = await storage.getCachedOrdersByStatuses(["vystavlen-invoice-klientu"]);

  // 4. Group orders by shop domain
  const ordersByShop = new Map<string, typeof allOrders>();
  for (const o of allOrders) {
    const payload = o.payload as any;
    const rawStore = payload?.shipmentStore || "";
    if (!rawStore) continue;
    const store = storeNameToDomain(rawStore);
    if (!enabledShops.includes(store)) continue;
    const list = ordersByShop.get(store) || [];
    list.push(o);
    ordersByShop.set(store, list);
  }

  // 5. For each enabled shop, get latest checks with tracking
  const shopEntries = Array.from(ordersByShop.entries());
  for (const [shop, orders] of shopEntries) {
    const crmOrderIds = orders.map((o: any) => o.orderId);

    // Get latest checks with tracking numbers (batch by 500)
    const checksWithTrack = new Map<string, string>(); // crmOrderId → trackingNumber
    for (let i = 0; i < crmOrderIds.length; i += 500) {
      const batch = crmOrderIds.slice(i, i + 500);
      const checks = await storage.getLatestChecksByCrmOrderIds(batch);
      for (const c of checks) {
        if (c.trackingNumber && c.checkResult === "success") {
          checksWithTrack.set(c.crmOrderId, c.trackingNumber);
        }
      }
    }

    if (checksWithTrack.size === 0) {
      console.log(`[ShopTrackSync] ${shop}: no tracks to sync`);
      continue;
    }

    console.log(`[ShopTrackSync] ${shop}: ${checksWithTrack.size} orders with collected tracks`);

    // 6. For each order with tracking, apply CRM write logic
    for (const o of orders) {
      const track = checksWithTrack.get(o.orderId);
      if (!track) continue;

      const payload = o.payload as any;
      const cf = payload?.customFields || {};
      const orderId = Number(payload?.id || o.orderId);
      const site = payload?.site || undefined;

      const isSbornyi = cf.sbornyi_zakaz === true || cf.sbornyi_zakaz === "true";
      const isKonsolidatsiia = cf.konsolidatsiia === true || cf.konsolidatsiia === "true";

      try {
        if (!isSbornyi && !isKonsolidatsiia) {
          // Normal order: write to trek_nomer_cklada_otgruzki_nomer, change status
          const existing = cf.trek_nomer_cklada_otgruzki_nomer || "";
          if (existing === track) {
            result.skipped++;
            continue;
          }
          await retailcrmService.editOrderCustomFields(config, orderId, {
            trek_nomer_cklada_otgruzki_nomer: track,
          }, site);
          await retailcrmService.editOrderStatus(config, orderId, "otpravlen-magazinom", site);
          result.updated++;
          console.log(`[ShopTrackSync] ${shop} order ${orderId}: wrote track to trek_nomer_cklada_otgruzki_nomer, status → otpravlen-magazinom`);
        } else if (!isSbornyi && isKonsolidatsiia) {
          // Consolidated: append to trek_nomer_sbornogo_vykupa, DON'T change status
          const existing = cf.trek_nomer_sbornogo_vykupa || "";
          const existingTracks = existing ? existing.split(",").map((t: string) => t.trim()) : [];
          if (existingTracks.includes(track)) {
            result.skipped++;
            continue;
          }
          const newValue = existing ? `${existing},${track}` : track;
          await retailcrmService.editOrderCustomFields(config, orderId, {
            trek_nomer_sbornogo_vykupa: newValue,
          }, site);
          result.updated++;
          console.log(`[ShopTrackSync] ${shop} order ${orderId}: appended track to trek_nomer_sbornogo_vykupa`);
        } else if (isSbornyi && !isKonsolidatsiia) {
          // Sbornyi: append to trek_nomera_dlia_sbornykh_zakazov, DON'T change status
          const existing = cf.trek_nomera_dlia_sbornykh_zakazov || "";
          const existingTracks = existing ? existing.split(",").map((t: string) => t.trim()) : [];
          if (existingTracks.includes(track)) {
            result.skipped++;
            continue;
          }
          const newValue = existing ? `${existing},${track}` : track;
          await retailcrmService.editOrderCustomFields(config, orderId, {
            trek_nomera_dlia_sbornykh_zakazov: newValue,
          }, site);
          result.updated++;
          console.log(`[ShopTrackSync] ${shop} order ${orderId}: appended track to trek_nomera_dlia_sbornykh_zakazov`);
        } else {
          // sbornyi=true + konsolidatsiia=true — not specified, skip
          result.skipped++;
          continue;
        }
      } catch (err: any) {
        result.errors++;
        console.error(`[ShopTrackSync] ${shop} order ${orderId}: error — ${err.message}`);
      }

      // Rate limiting (125ms between CRM API calls)
      await new Promise(r => setTimeout(r, 125));
    }
  }

  console.log(`[ShopTrackSync] Done: ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`);
  return result;
}
