import type { Express } from "express";
import { type Server } from "http";
import { storage } from "./storage";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { insertToolSchema, shopOrderChecks } from "@shared/schema";
import { db } from "./db";
import { sql, inArray } from "drizzle-orm";
import * as retailcrmService from "./retailcrm-service";
import * as backgroundSync from "./background-sync";
import * as track17Service from "./track17-service";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./replit_integrations/auth";

async function verifyFastMailConnection(apiToken: string): Promise<{ success: boolean; accountId?: string; email?: string; error?: string }> {
  try {
    const response = await fetch("https://api.fastmail.com/jmap/session", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      if (response.status === 401) {
        return { success: false, error: "Неверный API-токен" };
      }
      return { success: false, error: `Ошибка подключения: ${response.status}` };
    }

    const session = await response.json();
    const accountId = Object.keys(session.accounts || {})[0];
    const account = session.accounts?.[accountId];
    
    return {
      success: true,
      accountId,
      email: account?.name || session.username,
    };
  } catch (error) {
    return { success: false, error: "Не удалось подключиться к FastMail" };
  }
}

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY || process.env.OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

const geminiBaseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
const geminiApiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.AI_INTEGRATIONS_GEMINI_API_KEY || "";
const gemini = geminiApiKey ? new GoogleGenAI({
  apiKey: geminiApiKey,
  ...(geminiBaseUrl ? { httpOptions: { baseUrl: geminiBaseUrl, apiVersion: "" } } : {}),
}) : null;

function getProviderFromModel(model: string): "openai" | "anthropic" | "gemini" {
  if (model.startsWith("gpt")) return "openai";
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gemini")) return "gemini";
  return "openai";
}

function mapModelName(model: string): string {
  const modelMap: Record<string, string> = {
    "gpt-5.2": "gpt-4o",
    "gpt-5.1": "gpt-4o-mini",
    "gpt-5-mini": "gpt-4-turbo",
    "claude-opus-4-5": "claude-sonnet-4-20250514",
    "claude-sonnet-4-5": "claude-sonnet-4-20250514",
    "claude-haiku-4-5": "claude-sonnet-4-20250514",
    "gemini-2.5-pro": "gemini-2.5-pro",
    "gemini-2.5-flash": "gemini-2.5-flash",
    "gemini-2.5-flash-lite": "gemini-2.5-flash-lite",
    "gemini-3.1-pro-preview": "gemini-3.1-pro-preview",
    "gemini-3.1-flash-lite-preview": "gemini-3.1-flash-lite-preview",
  };
  return modelMap[model] || model;
}

const EXCLUDED_STORE_PREFIXES = ["ip-shatskaia-"];
const EXCLUDED_STORES_EXACT = new Set(["darkstore-dubli-zakazov"]);
function isExcludedStore(site: string): boolean {
  if (EXCLUDED_STORES_EXACT.has(site)) return true;
  for (const prefix of EXCLUDED_STORE_PREFIXES) {
    if (site.startsWith(prefix)) return true;
  }
  return false;
}
export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Setup authentication (MUST be before other routes)
  await setupAuth(app);
  registerAuthRoutes(app);

  // Global authentication middleware for all /api routes
  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/auth")) {
      return next();
    }
    isAuthenticated(req, res, next);
  });

  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS delivery_type_settings (
        id SERIAL PRIMARY KEY,
        delivery_code TEXT NOT NULL UNIQUE,
        group_name TEXT NOT NULL DEFAULT 'ls',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )
    `);
    // Seed defaults if empty
    const existing = await storage.getDeliveryTypeSettings();
    if (existing.length === 0) {
      await storage.upsertDeliveryTypeSettings([
        { deliveryCode: "ems", groupName: "ls" },
        { deliveryCode: "ems-pochta", groupName: "ls" },
        { deliveryCode: "sklad-berlin", groupName: "ls" },
        { deliveryCode: "pochta-rossii-registered-mail-parcel", groupName: "ls" },
        { deliveryCode: "shopogolik-ems-de", groupName: "shopogolic" },
        { deliveryCode: "shopogolik-post-de", groupName: "shopogolic" },
      ]);
    }
  } catch (e) { /* table already exists */ }
  // ===== User Management Routes (Admin only) =====
  
  // Get all users (admin only)
  app.get("/api/users", async (req, res) => {
    try {
      const email = (req.user as any).email || (req.user as any).claims?.email;
      const currentUser = await storage.getUserByEmail(email);
      if (!currentUser?.isAdmin) {
        return res.status(403).json({ error: "Доступ запрещён" });
      }
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      res.status(500).json({ error: "Не удалось получить список пользователей" });
    }
  });

  // Update user permissions (admin only)
  app.patch("/api/users/:id", async (req, res) => {
    try {
      const email = (req.user as any).email || (req.user as any).claims?.email;
      const currentUser = await storage.getUserByEmail(email);
      if (!currentUser?.isAdmin) {
        return res.status(403).json({ error: "Доступ запрещён" });
      }
      const { isApproved, allowedSections, isAdmin } = req.body;
      const updateData: any = {};
      if (typeof isApproved === "boolean") updateData.isApproved = isApproved;
      if (Array.isArray(allowedSections)) updateData.allowedSections = allowedSections;
      if (typeof isAdmin === "boolean") updateData.isAdmin = isAdmin;
      
      const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      const user = await storage.updateUser(userId, updateData);
      if (!user) {
        return res.status(404).json({ error: "Пользователь не найден" });
      }
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: "Не удалось обновить пользователя" });
    }
  });

  // Delete user (admin only)
  app.delete("/api/users/:id", async (req, res) => {
    try {
      const email = (req.user as any).email || (req.user as any).claims?.email;
      const currentUser = await storage.getUserByEmail(email);
      if (!currentUser?.isAdmin) {
        return res.status(403).json({ error: "Доступ запрещён" });
      }
      // Prevent self-deletion
      const deleteUserId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (currentUser.id === deleteUserId) {
        return res.status(400).json({ error: "Нельзя удалить самого себя" });
      }
      await storage.deleteUser(deleteUserId);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Не удалось удалить пользователя" });
    }
  });
  


  app.get("/api/tools", async (_req, res) => {
    try {
      const tools = await storage.getTools();
      res.json(tools);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tools" });
    }
  });

  app.get("/api/tools/:id", async (req, res) => {
    try {
      const tool = await storage.getTool(Number(req.params.id));
      if (!tool) {
        return res.status(404).json({ error: "Tool not found" });
      }
      res.json(tool);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tool" });
    }
  });

  app.post("/api/tools", async (req, res) => {
    try {
      const parsed = insertToolSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.message });
      }
      const tool = await storage.createTool(parsed.data);
      res.status(201).json(tool);
    } catch (error) {
      res.status(500).json({ error: "Failed to create tool" });
    }
  });

  app.patch("/api/tools/:id", async (req, res) => {
    try {
      const tool = await storage.updateTool(Number(req.params.id), req.body);
      if (!tool) {
        return res.status(404).json({ error: "Tool not found" });
      }
      res.json(tool);
    } catch (error) {
      res.status(500).json({ error: "Failed to update tool" });
    }
  });

  app.delete("/api/tools/:id", async (req, res) => {
    try {
      await storage.deleteTool(Number(req.params.id));
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete tool" });
    }
  });
  app.get("/api/tools/:id/email-accounts", async (req, res) => {
    try {
      const accounts = await storage.getEmailAccounts(Number(req.params.id));
      const safeAccounts = accounts.map((account) => ({
        ...account,
        hasSecret: !!process.env[account.secretKey],
      }));
      res.json(safeAccounts);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch email accounts" });
    }
  });

  app.post("/api/tools/:id/email-accounts", async (req, res) => {
    try {
      const toolId = Number(req.params.id);
      const { email, displayName } = req.body;
      
      if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "Email is required" });
      }

      // Generate unique secret key name
      const timestamp = Date.now();
      const secretKey = `FASTMAIL_TOKEN_${timestamp}`;
      
      const account = await storage.createEmailAccount({
        toolId,
        email,
        displayName: displayName || email,
        secretKey,
      });

      res.status(201).json({ 
        ...account, 
        hasSecret: false,
        secretKeyRequired: secretKey,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to create email account" });
    }
  });

  app.post("/api/email-accounts/:id/verify", async (req, res) => {
    try {
      const account = await storage.getEmailAccount(Number(req.params.id));
      if (!account) {
        return res.status(404).json({ error: "Email account not found" });
      }

      const apiToken = process.env[account.secretKey];
      if (!apiToken) {
        return res.status(400).json({ 
          error: `Секрет ${account.secretKey} не найден. Добавьте его в настройках секретов.`,
          secretKeyRequired: account.secretKey,
        });
      }

      const verification = await verifyFastMailConnection(apiToken);
      
      const updated = await storage.updateEmailAccount(account.id, {
        status: verification.success ? "connected" : "error",
        lastError: verification.error || null,
        accountId: verification.accountId || null,
      });

      res.json({ ...updated, hasSecret: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to verify email account" });
    }
  });

  app.delete("/api/email-accounts/:id", async (req, res) => {
    try {
      await storage.deleteEmailAccount(Number(req.params.id));
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete email account" });
    }
  });
  app.get("/api/tools/:id/retailcrm-accounts", async (req, res) => {
    try {
      const accounts = await storage.getRetailcrmAccounts(Number(req.params.id));
      // Use global RETAILCRM_API_KEY for all accounts
      const hasSecret = !!process.env.RETAILCRM_API_KEY;
      const accountsWithSecretStatus = accounts.map(acc => ({
        ...acc,
        hasSecret,
        secretKey: "RETAILCRM_API_KEY",
      }));
      res.json(accountsWithSecretStatus);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch retailcrm accounts" });
    }
  });

  app.post("/api/tools/:id/retailcrm-accounts", async (req, res) => {
    try {
      const { displayName, subdomain } = req.body;
      if (!displayName || !subdomain) {
        return res.status(400).json({ error: "Display name and subdomain are required" });
      }
      // Use global RETAILCRM_API_KEY for all accounts
      const secretKey = "RETAILCRM_API_KEY";
      const hasSecret = !!process.env.RETAILCRM_API_KEY;
      const account = await storage.createRetailcrmAccount({
        toolId: Number(req.params.id),
        displayName,
        subdomain,
        secretKey,
      });
      res.status(201).json({ 
        ...account, 
        hasSecret,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to create retailcrm account" });
    }
  });

  app.post("/api/retailcrm-accounts/:id/verify", async (req, res) => {
    try {
      const account = await storage.getRetailcrmAccount(Number(req.params.id));
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      
      // Use global RETAILCRM_API_KEY for all accounts
      const apiKey = process.env.RETAILCRM_API_KEY;
      if (!apiKey) {
        const updated = await storage.updateRetailcrmAccount(account.id, {
          status: "error",
          lastError: "Секрет RETAILCRM_API_KEY не найден в окружении",
        });
        return res.json({ ...updated, hasSecret: false });
      }
      
      // Verify RetailCRM API connection
      const result = await retailcrmService.verifyConnection({
        subdomain: account.subdomain,
        apiKey,
      });
      
      if (result.success) {
        const updated = await storage.updateRetailcrmAccount(account.id, {
          status: "connected",
          lastError: null,
        });
        res.json({ ...updated, hasSecret: true });
      } else {
        const updated = await storage.updateRetailcrmAccount(account.id, {
          status: "error",
          lastError: result.error || "Connection failed",
        });
        res.json({ ...updated, hasSecret: true });
      }
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to verify retailcrm account" });
    }
  });

  app.delete("/api/retailcrm-accounts/:id", async (req, res) => {
    try {
      await storage.deleteRetailcrmAccount(Number(req.params.id));
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete retailcrm account" });
    }
  });

  app.patch("/api/retailcrm-accounts/:id", async (req, res) => {
    try {
      const { displayName, subdomain } = req.body;
      const account = await storage.updateRetailcrmAccount(Number(req.params.id), { 
        displayName: displayName || undefined,
        subdomain: subdomain || undefined,
      });
      if (!account) {
        return res.status(404).json({ error: "RetailCRM account not found" });
      }
      res.json(account);
    } catch (error) {
      res.status(500).json({ error: "Failed to update retailcrm account" });
    }
  });
  app.get("/api/retailcrm/:accountId/orders", async (req, res) => {
    try {
      const account = await storage.getRetailcrmAccount(Number(req.params.accountId));
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      const apiKey = process.env[account.secretKey];
      if (!apiKey) {
        return res.status(400).json({ error: "API key not configured" });
      }
      
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      
      const data = await retailcrmService.getOrders(
        { subdomain: account.subdomain, apiKey },
        {},
        page,
        limit
      );
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get orders" });
    }
  });

  app.get("/api/retailcrm/:accountId/customers", async (req, res) => {
    try {
      const account = await storage.getRetailcrmAccount(Number(req.params.accountId));
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      const apiKey = process.env[account.secretKey];
      if (!apiKey) {
        return res.status(400).json({ error: "API key not configured" });
      }
      
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      
      const data = await retailcrmService.getCustomers(
        { subdomain: account.subdomain, apiKey },
        {},
        page,
        limit
      );
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get customers" });
    }
  });

  app.get("/api/retailcrm/:accountId/products", async (req, res) => {
    try {
      const account = await storage.getRetailcrmAccount(Number(req.params.accountId));
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      const apiKey = process.env[account.secretKey];
      if (!apiKey) {
        return res.status(400).json({ error: "API key not configured" });
      }
      
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      
      const data = await retailcrmService.getProducts(
        { subdomain: account.subdomain, apiKey },
        {},
        page,
        limit
      );
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get products" });
    }
  });

  app.get("/api/retailcrm/:accountId/statistics", async (req, res) => {
    try {
      const account = await storage.getRetailcrmAccount(Number(req.params.accountId));
      if (!account) {
        return res.status(404).json({ error: "Account not found" });
      }
      const apiKey = process.env[account.secretKey];
      if (!apiKey) {
        return res.status(400).json({ error: "API key not configured" });
      }
      
      const data = await retailcrmService.getStatistics(
        { subdomain: account.subdomain, apiKey }
      );
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get statistics" });
    }
  });

  let whereOrdersCache: { data: any; timestamp: number } | null = null;

  app.get("/api/sync/status", (req, res) => {
    const jobId = req.query.jobId as string;
    if (jobId) {
      const job = backgroundSync.getJobStatus(jobId);
      if (!job) {
        return res.json({ status: "not_found" });
      }
      if (job.status === "done") {
        whereOrdersCache = null;
      }
      return res.json({
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        error: job.error || null,
      });
    }
    const active = backgroundSync.getActiveJobs();
    res.json({
      activeJobs: active.map(j => ({
        jobId: j.id,
        type: j.type,
        status: j.status,
        progress: j.progress,
      })),
    });
  });

  app.post("/api/sync/cancel", (req, res) => {
    const { jobId } = req.body;
    if (jobId) {
      const cancelled = backgroundSync.cancelJob(jobId);
      return res.json({ cancelled });
    }
    const count = backgroundSync.cancelAllJobs();
    res.json({ cancelledCount: count });
  });

  // Get RetailCRM statuses for debugging
  app.get("/api/retailcrm/statuses", async (req, res) => {
    try {
      const accounts = await storage.getRetailcrmAccounts(8);
      if (!accounts || accounts.length === 0) {
        return res.status(404).json({ error: "RetailCRM account not configured" });
      }
      const account = accounts[0];
      const apiKey = process.env[account.secretKey];
      if (!apiKey) {
        return res.status(400).json({ error: "API key not configured" });
      }
      const data = await retailcrmService.getStatuses({ subdomain: account.subdomain, apiKey });
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  // ===== PARCEL TRACKING DE→RU (Russian Post batch API) =====

  const LOGISTICS_SYNC_JOB_ID = "scheduled-crm-sync";

  (async () => {
    try {
      const accounts = await storage.getRetailcrmAccounts(8);
      if (accounts && accounts.length > 0) {
        const account = accounts[0];
        const apiKey = process.env[account.secretKey];
        if (apiKey) {
          backgroundSync.initScheduledSync({ subdomain: account.subdomain, apiKey });
        }
      }
      backgroundSync.initDeTrackingSchedule();
      // Clean up stale "syncing" records from previous server crash/restart
      backgroundSync.cleanupStaleSyncHistory();
    } catch (e) {
      console.error("Failed to init scheduled CRM sync:", e);
    }
  })();

  app.get("/api/sync/history", async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
      const rows = await storage.getSyncHistory(limit);
      const result = rows.map(r => ({
        ...r,
        duration: r.completedAt && r.startedAt
          ? Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)
          : null,
      }));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/logistics/refresh-cache", async (req, res) => {
    try {
      const existing = backgroundSync.getJobStatus(LOGISTICS_SYNC_JOB_ID);
      if (existing && existing.status === "syncing") {
        return res.json({ status: "in_progress", message: existing.progress?.message || "Синхронизация...", jobId: LOGISTICS_SYNC_JOB_ID });
      }

      const accounts = await storage.getRetailcrmAccounts(8);
      if (!accounts || accounts.length === 0) {
        return res.status(404).json({ error: "RetailCRM account not configured" });
      }
      const account = accounts[0];
      const apiKey = process.env[account.secretKey];
      if (!apiKey) {
        return res.status(400).json({ error: "API key not configured" });
      }
      const config = { subdomain: account.subdomain, apiKey };

      const syncDays = await backgroundSync.getSyncDays();
      const dateTo = new Date().toISOString().split("T")[0];
      const dateFrom = new Date(Date.now() - syncDays * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const triggeredBy = (req as any).user?.email || undefined;
      console.log(`Logistics refresh: unified cache sync ${dateFrom} → ${dateTo} (${syncDays} days, by ${triggeredBy || "system"})`);

      const jobId = backgroundSync.triggerAtomicRangeSync(config, dateFrom, dateTo, "manual", triggeredBy);

      whereOrdersCache = null;

      res.json({ status: "started", message: "Синхронизация...", jobId });
    } catch (error: any) {
      console.error("Logistics cache refresh error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/logistics/refresh-cache/status", async (_req, res) => {
    const job = backgroundSync.getJobStatus(LOGISTICS_SYNC_JOB_ID);
    const nextScheduled = backgroundSync.getNextScheduledRun();

    if (!job) {
      return res.json({ inProgress: false, message: "", nextScheduled });
    }
    const inProgress = job.status === "syncing";
    let message = job.progress?.message || "";
    if (job.status === "done") {
      message = "Готово!";
      whereOrdersCache = null;
    } else if (job.status === "error") {
      message = `Ошибка: ${job.error || "unknown"}`;
    } else if (job.status === "cancelled") {
      message = "Отменено";
    }
    res.json({ inProgress, message, nextScheduled });
  });

  app.post("/api/logistics/refresh-cache/cancel", async (_req, res) => {
    const cancelled = backgroundSync.cancelJob(LOGISTICS_SYNC_JOB_ID);
    res.json({ status: cancelled ? "cancelled" : "not_running" });
  });
  let crmExportDeInProgress = false;
  let crmExportDeStatus = "";
  let crmExportDeTotal = 0;
  let crmExportDeProcessed = 0;
  let crmExportDeErrors = 0;

  app.post("/api/logistics/export-statuses-to-crm-de", async (req, res) => {
    try {
      if (crmExportDeInProgress) {
        return res.json({ status: "in_progress", message: crmExportDeStatus });
      }

      const accounts = await storage.getRetailcrmAccounts(8);
      if (!accounts || accounts.length === 0) {
        return res.status(404).json({ error: "RetailCRM account not configured" });
      }
      const account = accounts[0];
      const apiKey = process.env[account.secretKey];
      if (!apiKey) {
        return res.status(400).json({ error: "API key not configured" });
      }
      const config = { subdomain: account.subdomain, apiKey };

      const parseTrackNumbers = (value: string | undefined | null): string[] => {
        if (!value || !value.trim()) return [];
        return value.split(/[,;]+/).map(s => s.trim().toUpperCase()).filter(s => s.length >= 5);
      };

      let allParcels: { orderId: number; trackingNumber: string; site?: string }[] = [];

      const statusesData = await retailcrmService.getStatuses(config);
      const allStatuses = statusesData.statuses || {};
      let targetCode: string | null = null;
      for (const s of Object.values(allStatuses) as any[]) {
        if (s.name === "Отправлен магазином") {
          targetCode = s.code;
          break;
        }
      }

      const orderTracksMap = new Map<number, { tracks: string[]; site?: string }>();

      if (targetCode) {
        const cachedRows = await storage.getCachedOrdersByStatuses([targetCode]);
        for (const row of cachedRows) {
          const order = row.payload as any;
          const warehouseTracks = parseTrackNumbers(order.customFields?.trek_nomer_cklada_otgruzki_nomer);
          const bulkTracks = parseTrackNumbers(order.customFields?.trek_nomer_sbornogo_vykupa);
          const tracks = Array.from(new Set([...warehouseTracks, ...bulkTracks]));
          if (tracks.length === 0) continue;
          const oid = typeof order.id === 'string' ? parseInt(order.id, 10) : order.id;
          orderTracksMap.set(oid, { tracks, site: order.site || undefined });
          for (const track of tracks) {
            allParcels.push({ orderId: oid, trackingNumber: track, site: order.site || undefined });
          }
        }
      }

      let selectedOrderIds: Set<number>;

      if (req.body?.exportAll) {
        selectedOrderIds = new Set(allParcels.map(p => p.orderId));
        console.log(`CRM DE export (all): ${selectedOrderIds.size} orders, ${allParcels.length} parcels`);
      } else {
        const rawItems: { orderId: number | string; trackingNumber: string; site?: string }[] = req.body?.items || [];
        selectedOrderIds = new Set(rawItems.map(item =>
          typeof item.orderId === 'string' ? parseInt(item.orderId, 10) : item.orderId
        ));
        console.log(`CRM DE export (selected): ${selectedOrderIds.size} orders from ${rawItems.length} selected items`);
      }

      const deStatuses = await storage.getDeParcelStatuses();
      const statusMap: Record<string, string> = {};
      const lastEventDateMap: Record<string, string> = {};
      for (const row of deStatuses) {
        if (row.status) {
          statusMap[row.trackingNumber] = row.status;
        }
        if (row.lastEventDate) {
          lastEventDateMap[row.trackingNumber] = row.lastEventDate;
        }
      }

      const ordersToExport: {
        orderId: number;
        site?: string;
        tracks: string[];
        isMultiTrack: boolean;
      }[] = [];

      for (const orderId of Array.from(selectedOrderIds)) {
        const orderData = orderTracksMap.get(orderId);
        if (!orderData) continue;
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
        const skipped = ordersToExport.length - exportableOrders.length;
        crmExportDeStatus = `Готово: нет данных для выгрузки${skipped > 0 ? ` (${skipped} без статуса)` : ""}`;
        return res.json({ status: "done", message: crmExportDeStatus, updated: 0, errors: 0 });
      }

      crmExportDeInProgress = true;
      crmExportDeTotal = exportableOrders.length;
      crmExportDeProcessed = 0;
      crmExportDeErrors = 0;
      crmExportDeStatus = `Выгрузка 0/${exportableOrders.length} заказов...`;

      res.json({ status: "started", message: crmExportDeStatus, total: exportableOrders.length });

      (async () => {
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

            const trackDates = order.tracks
              .map(t => lastEventDateMap[t])
              .filter(Boolean)
              .sort();
            if (trackDates.length > 0) {
              const latest = trackDates[trackDates.length - 1];
              const d = new Date(latest);
              if (!isNaN(d.getTime())) {
                fields.data_statusa_dostavki_so_sklada_otgruzki = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              }
            }

            await retailcrmService.editOrderCustomFields(config, order.orderId, fields, order.site || undefined);

            crmExportDeProcessed++;
          } catch (err: any) {
            console.error(`CRM DE export error for order ${order.orderId}:`, err.message);
            crmExportDeErrors++;
            crmExportDeProcessed++;
          }

          crmExportDeStatus = `Выгрузка ${crmExportDeProcessed}/${exportableOrders.length} заказов...`;
          if (crmExportDeProcessed < exportableOrders.length) {
            await new Promise(r => setTimeout(r, DELAY_MS));
          }
        }

        const successCount = crmExportDeProcessed - crmExportDeErrors;
        const skipped = ordersToExport.length - exportableOrders.length;
        crmExportDeStatus = `Готово: ${successCount} заказов обновлено, ${crmExportDeErrors} ошибок${skipped > 0 ? `, ${skipped} пропущено (нет статуса)` : ""} (из ${ordersToExport.length})`;
        console.log(`CRM DE export done: ${successCount} orders updated, ${crmExportDeErrors} errors, ${skipped} skipped`);
        crmExportDeInProgress = false;
      })();
    } catch (error: any) {
      crmExportDeInProgress = false;
      console.error("CRM DE export error:", error);
      res.status(500).json({ error: error.message || "Failed to start CRM DE export" });
    }
  });

  app.get("/api/logistics/export-statuses-to-crm-de/status", async (_req, res) => {
    res.json({
      inProgress: crmExportDeInProgress,
      status: crmExportDeStatus,
      total: crmExportDeTotal,
      processed: crmExportDeProcessed,
      errors: crmExportDeErrors,
    });
  });

  let deBackfillInProgress = false;
  let deBackfillStatus = "";
  let deBackfillTotal = 0;
  let deBackfillProcessed = 0;
  let deBackfillErrors = 0;
  let deBackfillUpdated = 0;
  let deBackfillAbort = false;

  app.post("/api/logistics/parcel-tracking-de/backfill-dates", async (req, res) => {
    try {
      if (deBackfillInProgress) {
        return res.json({ status: "in_progress", message: deBackfillStatus });
      }

      const accounts = await storage.getRetailcrmAccounts(8);
      if (!accounts || accounts.length === 0) {
        return res.status(404).json({ error: "RetailCRM account not configured" });
      }
      const account = accounts[0];
      const apiKey = process.env[account.secretKey];
      if (!apiKey) {
        return res.status(400).json({ error: "API key not configured" });
      }
      const config = { subdomain: account.subdomain, apiKey };

      const deStatuses = await storage.getDeParcelStatuses();
      const lastEventDateMap: Record<string, string> = {};
      for (const row of deStatuses) {
        if (row.lastEventDate) {
          lastEventDateMap[row.trackingNumber] = row.lastEventDate;
        }
      }

      const parseTrackNumbers = (value: string | undefined | null): string[] => {
        if (!value || !value.trim()) return [];
        return value.split(/[,;]+/).map(s => s.trim().toUpperCase()).filter(s => s.length >= 5);
      };

      const fromDate = req.body?.fromDate || "2025-11-01";
      const allCachedRows = await db.execute(sql`
        SELECT order_id, payload FROM retailcrm_orders_cache
        WHERE created_date >= ${fromDate}
          AND site NOT LIKE 'ip-shatskaia-%'
          AND site != 'darkstore-dubli-zakazov'
      `);

      const ordersToUpdate: { orderId: number; site?: string; date: string }[] = [];

      for (const row of allCachedRows.rows as any[]) {
        const order = row.payload as any;
        const warehouseTracks = parseTrackNumbers(order.customFields?.trek_nomer_cklada_otgruzki_nomer);
        const bulkTracks = parseTrackNumbers(order.customFields?.trek_nomer_sbornogo_vykupa);
        const allTracks = Array.from(new Set([...warehouseTracks, ...bulkTracks]));
        if (allTracks.length === 0) continue;

        const trackDates = allTracks
          .map(t => lastEventDateMap[t])
          .filter(Boolean)
          .sort();
        if (trackDates.length === 0) continue;

        const latest = trackDates[trackDates.length - 1];
        const d = new Date(latest);
        if (isNaN(d.getTime())) continue;
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

        ordersToUpdate.push({
          orderId: typeof order.id === "string" ? parseInt(order.id, 10) : order.id,
          site: order.site || undefined,
          date: dateStr,
        });
      }

      if (ordersToUpdate.length === 0) {
        return res.json({ status: "done", message: "Нет заказов для обновления дат", total: 0 });
      }

      deBackfillInProgress = true;
      deBackfillTotal = ordersToUpdate.length;
      deBackfillProcessed = 0;
      deBackfillErrors = 0;
      deBackfillUpdated = 0;
      deBackfillStatus = `Обновление дат 0/${ordersToUpdate.length} заказов...`;

      console.log(`[DE backfill] Starting: ${ordersToUpdate.length} orders from ${fromDate}`);
      res.json({ status: "started", message: deBackfillStatus, total: ordersToUpdate.length });

      deBackfillAbort = false;

      (async () => {
        const DELAY_MS = 125;
        for (const order of ordersToUpdate) {
          if (deBackfillAbort) {
            deBackfillStatus = `Остановлено: ${deBackfillUpdated} обновлено, ${deBackfillErrors} ошибок (из ${ordersToUpdate.length})`;
            console.log(`[DE backfill] Aborted at ${deBackfillProcessed}/${ordersToUpdate.length}`);
            deBackfillInProgress = false;
            deBackfillAbort = false;
            return;
          }

          try {
            await retailcrmService.editOrderCustomFields(config, order.orderId, {
              data_statusa_dostavki_so_sklada_otgruzki: order.date,
            }, order.site);

            deBackfillUpdated++;
            deBackfillProcessed++;
          } catch (err: any) {
            console.error(`[DE backfill] Error for order ${order.orderId}:`, err.message);
            deBackfillErrors++;
            deBackfillProcessed++;
          }

          deBackfillStatus = `Обновление дат ${deBackfillProcessed}/${ordersToUpdate.length} заказов...`;
          if (deBackfillProcessed < ordersToUpdate.length) {
            await new Promise(r => setTimeout(r, DELAY_MS));
          }
        }

        deBackfillStatus = `Готово: ${deBackfillUpdated} заказов обновлено, ${deBackfillErrors} ошибок (из ${ordersToUpdate.length})`;
        console.log(`[DE backfill] Done: ${deBackfillUpdated} updated, ${deBackfillErrors} errors`);
        deBackfillInProgress = false;
      })();
    } catch (error: any) {
      deBackfillInProgress = false;
      console.error("[DE backfill] Error:", error);
      res.status(500).json({ error: error.message || "Failed to start backfill" });
    }
  });

  app.get("/api/logistics/parcel-tracking-de/backfill-dates/status", async (_req, res) => {
    res.json({
      inProgress: deBackfillInProgress,
      status: deBackfillStatus,
      total: deBackfillTotal,
      processed: deBackfillProcessed,
      errors: deBackfillErrors,
      updated: deBackfillUpdated,
    });
  });

  app.post("/api/logistics/parcel-tracking-de/backfill-dates/stop", async (_req, res) => {
    if (!deBackfillInProgress) {
      return res.json({ status: "not_running", message: "Процесс не запущен" });
    }
    deBackfillAbort = true;
    console.log("[DE backfill] Stop requested");
    res.json({ status: "stopping", message: "Остановка..." });
  });

  // ===== PARCEL TRACKING →DE (17track API) =====

  // List parcels with status "Отправлен магазином" + track fields
  // ── Tracking store settings ──────────────────────────────────
  app.get("/api/logistics/tracking-store-settings", async (_req, res) => {
    try {
      const accounts = await storage.getRetailcrmAccounts(8);
      const account = accounts?.[0];
      const apiKey = account ? process.env[account.secretKey] : null;
      const crmConfig = account && apiKey ? { subdomain: account.subdomain, apiKey } : null;

      // Get all unique sites from cached orders with status 'otpravlen-magazinom'
      const siteRows = await db.execute(sql`
        SELECT site, COUNT(*) as order_count
        FROM retailcrm_orders_cache
        WHERE status = 'otpravlen-magazinom'
          AND site IS NOT NULL
          AND site NOT LIKE 'ip-shatskaia-%'
          AND site != 'darkstore-dubli-zakazov'
        GROUP BY site
        ORDER BY site
      `);

      // Get CRM site names
      let siteNames: Record<string, string> = {};
      if (crmConfig) {
        try {
          const sitesData = await retailcrmService.getSites(crmConfig);
          if (sitesData?.sites) {
            for (const [code, info] of Object.entries(sitesData.sites) as any) {
              siteNames[code] = info.name || code;
            }
          }
        } catch (e) {
          console.error("Failed to fetch CRM sites:", e);
        }
      }

      // Get saved settings
      const saved = await storage.getTrackingStoreSettings();
      const savedMap = new Map(saved.map(s => [s.siteCode, s]));

      const stores = (siteRows.rows as any[]).map(row => {
        const siteCode = row.site as string;
        const setting = savedMap.get(siteCode);
        return {
          siteCode,
          siteName: setting?.siteName || siteNames[siteCode] || siteCode,
          groupName: setting?.groupName || "europe",
          enabled: setting?.enabled ?? true,
          orderCount: Number(row.order_count),
        };
      });

      res.json({ stores });
    } catch (error: any) {
      console.error("Tracking store settings error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/logistics/tracking-store-settings", async (req, res) => {
    try {
      const { settings } = req.body;
      if (!Array.isArray(settings)) {
        return res.status(400).json({ error: "settings array required" });
      }
      await storage.upsertTrackingStoreSettings(settings);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Save tracking store settings error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ── Delivery type settings ──────────────────────────────
  app.get("/api/logistics/delivery-type-settings", async (_req, res) => {
    try {
      const settings = await storage.getDeliveryTypeSettings();

      // Auto-discover delivery codes from cached orders
      const rows = await db.execute(sql`
        SELECT DISTINCT payload->'delivery'->>'code' as delivery_code
        FROM retailcrm_orders_cache
        WHERE status = 'otpravlen-magazinom'
          AND payload->'delivery'->>'code' IS NOT NULL
          AND payload->'delivery'->>'code' != ''
      `);
      const allCodes = (rows.rows as any[]).map(r => r.delivery_code).filter(Boolean);

      // Count orders per delivery code
      const countRows = await db.execute(sql`
        SELECT payload->'delivery'->>'code' as delivery_code, COUNT(*) as cnt
        FROM retailcrm_orders_cache
        WHERE status = 'otpravlen-magazinom'
          AND payload->'delivery'->>'code' IS NOT NULL
          AND payload->'delivery'->>'code' != ''
        GROUP BY payload->'delivery'->>'code'
      `);
      const countMap: Record<string, number> = {};
      for (const r of countRows.rows as any[]) {
        countMap[r.delivery_code] = Number(r.cnt);
      }

      // Merge: settings + discovered codes
      const settingsMap = new Map(settings.map(s => [s.deliveryCode, s.groupName]));
      const merged = allCodes.map(code => ({
        deliveryCode: code,
        groupName: settingsMap.get(code) || "ls",
        orderCount: countMap[code] || 0,
      }));
      // Sort by order count desc
      merged.sort((a, b) => b.orderCount - a.orderCount);

      res.json({ settings: merged });
    } catch (error: any) {
      console.error("Get delivery type settings error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/logistics/delivery-type-settings", async (req, res) => {
    try {
      const { settings } = req.body;
      if (!Array.isArray(settings)) {
        return res.status(400).json({ error: "settings array required" });
      }
      await storage.upsertDeliveryTypeSettings(settings);
      res.json({ ok: true });
    } catch (error: any) {
      console.error("Save delivery type settings error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // ── Parcel tracking DE ──────────────────────────────────
  app.get("/api/logistics/parcel-tracking-de", async (req, res) => {
    try {
      const accounts = await storage.getRetailcrmAccounts(8);
      const crmSubdomain = accounts?.[0]?.subdomain || null;

      // Load enabled store settings
      const storeSettings = await storage.getTrackingStoreSettings();
      const disabledSites = new Set(
        storeSettings.filter(s => !s.enabled).map(s => s.siteCode)
      );

      const cachedRows = await db.execute(sql`
        SELECT payload, site FROM retailcrm_orders_cache
        WHERE status = 'otpravlen-magazinom'
          AND site NOT LIKE 'ip-shatskaia-%'
          AND site != 'darkstore-dubli-zakazov'
      `);
      const parcels: any[] = [];

      const parseTrackNumbers = (value: string | undefined | null): string[] => {
        if (!value || !value.trim()) return [];
        return value.split(/[,;]+/).map(s => s.trim().toUpperCase()).filter(s => s.length >= 5);
      };

      for (const row of cachedRows.rows as any[]) {
        const order = row.payload as any;
        const site = (row as any).site as string | null;

        // Skip disabled stores
        if (site && disabledSites.has(site)) continue;

        const warehouseTracks = parseTrackNumbers(order.customFields?.trek_nomer_cklada_otgruzki_nomer);
        const bulkTracks = parseTrackNumbers(order.customFields?.trek_nomer_sbornogo_vykupa);

        if (warehouseTracks.length === 0 && bulkTracks.length === 0) continue;

        const baseFields = {
          orderId: order.id,
          orderNumber: order.number,
          trackCreatedAt: order.statusUpdatedAt || null,
          createdAt: order.createdAt || null,
          customer: [order.firstName, order.lastName].filter(Boolean).join(" ") || "—",
          site: site || null,
          deliveryCode: order.delivery?.code || null,
        };

        const seenTracks = new Set<string>();

        for (const track of warehouseTracks) {
          if (seenTracks.has(track)) continue;
          seenTracks.add(track);
          parcels.push({ ...baseFields, trackingNumber: track, isBulk: false });
        }

        for (const track of bulkTracks) {
          if (seenTracks.has(track)) continue;
          seenTracks.add(track);
          parcels.push({ ...baseFields, trackingNumber: track, isBulk: true });
        }
      }

      parcels.sort((a: any, b: any) => {
        const da = a.trackCreatedAt ? new Date(a.trackCreatedAt).getTime() : 0;
        const dbv = b.trackCreatedAt ? new Date(b.trackCreatedAt).getTime() : 0;
        return dbv - da;
      });

      res.json({ parcels, crmSubdomain });
    } catch (error: any) {
      console.error("Parcel tracking DE list error:", error);
      res.status(500).json({ error: error.message || "Failed to get parcel tracking data" });
    }
  });

  // Check tracking via 17track for →DE parcels (single/small batch)
  app.post("/api/logistics/parcel-tracking-de/check", async (req, res) => {
    try {
      const { trackingNumbers } = req.body;
      if (!Array.isArray(trackingNumbers) || trackingNumbers.length === 0) {
        return res.status(400).json({ error: "trackingNumbers array required" });
      }

      const toCheck = trackingNumbers.slice(0, 40);
      const results = await track17Service.registerAndGetStatus(
        toCheck.map((n: string) => ({ number: n }))
      );

      const statuses: Record<string, any> = {};
      results.forEach((info, number) => {
        const detection = track17Service.detectCarrierByFormat(number);
        statuses[number] = {
          status: info.status,
          subStatus: info.subStatus,
          lastEvent: info.lastEvent,
          lastLocation: info.lastLocation,
          lastUpdate: info.lastUpdate,
          firstEventDate: info.firstEventDate || null,
          lastEventDate: info.lastEventDate || null,
          checkedAt: new Date().toISOString(),
          carrier: detection.type === "carrier" ? detection.name : null,
        };
      });

      const dbEntries = Object.entries(statuses).map(([num, s]: [string, any]) => {
        return {
          trackingNumber: num,
          carrier: s.carrier,
          status: s.status,
          subStatus: s.subStatus || null,
          lastEvent: s.lastEvent || null,
          lastLocation: s.lastLocation || null,
          lastUpdate: s.lastUpdate || null,
          firstEventDate: s.firstEventDate || null,
          lastEventDate: s.lastEventDate || null,
        };
      });
      await storage.upsertDeParcelStatuses(dbEntries);

      res.json({ statuses });
    } catch (error: any) {
      console.error("Parcel tracking DE check error:", error);
      res.status(500).json({ error: error.message || "Failed to check tracking status" });
    }
  });

  // Funnel calculation reused by check-summary and check-all
  async function calcDeFunnel() {
    const isAmazonOrSF = (t: string) => /^DE\d{8,12}$/.test(t) || /^SF\d+$/.test(t);
    const parseTrackNumbers = (value: string | undefined | null): string[] => {
      if (!value || !value.trim()) return [];
      return value.split(/[,;]+/).map(s => s.trim().toUpperCase()).filter(s => s.length >= 5);
    };

    // Total orders before site filter
    const totalResult = await db.execute(sql`
      SELECT count(*) as cnt FROM retailcrm_orders_cache
      WHERE status = 'otpravlen-magazinom'
    `);
    const totalOrdersInCrm = Number((totalResult.rows[0] as any)?.cnt || 0);

    // Orders after site filter
    const allCachedRows = await db.execute(sql`
      SELECT payload FROM retailcrm_orders_cache
      WHERE status = 'otpravlen-magazinom'
        AND site NOT LIKE 'ip-shatskaia-%'
        AND site != 'darkstore-dubli-zakazov'
    `);
    const siteFiltered = totalOrdersInCrm - allCachedRows.rows.length;
    const ordersAfterSite = allCachedRows.rows.length;

    // Extract tracks
    const seenTracks = new Set<string>();
    const allTracks: string[] = [];
    let totalParcels = 0;
    let consolidatedOrders = 0;
    let consolidatedParcels = 0;
    let ordersWithoutTracks = 0;
    const ordersWithoutTracksList: { orderId: string; orderNumber: string }[] = [];
    const trackOccurrences = new Map<string, number>();

    for (const row of allCachedRows.rows as any[]) {
      const order = row.payload as any;
      const isConsol = order.customFields?.konsolidatsiia === true || order.customFields?.konsolidatsiia === "true";
      const warehouseTracks = parseTrackNumbers(order.customFields?.trek_nomer_cklada_otgruzki_nomer);
      const bulkTracks = parseTrackNumbers(order.customFields?.trek_nomer_sbornogo_vykupa);
      const orderTracks = [...warehouseTracks, ...bulkTracks];
      if (orderTracks.length === 0) {
        ordersWithoutTracks++;
        ordersWithoutTracksList.push({ orderId: String(order.id || ""), orderNumber: String(order.number || "") });
        continue;
      }
      if (isConsol) { consolidatedOrders++; consolidatedParcels += orderTracks.length; }
      totalParcels += orderTracks.length;
      for (const t of orderTracks) {
        trackOccurrences.set(t, (trackOccurrences.get(t) || 0) + 1);
        if (!seenTracks.has(t)) { seenTracks.add(t); allTracks.push(t); }
      }
    }

    const duplicateTracks = totalParcels - allTracks.length;
    const duplicateTracksList: string[] = [];
    trackOccurrences.forEach((count, track) => {
      if (count > 1) duplicateTracksList.push(track);
    });

    // Split Amazon DE / SF / other
    const amazonDeTracks: string[] = [];
    const sfTracks: string[] = [];
    const nonAmazonTracks: string[] = [];
    for (const t of allTracks) {
      if (/^DE\d{8,12}$/.test(t)) amazonDeTracks.push(t);
      else if (/^SF\d+$/.test(t)) sfTracks.push(t);
      else nonAmazonTracks.push(t);
    }
    const amazonTracks = [...amazonDeTracks, ...sfTracks]; // combined for backward compat

    // Delivered filter
    const existingStatuses = await storage.getDeParcelStatuses();
    const deliveredTracks = new Set<string>();
    for (const row of existingStatuses) {
      if (row.status && (row.status === "Доставлена" || row.status === "Доставлен" || row.status === "Delivered")) {
        deliveredTracks.add(row.trackingNumber);
      }
    }
    // Amazon DE delivered tracks count separately
    const amazonDelivered = amazonDeTracks.filter(t => deliveredTracks.has(t));
    const deliveredTracksList = nonAmazonTracks.filter(t => deliveredTracks.has(t));
    const deliveredCount = deliveredTracksList.length;
    const toCheck = nonAmazonTracks.filter(t => !deliveredTracks.has(t));

    return {
      totalOrdersInCrm,
      siteFiltered,
      ordersAfterSite,
      totalParcels,
      consolidatedOrders,
      consolidatedParcels,
      ordersWithoutTracks,
      ordersWithoutTracksList,
      uniqueTracks: allTracks.length,
      duplicateTracks,
      duplicateTracksList,
      amazonSF: amazonTracks.length,
      amazonDeCount: amazonDeTracks.length,
      sfCount: sfTracks.length,
      amazonDeliveredCount: amazonDelivered.length,
      delivered: deliveredCount,
      deliveredTracksList,
      toCheck: toCheck.length,
      toCheckTracks: toCheck,
      amazonTracks,
      amazonDeTracks,
      sfTracks,
      allTracks,
    };
  }

  app.get("/api/logistics/parcel-tracking-de/check-summary", async (_req, res) => {
    try {
      const f = await calcDeFunnel();
      res.json({
        toCheck: f.toCheck,
        totalParcels: f.totalParcels,
        uniqueTracks: f.uniqueTracks,
        totalOrdersInCrm: f.totalOrdersInCrm,
        funnel: {
          totalOrdersInCrm: f.totalOrdersInCrm,
          siteFiltered: f.siteFiltered,
          ordersAfterSite: f.ordersAfterSite,
          totalParcels: f.totalParcels,
          consolidatedOrders: f.consolidatedOrders,
          consolidatedParcels: f.consolidatedParcels,
          ordersWithoutTracks: f.ordersWithoutTracks,
          ordersWithoutTracksList: f.ordersWithoutTracksList,
          uniqueTracks: f.uniqueTracks,
          duplicateTracks: f.duplicateTracks,
          duplicateTracksList: f.duplicateTracksList,
          amazonSF: f.amazonSF,
          amazonTracksList: f.amazonTracks,
          amazonDeCount: f.amazonDeCount,
          amazonDeTracks: f.amazonDeTracks,
          sfCount: f.sfCount,
          sfTracks: f.sfTracks,
          amazonDeliveredCount: f.amazonDeliveredCount,
          delivered: f.delivered,
          deliveredTracksList: f.deliveredTracksList,
        },
      });
    } catch (error: any) {
      console.error("Check summary error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  let deBatchInProgress = false;
  let deBatchStatus = "";
  let deBatchDiagnostic = "";
  let deBatchStartedAt: number | null = null;
  let deBatchTotal = 0;
  let deBatchProcessed = 0;
  let deBatchResults: Record<string, any> = {};

  app.post("/api/logistics/parcel-tracking-de/check-all", async (req, res) => {
    try {
      if (deBatchInProgress) {
        return res.json({ status: "in_progress", message: deBatchStatus });
      }

      const specificTracks = req.body?.trackingNumbers as string[] | undefined;
      const isAmazonOrSF = (t: string) => /^DE\d{8,12}$/.test(t) || /^SF\d+$/.test(t);

      const trackNumbers: string[] = [];
      let diagnosticText = "";
      let funnelData: Awaited<ReturnType<typeof calcDeFunnel>> | null = null;

      if (Array.isArray(specificTracks) && specificTracks.length > 0) {
        // Ветка 1: конкретные треки выбраны пользователем
        const seenTracks = new Set<string>();
        let amazonSkipped = 0;
        for (const t of specificTracks) {
          const trimmed = t?.trim();
          if (!trimmed || trimmed.length < 5 || seenTracks.has(trimmed)) continue;
          if (isAmazonOrSF(trimmed)) { amazonSkipped++; continue; }
          seenTracks.add(trimmed);
          trackNumbers.push(trimmed);
        }
        diagnosticText = `Выбрано вручную: ${specificTracks.length} треков`;
        if (amazonSkipped > 0) diagnosticText += ` (− ${amazonSkipped} Amazon/SF)`;
        diagnosticText += ` → ${trackNumbers.length} к проверке`;
      } else {
        // Ветки 2 и 3: единая воронка из кеша CRM
        funnelData = await calcDeFunnel();
        trackNumbers.push(...funnelData.toCheckTracks);

        const f = funnelData;
        const line1 = `Заказов в CRM (статус «Отправлен магазином»): ${f.totalOrdersInCrm}`;
        const line2 = `За вычетом ${f.siteFiltered} заказов ip-shatskaia/darkstore = ${f.ordersAfterSite} заказов или ${f.totalParcels} посылок (${f.consolidatedOrders} консолид. заказов + ${f.consolidatedParcels} посылок)`;
        const deductions = [
          f.ordersWithoutTracks > 0 ? `${f.ordersWithoutTracks} (нет трек-номера)` : null,
          f.duplicateTracks > 0 ? `${f.duplicateTracks} (дубликаты трек-номеров)` : null,
          f.amazonSF > 0 ? `${f.amazonSF} (Amazon/SF)` : null,
          f.delivered > 0 ? `${f.delivered} (доставлены)` : null,
        ].filter(Boolean).join(", ");
        const line3 = `К проверке: ${f.toCheck} треков (${f.totalParcels} за вычетом: ${deductions})`;
        diagnosticText = `${line1}\n${line2}\n${line3}`;
        console.log(`[17track] Check-all funnel:\n${diagnosticText}`);
      }

      if (trackNumbers.length === 0) {
        return res.json({ status: "done", message: "Нет треков для проверки", diagnostic: diagnosticText, total: 0 });
      }

      deBatchInProgress = true;
      deBatchStartedAt = Date.now();
      deBatchTotal = trackNumbers.length;
      deBatchProcessed = 0;
      deBatchResults = {};
      deBatchDiagnostic = diagnosticText;
      deBatchStatus = `Запуск проверки ${trackNumbers.length} треков...`;

      res.json({ status: "started", message: deBatchStatus, diagnostic: diagnosticText, total: trackNumbers.length });

      (async () => {
        try {
          const CHUNK_SIZE = 40;
          for (let i = 0; i < trackNumbers.length; i += CHUNK_SIZE) {
            const chunk = trackNumbers.slice(i, i + CHUNK_SIZE);
            const chunkNum = Math.floor(i / CHUNK_SIZE) + 1;
            const totalChunks = Math.ceil(trackNumbers.length / CHUNK_SIZE);
            deBatchStatus = `Пакет ${chunkNum}/${totalChunks}: проверка ${chunk.length} треков...`;

            try {
              const results = await track17Service.registerAndGetStatus(
                chunk.map(n => ({ number: n }))
              );
              results.forEach((info, number) => {
                const detection = track17Service.detectCarrierByFormat(number);
                deBatchResults[number] = {
                  status: info.status,
                  subStatus: info.subStatus,
                  lastEvent: info.lastEvent,
                  lastLocation: info.lastLocation,
                  lastUpdate: info.lastUpdate,
                  firstEventDate: info.firstEventDate || null,
                  lastEventDate: info.lastEventDate || null,
                  checkedAt: new Date().toISOString(),
                  carrier: detection.type === "carrier" ? detection.name : null,
                };
              });

              const chunkDbEntries = Array.from(results.entries()).map(([num, info]) => {
                return {
                  trackingNumber: num,
                  carrier: deBatchResults[num]?.carrier || null,
                  status: info.status,
                  subStatus: info.subStatus || null,
                  lastEvent: info.lastEvent || null,
                  lastLocation: info.lastLocation || null,
                  lastUpdate: info.lastUpdate || null,
                  firstEventDate: info.firstEventDate || null,
                  lastEventDate: info.lastEventDate || null,
                };
              });
              await storage.upsertDeParcelStatuses(chunkDbEntries);
            } catch (chunkErr: any) {
              console.error(`17track batch chunk ${chunkNum} error:`, chunkErr);
              for (const n of chunk) {
                if (!deBatchResults[n]) {
                  deBatchResults[n] = {
                    status: "Ошибка",
                    subStatus: chunkErr.message || "",
                    lastEvent: "",
                    lastLocation: "",
                    lastUpdate: "",
                    firstEventDate: null,
                    lastEventDate: null,
                    checkedAt: new Date().toISOString(),
                  };
                }
              }
            }

            deBatchProcessed = Math.min(i + chunk.length, trackNumbers.length);
            deBatchStatus = `Пакет ${chunkNum}/${totalChunks}: готово (${deBatchProcessed}/${trackNumbers.length})`;

            if (i + CHUNK_SIZE < trackNumbers.length) {
              await new Promise(r => setTimeout(r, 1500));
            }
          }

          // Mark unresolved tracks as "Не отслеживается — перевозчик не определён" (no retry — 96% of unknown formats are untraceable)
          const unresolvedEntries: any[] = [];
          for (const [num, s] of Object.entries(deBatchResults) as [string, any][]) {
            // Skip already-categorized statuses
            if (s.status.startsWith("В пути") || s.status === "Доставлена" || s.status.startsWith("Проблема") || s.status.startsWith("Не отслеживается")) continue;
            // Everything else (empty, raw API statuses, old names) → unresolved
            deBatchResults[num] = { ...s, status: "Не отслеживается — перевозчик не определён" };
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
            deBatchStatus = `${unresolvedEntries.length} треков — перевозчик не определён`;
            console.log(`[17track] ${unresolvedEntries.length} tracks unresolved — marked as "Не отслеживается — перевозчик не определён"`);
            await storage.upsertDeParcelStatuses(unresolvedEntries);
          }


          // Sync de_parcel_statuses: add NEW Amazon DE / SF entries + remove stale records
          if (funnelData) {
            // Get existing tracks to avoid overwriting Amazon sync results
            const validTrackSet = new Set(funnelData.allTracks);
            const allDbRows = await storage.getDeParcelStatuses();
            const existingTrackSet = new Set(allDbRows.map(r => r.trackingNumber));

            // Only insert Amazon/SF tracks that DON'T already exist (don't overwrite "Доставлена" etc.)
            if (funnelData.amazonTracks.length > 0) {
              const newDeTracks = funnelData.amazonTracks.filter(t => /^DE\d{8,12}$/.test(t) && !existingTrackSet.has(t));
              const newSfTracks = funnelData.amazonTracks.filter(t => /^SF\d+$/.test(t) && !existingTrackSet.has(t));
              if (newDeTracks.length > 0) {
                const deEntries = newDeTracks.map(t => ({
                  trackingNumber: t,
                  carrier: "Amazon",
                  status: "В пути — прочее",
                  subStatus: null,
                  lastEvent: null,
                  lastLocation: null,
                  lastUpdate: null,
                  firstEventDate: null,
                  lastEventDate: null,
                }));
                await storage.upsertDeParcelStatuses(deEntries);
              }
              if (newSfTracks.length > 0) {
                const sfEntries = newSfTracks.map(t => ({
                  trackingNumber: t,
                  carrier: null,
                  status: "Не отслеживается — SF",
                  subStatus: null,
                  lastEvent: null,
                  lastLocation: null,
                  lastUpdate: null,
                  firstEventDate: null,
                  lastEventDate: null,
                }));
                await storage.upsertDeParcelStatuses(sfEntries);
              }
            }
            const staleIds: number[] = [];
            for (const row of allDbRows) {
              if (!validTrackSet.has(row.trackingNumber)) {
                staleIds.push(row.id);
              }
            }
            if (staleIds.length > 0) {
              await db.execute(sql`DELETE FROM de_parcel_statuses WHERE id = ANY(${staleIds})`);
              console.log(`[17track] Cleaned ${staleIds.length} stale records from de_parcel_statuses`);
            }
          }

          const statusCounts: Record<string, number> = {};
          const errorSubCounts: Record<string, number> = {};
          for (const s of Object.values(deBatchResults) as any[]) {
            statusCounts[s.status] = (statusCounts[s.status] || 0) + 1;
            if (s.status.includes("ошибка") && s.subStatus) {
              errorSubCounts[s.subStatus] = (errorSubCounts[s.subStatus] || 0) + 1;
            }
          }
          const summary = Object.entries(statusCounts).map(([k, v]) => `${k}: ${v}`).join(", ");
          console.log(`[17track] Batch done: ${summary}`);

          deBatchStatus = `Готово: ${Object.keys(deBatchResults).length} проверено. ${summary}`;
          console.log(`[17track] ${deBatchStatus}`);
          if (Object.keys(errorSubCounts).length > 0) {
            console.log(`[17track] Error breakdown: ${Object.entries(errorSubCounts).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
          }
        } catch (err: any) {
          console.error("17track batch background error:", err);
          deBatchStatus = `Ошибка: ${err.message}`;
        } finally {
          deBatchInProgress = false;
        }
      })();
    } catch (error: any) {
      deBatchInProgress = false;
      console.error("Parcel tracking DE check-all error:", error);
      res.status(500).json({ error: error.message || "Failed to start batch check" });
    }
  });

  let deStatusesMigrated = false;
  app.get("/api/logistics/parcel-tracking-de/statuses", async (_req, res) => {
    try {
      // One-time migration of old status names to unified format
      if (!deStatusesMigrated) {
        deStatusesMigrated = true;
        // Add reregistered_at column if missing
        await db.execute(sql`ALTER TABLE de_parcel_statuses ADD COLUMN IF NOT EXISTS reregistered_at TIMESTAMP`).catch(() => {});
        const renames: [string, string][] = [
          ["Проверка не проводилась", "Не отслеживается — Amazon/SF"],
          ["Не отслеживается (Amazon/SF)", "Не отслеживается — Amazon/SF"],
          ["Некорректный трек-номер", "Не отслеживается — прочее"],
          ["Не отслеживается — некорректный трек", "Не отслеживается — прочее"],
          ["Нет данных", "Не отслеживается — прочее"],
          ["Не найден", "Не отслеживается — прочее"],
          ["Не отслеживается — нет данных", "Не отслеживается — прочее"],
          ["Не отслеживается — новый трек", "Не отслеживается — прочее"],
          ["Перевозчик не определён", "Не отслеживается — перевозчик не определён"],
          ["Ошибка", "Не отслеживается — не принято API"],
          ["Не отслеживается — ошибка", "Не отслеживается — не принято API"],
          ["Создана отправка", "В пути — создана отправка"],
          ["Информация получена", "В пути — создана отправка"],
          ["Передана курьеру", "В пути — передана курьеру"],
          ["Ожидает в пункте выдачи", "В пути — ожидает в пункте выдачи"],
          ["Данные устарели", "Проблема — данные устарели"],
          ["Доставка не удалась", "Проблема — доставка не удалась"],
          ["Возвращается отправителю", "Проблема — возвращается отправителю"],
          ["Возвращена отправителю", "Проблема — возвращена отправителю"],
          ["Утеряна", "Проблема — утеряна"],
          ["Уничтожена", "Проблема — уничтожена"],
          ["Отправка отменена", "Проблема — отправка отменена"],
          ["Ожидание данных", "В пути — ожидание данных"],
          ["В пути", "В пути — прочее"],
          ["Проблема", "Проблема — прочее"],
          ["Не проверен", "Не отслеживается — не проверен"],
        ];
        try {
          // Also migrate sub-status specific old names
          const subRenames: [string, string][] = [
            ["Доставка не удалась — получатель отсутствовал", "Проблема — получатель отсутствовал"],
            ["Доставка не удалась — проверка безопасности", "Проблема — не прошла проверку"],
            ["Доставка не удалась — отказ получателя", "Проблема — отказ получателя"],
            ["Доставка не удалась — неверный адрес", "Проблема — неверный адрес"],
            ["В пути — отправлена с промежуточного пункта", "В пути — отправлена с пункта"],
          ];
          let totalMigrated = 0;
          for (const [oldName, newName] of renames.concat(subRenames)) {
            const r = await db.execute(sql`UPDATE de_parcel_statuses SET status = ${newName} WHERE status = ${oldName}`);
            const cnt = (r as any).rowCount || 0;
            if (cnt > 0) totalMigrated += cnt;
          }
          if (totalMigrated > 0) {
            console.log(`[17track] Status migration: ${totalMigrated} rows renamed to unified format`);
          }

          // Split "Не отслеживается — Amazon/SF" → separate DE (Amazon) and SF
          const deAmazon = await db.execute(sql`
            UPDATE de_parcel_statuses
            SET status = 'В пути — прочее', carrier = 'Amazon'
            WHERE status = 'Не отслеживается — Amazon/SF'
              AND tracking_number ~ '^DE[0-9]{8,12}$'
          `);
          const sfSplit = await db.execute(sql`
            UPDATE de_parcel_statuses
            SET status = 'Не отслеживается — SF'
            WHERE status = 'Не отслеживается — Amazon/SF'
              AND tracking_number ~ '^SF'
          `);
          const deCnt = (deAmazon as any).rowCount || 0;
          const sfCnt = (sfSplit as any).rowCount || 0;
          if (deCnt > 0 || sfCnt > 0) {
            console.log(`[17track] Amazon/SF split: ${deCnt} DE → "В пути — прочее", ${sfCnt} SF → "Не отслеживается — SF"`);
          }
        } catch (e) { /* ignore */ }
      }
      const rows = await storage.getDeParcelStatuses();
      const statuses: Record<string, any> = {};
      const toBackfill: { trackingNumber: string; carrier: string }[] = [];
      for (const row of rows) {
        let carrier = row.carrier || null;
        if (!carrier) {
          const det = track17Service.detectCarrierByFormat(row.trackingNumber);
          if (det.type === "carrier") {
            carrier = det.name;
            toBackfill.push({ trackingNumber: row.trackingNumber, carrier: det.name });
          }
        }
        statuses[row.trackingNumber] = {
          status: row.status,
          subStatus: row.subStatus || "",
          lastEvent: row.lastEvent || "",
          lastLocation: row.lastLocation || "",
          lastUpdate: row.lastUpdate || "",
          firstEventDate: row.firstEventDate || null,
          lastEventDate: row.lastEventDate || null,
          checkedAt: row.checkedAt ? row.checkedAt.toISOString() : null,
          carrier,
        };
      }
      // Backfill carrier in DB for rows where it was missing
      if (toBackfill.length > 0) {
        const entries = toBackfill.map(e => ({
          trackingNumber: e.trackingNumber,
          carrier: e.carrier,
          status: statuses[e.trackingNumber].status,
          subStatus: statuses[e.trackingNumber].subStatus || null,
          lastEvent: statuses[e.trackingNumber].lastEvent || null,
          lastLocation: statuses[e.trackingNumber].lastLocation || null,
          lastUpdate: statuses[e.trackingNumber].lastUpdate || null,
          firstEventDate: statuses[e.trackingNumber].firstEventDate || null,
          lastEventDate: statuses[e.trackingNumber].lastEventDate || null,
        }));
        await storage.upsertDeParcelStatuses(entries);
        console.log(`[17track] Backfilled carrier for ${toBackfill.length} tracks`);
      }
      res.json({ statuses });
    } catch (error: any) {
      console.error("Get DE parcel statuses error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/logistics/parcel-tracking-de/batch-status", async (_req, res) => {
    const elapsed = deBatchStartedAt ? Math.floor((Date.now() - deBatchStartedAt) / 1000) : 0;
    const scheduleInfo = backgroundSync.getDeTrackingScheduleInfo();
    res.json({
      inProgress: deBatchInProgress,
      status: deBatchStatus,
      diagnostic: deBatchDiagnostic,
      startedAt: deBatchStartedAt,
      elapsed,
      total: deBatchTotal,
      processed: deBatchProcessed,
      statuses: deBatchInProgress ? {} : deBatchResults,
      nextScheduledCheck: scheduleInfo.nextCheckAt,
      scheduledCheckInProgress: backgroundSync.isDeTrackingInProgress(),
      lastCheckAt: scheduleInfo.lastCheckAt,
      lastCheckTracksCount: scheduleInfo.lastCheckTracksCount,
      nextCheckIsSecondPass: scheduleInfo.nextCheckIsSecondPass,
      schedule: scheduleInfo.schedule,
      amazonSync: scheduleInfo.amazonSync,
    });
  });
  app.get("/api/logistics/track17-quota", async (_req, res) => {
    try {
      const quota = await track17Service.getQuota();
      res.json(quota);
    } catch (error: any) {
      console.error("17track quota error:", error);
      res.status(500).json({ error: error.message });
    }
  });
  app.get("/api/settings/crm", async (_req, res) => {
    try {
      const syncDays = await backgroundSync.getSyncDays();
      res.json({ syncDays });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/settings/crm", async (req, res) => {
    try {
      const { syncDays } = req.body;
      if (typeof syncDays !== "number" || syncDays < 1 || syncDays > 365) {
        return res.status(400).json({ error: "syncDays must be between 1 and 365" });
      }
      await storage.setAppSetting("crm_sync_days", String(syncDays));
      res.json({ success: true, syncDays });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/settings/crm/sync-stats", async (_req, res) => {
    try {
      const history = await storage.getSyncHistory(100);
      // Find last entry per jobType for night/day/manual
      const types = ["night", "day", "manual", "night_retry", "day_retry"];
      const lastByType: Record<string, typeof history[0]> = {};
      for (const entry of history) {
        if (types.includes(entry.jobType) && !lastByType[entry.jobType]) {
          lastByType[entry.jobType] = entry;
        }
      }
      res.json({ lastByType, recentHistory: history.filter(h => types.includes(h.jobType)).slice(0, 20) });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
  // ============================================
  // Shop Agent endpoints
  // ============================================

  // Debug/test endpoint (no auth) - remove after testing
  app.get("/api/shop-agent/test", async (_req, res) => {
    try {
      const count = await storage.getCachedOrdersByStatuses(["vystavlen-invoice-klientu"]);
      let creds: any[] = [];
      try { creds = await storage.getShopCredentials(); } catch (e) { console.log("[shop-agent/test] credentials table not available"); }
      res.json({ ordersCount: count.length, credsCount: creds.length, ok: true });
    } catch (error: any) {
      res.json({ error: error.message, stack: error.stack?.split("\n").slice(0, 3) });
    }
  });

  // Get shops summary: unique shops with order counts, sorted desc
  // Convert CRM warehouse name to domain-style: "tradeinn-com" → "tradeinn.com"
  const storeNameToDomain = (name: string): string => {
    if (!name) return name;
    // If already has a dot (e.g. "tradeinn.com"), return as-is
    if (name.includes(".")) return name;
    // Replace last hyphen with dot: "basler-beauty-de" → "basler-beauty.de"
    const lastHyphen = name.lastIndexOf("-");
    if (lastHyphen > 0) {
      return name.slice(0, lastHyphen) + "." + name.slice(lastHyphen + 1);
    }
    return name;
  };

  app.get("/api/shop-agent/shops", async (_req, res) => {
    try {
      console.log("[shop-agent] Fetching shops summary...");
      const allOrders = await storage.getCachedOrdersByStatuses(["vystavlen-invoice-klientu"]);
      console.log(`[shop-agent] shops: found ${allOrders.length} orders to aggregate`);

      // Domains where we have API/mailbox access to ALL emails on the domain (all on Fastmail now)
      const FASTMAIL_DOMAINS = [
        "newmen.me", "vatebo.info", "croxl.info",
        "newmenshopping.de", "clixl.com", "vatebo.com",
        "anecy.online", "croxl.us", "uniea.pl", "ru.shopping",
        "invoice.delivery", "newmen.shopping", "ozon.style",
        "anecy.us", "mailspectacular.com", "proton.me",
        "newmenge.com", "cramler.org", "macrobeer.org", "metran.org",
        "dpemme.com", "holzfeller.com", "cradier.org", "kleines.org",
        "lougecom.org", "noveg.org", "teriac.org", "vatebo.de",
        "newmen.agency", "newmen.gmbh",
      ];
      const mailboxDomains = new Set(FASTMAIL_DOMAINS);

      // Load shop_credentials — build set of specific emails that have passwords
      const allCredentials = await storage.getShopCredentials();
      const emailsWithCreds = new Set<string>();
      for (const c of allCredentials) {
        if (c.encryptedPassword && c.email) {
          emailsWithCreds.add(c.email.toLowerCase());
        }
      }

      // Aggregate by shipmentStore (Склад отгрузки)
      const shopMap = new Map<string, { count: number; emails: Set<string>; withPassword: number; withMailAccess: number; orderIds: Set<string> }>();
      for (const o of allOrders) {
        const payload = o.payload as any;
        const cf = payload?.customFields || {};
        const rawStore = payload?.shipmentStore || "";
        if (!rawStore) continue;
        const store = storeNameToDomain(rawStore);
        const entry = shopMap.get(store) || { count: 0, emails: new Set<string>(), withPassword: 0, withMailAccess: 0, orderIds: new Set<string>() };
        entry.count++;
        entry.orderIds.add(o.orderId);
        const email = (cf.order_email_address || "").trim();
        if (email) entry.emails.add(email);

        // Has access if: password in CRM, OR email on Fastmail/Proton domain, OR exact email in shop_credentials
        const emailDomain = email ? email.split("@")[1]?.toLowerCase() : "";
        const hasMailAccess = emailDomain && mailboxDomains.has(emailDomain);
        const hasAccess = cf.order_email_password
          || hasMailAccess
          || (email && emailsWithCreds.has(email.toLowerCase()));
        if (hasAccess) entry.withPassword++;
        if (hasMailAccess) entry.withMailAccess++;

        shopMap.set(store, entry);
      }

      // Get checked order IDs from shopOrderChecks
      const allCrmIds = allOrders.map(o => o.orderId);
      const checkedSet = new Set<string>();
      if (allCrmIds.length > 0) {
        try {
          for (let i = 0; i < allCrmIds.length; i += 500) {
            const batch = allCrmIds.slice(i, i + 500);
            const rows = await db.selectDistinct({ crmOrderId: shopOrderChecks.crmOrderId })
              .from(shopOrderChecks)
              .where(inArray(shopOrderChecks.crmOrderId, batch));
            for (const row of rows) {
              if (row.crmOrderId) checkedSet.add(row.crmOrderId);
            }
          }
        } catch (err) {
          console.error("[shop-agent/shops] Error fetching check counts:", err);
        }
      }

      console.log(`[shop-agent/shops] checkedSet size: ${checkedSet.size} out of ${allCrmIds.length} total orders`);

      // Load shop profiles and instructions
      const allProfiles = await storage.getShopProfiles();
      const profileMap = new Map<string, typeof allProfiles[0]>();
      for (const p of allProfiles) profileMap.set(p.domain, p);

      const allInstructions = await storage.getShopInstructions();
      const instructionSet = new Set<string>();
      for (const i of allInstructions) instructionSet.add(i.domain);

      // Build result sorted by count desc
      const shops = Array.from(shopMap.entries())
        .map(([store, { count, emails, withPassword, withMailAccess, orderIds }]) => {
          const checkedCount = [...orderIds].filter(id => checkedSet.has(id)).length;
          const profile = profileMap.get(store);
          return {
            shipmentStore: store,
            orderCount: count,
            emails: Array.from(emails),
            withPassword,
            withMailAccess,
            checkedCount,
            crmExport: profile?.crmExport || false,
            noteText: profile?.noteText || null,
            noteAuthor: profile?.noteAuthor || null,
            notedAt: profile?.notedAt || null,
            noteStatus: profile?.noteStatus || null,
            noteResolution: profile?.noteResolution || null,
            noteResolvedBy: profile?.noteResolvedBy || null,
            hasInstruction: instructionSet.has(store),
          };
        });

      // Add shops from profiles that have NO orders (manually added shops)
      for (const [domain, profile] of profileMap) {
        if (!shopMap.has(domain)) {
          shops.push({
            shipmentStore: domain,
            orderCount: 0,
            emails: [],
            withPassword: 0,
            withMailAccess: 0,
            checkedCount: 0,
            crmExport: profile.crmExport,
            noteText: profile.noteText,
            noteAuthor: profile.noteAuthor,
            notedAt: profile.notedAt,
            noteStatus: profile.noteStatus || null,
            noteResolution: profile.noteResolution || null,
            noteResolvedBy: profile.noteResolvedBy || null,
            hasInstruction: instructionSet.has(domain),
          });
        }
      }

      shops.sort((a, b) => b.orderCount - a.orderCount);

      const totalChecked = shops.reduce((s, sh) => s + sh.checkedCount, 0);
      console.log(`[shop-agent/shops] ${shops.length} shops (${allProfiles.length} profiles), totalChecked=${totalChecked}, fullyChecked=${shops.filter(s => s.orderCount > 0 && s.checkedCount >= s.orderCount).length}`);

      res.json(shops);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get shops" });
    }
  });

  // Shop check methods CRUD
  app.get("/api/shop-agent/shop-check-methods", async (_req, res) => {
    try {
      const methods = await storage.getShopCheckMethods();
      res.json(methods);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get check methods" });
    }
  });

  app.put("/api/shop-agent/shop-check-methods/:shopName", async (req, res) => {
    try {
      const { shopName } = req.params;
      const { checkMethod } = req.body;
      if (!checkMethod || !["lk", "email"].includes(checkMethod)) {
        return res.status(400).json({ error: "checkMethod must be 'lk' or 'email'" });
      }
      const result = await storage.upsertShopCheckMethod(shopName, checkMethod);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update check method" });
    }
  });

  // === Shop Profiles (new, replaces shop-check-methods for UI) ===
  app.get("/api/shop-agent/shop-profiles", async (_req, res) => {
    try {
      const profiles = await storage.getShopProfiles();
      res.json(profiles);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/shop-agent/shop-profiles", async (req, res) => {
    try {
      const { domain, checkMethod } = req.body;
      if (!domain || typeof domain !== "string") {
        return res.status(400).json({ error: "domain is required" });
      }
      const validMethods = ["lk", "email", "email_lk", "other"];
      const method = validMethods.includes(checkMethod) ? checkMethod : "email";
      const email = (req.user as any)?.email || (req.user as any)?.claims?.email || "";
      const result = await storage.upsertShopProfile(domain.toLowerCase().trim(), {
        checkMethod: method,
        createdBy: email,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/shop-agent/shop-profiles/:domain", async (req, res) => {
    try {
      const domain = decodeURIComponent(req.params.domain);
      const { checkMethod, crmExport, noteText, noteAuthor, noteResolution, noteStatus } = req.body;
      const update: any = {};
      if (checkMethod !== undefined) {
        const validMethods = ["lk", "email", "email_lk", "other"];
        if (!validMethods.includes(checkMethod)) {
          return res.status(400).json({ error: "Invalid checkMethod" });
        }
        update.checkMethod = checkMethod;
      }
      if (crmExport !== undefined) update.crmExport = !!crmExport;
      if (noteText !== undefined) {
        update.noteText = noteText || null;
        update.noteAuthor = noteText ? (noteAuthor || (req.user as any)?.email || "") : null;
        update.notedAt = noteText ? new Date() : null;
        // Auto-set status: writing note → open, clearing note → clear all
        if (noteText) {
          update.noteStatus = "open";
          // If reopening (user wrote "не работает"), clear resolution
          if (!noteStatus || noteStatus === "open") {
            update.noteResolution = null;
            update.noteResolvedBy = null;
          }
        } else {
          update.noteStatus = null;
          update.noteResolution = null;
          update.noteResolvedBy = null;
        }
      }
      if (noteResolution !== undefined) {
        update.noteResolution = noteResolution || null;
        update.noteResolvedBy = noteResolution ? ((req.user as any)?.email || "") : null;
        if (noteResolution) {
          update.noteStatus = "resolved";
        }
      }
      if (noteStatus !== undefined && noteText === undefined && noteResolution === undefined) {
        update.noteStatus = noteStatus || null;
      }
      const result = await storage.upsertShopProfile(domain, update);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/shop-agent/shop-profiles/:domain", async (req, res) => {
    try {
      const domain = decodeURIComponent(req.params.domain);
      await storage.deleteShopProfile(domain);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // === Force sync shop tracks → CRM ===
  app.post("/api/shop-agent/sync-tracks-to-crm", async (_req, res) => {
    try {
      const { syncShopTracksToCrm } = await import("./background-sync");
      const result = await syncShopTracksToCrm();
      res.json(result);
    } catch (error: any) {
      console.error("[shop-agent/sync-tracks-to-crm] Error:", error);
      res.status(500).json({ error: error.message || "Failed to sync tracks" });
    }
  });

  // === Shop Instructions ===
  app.get("/api/shop-agent/shop-instructions", async (_req, res) => {
    try {
      const instructions = await storage.getShopInstructions();
      res.json(instructions);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/shop-agent/shop-instructions/:domain", async (req, res) => {
    try {
      const domain = decodeURIComponent(req.params.domain);
      const instruction = await storage.getShopInstruction(domain);
      res.json(instruction || null);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/shop-agent/shop-instructions/:domain", async (req, res) => {
    try {
      const domain = decodeURIComponent(req.params.domain);
      const { mailProvider, senderEmail, subjectPattern, hasOrderId, orderIdPhrase, trackingPhrase } = req.body;
      const email = (req.user as any)?.email || (req.user as any)?.claims?.email || "";
      const result = await storage.upsertShopInstruction(domain, {
        mailProvider: mailProvider || null,
        senderEmail: senderEmail || null,
        subjectPattern: subjectPattern || null,
        hasOrderId: !!hasOrderId,
        orderIdPhrase: orderIdPhrase || null,
        trackingPhrase: trackingPhrase || null,
        createdBy: email,
      });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================
  // Task Prompts (for autonomous task watcher)
  // ============================================================

  app.get("/api/shop-agent/task-prompts", async (_req, res) => {
    try {
      const prompts = await storage.getTaskPrompts();
      res.json(prompts);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/shop-agent/task-prompts/:taskType", async (req, res) => {
    try {
      const taskType = decodeURIComponent(req.params.taskType);
      const { promptTemplate } = req.body;
      if (!promptTemplate) return res.status(400).json({ error: "promptTemplate is required" });
      const result = await storage.upsertTaskPrompt(taskType, promptTemplate);
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============================================================
  // Recipe Knowledge (accumulated knowledge base)
  // ============================================================

  app.get("/api/shop-agent/recipe-knowledge", async (_req, res) => {
    try {
      const knowledge = await storage.getRecipeKnowledge();
      res.json(knowledge);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/shop-agent/recipe-knowledge", async (req, res) => {
    try {
      const { category, topic, content, examples, tags } = req.body;
      if (!category || !topic || !content) return res.status(400).json({ error: "category, topic, content are required" });
      const result = await storage.createRecipeKnowledge({ category, topic, content, examples, tags });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put("/api/shop-agent/recipe-knowledge/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { category, topic, content, examples, tags } = req.body;
      const result = await storage.updateRecipeKnowledge(id, { category, topic, content, examples, tags });
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/shop-agent/recipe-knowledge/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteRecipeKnowledge(id);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Get orders eligible for checking (from CRM cache) with pagination
  app.get("/api/shop-agent/orders", (req, res, next) => {
    console.log("[shop-agent/orders] Route hit, authenticated:", !!req.user);
    next();
  }, async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page)) || 1);
      const perPage = Math.min(5000, Math.max(10, parseInt(String(req.query.perPage)) || 50));

      console.log("[shop-agent/orders] Fetching orders...");
      const storeFilter = req.query.store ? String(req.query.store) : "";
      const recipeFilter = req.query.recipeFilter ? String(req.query.recipeFilter) : "";
      const allOrders = await storage.getCachedOrdersByStatuses(["vystavlen-invoice-klientu"]);
      console.log(`[shop-agent/orders] Found ${allOrders.length} orders`);

      // Load recipes for stats and filtering
      const allRecipes = await storage.getShopRecipes();
      const emailRecipeDomains = new Set(allRecipes.filter(r => r.loginType === "email_parsing").map(r => r.domain));
      const browserRecipeDomains = new Set(allRecipes.filter(r => r.loginType !== "email_parsing").map(r => r.domain));

      // Load fallback credentials from shop_credentials table
      let credentialDomains = new Set<string>();
      try {
        const creds = await storage.getShopCredentials();
        for (const c of creds) {
          credentialDomains.add(`${c.domain}:${c.email}`);
        }
      } catch { /* ignore */ }

      // Load check methods for all shops
      const checkMethodsArr = await storage.getShopCheckMethods();
      const checkMethodsMap = new Map(checkMethodsArr.map(m => [m.shopName, m.checkMethod]));
      const getCheckMethod = (shopName: string): string => {
        if (checkMethodsMap.has(shopName)) return checkMethodsMap.get(shopName)!;
        return shopName.toLowerCase().includes("modivo") ? "lk" : "email";
      };

      const mapped = allOrders.map((o) => {
        const payload = o.payload as any;
        const cf = payload?.customFields || {};
        const shipmentStore = storeNameToDomain(payload?.shipmentStore || "");
        const shopOrderId = cf.id_zakaza_y_sklada_otgruzki || "";
        const orderEmail = cf.order_email_address || "";
        const orderPassword = cf.order_email_password || "";
        const legalEntity = cf.iul_vykupa1c || "";
        const trackingNumber = cf.trek_nomer_cklada_otgruzki_nomer || "";

        // Check fallback credentials from shop_credentials table
        const hasFallbackCred = !orderPassword && orderEmail && credentialDomains.has(`${shipmentStore}:${orderEmail}`);

        // Purchase date = when order entered current status
        const purchaseDate: string | null = payload?.statusUpdatedAt || null;
        const daysSincePurchase: number | null = purchaseDate
          ? Math.floor((Date.now() - new Date(purchaseDate).getTime()) / 86400000)
          : null;

        return {
          crmOrderId: o.orderId,
          createdDate: o.createdDate,
          status: o.status,
          site: o.site,
          shipmentStore,
          shopOrderId,
          orderEmail,
          orderPassword: orderPassword ? "есть" : hasFallbackCred ? "fallback" : "",
          hasCredentials: !!(orderEmail && (orderPassword || hasFallbackCred)),
          legalEntity,
          trackingNumber,
          totalSum: o.totalSum,
          purchaseDate,
          daysSincePurchase,
          crmNumber: payload?.number ? String(payload.number) : "",
          estimatedDeliveryDate: null as string | null,
          hasRecipe: emailRecipeDomains.has(shipmentStore) || browserRecipeDomains.has(shipmentStore),
          // Unified check fields
          checkMethod: getCheckMethod(shipmentStore),
          checkStatus: null as string | null,
          checkResult: null as string | null,
          checkTrack: null as string | null,
          checkCarrier: null as string | null,
          checkedAt: null as string | null,
        };
      });

      // Filter by shipmentStore if requested
      let filtered = storeFilter
        ? mapped.filter((o) => o.shipmentStore.toLowerCase().includes(storeFilter.toLowerCase()))
        : [...mapped];

      // Search by order number (CRM order ID, CRM number, or shop order ID)
      const searchQuery = req.query.search ? String(req.query.search).trim().toLowerCase() : "";
      if (searchQuery) {
        filtered = filtered.filter((o) =>
          o.crmOrderId.toLowerCase().includes(searchQuery) ||
          o.shopOrderId.toLowerCase().includes(searchQuery) ||
          o.crmNumber.toLowerCase().includes(searchQuery)
        );
      }

      // Filter by recipe type if requested (pre-check filters)
      // Non-overlapping categories: emailOnly = has email but NOT lk, lkOnly = has lk but NOT email, both = has both
      if (recipeFilter === "emailOnly") {
        filtered = filtered.filter((o) => emailRecipeDomains.has(o.shipmentStore) && !browserRecipeDomains.has(o.shipmentStore));
      } else if (recipeFilter === "lkOnly") {
        filtered = filtered.filter((o) => browserRecipeDomains.has(o.shipmentStore) && !emailRecipeDomains.has(o.shipmentStore));
      } else if (recipeFilter === "both") {
        filtered = filtered.filter((o) => emailRecipeDomains.has(o.shipmentStore) && browserRecipeDomains.has(o.shipmentStore));
      } else if (recipeFilter === "recipe") {
        filtered = filtered.filter((o) => emailRecipeDomains.has(o.shipmentStore) || browserRecipeDomains.has(o.shipmentStore));
      }

      // Fetch check results for ALL filtered orders (needed for sorting across pages)
      const allCrmIds = filtered.map((o) => o.crmOrderId);
      if (allCrmIds.length > 0) {
        try {
          // Process in batches of 500 to avoid too-large queries
          for (let i = 0; i < allCrmIds.length; i += 500) {
            const batch = allCrmIds.slice(i, i + 500);
            const latestChecks = await storage.getLatestChecksByTypeByCrmOrderIds(batch);
            for (const check of latestChecks) {
              const item = filtered.find((o) => o.crmOrderId === check.crmOrderId);
              if (!item) continue;
              // Determine check type from stepsLog source or shopDomain
              let checkSource = "lk";
              try {
                const log = check.stepsLog ? JSON.parse(check.stepsLog) : {};
                if (log.source === "fastmail-recipe" || log.source === "fastmail") checkSource = "email";
              } catch { /* ignore */ }
              if (check.shopDomain === "email-check") checkSource = "email";
              // Only use the check that matches the configured method for this shop
              if (checkSource !== item.checkMethod) continue;
              item.checkStatus = check.newStatus;
              item.checkResult = check.checkResult;
              item.checkTrack = check.trackingNumber;
              item.checkedAt = check.checkedAt ? new Date(check.checkedAt).toISOString() : null;
              // Estimated delivery date from browser recipe
              if (check.estimatedDeliveryDate) {
                item.estimatedDeliveryDate = check.estimatedDeliveryDate;
              }
              if (checkSource === "email") {
                try {
                  const log = check.stepsLog ? JSON.parse(check.stepsLog) : {};
                  item.checkCarrier = log.carrierName ?? null;
                } catch { /* ignore */ }
              }
            }
          }
        } catch (err) {
          console.error("[shop-agent/orders] Error fetching checks:", err);
        }
      }

      // Post-check filters (require check data to be loaded first)
      if (recipeFilter === "checked") {
        filtered = filtered.filter((o) => o.checkedAt);
      } else if (recipeFilter === "tracking") {
        filtered = filtered.filter((o) => o.checkTrack || o.trackingNumber);
      }

      // Server-side sorting (across all pages)
      const sortField = req.query.sortField ? String(req.query.sortField) : "";
      const sortDir = req.query.sortDir === "desc" ? "desc" : "asc";
      if (sortField) {
        filtered.sort((a: any, b: any) => {
          let va = a[sortField] ?? "";
          let vb = b[sortField] ?? "";
          if (typeof va === "number" && typeof vb === "number") {
            return sortDir === "asc" ? va - vb : vb - va;
          }
          const cmp = String(va).localeCompare(String(vb), "ru", { numeric: true });
          return sortDir === "asc" ? cmp : -cmp;
        });
      }

      const total = filtered.length;
      const totalPages = Math.ceil(total / perPage);
      const start = (page - 1) * perPage;
      const items = filtered.slice(start, start + perPage);

      // Collect unique shipmentStores for filter dropdown
      const stores = [...new Set(mapped.map((o) => o.shipmentStore).filter(Boolean))].sort();

      // Aggregate stats across ALL filtered orders (not just current page)
      // Non-overlapping recipe categories
      const stats = {
        emailOnly: filtered.filter((o) => emailRecipeDomains.has(o.shipmentStore) && !browserRecipeDomains.has(o.shipmentStore)).length,
        lkOnly: filtered.filter((o) => browserRecipeDomains.has(o.shipmentStore) && !emailRecipeDomains.has(o.shipmentStore)).length,
        both: filtered.filter((o) => emailRecipeDomains.has(o.shipmentStore) && browserRecipeDomains.has(o.shipmentStore)).length,
        withAnyRecipe: filtered.filter((o) => emailRecipeDomains.has(o.shipmentStore) || browserRecipeDomains.has(o.shipmentStore)).length,
        checked: filtered.filter((o) => o.checkedAt).length,
        withTracking: filtered.filter((o) => o.checkTrack || o.trackingNumber).length,
      };

      res.json({ items, total, page, perPage, totalPages, stores, stats });
    } catch (error: any) {
      console.error("[shop-agent] Error fetching orders:", error);
      res.status(500).json({ error: error.message || "Failed to get orders" });
    }
  });

  // Start a check run
  app.post("/api/shop-agent/check", async (req, res) => {
    try {
      const { checkOrders } = await import("./shop-agent/agent");
      const { orderIds, hints, storeFilter } = req.body || {};
      // Start check in background, respond immediately
      checkOrders(orderIds, hints, storeFilter).catch((err) => {
        console.error("[shop-agent] Check error:", err);
      });
      res.json({ started: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to start check" });
    }
  });

  // Get check progress (polling)
  app.get("/api/shop-agent/status", async (_req, res) => {
    try {
      const { getCheckProgress } = await import("./shop-agent/agent");
      res.json(getCheckProgress());
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get status" });
    }
  });

  // Get check history
  app.get("/api/shop-agent/history", async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit)) || 50;
      const checks = await storage.getShopOrderChecks(limit);
      res.json(checks);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get history" });
    }
  });

  // Get all recipes
  app.get("/api/shop-agent/recipes", async (_req, res) => {
    try {
      const recipes = await storage.getShopRecipes();
      res.json(recipes);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get recipes" });
    }
  });

  // Update a recipe
  app.put("/api/shop-agent/recipes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const recipe = await storage.updateShopRecipe(id, req.body);
      if (!recipe) return res.status(404).json({ error: "Recipe not found" });
      res.json(recipe);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update recipe" });
    }
  });

  // Get all credentials (passwords masked)
  app.get("/api/shop-agent/credentials", async (_req, res) => {
    try {
      const creds = await storage.getShopCredentials();
      const masked = creds.map((c) => ({
        ...c,
        encryptedPassword: "••••••",
      }));
      res.json(masked);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to get credentials" });
    }
  });

  // Add credentials
  app.post("/api/shop-agent/credentials", async (req, res) => {
    try {
      const { domain, email, password, loginUrl, notes, legalEntity } = req.body;
      if (!domain || !email || !password) {
        return res.status(400).json({ error: "domain, email, and password are required" });
      }
      const { encrypt } = await import("./shop-agent/crypto");
      const encryptedPassword = encrypt(password);
      const cred = await storage.createShopCredential({
        domain,
        email,
        encryptedPassword,
        loginUrl: loginUrl || null,
        notes: notes || null,
        legalEntity: legalEntity || null,
      });
      res.json({ ...cred, encryptedPassword: "••••••" });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to create credential" });
    }
  });

  // Update credentials
  app.put("/api/shop-agent/credentials/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { domain, email, password, loginUrl, notes, status, legalEntity } = req.body;
      const updateData: any = {};
      if (domain !== undefined) updateData.domain = domain;
      if (email !== undefined) updateData.email = email;
      if (loginUrl !== undefined) updateData.loginUrl = loginUrl;
      if (notes !== undefined) updateData.notes = notes;
      if (status !== undefined) updateData.status = status;
      if (legalEntity !== undefined) updateData.legalEntity = legalEntity;
      if (password) {
        const { encrypt } = await import("./shop-agent/crypto");
        updateData.encryptedPassword = encrypt(password);
      }
      const cred = await storage.updateShopCredential(id, updateData);
      if (!cred) return res.status(404).json({ error: "Credential not found" });
      res.json({ ...cred, encryptedPassword: "••••••" });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update credential" });
    }
  });

  // Delete credentials
  app.delete("/api/shop-agent/credentials/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteShopCredential(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete credential" });
    }
  });

  // Delete recipe
  app.delete("/api/shop-agent/recipes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteShopRecipe(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete recipe" });
    }
  });

  // Get AI system prompt
  app.get("/api/shop-agent/prompt", async (_req, res) => {
    try {
      const { DEFAULT_SYSTEM_PROMPT } = await import("./shop-agent/ai-navigator");
      const prompt = await storage.getAppSetting("shop_agent_system_prompt");
      res.json({ prompt: prompt || DEFAULT_SYSTEM_PROMPT });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Save AI system prompt
  app.put("/api/shop-agent/prompt", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({ error: "prompt is required" });
      }
      await storage.setAppSetting("shop_agent_system_prompt", prompt);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Import credentials from CSV
  app.post("/api/shop-agent/credentials/import", async (req, res) => {
    try {
      const { csvData, legalEntity } = req.body;
      if (!csvData || !legalEntity) {
        return res.status(400).json({ error: "csvData and legalEntity are required" });
      }
      const { encrypt } = await import("./shop-agent/crypto");
      const lines = csvData.trim().split("\n");
      const header = lines[0].toLowerCase();
      const hasHeader = header.includes("domain") || header.includes("email") || header.includes("домен");
      const dataLines = hasHeader ? lines.slice(1) : lines;

      let imported = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const line of dataLines) {
        if (!line.trim()) { skipped++; continue; }
        const parts = line.split(/[,;\t]/).map((s: string) => s.trim().replace(/^["']|["']$/g, ""));
        const [domain, email, password, loginUrl, notes] = parts;
        if (!domain || !email || !password) { skipped++; continue; }
        try {
          const encryptedPassword = encrypt(password);
          await storage.createShopCredential({
            domain,
            email,
            encryptedPassword,
            loginUrl: loginUrl || null,
            notes: notes || null,
            legalEntity,
          });
          imported++;
        } catch (err: any) {
          if (err.message?.includes("unique") || err.code === "23505") {
            skipped++;
          } else {
            errors.push(`${domain}:${email}: ${err.message}`);
          }
        }
      }

      res.json({ imported, skipped, errors });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to import credentials" });
    }
  });

  // Check email for order tracking info via Fastmail
  // If shopDomain is provided and an email recipe exists → use recipe engine
  // Otherwise → fallback to generic searchOrderInEmail
  app.post("/api/shop-agent/check-email", async (req, res) => {
    try {
      const { orderId, shopOrderId, legalEntity, shopDomain } = req.body;
      if (!shopOrderId) {
        return res.status(400).json({ error: "shopOrderId is required" });
      }
      if (!legalEntity) {
        return res.status(400).json({ error: "legalEntity is required to determine Fastmail account" });
      }

      console.log(`[check-email] orderId=${orderId} shopOrderId=${shopOrderId} legalEntity=${legalEntity} shopDomain=${shopDomain}`);

      // Try email recipe first if shopDomain is provided
      if (shopDomain) {
        const emailRecipe = await storage.getEmailRecipeByDomain(shopDomain);
        console.log(`[check-email] Recipe for ${shopDomain}:`, emailRecipe ? `id=${emailRecipe.id}` : "NOT FOUND");
        if (emailRecipe) {
          const { executeEmailRecipe } = await import("./email-recipe-engine");
          const recipeJson = emailRecipe.recipeJson as any;
          const startTime = Date.now();
          const recipeResult = await executeEmailRecipe(recipeJson, shopOrderId, legalEntity);
          const durationMs = Date.now() - startTime;

          // Update recipe stats
          try {
            if (recipeResult.found) {
              await storage.updateShopRecipe(emailRecipe.id, {
                successCount: (emailRecipe.successCount || 0) + 1,
                lastUsedAt: new Date(),
              });
            } else {
              await storage.updateShopRecipe(emailRecipe.id, {
                failCount: (emailRecipe.failCount || 0) + 1,
                lastUsedAt: new Date(),
              });
            }
          } catch (statErr) {
            console.error("[check-email] Failed to update recipe stats:", statErr);
          }

          // Save check result
          if (orderId) {
            try {
              await storage.createShopOrderCheck({
                crmOrderId: String(orderId),
                shopDomain: shopDomain,
                shopOrderId: String(shopOrderId),
                previousStatus: null,
                newStatus: recipeResult.found ? recipeResult.status : "Писем нет",
                trackingNumber: recipeResult.trackingNumber,
                referenceNumber: recipeResult.referenceNumber,
                checkResult: recipeResult.found ? "success" : "not_found",
                errorMessage: recipeResult.found ? null : "No matching emails found via recipe",
                stepsLog: JSON.stringify({
                  source: "fastmail-recipe",
                  recipeDomain: recipeResult.recipeDomain,
                  legalEntity,
                  emailsAnalyzed: recipeResult.emailsAnalyzed,
                  matchedEmails: recipeResult.matchedEmails.length,
                  carrierName: recipeResult.carrierName,
                  deliveryDate: recipeResult.deliveryDate,
                }),
                screenshotPath: null,
                durationMs,
                aiTokensUsed: 0,
                recipeUsed: true,
              });
            } catch (saveErr) {
              console.error("[check-email] Failed to save recipe check result:", saveErr);
            }
          }

          // Return in unified format
          return res.json({
            found: recipeResult.found,
            emails: recipeResult.matchedEmails.map(m => ({
              id: m.emailId,
              subject: m.subject,
              from: m.from,
              receivedAt: m.receivedAt,
              snippet: `[${m.matchedType}] status=${m.extractedStatus}`,
            })),
            orderStatus: recipeResult.status || undefined,
            trackingNumber: recipeResult.trackingNumber || undefined,
            carrierName: recipeResult.carrierName || undefined,
            deliveryDate: recipeResult.deliveryDate || undefined,
            referenceNumber: recipeResult.referenceNumber || undefined,
            rawSubject: recipeResult.matchedEmails[0]?.subject,
            receivedAt: recipeResult.matchedEmails[0]?.receivedAt,
            recipeUsed: true,
            recipeDomain: recipeResult.recipeDomain,
            emailsAnalyzed: recipeResult.emailsAnalyzed,
          });
        }
      }

      // Fallback: generic search
      const { searchOrderInEmail } = await import("./fastmail-search");
      const result = await searchOrderInEmail(shopOrderId, legalEntity);

      // Always store the result in shopOrderChecks table (both found and not_found)
      if (orderId) {
        try {
          await storage.createShopOrderCheck({
            crmOrderId: String(orderId),
            shopDomain: shopDomain || "email-check",
            shopOrderId: String(shopOrderId),
            previousStatus: null,
            newStatus: result.found ? (result.orderStatus || null) : "Писем нет",
            trackingNumber: result.found ? (result.trackingNumber || null) : null,
            referenceNumber: null,
            checkResult: result.found ? "success" : "not_found",
            errorMessage: result.found ? null : "No emails found for this order",
            stepsLog: JSON.stringify({
              source: "fastmail",
              legalEntity,
              emailsFound: result.emails?.length || 0,
              subject: result.rawSubject || null,
              receivedAt: result.receivedAt || null,
              carrierName: result.carrierName || null,
            }),
            screenshotPath: null,
            durationMs: 0,
            aiTokensUsed: 0,
            recipeUsed: false,
          });
        } catch (saveErr) {
          console.error("[check-email] Failed to save check result:", saveErr);
        }
      }

      res.json(result);
    } catch (error: any) {
      console.error("[check-email] Error:", error);
      res.status(500).json({ error: error.message || "Failed to check email" });
    }
  });

  // ============= Email Recipe CRUD =============

  // List all email recipes
  app.get("/api/shop-agent/email-recipes", async (_req, res) => {
    try {
      const allRecipes = await storage.getShopRecipes();
      const emailRecipes = allRecipes.filter(r => r.loginType === "email_parsing");
      res.json(emailRecipes);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch email recipes" });
    }
  });

  // Create email recipe
  app.post("/api/shop-agent/email-recipes", async (req, res) => {
    try {
      const { domain, recipeJson } = req.body;
      if (!domain || !recipeJson) {
        return res.status(400).json({ error: "domain and recipeJson are required" });
      }

      // Validate recipe structure
      if (!recipeJson.senderPatterns || !recipeJson.emailTypes || !recipeJson.statusPriority) {
        return res.status(400).json({ error: "recipeJson must have senderPatterns, emailTypes, statusPriority" });
      }

      // Check if recipe already exists
      const existing = await storage.getEmailRecipeByDomain(domain);
      if (existing) {
        // Update existing
        const updated = await storage.updateShopRecipe(existing.id, { recipeJson });
        return res.json(updated);
      }

      const recipe = await storage.createShopRecipe({
        domain,
        loginType: "email_parsing",
        recipeJson,
      });
      res.json(recipe);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to create email recipe" });
    }
  });

  // Update email recipe
  app.put("/api/shop-agent/email-recipes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { recipeJson } = req.body;
      if (!recipeJson) {
        return res.status(400).json({ error: "recipeJson is required" });
      }
      const updated = await storage.updateShopRecipe(id, { recipeJson });
      if (!updated) {
        return res.status(404).json({ error: "Recipe not found" });
      }
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to update email recipe" });
    }
  });

  // Delete email recipe
  app.delete("/api/shop-agent/email-recipes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.deleteShopRecipe(id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete email recipe" });
    }
  });

  // ============= Email Samples (for recipe creation) =============

  // Search sample emails from a shop domain
  app.post("/api/shop-agent/email-samples", async (req, res) => {
    try {
      const { shopDomain, legalEntity, limit } = req.body;
      if (!shopDomain) {
        return res.status(400).json({ error: "shopDomain is required" });
      }
      if (!legalEntity) {
        return res.status(400).json({ error: "legalEntity is required" });
      }

      const { searchSampleEmails } = await import("./fastmail-search");
      const emails = await searchSampleEmails(shopDomain, legalEntity, limit || 20);

      res.json({
        domain: shopDomain,
        legalEntity,
        count: emails.length,
        emails: emails.map(e => ({
          id: e.id,
          subject: e.subject,
          from: e.from,
          receivedAt: e.receivedAt,
          textBodyPreview: e.textBody.slice(0, 2000),
          htmlBodyPreview: e.htmlBody.slice(0, 3000),
        })),
      });
    } catch (error: any) {
      console.error("[email-samples] Error:", error);
      res.status(500).json({ error: error.message || "Failed to search sample emails" });
    }
  });

  return httpServer;
}
// Helper function to fetch emails from FastMail
async function fetchFastMailEmails(apiToken: string, accountId: string, days: number = 30): Promise<any[]> {
  try {
    // First get JMAP session
    const sessionRes = await fetch("https://api.fastmail.com/jmap/session", {
      headers: { "Authorization": `Bearer ${apiToken}` },
    });
    const session = await sessionRes.json();
    const apiUrl = session.apiUrl;
    const primaryAccountId = Object.keys(session.accounts || {})[0] || accountId;
    
    // Query recent emails for specified period
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        methodCalls: [
          ["Email/query", {
            accountId: primaryAccountId,
            filter: {
              after: sinceDate.toISOString(),
            },
            sort: [{ property: "receivedAt", isAscending: false }],
            limit: 100,
          }, "0"],
          ["Email/get", {
            accountId: primaryAccountId,
            "#ids": { resultOf: "0", name: "Email/query", path: "/ids" },
            properties: ["id", "subject", "from", "receivedAt", "textBody", "htmlBody", "bodyValues"],
            fetchTextBodyValues: true,
            fetchHTMLBodyValues: true,
          }, "1"],
        ],
      }),
    });
    
    const data = await response.json();
    const emails = data.methodResponses?.[1]?.[1]?.list || [];
    
    // Process emails to extract text content
    return emails.map((email: any) => {
      let textBody = "";
      let htmlBody = "";
      
      if (email.bodyValues) {
        for (const partId of (email.textBody || [])) {
          if (email.bodyValues[partId.partId]) {
            textBody += email.bodyValues[partId.partId].value || "";
          }
        }
        for (const partId of (email.htmlBody || [])) {
          if (email.bodyValues[partId.partId]) {
            htmlBody += email.bodyValues[partId.partId].value || "";
          }
        }
      }
      
      return {
        id: email.id,
        subject: email.subject,
        from: email.from,
        receivedAt: email.receivedAt,
        textBody,
        htmlBody,
      };
    });
  } catch (error) {
    console.error("FastMail fetch error:", error);
    return [];
  }
}

// Helper function to fetch single email content
async function fetchFastMailEmailContent(apiToken: string, accountId: string, emailId: string): Promise<any> {
  try {
    const sessionRes = await fetch("https://api.fastmail.com/jmap/session", {
      headers: { "Authorization": `Bearer ${apiToken}` },
    });
    const session = await sessionRes.json();
    const apiUrl = session.apiUrl;
    const primaryAccountId = Object.keys(session.accounts || {})[0] || accountId;
    
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        methodCalls: [
          ["Email/get", {
            accountId: primaryAccountId,
            ids: [emailId],
            properties: ["id", "subject", "from", "to", "receivedAt", "textBody", "htmlBody", "bodyValues"],
            fetchTextBodyValues: true,
            fetchHTMLBodyValues: true,
          }, "0"],
        ],
      }),
    });
    
    const data = await response.json();
    const email = data.methodResponses?.[0]?.[1]?.list?.[0];
    
    if (!email) return null;
    
    let htmlContent = "";
    if (email.bodyValues && email.htmlBody) {
      for (const partId of email.htmlBody) {
        if (email.bodyValues[partId.partId]) {
          htmlContent += email.bodyValues[partId.partId].value || "";
        }
      }
    }
    
    let textContent = "";
    if (email.bodyValues && email.textBody) {
      for (const partId of email.textBody) {
        if (email.bodyValues[partId.partId]) {
          textContent += email.bodyValues[partId.partId].value || "";
        }
      }
    }
    
    return {
      id: email.id,
      subject: email.subject,
      from: email.from,
      to: email.to,
      receivedAt: email.receivedAt,
      htmlContent,
      textContent,
    };
  } catch (error) {
    console.error("FastMail email fetch error:", error);
    return null;
  }
}
