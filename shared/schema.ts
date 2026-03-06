import { sql, relations } from "drizzle-orm";
import { pgTable, text, integer, serial, timestamp, boolean, jsonb, real, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Export auth models (users, sessions)
export * from "./models/auth";

// Tools (Integrations) table
export const tools = pgTable("tools", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon").default("wrench"),
  type: text("type").default("api"), // 'api' | 'webhook' | 'internal'
  config: jsonb("config").default({}),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertToolSchema = createInsertSchema(tools).omit({
  id: true,
  createdAt: true,
});

export type Tool = typeof tools.$inferSelect;
export type InsertTool = z.infer<typeof insertToolSchema>;

// Email accounts for FastMail integration
export const emailAccounts = pgTable("email_accounts", {
  id: serial("id").primaryKey(),
  toolId: integer("tool_id").references(() => tools.id, { onDelete: "cascade" }).notNull(),
  email: text("email").notNull(),
  secretKey: text("secret_key").notNull(), // Name of the secret in environment
  displayName: text("display_name"),
  status: text("status").default("pending"), // 'pending' | 'connected' | 'error'
  lastError: text("last_error"),
  accountId: text("account_id"), // FastMail account ID from JMAP session
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const emailAccountsRelations = relations(emailAccounts, ({ one }) => ({
  tool: one(tools, {
    fields: [emailAccounts.toolId],
    references: [tools.id],
  }),
}));

export const insertEmailAccountSchema = createInsertSchema(emailAccounts).omit({
  id: true,
  createdAt: true,
  status: true,
  lastError: true,
  accountId: true,
  secretKey: true,
});

export type EmailAccount = typeof emailAccounts.$inferSelect;
export type InsertEmailAccount = z.infer<typeof insertEmailAccountSchema>;

// RetailCRM accounts for CRM integration
export const retailcrmAccounts = pgTable("retailcrm_accounts", {
  id: serial("id").primaryKey(),
  toolId: integer("tool_id").references(() => tools.id, { onDelete: "cascade" }).notNull(),
  displayName: text("display_name").notNull(),
  subdomain: text("subdomain").notNull(), // e.g. "myshop" for myshop.retailcrm.pro
  secretKey: text("secret_key").notNull(), // Name of the secret in environment (API key)
  status: text("status").default("pending"), // 'pending' | 'connected' | 'error'
  lastError: text("last_error"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const retailcrmAccountsRelations = relations(retailcrmAccounts, ({ one }) => ({
  tool: one(tools, {
    fields: [retailcrmAccounts.toolId],
    references: [tools.id],
  }),
}));

export const insertRetailcrmAccountSchema = createInsertSchema(retailcrmAccounts).omit({
  id: true,
  createdAt: true,
  status: true,
  lastError: true,
  secretKey: true,
});

export type RetailcrmAccount = typeof retailcrmAccounts.$inferSelect;
export type InsertRetailcrmAccount = z.infer<typeof insertRetailcrmAccountSchema>;

// Tracking numbers extracted from emails
export const tracks = pgTable("tracks", {
  id: serial("id").primaryKey(),
  emailId: text("email_id").notNull(), // FastMail message ID
  emailAccountId: integer("email_account_id").references(() => emailAccounts.id, { onDelete: "cascade" }),
  sender: text("sender").notNull(), // From email/name (store/company)
  senderEmail: text("sender_email"),
  subject: text("subject"),
  orderId: text("order_id"), // Order number if found
  trackingNumber: text("tracking_number").notNull(),
  carrier: text("carrier").notNull(), // 'dhl' | 'ups' | 'fedex' | 'dpd' | 'unknown'
  carrierStatus: text("carrier_status"), // Status from carrier API
  carrierStatusDetails: text("carrier_status_details"),
  emailDate: timestamp("email_date"),
  lastChecked: timestamp("last_checked"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const tracksRelations = relations(tracks, ({ one }) => ({
  emailAccount: one(emailAccounts, {
    fields: [tracks.emailAccountId],
    references: [emailAccounts.id],
  }),
}));

export const insertTrackSchema = createInsertSchema(tracks).omit({
  id: true,
  createdAt: true,
});

export type Track = typeof tracks.$inferSelect;
export type InsertTrack = z.infer<typeof insertTrackSchema>;

export const retailcrmOrdersCache = pgTable("retailcrm_orders_cache", {
  id: serial("id").primaryKey(),
  orderId: text("order_id").notNull().unique(),
  createdDate: text("created_date").notNull(),
  status: text("status").notNull(),
  site: text("site"),
  totalSum: real("total_sum").default(0),
  payload: jsonb("payload").notNull(),
  cachedAt: timestamp("cached_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type RetailcrmOrderCache = typeof retailcrmOrdersCache.$inferSelect;

export const currencyRates = pgTable("currency_rates", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  currencyCode: text("currency_code").notNull(),
  rate: real("rate").notNull(),
}, (table) => [
  uniqueIndex("currency_rates_date_code_idx").on(table.date, table.currencyCode),
]);

export type CurrencyRate = typeof currencyRates.$inferSelect;

export const cacheSyncLog = pgTable("cache_sync_log", {
  id: serial("id").primaryKey(),
  syncDate: text("sync_date").notNull().unique(),
  ordersCount: integer("orders_count").default(0),
  syncedAt: timestamp("synced_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type CacheSyncLogEntry = typeof cacheSyncLog.$inferSelect;

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;

export const deParcelStatuses = pgTable("de_parcel_statuses", {
  id: serial("id").primaryKey(),
  trackingNumber: text("tracking_number").notNull().unique(),
  carrier: text("carrier"),
  status: text("status").notNull(),
  subStatus: text("sub_status"),
  lastEvent: text("last_event"),
  lastLocation: text("last_location"),
  lastUpdate: text("last_update"),
  firstEventDate: text("first_event_date"),
  lastEventDate: text("last_event_date"),
  checkedAt: timestamp("checked_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type DeParcelStatus = typeof deParcelStatuses.$inferSelect;

// Shop recipes — saved automation recipes for shop order checking
export const shopRecipes = pgTable("shop_recipes", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  loginType: text("login_type").notNull(), // "email_password" | "order_lookup" | "guest_tracking" | "email_parsing"
  recipeJson: jsonb("recipe_json").notNull(), // full recipe (steps, selectors, mapping)
  successCount: integer("success_count").default(0),
  failCount: integer("fail_count").default(0),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("shop_recipes_domain_login_type_idx").on(table.domain, table.loginType),
]);

export const insertShopRecipeSchema = createInsertSchema(shopRecipes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  successCount: true,
  failCount: true,
  lastUsedAt: true,
});

export type ShopRecipe = typeof shopRecipes.$inferSelect;
export type InsertShopRecipe = z.infer<typeof insertShopRecipeSchema>;

// Shop order checks — log of all order status checks
export const shopOrderChecks = pgTable("shop_order_checks", {
  id: serial("id").primaryKey(),
  crmOrderId: text("crm_order_id").notNull(),
  shopDomain: text("shop_domain").notNull(),
  shopOrderId: text("shop_order_id"),
  previousStatus: text("previous_status"),
  newStatus: text("new_status"), // "pending" | "shipped" | "cancelled" | "delivered" | "returned"
  trackingNumber: text("tracking_number"),
  referenceNumber: text("reference_number"),
  estimatedDeliveryDate: text("estimated_delivery_date"),
  checkResult: text("check_result").notNull(), // "success" | "login_failed" | "not_found" | "review_needed" | "error"
  errorMessage: text("error_message"),
  stepsLog: text("steps_log"),
  screenshotPath: text("screenshot_path"),
  durationMs: integer("duration_ms"),
  aiTokensUsed: integer("ai_tokens_used").default(0),
  recipeUsed: boolean("recipe_used").default(false),
  checkedAt: timestamp("checked_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertShopOrderCheckSchema = createInsertSchema(shopOrderChecks).omit({
  id: true,
  checkedAt: true,
});

export type ShopOrderCheck = typeof shopOrderChecks.$inferSelect;
export type InsertShopOrderCheck = z.infer<typeof insertShopOrderCheckSchema>;

// Shop credentials — encrypted login credentials for shops
export const shopCredentials = pgTable("shop_credentials", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  email: text("email").notNull(),
  encryptedPassword: text("encrypted_password").notNull(), // AES-256-GCM encrypted
  loginUrl: text("login_url"),
  notes: text("notes"),
  legalEntity: text("legal_entity"), // "Newmen" | "Vatebo"
  status: text("status").default("active"), // "active" | "login_failed" | "disabled"
  lastLoginAt: timestamp("last_login_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("shop_credentials_domain_email_idx").on(table.domain, table.email),
]);

export const insertShopCredentialSchema = createInsertSchema(shopCredentials).omit({
  id: true,
  createdAt: true,
  status: true,
  lastLoginAt: true,
});

export type ShopCredential = typeof shopCredentials.$inferSelect;
export type InsertShopCredential = z.infer<typeof insertShopCredentialSchema>;

// Shop check methods — per-shop setting: check via ЛК (browser) or email
export const shopCheckMethods = pgTable("shop_check_methods", {
  id: serial("id").primaryKey(),
  shopName: text("shop_name").notNull().unique(),
  checkMethod: text("check_method").notNull().default("email"), // "lk" | "email"
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type ShopCheckMethod = typeof shopCheckMethods.$inferSelect;

// Shop profiles — per-shop settings (replaces shop_check_methods)
export const shopProfiles = pgTable("shop_profiles", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  checkMethod: text("check_method").notNull().default("email"), // "lk" | "email" | "email_lk" | "other"
  crmExport: boolean("crm_export").notNull().default(false),
  noteText: text("note_text"),
  noteAuthor: text("note_author"),
  notedAt: timestamp("noted_at"),
  noteStatus: text("note_status"), // 'open' | 'resolved' | null
  noteResolution: text("note_resolution"),
  noteResolvedBy: text("note_resolved_by"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type ShopProfile = typeof shopProfiles.$inferSelect;

// Shop instructions — reference for creating email recipes
export const shopInstructions = pgTable("shop_instructions", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  mailProvider: text("mail_provider"), // "proton" | "fastmail"
  senderEmail: text("sender_email"),
  subjectPattern: text("subject_pattern"),
  hasOrderId: boolean("has_order_id").notNull().default(false),
  orderIdPhrase: text("order_id_phrase"),
  trackingPhrase: text("tracking_phrase"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type ShopInstruction = typeof shopInstructions.$inferSelect;

// Sync history for background CRM synchronization
export const syncHistory = pgTable("sync_history", {
  id: serial("id").primaryKey(),
  jobType: text("job_type").notNull(),        // "night" | "day" | "manual"
  dateFrom: text("date_from").notNull(),
  dateTo: text("date_to").notNull(),
  status: text("status").notNull(),            // "syncing" | "done" | "error" | "cancelled"
  ordersCount: integer("orders_count").default(0),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at").notNull(),
  completedAt: timestamp("completed_at"),
  triggeredBy: text("triggered_by"),
});

export type SyncHistoryEntry = typeof syncHistory.$inferSelect;

// Tracking store settings — per-store config for DE parcel tracking page
export const trackingStoreSettings = pgTable("tracking_store_settings", {
  id: serial("id").primaryKey(),
  siteCode: text("site_code").notNull().unique(),
  siteName: text("site_name"),
  groupName: text("group_name").default("europe").notNull(), // 'europe' | 'china'
  enabled: boolean("enabled").default(true).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type TrackingStoreSetting = typeof trackingStoreSettings.$inferSelect;

// Delivery type settings — map CRM delivery.code to delivery type groups (ls/shopogolic/china)
export const deliveryTypeSettings = pgTable("delivery_type_settings", {
  id: serial("id").primaryKey(),
  deliveryCode: text("delivery_code").notNull().unique(),
  groupName: text("group_name").default("ls").notNull(), // 'ls' | 'shopogolic' | 'china'
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type DeliveryTypeSetting = typeof deliveryTypeSettings.$inferSelect;

// Recipe knowledge — accumulated knowledge base for autonomous recipe creation
export const recipeKnowledge = pgTable("recipe_knowledge", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 'sender_pattern', 'extraction', 'gotcha', 'email_type', 'carrier', 'lk_login', 'workflow'
  topic: text("topic").notNull(),
  content: text("content").notNull(),
  examples: jsonb("examples"), // JSON with concrete examples
  tags: text("tags").array(), // For search: ['tracking', 'dpd', 'regex']
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type RecipeKnowledge = typeof recipeKnowledge.$inferSelect;

// Task prompts — templates for autonomous task processing
export const taskPrompts = pgTable("task_prompts", {
  id: serial("id").primaryKey(),
  taskType: text("task_type").notNull().unique(), // 'email_recipe', 'lk_setup', 'general'
  promptTemplate: text("prompt_template").notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export type TaskPrompt = typeof taskPrompts.$inferSelect;
