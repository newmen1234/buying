import {
  type User, type UpsertUser,
  type Tool, type InsertTool,
  type EmailAccount, type InsertEmailAccount,
  type RetailcrmAccount, type InsertRetailcrmAccount,
  type Track, type InsertTrack,
  type RetailcrmOrderCache, type CacheSyncLogEntry,
  type SyncHistoryEntry,
  type ShopRecipe, type InsertShopRecipe,
  type ShopOrderCheck, type InsertShopOrderCheck,
  type ShopCredential, type InsertShopCredential,
  type ShopCheckMethod,
  type ShopProfile, type ShopInstruction,
  type TrackingStoreSetting, type DeliveryTypeSetting,
  type TaskPrompt, type RecipeKnowledge,
  users, tools, emailAccounts, retailcrmAccounts, tracks,
  retailcrmOrdersCache, currencyRates, cacheSyncLog, appSettings, deParcelStatuses,
  syncHistory, shopRecipes, shopOrderChecks, shopCredentials, shopCheckMethods,
  shopProfiles, shopInstructions,
  trackingStoreSettings, deliveryTypeSettings,
  taskPrompts, recipeKnowledge,
} from "@shared/schema";
import { db } from "./db";
import { eq, ne, desc, and, gte, lte, inArray, sql, isNotNull } from "drizzle-orm";

export interface LeanOrder {
  status: string;
  site: string | null;
  createdAt: string | null;
  statusUpdatedAt: string | null;
  summ: number;
  purchaseSumm: number;
  sebestoimost: number;
  delivery: number;
  adSpend: number;
  iulVykupa: string;
  iulVykupa1c: string;
  brand: string;
  istochnik: string;
  cancelReason: string;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  createUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, data: Partial<UpsertUser>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;

  getTools(): Promise<Tool[]>;
  getTool(id: number): Promise<Tool | undefined>;
  createTool(data: InsertTool): Promise<Tool>;
  updateTool(id: number, data: Partial<InsertTool>): Promise<Tool | undefined>;
  deleteTool(id: number): Promise<void>;
  
  getEmailAccounts(toolId: number): Promise<EmailAccount[]>;
  getEmailAccount(id: number): Promise<EmailAccount | undefined>;
  createEmailAccount(data: InsertEmailAccount & { secretKey: string }): Promise<EmailAccount>;
  updateEmailAccount(id: number, data: Partial<EmailAccount>): Promise<EmailAccount | undefined>;
  deleteEmailAccount(id: number): Promise<void>;
  
  getRetailcrmAccounts(toolId?: number): Promise<RetailcrmAccount[]>;
  getRetailcrmAccount(id: number): Promise<RetailcrmAccount | undefined>;
  createRetailcrmAccount(data: InsertRetailcrmAccount & { secretKey: string }): Promise<RetailcrmAccount>;
  updateRetailcrmAccount(id: number, data: Partial<RetailcrmAccount>): Promise<RetailcrmAccount | undefined>;
  deleteRetailcrmAccount(id: number): Promise<void>;

  getTracks(): Promise<Track[]>;
  getTrack(id: number): Promise<Track | undefined>;
  getTrackByEmailId(emailId: string): Promise<Track | undefined>;
  createTrack(data: InsertTrack): Promise<Track>;
  updateTrack(id: number, data: Partial<Track>): Promise<Track | undefined>;
  deleteTrack(id: number): Promise<void>;

  getCachedOrdersByDateRange(dateFrom: string, dateTo: string): Promise<RetailcrmOrderCache[]>;
  getCachedOrdersLean(dateFrom: string, dateTo: string): Promise<LeanOrder[]>;
  getCachedOrdersByStatuses(statusCodes: string[]): Promise<RetailcrmOrderCache[]>;
  getCachedOrdersLeanByStatuses(statusCodes: string[]): Promise<LeanOrder[]>;
  getCachedOrdersPurchaseSpeed(dateFrom: string, dateTo: string): Promise<{ createdAt: string; dataVykupa: string; site: string | null; managerId: string | null }[]>;
  upsertCachedOrders(orders: { orderId: string; createdDate: string; status: string; site: string | null; totalSum: number; payload: any }[]): Promise<void>;
  deleteCachedOrdersByStatuses(statusCodes: string[]): Promise<void>;
  deleteCachedOrdersByDateRange(dateFrom: string, dateTo: string): Promise<void>;
  clearStagingCache(): Promise<void>;
  insertStagingOrders(orders: { orderId: string; createdDate: string; status: string; site: string | null; totalSum: number; payload: any }[]): Promise<void>;
  swapStagingToMainCache(dateFrom: string, dateTo: string): Promise<void>;
  getSyncedDates(dateFrom: string, dateTo: string): Promise<CacheSyncLogEntry[]>;
  upsertSyncLog(syncDate: string, ordersCount: number): Promise<void>;
  getCurrencyRates(date: string): Promise<Record<string, number> | null>;
  upsertCurrencyRates(date: string, rates: Record<string, number>): Promise<void>;
  getLatestSyncTime(dateFrom: string, dateTo: string): Promise<Date | null>;

  getAppSetting(key: string): Promise<string | null>;
  setAppSetting(key: string, value: string): Promise<void>;

  upsertDeParcelStatuses(entries: { trackingNumber: string; carrier?: string | null; status: string; subStatus: string | null; lastEvent: string | null; lastLocation: string | null; lastUpdate: string | null; firstEventDate: string | null; lastEventDate: string | null }[]): Promise<void>;
  getDeParcelStatuses(): Promise<any[]>;

  insertSyncHistory(jobType: string, dateFrom: string, dateTo: string, triggeredBy?: string): Promise<number>;
  updateSyncHistory(id: number, data: { status?: string; ordersCount?: number; errorMessage?: string | null; completedAt?: Date }): Promise<void>;
  getSyncHistory(limit: number): Promise<SyncHistoryEntry[]>;

  // Shop recipes
  getShopRecipes(): Promise<ShopRecipe[]>;
  getShopRecipe(id: number): Promise<ShopRecipe | undefined>;
  getShopRecipeByDomain(domain: string): Promise<ShopRecipe | undefined>;
  getEmailRecipeByDomain(domain: string): Promise<ShopRecipe | undefined>;
  createShopRecipe(data: InsertShopRecipe): Promise<ShopRecipe>;
  updateShopRecipe(id: number, data: Partial<ShopRecipe>): Promise<ShopRecipe | undefined>;
  deleteShopRecipe(id: number): Promise<void>;

  // Shop order checks
  getShopOrderChecks(limit: number): Promise<ShopOrderCheck[]>;
  getShopOrderChecksByDomain(domain: string, limit: number): Promise<ShopOrderCheck[]>;
  getLatestChecksByCrmOrderIds(crmOrderIds: string[]): Promise<ShopOrderCheck[]>;
  /** Get existing tracking numbers for shop order IDs (to avoid redundant OCR) */
  getLatestTrackingForOrders(shopOrderIds: string[]): Promise<Map<string, string>>;
  createShopOrderCheck(data: InsertShopOrderCheck): Promise<ShopOrderCheck>;

  // Shop credentials
  getShopCredentials(): Promise<ShopCredential[]>;
  getShopCredential(id: number): Promise<ShopCredential | undefined>;
  getShopCredentialsByDomain(domain: string): Promise<ShopCredential[]>;
  createShopCredential(data: InsertShopCredential): Promise<ShopCredential>;
  updateShopCredential(id: number, data: Partial<ShopCredential>): Promise<ShopCredential | undefined>;
  deleteShopCredential(id: number): Promise<void>;

  // Shop check methods (legacy)
  getShopCheckMethods(): Promise<ShopCheckMethod[]>;
  upsertShopCheckMethod(shopName: string, checkMethod: string): Promise<ShopCheckMethod>;

  // Shop profiles
  getShopProfiles(): Promise<ShopProfile[]>;
  upsertShopProfile(domain: string, data: Partial<ShopProfile>): Promise<ShopProfile>;
  deleteShopProfile(domain: string): Promise<void>;
  getShopsWithCrmExport(): Promise<string[]>;

  // Shop instructions
  getShopInstructions(): Promise<ShopInstruction[]>;
  getShopInstruction(domain: string): Promise<ShopInstruction | undefined>;
  upsertShopInstruction(domain: string, data: Partial<ShopInstruction>): Promise<ShopInstruction>;

  // Tracking store settings
  getTrackingStoreSettings(): Promise<TrackingStoreSetting[]>;
  upsertTrackingStoreSettings(settings: { siteCode: string; siteName?: string | null; groupName: string; enabled: boolean }[]): Promise<void>;

  // Delivery type settings
  getDeliveryTypeSettings(): Promise<DeliveryTypeSetting[]>;
  upsertDeliveryTypeSettings(settings: { deliveryCode: string; groupName: string }[]): Promise<void>;

  // Task prompts (for autonomous task watcher)
  getTaskPrompts(): Promise<TaskPrompt[]>;
  upsertTaskPrompt(taskType: string, promptTemplate: string): Promise<TaskPrompt>;

  // Recipe knowledge (accumulated knowledge base)
  getRecipeKnowledge(): Promise<RecipeKnowledge[]>;
  createRecipeKnowledge(data: { category: string; topic: string; content: string; examples?: any; tags?: string[] }): Promise<RecipeKnowledge>;
  updateRecipeKnowledge(id: number, data: { category?: string; topic?: string; content?: string; examples?: any; tags?: string[] }): Promise<RecipeKnowledge>;
  deleteRecipeKnowledge(id: number): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(users.createdAt);
  }

  async createUser(userData: UpsertUser): Promise<User> {
    const [user] = await db.insert(users).values(userData).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<UpsertUser>): Promise<User | undefined> {
    const [user] = await db.update(users)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getTools(): Promise<Tool[]> {
    return db.select().from(tools);
  }

  async getTool(id: number): Promise<Tool | undefined> {
    const [tool] = await db.select().from(tools).where(eq(tools.id, id));
    return tool;
  }

  async createTool(data: InsertTool): Promise<Tool> {
    const [tool] = await db.insert(tools).values(data).returning();
    return tool;
  }

  async updateTool(id: number, data: Partial<InsertTool>): Promise<Tool | undefined> {
    const [tool] = await db.update(tools).set(data).where(eq(tools.id, id)).returning();
    return tool;
  }

  async deleteTool(id: number): Promise<void> {
    await db.delete(tools).where(eq(tools.id, id));
  }

  async getEmailAccounts(toolId: number): Promise<EmailAccount[]> {
    return db.select().from(emailAccounts).where(eq(emailAccounts.toolId, toolId));
  }

  async getEmailAccount(id: number): Promise<EmailAccount | undefined> {
    const [account] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, id));
    return account;
  }

  async createEmailAccount(data: InsertEmailAccount & { secretKey: string }): Promise<EmailAccount> {
    const [account] = await db.insert(emailAccounts).values(data).returning();
    return account;
  }

  async updateEmailAccount(id: number, data: Partial<EmailAccount>): Promise<EmailAccount | undefined> {
    const [account] = await db.update(emailAccounts).set(data).where(eq(emailAccounts.id, id)).returning();
    return account;
  }

  async deleteEmailAccount(id: number): Promise<void> {
    await db.delete(emailAccounts).where(eq(emailAccounts.id, id));
  }

  async getRetailcrmAccounts(toolId?: number): Promise<RetailcrmAccount[]> {
    if (toolId) {
      return db.select().from(retailcrmAccounts).where(eq(retailcrmAccounts.toolId, toolId));
    }
    return db.select().from(retailcrmAccounts);
  }

  async getRetailcrmAccount(id: number): Promise<RetailcrmAccount | undefined> {
    const [account] = await db.select().from(retailcrmAccounts).where(eq(retailcrmAccounts.id, id));
    return account;
  }

  async createRetailcrmAccount(data: InsertRetailcrmAccount & { secretKey: string }): Promise<RetailcrmAccount> {
    const [account] = await db.insert(retailcrmAccounts).values(data).returning();
    return account;
  }

  async updateRetailcrmAccount(id: number, data: Partial<RetailcrmAccount>): Promise<RetailcrmAccount | undefined> {
    const [account] = await db.update(retailcrmAccounts).set(data).where(eq(retailcrmAccounts.id, id)).returning();
    return account;
  }

  async deleteRetailcrmAccount(id: number): Promise<void> {
    await db.delete(retailcrmAccounts).where(eq(retailcrmAccounts.id, id));
  }

  async getTracks(): Promise<Track[]> {
    return db.select().from(tracks).orderBy(desc(tracks.emailDate));
  }
  
  async getTrack(id: number): Promise<Track | undefined> {
    const [track] = await db.select().from(tracks).where(eq(tracks.id, id));
    return track;
  }
  
  async getTrackByEmailId(emailId: string): Promise<Track | undefined> {
    const [track] = await db.select().from(tracks).where(eq(tracks.emailId, emailId));
    return track;
  }
  
  async createTrack(data: InsertTrack): Promise<Track> {
    const [track] = await db.insert(tracks).values(data).returning();
    return track;
  }
  
  async updateTrack(id: number, data: Partial<Track>): Promise<Track | undefined> {
    const [track] = await db.update(tracks).set(data).where(eq(tracks.id, id)).returning();
    return track;
  }
  
  async deleteTrack(id: number): Promise<void> {
    await db.delete(tracks).where(eq(tracks.id, id));
  }

  async getCachedOrdersByDateRange(dateFrom: string, dateTo: string): Promise<RetailcrmOrderCache[]> {
    return db.select().from(retailcrmOrdersCache)
      .where(and(
        gte(retailcrmOrdersCache.createdDate, dateFrom),
        lte(retailcrmOrdersCache.createdDate, dateTo),
      ));
  }

  async getCachedOrdersLean(dateFrom: string, dateTo: string): Promise<LeanOrder[]> {
    const result = await db.execute(sql`
      SELECT
        status,
        site,
        payload->>'createdAt' as "createdAt",
        payload->>'statusUpdatedAt' as "statusUpdatedAt",
        COALESCE((payload->>'summ')::numeric, 0) as summ,
        COALESCE((payload->>'purchaseSumm')::numeric, 0) as "purchaseSumm",
        CASE WHEN replace(trim(split_part(COALESCE(payload->'customFields'->>'sebestoimost_vykupa_parsing', ''), ';', 1)), ',', '.') ~ '^-?[0-9]+([.][0-9]+)?$'
             THEN replace(trim(split_part(payload->'customFields'->>'sebestoimost_vykupa_parsing', ';', 1)), ',', '.')::numeric ELSE 0 END as sebestoimost,
        CASE WHEN replace(trim(split_part(COALESCE(payload->'customFields'->>'raskhod_na_dostavku', ''), ';', 1)), ',', '.') ~ '^-?[0-9]+([.][0-9]+)?$'
             THEN replace(trim(split_part(payload->'customFields'->>'raskhod_na_dostavku', ';', 1)), ',', '.')::numeric ELSE 0 END as delivery,
        CASE WHEN replace(trim(split_part(COALESCE(payload->'customFields'->>'komissiia_marketpleisa1', ''), ';', 1)), ',', '.') ~ '^-?[0-9]+([.][0-9]+)?$'
             THEN replace(trim(split_part(payload->'customFields'->>'komissiia_marketpleisa1', ';', 1)), ',', '.')::numeric ELSE 0 END as "adSpend",
        COALESCE(payload->'customFields'->>'iul_vykupa', '—') as "iulVykupa",
        COALESCE(payload->'customFields'->>'iul_vykupa1c', '—') as "iulVykupa1c",
        COALESCE(payload->'customFields'->>'brand', '—') as brand,
        COALESCE(payload->'customFields'->>'istochnik1', '—') as istochnik,
        COALESCE(payload->'customFields'->>'prichina_otmeny', '') as "cancelReason"
      FROM retailcrm_orders_cache
      WHERE created_date >= ${dateFrom} AND created_date <= ${dateTo}
    `);
    return result.rows as unknown as LeanOrder[];
  }

  async getCachedOrdersByStatuses(statusCodes: string[]): Promise<RetailcrmOrderCache[]> {
    if (statusCodes.length === 0) return [];
    return db.select().from(retailcrmOrdersCache)
      .where(inArray(retailcrmOrdersCache.status, statusCodes));
  }

  async getCachedOrdersLeanByStatuses(statusCodes: string[]): Promise<LeanOrder[]> {
    if (statusCodes.length === 0) return [];
    const result = await db.execute(sql`
      SELECT
        status,
        site,
        payload->>'createdAt' as "createdAt",
        payload->>'statusUpdatedAt' as "statusUpdatedAt",
        COALESCE((payload->>'summ')::numeric, 0) as summ,
        COALESCE((payload->>'purchaseSumm')::numeric, 0) as "purchaseSumm",
        CASE WHEN replace(trim(split_part(COALESCE(payload->'customFields'->>'sebestoimost_vykupa_parsing', ''), ';', 1)), ',', '.') ~ '^-?[0-9]+([.][0-9]+)?$'
             THEN replace(trim(split_part(payload->'customFields'->>'sebestoimost_vykupa_parsing', ';', 1)), ',', '.')::numeric ELSE 0 END as sebestoimost,
        CASE WHEN replace(trim(split_part(COALESCE(payload->'customFields'->>'raskhod_na_dostavku', ''), ';', 1)), ',', '.') ~ '^-?[0-9]+([.][0-9]+)?$'
             THEN replace(trim(split_part(payload->'customFields'->>'raskhod_na_dostavku', ';', 1)), ',', '.')::numeric ELSE 0 END as delivery,
        CASE WHEN replace(trim(split_part(COALESCE(payload->'customFields'->>'komissiia_marketpleisa1', ''), ';', 1)), ',', '.') ~ '^-?[0-9]+([.][0-9]+)?$'
             THEN replace(trim(split_part(payload->'customFields'->>'komissiia_marketpleisa1', ';', 1)), ',', '.')::numeric ELSE 0 END as "adSpend",
        COALESCE(payload->'customFields'->>'iul_vykupa', '—') as "iulVykupa",
        COALESCE(payload->'customFields'->>'iul_vykupa1c', '—') as "iulVykupa1c",
        COALESCE(payload->'customFields'->>'brand', '—') as brand,
        COALESCE(payload->'customFields'->>'istochnik1', '—') as istochnik,
        COALESCE(payload->'customFields'->>'prichina_otmeny', '') as "cancelReason"
      FROM retailcrm_orders_cache
      WHERE status = ANY(${sql.raw(`ARRAY[${statusCodes.map(s => `'${s.replace(/'/g, "''")}'`).join(",")}]`)})
    `);
    return result.rows as unknown as LeanOrder[];
  }

  async upsertCachedOrders(orders: { orderId: string; createdDate: string; status: string; site: string | null; totalSum: number; payload: any }[]): Promise<void> {
    if (orders.length === 0) return;
    const deduped = new Map<string, typeof orders[0]>();
    for (const o of orders) {
      deduped.set(o.orderId, o);
    }
    const uniqueOrders = Array.from(deduped.values());
    const batchSize = 500;
    for (let i = 0; i < uniqueOrders.length; i += batchSize) {
      const batch = uniqueOrders.slice(i, i + batchSize);
      await db.insert(retailcrmOrdersCache)
        .values(batch.map(o => ({
          orderId: o.orderId,
          createdDate: o.createdDate,
          status: o.status,
          site: o.site,
          totalSum: o.totalSum,
          payload: o.payload,
        })))
        .onConflictDoUpdate({
          target: retailcrmOrdersCache.orderId,
          set: {
            createdDate: sql`excluded.created_date`,
            status: sql`excluded.status`,
            site: sql`excluded.site`,
            totalSum: sql`excluded.total_sum`,
            payload: sql`excluded.payload`,
            cachedAt: sql`CURRENT_TIMESTAMP`,
          },
        });
    }
  }

  async getCachedOrdersPurchaseSpeed(dateFrom: string, dateTo: string): Promise<{ createdAt: string; dataVykupa: string; site: string | null; managerId: string | null; totalSum: number; summ: number }[]> {
    const result = await db.execute(sql`
      SELECT
        payload->>'createdAt' as "createdAt",
        payload->'customFields'->>'data_vykupa' as "dataVykupa",
        site,
        payload->>'managerId' as "managerId",
        COALESCE(total_sum, 0) as "totalSum",
        COALESCE((payload->>'summ')::numeric, 0) as "summ"
      FROM retailcrm_orders_cache
      WHERE created_date >= ${dateFrom} AND created_date <= ${dateTo}
        AND payload->'customFields'->>'data_vykupa' IS NOT NULL
        AND payload->'customFields'->>'data_vykupa' != ''
    `);
    return result.rows as unknown as { createdAt: string; dataVykupa: string; site: string | null; managerId: string | null; totalSum: number; summ: number }[];
  }

  async deleteCachedOrdersByStatuses(statusCodes: string[]): Promise<void> {
    if (statusCodes.length === 0) return;
    await db.delete(retailcrmOrdersCache)
      .where(inArray(retailcrmOrdersCache.status, statusCodes));
  }

  async deleteCachedOrdersByDateRange(dateFrom: string, dateTo: string): Promise<void> {
    await db.delete(retailcrmOrdersCache)
      .where(and(
        gte(retailcrmOrdersCache.createdDate, dateFrom),
        lte(retailcrmOrdersCache.createdDate, dateTo),
      ));
  }

  async clearStagingCache(): Promise<void> {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS retailcrm_orders_cache_staging (
        id SERIAL PRIMARY KEY,
        order_id TEXT NOT NULL,
        created_date TEXT NOT NULL,
        status TEXT NOT NULL,
        site TEXT,
        total_sum REAL DEFAULT 0,
        payload JSONB NOT NULL,
        cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    await db.execute(sql`TRUNCATE retailcrm_orders_cache_staging`);
  }

  async insertStagingOrders(orders: { orderId: string; createdDate: string; status: string; site: string | null; totalSum: number; payload: any }[]): Promise<void> {
    if (orders.length === 0) return;
    const batchSize = 500;
    for (let i = 0; i < orders.length; i += batchSize) {
      const batch = orders.slice(i, i + batchSize);
      const values = batch.map(o =>
        sql`(${o.orderId}, ${o.createdDate}, ${o.status}, ${o.site}, ${o.totalSum}, ${JSON.stringify(o.payload)}::jsonb, CURRENT_TIMESTAMP)`
      );
      await db.execute(sql`
        INSERT INTO retailcrm_orders_cache_staging (order_id, created_date, status, site, total_sum, payload, cached_at)
        VALUES ${sql.join(values, sql`, `)}
      `);
    }
  }

  async swapStagingToMainCache(dateFrom: string, dateTo: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM retailcrm_orders_cache WHERE created_date >= ${dateFrom} AND created_date <= ${dateTo}`);
      await tx.execute(sql`
        WITH deduped AS (
          SELECT DISTINCT ON (order_id) order_id, created_date, status, site, total_sum, payload, cached_at
          FROM retailcrm_orders_cache_staging
          ORDER BY order_id, cached_at DESC
        )
        INSERT INTO retailcrm_orders_cache (order_id, created_date, status, site, total_sum, payload, cached_at)
        SELECT order_id, created_date, status, site, total_sum, payload, cached_at
        FROM deduped
        ON CONFLICT (order_id) DO UPDATE SET
          created_date = EXCLUDED.created_date,
          status = EXCLUDED.status,
          site = EXCLUDED.site,
          total_sum = EXCLUDED.total_sum,
          payload = EXCLUDED.payload,
          cached_at = EXCLUDED.cached_at
      `);
      await tx.execute(sql`TRUNCATE retailcrm_orders_cache_staging`);
    });
  }

  async getSyncedDates(dateFrom: string, dateTo: string): Promise<CacheSyncLogEntry[]> {
    return db.select().from(cacheSyncLog)
      .where(and(
        gte(cacheSyncLog.syncDate, dateFrom),
        lte(cacheSyncLog.syncDate, dateTo),
      ));
  }

  async upsertSyncLog(syncDate: string, ordersCount: number): Promise<void> {
    await db.insert(cacheSyncLog)
      .values({ syncDate, ordersCount })
      .onConflictDoUpdate({
        target: cacheSyncLog.syncDate,
        set: {
          ordersCount,
          syncedAt: sql`CURRENT_TIMESTAMP`,
        },
      });
  }

  async getCurrencyRates(date: string): Promise<Record<string, number> | null> {
    const rows = await db.select().from(currencyRates)
      .where(eq(currencyRates.date, date));
    if (rows.length === 0) return null;
    const rates: Record<string, number> = {};
    for (const row of rows) {
      rates[row.currencyCode] = row.rate;
    }
    return rates;
  }

  async upsertCurrencyRates(date: string, rates: Record<string, number>): Promise<void> {
    const entries = Object.entries(rates).map(([currencyCode, rate]) => ({
      date,
      currencyCode,
      rate,
    }));
    if (entries.length === 0) return;
    await db.insert(currencyRates)
      .values(entries)
      .onConflictDoUpdate({
        target: [currencyRates.date, currencyRates.currencyCode],
        set: {
          rate: sql`excluded.rate`,
        },
      });
  }

  async getLatestSyncTime(dateFrom: string, dateTo: string): Promise<Date | null> {
    const rows = await db.select({ syncedAt: cacheSyncLog.syncedAt })
      .from(cacheSyncLog)
      .where(and(
        gte(cacheSyncLog.syncDate, dateFrom),
        lte(cacheSyncLog.syncDate, dateTo),
      ))
      .orderBy(desc(cacheSyncLog.syncedAt))
      .limit(1);
    return rows.length > 0 ? rows[0].syncedAt : null;
  }

  async getAppSetting(key: string): Promise<string | null> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return row?.value ?? null;
  }

  async setAppSetting(key: string, value: string): Promise<void> {
    await db.insert(appSettings)
      .values({ key, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() },
      });
  }

  async upsertDeParcelStatuses(entries: { trackingNumber: string; carrier?: string | null; status: string; subStatus: string | null; lastEvent: string | null; lastLocation: string | null; lastUpdate: string | null; firstEventDate: string | null; lastEventDate: string | null }[]): Promise<void> {
    if (entries.length === 0) return;
    const BATCH = 500;
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      await db.insert(deParcelStatuses)
        .values(batch.map(e => ({
          trackingNumber: e.trackingNumber,
          carrier: e.carrier || null,
          status: e.status,
          subStatus: e.subStatus,
          lastEvent: e.lastEvent,
          lastLocation: e.lastLocation,
          lastUpdate: e.lastUpdate,
          firstEventDate: e.firstEventDate,
          lastEventDate: e.lastEventDate,
          checkedAt: new Date(),
        })))
        .onConflictDoUpdate({
          target: deParcelStatuses.trackingNumber,
          set: {
            carrier: sql`COALESCE(excluded.carrier, de_parcel_statuses.carrier)`,
            status: sql`excluded.status`,
            subStatus: sql`excluded.sub_status`,
            lastEvent: sql`excluded.last_event`,
            lastLocation: sql`excluded.last_location`,
            lastUpdate: sql`excluded.last_update`,
            firstEventDate: sql`excluded.first_event_date`,
            lastEventDate: sql`excluded.last_event_date`,
            checkedAt: sql`excluded.checked_at`,
          },
        });
    }
  }

  async getDeParcelStatuses(): Promise<any[]> {
    return await db.select().from(deParcelStatuses);
  }

  async insertSyncHistory(jobType: string, dateFrom: string, dateTo: string, triggeredBy?: string): Promise<number> {
    const [row] = await db.insert(syncHistory).values({
      jobType,
      dateFrom,
      dateTo,
      status: "syncing",
      startedAt: new Date(),
      ...(triggeredBy ? { triggeredBy } : {}),
    }).returning({ id: syncHistory.id });
    return row.id;
  }

  async updateSyncHistory(id: number, data: { status?: string; ordersCount?: number; errorMessage?: string | null; completedAt?: Date }): Promise<void> {
    const setData: any = {};
    if (data.status !== undefined) setData.status = data.status;
    if (data.ordersCount !== undefined) setData.ordersCount = data.ordersCount;
    if (data.errorMessage !== undefined) setData.errorMessage = data.errorMessage;
    if (data.completedAt !== undefined) setData.completedAt = data.completedAt;
    await db.update(syncHistory).set(setData).where(eq(syncHistory.id, id));
  }

  async getSyncHistory(limit: number): Promise<SyncHistoryEntry[]> {
    return db.select().from(syncHistory).orderBy(desc(syncHistory.startedAt)).limit(limit);
  }

  // Shop recipes
  async getShopRecipes(): Promise<ShopRecipe[]> {
    return db.select().from(shopRecipes).orderBy(desc(shopRecipes.updatedAt));
  }

  async getShopRecipe(id: number): Promise<ShopRecipe | undefined> {
    const [recipe] = await db.select().from(shopRecipes).where(eq(shopRecipes.id, id));
    return recipe;
  }

  async getShopRecipeByDomain(domain: string): Promise<ShopRecipe | undefined> {
    // Browser recipes only (exclude email_parsing)
    const [recipe] = await db.select().from(shopRecipes)
      .where(and(eq(shopRecipes.domain, domain), ne(shopRecipes.loginType, "email_parsing")));
    if (recipe) return recipe;
    const alt = domain.startsWith("www.") ? domain.slice(4) : `www.${domain}`;
    const [altRecipe] = await db.select().from(shopRecipes)
      .where(and(eq(shopRecipes.domain, alt), ne(shopRecipes.loginType, "email_parsing")));
    return altRecipe;
  }

  async getEmailRecipeByDomain(domain: string): Promise<ShopRecipe | undefined> {
    const [recipe] = await db.select().from(shopRecipes)
      .where(and(eq(shopRecipes.domain, domain), eq(shopRecipes.loginType, "email_parsing")));
    if (recipe) return recipe;
    const alt = domain.startsWith("www.") ? domain.slice(4) : `www.${domain}`;
    const [altRecipe] = await db.select().from(shopRecipes)
      .where(and(eq(shopRecipes.domain, alt), eq(shopRecipes.loginType, "email_parsing")));
    return altRecipe;
  }

  async createShopRecipe(data: InsertShopRecipe): Promise<ShopRecipe> {
    const [recipe] = await db.insert(shopRecipes).values(data).returning();
    return recipe;
  }

  async updateShopRecipe(id: number, data: Partial<ShopRecipe>): Promise<ShopRecipe | undefined> {
    const [recipe] = await db.update(shopRecipes)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(shopRecipes.id, id))
      .returning();
    return recipe;
  }

  async deleteShopRecipe(id: number): Promise<void> {
    await db.delete(shopRecipes).where(eq(shopRecipes.id, id));
  }

  // Shop order checks
  async getShopOrderChecks(limit: number): Promise<ShopOrderCheck[]> {
    return db.select().from(shopOrderChecks).orderBy(desc(shopOrderChecks.checkedAt)).limit(limit);
  }

  async getShopOrderChecksByDomain(domain: string, limit: number): Promise<ShopOrderCheck[]> {
    return db.select().from(shopOrderChecks)
      .where(eq(shopOrderChecks.shopDomain, domain))
      .orderBy(desc(shopOrderChecks.checkedAt))
      .limit(limit);
  }

  async getLatestChecksByCrmOrderIds(crmOrderIds: string[]): Promise<ShopOrderCheck[]> {
    if (crmOrderIds.length === 0) return [];
    // Get the latest check for each crmOrderId using a subquery for max(id)
    const latestIds = db
      .select({
        maxId: sql<number>`max(${shopOrderChecks.id})`.as("max_id"),
      })
      .from(shopOrderChecks)
      .where(inArray(shopOrderChecks.crmOrderId, crmOrderIds))
      .groupBy(shopOrderChecks.crmOrderId)
      .as("latest");

    return db
      .select()
      .from(shopOrderChecks)
      .innerJoin(latestIds, eq(shopOrderChecks.id, latestIds.maxId))
      .then(rows => rows.map(r => r.shop_order_checks));
  }

  /** Returns latest ЛК check + latest email check per order (up to 2 rows per crmOrderId) */
  async getLatestChecksByTypeByCrmOrderIds(crmOrderIds: string[]): Promise<ShopOrderCheck[]> {
    if (crmOrderIds.length === 0) return [];
    // Get latest check per crmOrderId (simply the most recent one)
    // The caller (routes.ts) handles email vs lk classification via stepsLog
    const latestIds = db
      .select({
        maxId: sql<number>`max(${shopOrderChecks.id})`.as("max_id"),
      })
      .from(shopOrderChecks)
      .where(inArray(shopOrderChecks.crmOrderId, crmOrderIds))
      .groupBy(shopOrderChecks.crmOrderId)
      .as("latest");

    return db
      .select()
      .from(shopOrderChecks)
      .innerJoin(latestIds, eq(shopOrderChecks.id, latestIds.maxId))
      .then(rows => rows.map(r => r.shop_order_checks));
  }

  async getLatestTrackingForOrders(shopOrderIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (shopOrderIds.length === 0) return map;

    // Find latest non-null tracking for each shop order ID
    const rows = await db
      .select({
        shopOrderId: shopOrderChecks.shopOrderId,
        trackingNumber: shopOrderChecks.trackingNumber,
      })
      .from(shopOrderChecks)
      .where(
        and(
          inArray(shopOrderChecks.shopOrderId, shopOrderIds),
          isNotNull(shopOrderChecks.trackingNumber),
        ),
      )
      .orderBy(desc(shopOrderChecks.id));

    // Keep only the latest tracking for each order
    for (const row of rows) {
      if (row.shopOrderId && row.trackingNumber && !map.has(row.shopOrderId)) {
        map.set(row.shopOrderId, row.trackingNumber);
      }
    }

    return map;
  }

  async createShopOrderCheck(data: InsertShopOrderCheck): Promise<ShopOrderCheck> {
    const [check] = await db.insert(shopOrderChecks).values(data).returning();
    return check;
  }

  // Shop credentials
  async getShopCredentials(): Promise<ShopCredential[]> {
    return db.select().from(shopCredentials).orderBy(shopCredentials.domain);
  }

  async getShopCredential(id: number): Promise<ShopCredential | undefined> {
    const [cred] = await db.select().from(shopCredentials).where(eq(shopCredentials.id, id));
    return cred;
  }

  async getShopCredentialsByDomain(domain: string): Promise<ShopCredential[]> {
    return db.select().from(shopCredentials).where(eq(shopCredentials.domain, domain));
  }

  async createShopCredential(data: InsertShopCredential): Promise<ShopCredential> {
    const [cred] = await db.insert(shopCredentials).values(data).returning();
    return cred;
  }

  async updateShopCredential(id: number, data: Partial<ShopCredential>): Promise<ShopCredential | undefined> {
    const [cred] = await db.update(shopCredentials)
      .set(data)
      .where(eq(shopCredentials.id, id))
      .returning();
    return cred;
  }

  async deleteShopCredential(id: number): Promise<void> {
    await db.delete(shopCredentials).where(eq(shopCredentials.id, id));
  }

  // Shop check methods
  async getShopCheckMethods(): Promise<ShopCheckMethod[]> {
    return db.select().from(shopCheckMethods).orderBy(shopCheckMethods.shopName);
  }

  async upsertShopCheckMethod(shopName: string, checkMethod: string): Promise<ShopCheckMethod> {
    const [result] = await db
      .insert(shopCheckMethods)
      .values({ shopName, checkMethod })
      .onConflictDoUpdate({
        target: shopCheckMethods.shopName,
        set: { checkMethod, updatedAt: sql`CURRENT_TIMESTAMP` },
      })
      .returning();
    return result;
  }

  // Shop profiles
  async getShopProfiles(): Promise<ShopProfile[]> {
    return db.select().from(shopProfiles).orderBy(shopProfiles.domain);
  }

  async upsertShopProfile(domain: string, data: Partial<ShopProfile>): Promise<ShopProfile> {
    const [result] = await db
      .insert(shopProfiles)
      .values({ domain, ...data } as any)
      .onConflictDoUpdate({
        target: shopProfiles.domain,
        set: { ...data, updatedAt: sql`CURRENT_TIMESTAMP` },
      })
      .returning();
    return result;
  }

  async deleteShopProfile(domain: string): Promise<void> {
    await db.delete(shopProfiles).where(eq(shopProfiles.domain, domain));
    await db.delete(shopInstructions).where(eq(shopInstructions.domain, domain));
  }

  async getShopsWithCrmExport(): Promise<string[]> {
    const rows = await db.select({ domain: shopProfiles.domain })
      .from(shopProfiles)
      .where(eq(shopProfiles.crmExport, true));
    return rows.map(r => r.domain);
  }

  // Shop instructions
  async getShopInstructions(): Promise<ShopInstruction[]> {
    return db.select().from(shopInstructions).orderBy(shopInstructions.domain);
  }

  async getShopInstruction(domain: string): Promise<ShopInstruction | undefined> {
    const [row] = await db.select().from(shopInstructions).where(eq(shopInstructions.domain, domain));
    return row;
  }

  async upsertShopInstruction(domain: string, data: Partial<ShopInstruction>): Promise<ShopInstruction> {
    const [result] = await db
      .insert(shopInstructions)
      .values({ domain, ...data } as any)
      .onConflictDoUpdate({
        target: shopInstructions.domain,
        set: { ...data, updatedAt: sql`CURRENT_TIMESTAMP` },
      })
      .returning();
    return result;
  }

  // Tracking store settings
  async getTrackingStoreSettings(): Promise<TrackingStoreSetting[]> {
    return db.select().from(trackingStoreSettings).orderBy(trackingStoreSettings.siteName);
  }

  async upsertTrackingStoreSettings(settings: { siteCode: string; siteName?: string | null; groupName: string; enabled: boolean }[]): Promise<void> {
    if (settings.length === 0) return;
    for (const s of settings) {
      await db
        .insert(trackingStoreSettings)
        .values({
          siteCode: s.siteCode,
          siteName: s.siteName || null,
          groupName: s.groupName,
          enabled: s.enabled,
        })
        .onConflictDoUpdate({
          target: trackingStoreSettings.siteCode,
          set: {
            siteName: s.siteName || sql`tracking_store_settings.site_name`,
            groupName: s.groupName,
            enabled: s.enabled,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        });
    }
  }

  // Delivery type settings
  async getDeliveryTypeSettings(): Promise<DeliveryTypeSetting[]> {
    return db.select().from(deliveryTypeSettings).orderBy(deliveryTypeSettings.deliveryCode);
  }

  async upsertDeliveryTypeSettings(settings: { deliveryCode: string; groupName: string }[]): Promise<void> {
    if (settings.length === 0) return;
    for (const s of settings) {
      await db
        .insert(deliveryTypeSettings)
        .values({ deliveryCode: s.deliveryCode, groupName: s.groupName })
        .onConflictDoUpdate({
          target: deliveryTypeSettings.deliveryCode,
          set: { groupName: s.groupName, updatedAt: sql`CURRENT_TIMESTAMP` },
        });
    }
  }

  // Task prompts
  async getTaskPrompts(): Promise<TaskPrompt[]> {
    return db.select().from(taskPrompts).orderBy(taskPrompts.taskType);
  }

  async upsertTaskPrompt(taskType: string, promptTemplate: string): Promise<TaskPrompt> {
    const [result] = await db
      .insert(taskPrompts)
      .values({ taskType, promptTemplate } as any)
      .onConflictDoUpdate({
        target: taskPrompts.taskType,
        set: { promptTemplate, updatedAt: sql`CURRENT_TIMESTAMP` },
      })
      .returning();
    return result;
  }

  // Recipe knowledge
  async getRecipeKnowledge(): Promise<RecipeKnowledge[]> {
    return db.select().from(recipeKnowledge).orderBy(recipeKnowledge.category, recipeKnowledge.topic);
  }

  async createRecipeKnowledge(data: { category: string; topic: string; content: string; examples?: any; tags?: string[] }): Promise<RecipeKnowledge> {
    const [result] = await db
      .insert(recipeKnowledge)
      .values(data as any)
      .returning();
    return result;
  }

  async updateRecipeKnowledge(id: number, data: { category?: string; topic?: string; content?: string; examples?: any; tags?: string[] }): Promise<RecipeKnowledge> {
    const [result] = await db
      .update(recipeKnowledge)
      .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(recipeKnowledge.id, id))
      .returning();
    return result;
  }

  async deleteRecipeKnowledge(id: number): Promise<void> {
    await db.delete(recipeKnowledge).where(eq(recipeKnowledge.id, id));
  }
}

export const storage = new DatabaseStorage();
