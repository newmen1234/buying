import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  RefreshCw,
  CheckCircle,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Search,
  History,
  Settings,
  Store as StoreIcon,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Mail,
  Monitor,
  Eye,
  Trash2,
  AlertTriangle,
  Info,
  Plus,
  FileText,
  BookOpen,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";

// Types
interface ShopOrder {
  crmOrderId: string;
  createdDate: string;
  status: string;
  site: string | null;
  shipmentStore: string;
  shopOrderId: string;
  orderEmail: string;
  orderPassword: string;
  hasCredentials: boolean;
  legalEntity: string;
  trackingNumber: string;
  totalSum: number;
  purchaseDate: string | null;
  daysSincePurchase: number | null;
  estimatedDeliveryDate: string | null;
  hasRecipe: boolean;
  // Unified check fields
  checkMethod: string | null;
  checkStatus: string | null;
  checkResult: string | null;
  checkTrack: string | null;
  checkCarrier: string | null;
  checkedAt: string | null;
}

interface PaginatedOrders {
  items: ShopOrder[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  stores?: string[];
  stats?: {
    emailOnly: number;
    lkOnly: number;
    both: number;
    withAnyRecipe: number;
    checked: number;
    withTracking: number;
  };
}

interface LiveStep {
  step: number;
  action: string;
  description: string;
  status: "ok" | "failed" | "skipped" | "running";
  url?: string;
}

interface CheckProgress {
  total: number;
  completed: number;
  current: string | null;
  status: "idle" | "running" | "done" | "error";
  results: any[];
  startedAt: number | null;
  liveSteps: LiveStep[];
  currentUrl: string | null;
}

interface ShopOrderCheck {
  id: number;
  crmOrderId: string;
  shopDomain: string;
  shopOrderId: string | null;
  previousStatus: string | null;
  newStatus: string | null;
  trackingNumber: string | null;
  referenceNumber: string | null;
  checkResult: string;
  errorMessage: string | null;
  stepsLog: string | null;
  durationMs: number | null;
  aiTokensUsed: number | null;
  recipeUsed: boolean | null;
  checkedAt: string;
}

interface ShopRecipe {
  id: number;
  domain: string;
  loginType: string;
  recipeJson: any;
  successCount: number | null;
  failCount: number | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ShopCredentialBrief {
  id: number;
  domain: string;
  email: string;
  legalEntity: string | null;
}

interface EmailSearchResult {
  found: boolean;
  emails: { id: string; subject: string; from: string; receivedAt: string; snippet: string }[];
  orderStatus?: string;
  trackingNumber?: string;
  carrierName?: string;
  rawSubject?: string;
  receivedAt?: string;
}

// ============= Helpers =============
function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
}

const STATUS_RU: Record<string, string> = {
  order_placed: "Оформлен",
  preparing: "Готовится",
  in_transit: "В пути",
  shipped: "Отправлен",
  delivered: "Доставлен",
  cancelled: "Отменён",
  returned: "Возврат",
  pending: "Ожидает",
  processing: "Обработка",
  out_for_delivery: "Курьер в пути",
  ready_for_pickup: "Готов к выдаче",
  confirmed: "Подтверждён",
};

function translateStatus(status: string | null): string {
  if (!status) return "—";
  return STATUS_RU[status] || status;
}

function buildUrlFromNumber(num: string): string | null {
  if (/^0\d{12,14}[A-Za-z]?$/.test(num))
    return `https://tracking.dpd.de/status/de_DE/parcel/${num}`;
  if (/^H\d{18,20}$/.test(num))
    return `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#${num}`;
  if (/^\d{10,12}$/.test(num))
    return `https://gls-group.com/DE/de/paketverfolgung?match=${num}`;
  // DHL: 10-20 digits or JJD + digits
  if (/^(JJD\d{15,20}|\d{12,20})$/.test(num) && !/^0\d{12,14}[A-Za-z]?$/.test(num))
    return `https://www.dhl.de/de/privatkunden/dhl-sendungsverfolgung.html?piececode=${num}`;
  // UPS: 1Z + alphanumeric
  if (/^1Z[A-Z0-9]{16,18}$/i.test(num))
    return `https://www.ups.com/track?tracknum=${num}`;
  // Deutsche Post (JVGL + digits)
  if (/^JVGL\d+$/.test(num))
    return `https://www.dhl.de/de/privatkunden/dhl-sendungsverfolgung.html?piececode=${num}`;
  // Evri / Hermes EU (HZYEJC + digits)
  if (/^HZYEJC\d+$/.test(num))
    return `https://www.evri.com/track-a-parcel/${num}`;
  return null;
}

function parseTracking(raw: string | null | undefined): { number: string; url: string | null; courier: string } | null {
  if (!raw) return null;
  if (raw.startsWith("http")) {
    const hashIdx = raw.indexOf("#");
    const hashPart = hashIdx >= 0 ? raw.substring(hashIdx + 1) : null;
    const m = raw.match(/[?&](?:parcelno|trackid|code|number|segOnlineIdentificador|match|tracking-id|tracknum|shippingNumber|barcode)=([^&]+)/i);
    const number = m ? m[1] : hashPart || raw.replace(/^https?:\/\//, "").slice(0, 40);
    const courier = detectCourier(raw, number);
    return { number, url: raw, courier };
  }
  const courier = detectCourier(null, raw);
  const url = buildUrlFromNumber(raw);
  return { number: raw, url, courier };
}

function detectCourier(url: string | null, number: string): string {
  if (url) {
    if (url.includes("dpd.de")) return "DPD";
    if (url.includes("seur.com")) return "SEUR";
    if (url.includes("gls-group.com")) return "GLS";
    if (url.includes("dhl.com") || url.includes("dhl.de")) return "DHL";
    if (url.includes("hermes")) return "Hermes";
    if (url.includes("ups.com")) return "UPS";
    if (url.includes("correos")) return "Correos";
    if (url.includes("spring-gds.com")) return "Hermes";
    if (url.includes("evri.com")) return "Hermes";
  }
  if (/^0\d{12,14}[A-Za-z]?$/.test(number)) return "DPD";
  if (/^H\d{18,20}$/.test(number)) return "Hermes";
  if (/^HZYEJC\d+$/.test(number)) return "Hermes";
  if (/^\d{10,12}$/.test(number)) return "GLS";
  if (/^(JJD\d{15,20}|\d{12,20})$/.test(number)) return "DHL";
  if (/^1Z[A-Z0-9]{16,18}$/i.test(number)) return "UPS";
  if (/^JVGL\d+$/.test(number)) return "Deutsche Post";
  return "";
}

function getRecipeTooltip(recipe: ShopRecipe): string {
  const json = recipe.recipeJson;
  if (!json) return "Пустой рецепт";
  const statsLine = `✓ ${recipe.successCount || 0} успешно / ✗ ${recipe.failCount || 0} неудач`;

  if (recipe.loginType === "email_parsing") {
    const emailTypes: any[] = json.emailTypes || [];
    // Collect carriers from carrierPatterns
    const carrierSet = new Set<string>();
    let hasTracking = false;
    const statusSet = new Set<string>();
    for (const et of emailTypes) {
      if (et.impliedStatus) statusSet.add(et.impliedStatus);
      const cp: string[] = et.extraction?.carrierPatterns || [];
      for (const p of cp) {
        for (const c of ["DHL", "Hermes", "DPD", "UPS", "GLS", "Deutsche Post"]) {
          if (p.includes(c)) carrierSet.add(c);
        }
      }
      if (et.extraction?.trackingPatterns?.length) hasTracking = true;
    }
    const parts: string[] = [];
    if (carrierSet.size > 0) parts.push(Array.from(carrierSet).join("/"));
    const statuses = Array.from(statusSet);
    if (statuses.length > 0) {
      const order = ["confirmed", "processing", "shipped", "delivered", "cancelled", "returned"];
      statuses.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      parts.push(statuses.join("→"));
    }
    parts.push(hasTracking ? "трек" : "без трекинга");
    parts.push(`${emailTypes.length} тип${emailTypes.length === 1 ? "" : emailTypes.length < 5 ? "а" : "ов"} писем`);
    return parts.join(" · ") + "\n" + statsLine;
  }

  // Browser recipe (ЛК)
  const steps: any[] = json.steps || [];
  const mapping = json.statusMapping || {};
  const mappedStatuses = Object.values(mapping) as string[];
  const parts: string[] = ["ЛК"];
  if (steps.length > 0) parts.push(`${steps.length} шагов`);
  if (mappedStatuses.length > 0) parts.push(mappedStatuses.join("/"));
  return parts.join(" · ") + "\n" + statsLine;
}

function formatPurchaseDate(purchaseDate: string | null, createdDate: string | null): string {
  if (!purchaseDate) return "—";
  const pd = new Date(purchaseDate);
  if (isNaN(pd.getTime())) return "—";
  const dd = String(pd.getDate()).padStart(2, "0");
  const mm = String(pd.getMonth() + 1).padStart(2, "0");
  const yy = String(pd.getFullYear()).slice(-2);
  let suffix = "";
  if (createdDate) {
    const cd = new Date(createdDate);
    if (!isNaN(cd.getTime())) {
      const diffDays = Math.floor((pd.getTime() - cd.getTime()) / 86400000);
      if (diffDays >= 0) suffix = ` (+${diffDays})`;
    }
  }
  return `${dd}.${mm}.${yy}${suffix}`;
}

// ============= Sort types =============
type SortField = "createdDate" | "shipmentStore" | "shopOrderId" | "orderEmail" | "orderPassword" | "legalEntity" | "purchaseDate" | "daysSincePurchase" | "checkStatus" | "checkTrack" | "trackingNumber";
type SortDir = "asc" | "desc";

// ============= Orders Tab =============
function OrdersTab() {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isChecking, setIsChecking] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [storeFilter, setStoreFilter] = useState("");
  const [orderSearch, setOrderSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recipeFilter, setRecipeFilter] = useState<"emailOnly" | "lkOnly" | "both" | "recipe" | "checked" | "tracking" | null>(null);
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<{ total: number; done: number } | null>(null);

  // Debounce order search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(orderSearch);
      setPage(1);
    }, 400);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [orderSearch]);

  const { data, isLoading, error } = useQuery<PaginatedOrders>({
    queryKey: ["/api/shop-agent/orders", page, perPage, storeFilter, recipeFilter, sortField, sortDir, debouncedSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      if (storeFilter) params.set("store", storeFilter);
      if (recipeFilter) params.set("recipeFilter", recipeFilter);
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (sortField) {
        params.set("sortField", sortField);
        params.set("sortDir", sortDir);
      }
      const res = await fetch(`/api/shop-agent/orders?${params}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      return res.json();
    },
  });

  const { data: storesData } = useQuery<PaginatedOrders>({
    queryKey: ["/api/shop-agent/orders", 1, 1, ""],
    queryFn: async () => {
      const res = await fetch(`/api/shop-agent/orders?page=1&perPage=1`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    staleTime: 60000,
  });
  const stores = storesData?.stores || [];

  const orders = data?.items || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 0;
  const stats = data?.stats;

  const { data: progress } = useQuery<CheckProgress>({
    queryKey: ["/api/shop-agent/status"],
    queryFn: async () => {
      const res = await fetch("/api/shop-agent/status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    refetchInterval: isChecking ? 1000 : false,
  });

  const [showProgressCard, setShowProgressCard] = useState(false);

  useEffect(() => {
    if (!isChecking || !progress) return;
    if (progress.status === "done" || progress.status === "error") {
      setIsChecking(false);
      if (progress.status === "done") {
        toast({ title: `Проверка ЛК завершена: ${progress.completed} заказов` });
        queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/history"] });
        queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/orders"] });
      }
      setShowProgressCard(true);
    }
  }, [progress?.status, progress?.completed, isChecking]);

  const checkMutation = useMutation({
    mutationFn: async ({ orderIds, hints, storeFilter: sf }: { orderIds?: string[]; hints?: Record<string, string>; storeFilter?: string }) => {
      return apiRequest("POST", "/api/shop-agent/check", { orderIds, hints, storeFilter: sf });
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/shop-agent/status"], {
        total: 0, completed: 0, current: null, status: "running",
        results: [], startedAt: Date.now(), liveSteps: [], currentUrl: null,
      } as CheckProgress);
      setIsChecking(true);
      setShowProgressCard(true);
      toast({ title: "Проверка ЛК запущена" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const startLkCheck = (orderIds?: string[]) => {
    checkMutation.mutate({ orderIds, storeFilter: !orderIds && storeFilter ? storeFilter : undefined });
  };

  const checkEmailSingle = useCallback(async (order: ShopOrder) => {
    if (!order.shopOrderId) { toast({ title: "Нет номера заказа", variant: "destructive" }); return; }
    if (!order.legalEntity) { toast({ title: "Нет ЮЛ", variant: "destructive" }); return; }
    setCheckingIds((prev) => new Set(prev).add(order.crmOrderId));
    try {
      const res = await apiRequest("POST", "/api/shop-agent/check-email", {
        orderId: order.crmOrderId, shopOrderId: order.shopOrderId, legalEntity: order.legalEntity, shopDomain: order.shipmentStore,
      });
      const result: EmailSearchResult = await res.json();
      toast({ title: result.found ? `${order.shopOrderId}: ${result.emails.length} писем` : `${order.shopOrderId}: писем не найдено` });
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/orders"] });
    } catch (err: any) {
      toast({ title: "Ошибка поиска в почте", description: err.message, variant: "destructive" });
    } finally {
      setCheckingIds((prev) => { const n = new Set(prev); n.delete(order.crmOrderId); return n; });
    }
  }, [toast]);

  const checkEmailBatch = useCallback(async (ordersToCheck: ShopOrder[]) => {
    const valid = ordersToCheck.filter((o) => o.shopOrderId && o.legalEntity);
    if (valid.length === 0) { toast({ title: "Нет заказов для проверки", variant: "destructive" }); return; }
    setBatchProgress({ total: valid.length, done: 0 });
    for (let i = 0; i < valid.length; i++) {
      const o = valid[i];
      setCheckingIds((prev) => new Set(prev).add(o.crmOrderId));
      try {
        await apiRequest("POST", "/api/shop-agent/check-email", {
          orderId: o.crmOrderId, shopOrderId: o.shopOrderId, legalEntity: o.legalEntity, shopDomain: o.shipmentStore,
        });
      } catch { /* continue */ }
      setCheckingIds((prev) => { const n = new Set(prev); n.delete(o.crmOrderId); return n; });
      setBatchProgress({ total: valid.length, done: i + 1 });
    }
    setBatchProgress(null);
    toast({ title: `Email-проверка завершена: ${valid.length} заказов` });
    queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/history"] });
  }, [toast]);

  // Determine forced check method based on recipeFilter
  const getCheckMethodForFilter = (): "email" | "lk" | "both" | null => {
    if (recipeFilter === "emailOnly") return "email";
    if (recipeFilter === "lkOnly") return "lk";
    if (recipeFilter === "both") return "both";
    return null; // use per-order checkMethod
  };

  const splitOrdersByMethod = (ordersToSplit: ShopOrder[], forcedMethod: "email" | "lk" | "both" | null) => {
    let emailOrders: ShopOrder[] = [];
    let lkOrders: ShopOrder[] = [];
    if (forcedMethod === "email") {
      emailOrders = ordersToSplit;
    } else if (forcedMethod === "lk") {
      lkOrders = ordersToSplit;
    } else if (forcedMethod === "both") {
      // Run both methods on all orders
      emailOrders = ordersToSplit;
      lkOrders = ordersToSplit;
    } else {
      // Default: use per-order checkMethod
      emailOrders = ordersToSplit.filter((o) => o.checkMethod === "email");
      lkOrders = ordersToSplit.filter((o) => o.checkMethod === "lk");
    }
    return { emailOrders, lkOrders };
  };

  const startUnifiedCheck = useCallback(async (orderIds?: string[]) => {
    const forcedMethod = getCheckMethodForFilter();
    if (orderIds) {
      // Specific orders selected — use only those, but skip those without recipes
      const ordersToCheck = orders.filter((o) => orderIds.includes(o.crmOrderId) && o.hasRecipe);
      if (ordersToCheck.length === 0) { toast({ title: "Нет заказов с рецептами для проверки", variant: "destructive" }); return; }
      const { emailOrders, lkOrders } = splitOrdersByMethod(ordersToCheck, forcedMethod);
      if (lkOrders.length > 0) startLkCheck(lkOrders.map((o) => o.crmOrderId));
      if (emailOrders.length > 0) await checkEmailBatch(emailOrders);
    } else {
      // "Check all" — fetch ALL matching orders, skip those without recipes
      try {
        const params = new URLSearchParams({ page: "1", perPage: "9999" });
        if (storeFilter) params.set("store", storeFilter);
        if (recipeFilter) params.set("recipeFilter", recipeFilter);
        const res = await fetch(`/api/shop-agent/orders?${params}`, { credentials: "include" });
        if (res.ok) {
          const all = await res.json() as PaginatedOrders;
          const withRecipe = all.items.filter((o: ShopOrder) => o.hasRecipe);
          if (withRecipe.length === 0) { toast({ title: "Нет заказов с рецептами для проверки", variant: "destructive" }); return; }
          const { emailOrders, lkOrders } = splitOrdersByMethod(withRecipe, forcedMethod);
          if (lkOrders.length > 0) startLkCheck(lkOrders.map((o: ShopOrder) => o.crmOrderId));
          if (emailOrders.length > 0) await checkEmailBatch(emailOrders);
        }
      } catch { /* ignore */ }
    }
  }, [orders, storeFilter, recipeFilter, checkMutation, checkEmailBatch, toast]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
    setPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />;
  };

  const toggleSelect = (id: string) => { const next = new Set(selectedIds); if (next.has(id)) next.delete(id); else next.add(id); setSelectedIds(next); };
  const toggleAll = () => { if (selectedIds.size === orders.length && orders.length > 0) setSelectedIds(new Set()); else setSelectedIds(new Set(orders.map((o) => o.crmOrderId))); };

  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  if (error) return (
    <div className="p-6 text-center space-y-2">
      <XCircle className="w-8 h-8 text-destructive mx-auto" />
      <p className="text-sm text-destructive">{(error as Error).message}</p>
      <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/orders"] })}>Повторить</Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Action bar + stats badges in one row */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => startUnifiedCheck(selectedIds.size > 0 ? Array.from(selectedIds) : undefined)} disabled={isChecking || checkMutation.isPending || batchProgress !== null}>
          {isChecking || batchProgress !== null ? (
            <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />{batchProgress ? `${batchProgress.done}/${batchProgress.total}` : "Проверка..."}</>
          ) : (
            <><RefreshCw className="w-4 h-4 mr-1.5" />{selectedIds.size > 0 ? `Проверить (${selectedIds.size})` : recipeFilter === "emailOnly" ? `Проверить email (${total})` : recipeFilter === "lkOnly" ? `Проверить ЛК (${total})` : recipeFilter === "both" ? `Проверить оба (${total})` : recipeFilter ? `Проверить выбранное (${total})` : storeFilter ? `Проверить: все ${storeFilter}` : "Проверить все"}</>
          )}
        </Button>
        <div className="relative">
          <StoreIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <select className="border rounded-md pl-8 pr-8 py-2 text-sm bg-background appearance-none cursor-pointer h-9" value={storeFilter} onChange={(e) => { setStoreFilter(e.target.value); setRecipeFilter(null); setPage(1); setSelectedIds(new Set()); }}>
            <option value="">Все магазины</option>
            {stores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Поиск по № заказа..."
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
            className="border rounded-md pl-8 pr-8 py-2 text-sm bg-background h-9 w-52"
          />
          {orderSearch && (
            <button
              onClick={() => { setOrderSearch(""); setDebouncedSearch(""); setPage(1); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <XCircle className="w-4 h-4" />
            </button>
          )}
        </div>
        <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/orders"] })}>
          <RefreshCw className="w-4 h-4" />
        </Button>

        <div className="w-px h-6 bg-border" />

        <div className="bg-muted rounded-md px-2.5 py-1 text-xs font-medium">
          {total} заказов{storeFilter ? ` (${storeFilter})` : ""}
          {selectedIds.size > 0 && <span className="ml-1 text-blue-600">· {selectedIds.size} выбр.</span>}
        </div>
        {stats && (
          <>
            <div
              className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${recipeFilter === "recipe" ? "bg-emerald-100 ring-1 ring-emerald-400 dark:bg-emerald-900/30" : "bg-muted hover:bg-muted/80"}`}
              onClick={() => { setRecipeFilter(recipeFilter === "recipe" ? null : "recipe"); setPage(1); }}
              title="Фильтр: все заказы с рецептами"
            >
              🧾 {stats.withAnyRecipe} <span className="text-muted-foreground">({total > 0 ? Math.round(stats.withAnyRecipe / total * 100) : 0}%)</span>
            </div>
            <div
              className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${recipeFilter === "emailOnly" ? "bg-purple-100 ring-1 ring-purple-400 dark:bg-purple-900/30" : "bg-muted hover:bg-muted/80"}`}
              onClick={() => { setRecipeFilter(recipeFilter === "emailOnly" ? null : "emailOnly"); setPage(1); }}
              title="Фильтр: только email-рецепт (без ЛК). Проверка → email"
            >
              <Mail className="w-3 h-3 inline mr-1 text-purple-600" />
              {stats.emailOnly} <span className="text-muted-foreground">({total > 0 ? Math.round(stats.emailOnly / total * 100) : 0}%)</span>
            </div>
            <div
              className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${recipeFilter === "lkOnly" ? "bg-blue-100 ring-1 ring-blue-400 dark:bg-blue-900/30" : "bg-muted hover:bg-muted/80"}`}
              onClick={() => { setRecipeFilter(recipeFilter === "lkOnly" ? null : "lkOnly"); setPage(1); }}
              title="Фильтр: только ЛК-рецепт (без email). Проверка → ЛК"
            >
              <Monitor className="w-3 h-3 inline mr-1 text-blue-600" />
              {stats.lkOnly} <span className="text-muted-foreground">({total > 0 ? Math.round(stats.lkOnly / total * 100) : 0}%)</span>
            </div>
            <div
              className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${recipeFilter === "both" ? "bg-indigo-100 ring-1 ring-indigo-400 dark:bg-indigo-900/30" : "bg-muted hover:bg-muted/80"}`}
              onClick={() => { setRecipeFilter(recipeFilter === "both" ? null : "both"); setPage(1); }}
              title="Фильтр: оба рецепта (email + ЛК). Проверка → оба метода"
            >
              <Mail className="w-3 h-3 inline mr-0.5 text-purple-600" /><Monitor className="w-3 h-3 inline mr-1 text-blue-600" />
              {stats.both} <span className="text-muted-foreground">({total > 0 ? Math.round(stats.both / total * 100) : 0}%)</span>
            </div>
            <div
              className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${recipeFilter === "checked" ? "bg-green-100 ring-1 ring-green-400 dark:bg-green-900/30" : "bg-muted hover:bg-muted/80"}`}
              onClick={() => { setRecipeFilter(recipeFilter === "checked" ? null : "checked"); setPage(1); }}
              title="Фильтр: проверенные заказы"
            >
              <CheckCircle2 className="w-3 h-3 inline mr-1 text-green-600" />
              {stats.checked} <span className="text-muted-foreground">({total > 0 ? Math.round(stats.checked / total * 100) : 0}%)</span>
            </div>
            <div
              className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer transition-colors ${recipeFilter === "tracking" ? "bg-orange-100 ring-1 ring-orange-400 dark:bg-orange-900/30" : "bg-muted hover:bg-muted/80"}`}
              onClick={() => { setRecipeFilter(recipeFilter === "tracking" ? null : "tracking"); setPage(1); }}
              title="Фильтр: заказы с трек-номером"
            >
              📦 {stats.withTracking} <span className="text-muted-foreground">({total > 0 ? Math.round(stats.withTracking / total * 100) : 0}%)</span>
            </div>
          </>
        )}
      </div>

      {/* Progress card */}
      {showProgressCard && progress && progress.status !== "idle" && (() => {
        const isDone = progress.status === "done" || progress.status === "error";
        const startedAt = progress.startedAt;
        const now = Date.now();
        const elapsedMs = startedAt ? (now - startedAt) : 0;
        const elapsedSec = Math.floor(elapsedMs / 1000);
        const elapsedMin = Math.floor(elapsedSec / 60);
        const elapsedSecRem = elapsedSec % 60;
        const startTimeStr = startedAt ? new Date(startedAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "";
        const perOrderSec = progress.completed > 0 ? Math.round(elapsedMs / progress.completed / 1000) : 0;
        const successCount = progress.results?.filter((r: any) => r.checkResult === "success").length || 0;
        const errorCount = progress.results?.filter((r: any) => r.checkResult === "error" || r.checkResult === "not_found").length || 0;
        return (
          <Card className={isDone ? (errorCount > 0 ? "border-orange-300" : "border-green-300") : ""}>
            <CardContent className="py-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {isDone ? (progress.status === "done" ? <CheckCircle2 className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />) : <Loader2 className="w-4 h-4 animate-spin" />}
                  <span className="text-sm font-medium">{isDone ? `Проверка завершена: ${progress.completed} заказов` : `Проверяю: ${progress.current || "..."} (${progress.completed}/${progress.total})`}</span>
                </div>
                {isDone && <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setShowProgressCard(false)}>Скрыть</Button>}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {startTimeStr && <span>Начало: {startTimeStr}</span>}
                <span>{isDone ? "Заняло" : "Прошло"}: {elapsedMin > 0 ? `${elapsedMin} мин ` : ""}{elapsedSecRem} сек</span>
                {perOrderSec > 0 && <span>~{perOrderSec} сек/заказ</span>}
              </div>
              {!isDone && <div className="h-2 bg-muted rounded-full overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%` }} /></div>}
              {isDone && progress.results && progress.results.length > 0 && (
                <div className="flex gap-3 text-xs">
                  {successCount > 0 && <span className="flex items-center gap-1 text-green-600"><CheckCircle2 className="w-3 h-3" /> {successCount} успешно</span>}
                  {errorCount > 0 && <span className="flex items-center gap-1 text-red-600"><XCircle className="w-3 h-3" /> {errorCount} ошибок</span>}
                </div>
              )}
              {!isDone && progress.liveSteps && progress.liveSteps.length > 0 && (
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {progress.currentUrl && <div className="text-xs text-muted-foreground truncate mb-1">URL: {progress.currentUrl}</div>}
                  {progress.liveSteps.map((s) => (
                    <div key={s.step} className="flex items-center gap-2 text-xs">
                      <span className="w-5 text-right text-muted-foreground">{s.step}.</span>
                      {s.status === "running" ? <Loader2 className="w-3 h-3 animate-spin text-blue-500 flex-shrink-0" /> : s.status === "ok" ? <CheckCircle2 className="w-3 h-3 text-green-500 flex-shrink-0" /> : s.status === "failed" ? <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" /> : <Clock className="w-3 h-3 text-orange-400 flex-shrink-0" />}
                      <span className={s.status === "failed" ? "text-red-600" : s.status === "skipped" ? "text-muted-foreground" : ""}>{s.description}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 w-8"><input type="checkbox" checked={selectedIds.size === orders.length && orders.length > 0} onChange={toggleAll} /></th>
              <th className="p-2 text-left cursor-pointer select-none hover:bg-muted/80" onClick={() => toggleSort("createdDate")}>
                <span className="inline-flex items-center gap-1">Дата заказа <SortIcon field="createdDate" /></span>
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:bg-muted/80" onClick={() => toggleSort("shipmentStore")}>
                <span className="inline-flex items-center gap-1">Склад отгрузки <SortIcon field="shipmentStore" /></span>
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:bg-muted/80" onClick={() => toggleSort("shopOrderId")}>
                <span className="inline-flex items-center gap-1">№ заказа <SortIcon field="shopOrderId" /></span>
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:bg-muted/80" onClick={() => toggleSort("orderEmail")}>
                <span className="inline-flex items-center gap-1">Email <SortIcon field="orderEmail" /></span>
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:bg-muted/80" onClick={() => toggleSort("orderPassword")}>
                <span className="inline-flex items-center gap-1">🔑 <SortIcon field="orderPassword" /></span>
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:bg-muted/80" onClick={() => toggleSort("legalEntity")}>
                <span className="inline-flex items-center gap-1">ЮЛ Выкупа <SortIcon field="legalEntity" /></span>
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:bg-muted/80" onClick={() => toggleSort("purchaseDate")}>
                <span className="inline-flex items-center gap-1">Дата выкупа <SortIcon field="purchaseDate" /></span>
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:bg-muted/80" onClick={() => toggleSort("daysSincePurchase")}>
                <span className="inline-flex items-center gap-1">Дней <SortIcon field="daysSincePurchase" /></span>
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:bg-muted/80" onClick={() => toggleSort("checkStatus")}>
                <span className="inline-flex items-center gap-1">Статус <SortIcon field="checkStatus" /></span>
              </th>
              <th className="p-2 text-left cursor-pointer select-none hover:bg-muted/80" onClick={() => toggleSort("checkTrack")}>
                <span className="inline-flex items-center gap-1">Трек-номер <SortIcon field="checkTrack" /></span>
              </th>
              <th className="p-2 text-left">Плановая дата</th>
              <th className="p-2 text-left">Перевозчик</th>
              <th className="p-2 w-16 text-center">Действия</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={14} className="p-8 text-center text-muted-foreground">{storeFilter ? `Нет заказов для магазина «${storeFilter}»` : "Нет заказов для проверки"}</td></tr>
            ) : (
              orders.map((o) => {
                const isOrderChecking = checkingIds.has(o.crmOrderId);
                const t = parseTracking(o.trackingNumber) || parseTracking(o.checkTrack);
                return (
                  <tr key={o.crmOrderId} className="border-b hover:bg-muted/30">
                    <td className="p-2"><input type="checkbox" checked={selectedIds.has(o.crmOrderId)} onChange={() => toggleSelect(o.crmOrderId)} /></td>
                    <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">{o.createdDate}</td>
                    <td className="p-2 text-xs">{o.shipmentStore || "—"}</td>
                    <td className="p-2 font-mono text-xs">
                      {o.shopOrderId ? (
                        <a href={`https://newmen-shopping.retailcrm.ru/orders/${o.crmOrderId}/edit`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{o.shopOrderId}</a>
                      ) : "—"}
                    </td>
                    <td className="p-2 text-xs truncate max-w-[120px]" title={o.orderEmail}>{o.orderEmail || "—"}</td>
                    <td className="p-2">{o.orderPassword ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <XCircle className="w-3.5 h-3.5 text-orange-400" />}</td>
                    <td className="p-2 text-xs">{capitalize(o.legalEntity) || "—"}</td>
                    <td className="p-2 text-xs text-muted-foreground whitespace-nowrap">{formatPurchaseDate(o.purchaseDate, o.createdDate)}</td>
                    <td className="p-2 text-xs font-mono text-center">{o.daysSincePurchase != null ? o.daysSincePurchase : "—"}</td>

                    {/* Status */}
                    <td className="p-2 text-xs">
                      {isOrderChecking ? <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" /> :
                       o.checkResult ? (
                        <span className="inline-flex items-center gap-1">
                          {o.checkResult === "success" ? <CheckCircle2 className="w-3 h-3 text-green-600 flex-shrink-0" /> :
                           o.checkResult === "error" || o.checkResult === "login_failed" ? <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" /> :
                           o.checkResult === "not_found" ? <Search className="w-3 h-3 text-muted-foreground flex-shrink-0" /> :
                           <Clock className="w-3 h-3 text-orange-400 flex-shrink-0" />}
                          <span>{translateStatus(o.checkStatus)}</span>
                        </span>
                      ) : "—"}
                    </td>

                    {/* Track */}
                    <td className="p-2 font-mono text-xs">
                      {!t ? "—" : t.url ? (
                        <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline" title="Открыть трекинг">{t.number}</a>
                      ) : t.number}
                    </td>

                    {/* Planned delivery */}
                    <td className="p-2 text-xs text-muted-foreground">{o.estimatedDeliveryDate || "—"}</td>

                    {/* Carrier */}
                    <td className="p-2 text-xs">{t?.courier || o.checkCarrier || "—"}</td>

                    {/* Actions */}
                    <td className="p-2">
                      <div className="flex gap-1 justify-center">
                        {!o.hasRecipe ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled title="Нет рецепта">
                            {o.checkMethod === "lk" ? <Monitor className="w-3.5 h-3.5 opacity-30" /> : <Mail className="w-3.5 h-3.5 opacity-30" />}
                          </Button>
                        ) : o.checkMethod === "lk" ? (
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isChecking || checkMutation.isPending} onClick={() => startLkCheck([o.crmOrderId])} title="Проверить в ЛК">
                            <Monitor className="w-3.5 h-3.5" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={isOrderChecking || !o.shopOrderId || !o.legalEntity} onClick={() => checkEmailSingle(o)} title="Проверить в почте">
                            {isOrderChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Строк:</span>
            <select className="border rounded px-2 py-1 text-sm bg-background" value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}>
              {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} из {total}</span>
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</Button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              let p: number;
              if (totalPages <= 7) p = i + 1;
              else if (page <= 4) p = i + 1;
              else if (page >= totalPages - 3) p = totalPages - 6 + i;
              else p = page - 3 + i;
              return <Button key={p} variant={p === page ? "default" : "outline"} size="sm" className="w-8 h-8 p-0" onClick={() => setPage(p)}>{p}</Button>;
            })}
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>→</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============= History Tab =============
function HistoryTab() {
  const [filter, setFilter] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: checks = [], isLoading } = useQuery<ShopOrderCheck[]>({
    queryKey: ["/api/shop-agent/history"],
    queryFn: async () => {
      const res = await fetch("/api/shop-agent/history?limit=100", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const filtered = filter
    ? checks.filter((c) => c.shopDomain.includes(filter) || c.crmOrderId.includes(filter) || c.checkResult.includes(filter))
    : checks;

  const resultBadge = (result: string) => {
    switch (result) {
      case "success": return <Badge className="bg-green-100 text-green-800 text-xs"><CheckCircle2 className="w-3 h-3 mr-1" />OK</Badge>;
      case "login_failed": return <Badge variant="destructive" className="text-xs"><XCircle className="w-3 h-3 mr-1" />Login</Badge>;
      case "not_found": return <Badge variant="secondary" className="text-xs"><Search className="w-3 h-3 mr-1" />Not found</Badge>;
      case "error": return <Badge variant="destructive" className="text-xs"><XCircle className="w-3 h-3 mr-1" />Error</Badge>;
      default: return <Badge variant="secondary" className="text-xs">{result}</Badge>;
    }
  };

  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Фильтр по магазину, заказу..." value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-9" />
        </div>
        <span className="text-sm text-muted-foreground">{filtered.length} записей</span>
      </div>
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 text-left">Дата</th>
              <th className="p-2 text-left">Источник</th>
              <th className="p-2 text-left">CRM ID</th>
              <th className="p-2 text-left">Статус заказа</th>
              <th className="p-2 text-left">Трек-номер</th>
              <th className="p-2 text-left">Результат</th>
              <th className="p-2 text-right">Время</th>
              <th className="p-2 text-right">AI</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Нет записей</td></tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}>
                  <td className="p-2 text-xs text-muted-foreground">{new Date(c.checkedAt).toLocaleString("ru")}</td>
                  <td className="p-2">{c.shopDomain === "email-check" ? <Badge variant="outline" className="text-xs"><Mail className="w-3 h-3 mr-1" />Почта</Badge> : <span className="text-xs">{c.shopDomain}</span>}</td>
                  <td className="p-2 font-mono text-xs">{c.crmOrderId}</td>
                  <td className="p-2 text-xs">{translateStatus(c.newStatus)}</td>
                  <td className="p-2 font-mono text-xs" onClick={(e) => e.stopPropagation()}>
                    {(() => { const t = parseTracking(c.trackingNumber); if (!t) return "—"; return t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{t.number}</a> : t.number; })()}
                  </td>
                  <td className="p-2">{resultBadge(c.checkResult)}</td>
                  <td className="p-2 text-right text-xs text-muted-foreground">{c.durationMs ? `${(c.durationMs / 1000).toFixed(1)}s` : "—"}</td>
                  <td className="p-2 text-right text-xs">{c.recipeUsed ? <Badge variant="outline" className="text-xs">Рецепт</Badge> : c.aiTokensUsed ? <span className="text-muted-foreground">{c.aiTokensUsed} tok</span> : "—"}</td>
                </tr>
              )).flatMap((row, idx) => {
                const c = filtered[idx];
                const details = expandedId === c.id ? (
                  <tr key={`${c.id}-details`} className="bg-muted/20">
                    <td colSpan={8} className="p-3">
                      {c.stepsLog && <div className="mb-2"><span className="text-xs font-medium text-muted-foreground">Шаги:</span><pre className="mt-1 text-xs bg-background rounded p-2 whitespace-pre-wrap font-mono">{c.stepsLog}</pre></div>}
                      {c.errorMessage && <div><span className="text-xs font-medium text-destructive">Ошибка:</span><pre className="mt-1 text-xs bg-background rounded p-2 whitespace-pre-wrap font-mono text-destructive/80">{c.errorMessage}</pre></div>}
                      {!c.stepsLog && !c.errorMessage && <span className="text-xs text-muted-foreground">Нет подробностей</span>}
                    </td>
                  </tr>
                ) : null;
                return details ? [row, details] : [row];
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// RecipesSection removed — recipe display integrated into ShopsTab rows

// ============= Shops (Магазины) Tab =============
interface ShopSummary {
  shipmentStore: string;
  orderCount: number;
  emails: string[];
  withPassword: number;
  withMailAccess: number;
  checkedCount: number;
  crmExport: boolean;
  noteText: string | null;
  noteAuthor: string | null;
  notedAt: string | null;
  noteStatus: string | null; // 'open' | 'resolved' | null
  noteResolution: string | null;
  noteResolvedBy: string | null;
  hasInstruction: boolean;
}

interface ShopInstruction {
  id: number;
  domain: string;
  mailProvider: string | null;
  senderEmail: string | null;
  subjectPattern: string | null;
  hasOrderId: boolean;
  orderIdPhrase: string | null;
  trackingPhrase: string | null;
  createdBy: string | null;
  updatedAt: string;
}
interface ShopCheckMethodEntry { id: number; shopName: string; checkMethod: string; }

type ShopStatusFilter = "all" | "green" | "yellow" | "red";
type ShopSortKey = "store" | "orderCount" | "checkedCount" | "withPassword" | "recipeCount";
type ShopSortDir = "asc" | "desc";

function ShopsTab() {
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<ShopStatusFilter>("all");
  const [showNoOrders, setShowNoOrders] = useState(false);
  const [crmFilter, setCrmFilter] = useState<"all" | "crm" | "no-crm">("all");
  const [noteFilter, setNoteFilter] = useState<"all" | "open" | "resolved">("all");
  const [sortKey, setSortKey] = useState<ShopSortKey>("store");
  const [sortDir, setSortDir] = useState<ShopSortDir>("asc");
  const [viewRecipe, setViewRecipe] = useState<ShopRecipe | null>(null);
  const [addShopOpen, setAddShopOpen] = useState(false);
  const [addShopDomain, setAddShopDomain] = useState("");
  const [addShopMethod, setAddShopMethod] = useState("email");
  const [noteDialog, setNoteDialog] = useState<{ domain: string; text: string; author: string | null; date: string | null; mode: "add" | "view" | "view-resolved"; noteStatus: string | null; noteResolution: string | null; noteResolvedBy: string | null } | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [instrDialog, setInstrDialog] = useState<{ domain: string; data: ShopInstruction | null } | null>(null);
  const [instrForm, setInstrForm] = useState({ mailProvider: "fastmail", senderEmail: "", subjectPattern: "", hasOrderId: false, orderIdPhrase: "", trackingPhrase: "" });
  const { toast } = useToast();

  const { data: shops = [], isLoading } = useQuery<ShopSummary[]>({
    queryKey: ["/api/shop-agent/shops"],
    queryFn: async () => { const res = await fetch("/api/shop-agent/shops", { credentials: "include" }); if (!res.ok) throw new Error("Failed"); return res.json(); },
  });

  const { data: profiles = [] } = useQuery<any[]>({
    queryKey: ["/api/shop-agent/shop-profiles"],
    queryFn: async () => { const res = await fetch("/api/shop-agent/shop-profiles", { credentials: "include" }); if (!res.ok) throw new Error("Failed"); return res.json(); },
  });

  const { data: recipes = [] } = useQuery<ShopRecipe[]>({
    queryKey: ["/api/shop-agent/recipes"],
    queryFn: async () => { const res = await fetch("/api/shop-agent/recipes", { credentials: "include" }); if (!res.ok) throw new Error("Failed"); return res.json(); },
  });

  const browserRecipeMap = new Map(recipes.filter(r => r.loginType !== "email_parsing").map((r) => [r.domain, r]));
  const emailRecipeMap = new Map(recipes.filter(r => r.loginType === "email_parsing").map((r) => [r.domain, r]));

  const deleteRecipe = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/shop-agent/recipes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/recipes"] });
      setViewRecipe(null);
      toast({ title: "Рецепт удалён" });
    },
  });

  const profileMap = new Map(profiles.map((p: any) => [p.domain, p]));
  const getMethod = (shopName: string): string => {
    const p = profileMap.get(shopName);
    if (p) return p.checkMethod;
    return shopName.toLowerCase().includes("modivo") ? "lk" : "email";
  };

  const updateProfile = useMutation({
    mutationFn: async ({ domain, data }: { domain: string; data: any }) => {
      return apiRequest("PUT", `/api/shop-agent/shop-profiles/${encodeURIComponent(domain)}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/shop-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/shops"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/orders"] });
    },
    onError: (err: any) => { toast({ title: "Ошибка", description: err.message, variant: "destructive" }); },
  });

  const addShop = useMutation({
    mutationFn: async ({ domain, checkMethod }: { domain: string; checkMethod: string }) => {
      return apiRequest("POST", "/api/shop-agent/shop-profiles", { domain, checkMethod });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/shop-profiles"] });
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/shops"] });
      setAddShopOpen(false);
      setAddShopDomain("");
      setAddShopMethod("email");
      toast({ title: "Магазин добавлен" });
    },
    onError: (err: any) => { toast({ title: "Ошибка", description: err.message, variant: "destructive" }); },
  });

  const saveInstruction = useMutation({
    mutationFn: async ({ domain, data }: { domain: string; data: any }) => {
      return apiRequest("PUT", `/api/shop-agent/shop-instructions/${encodeURIComponent(domain)}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/shops"] });
      setInstrDialog(null);
      toast({ title: "Инструкция сохранена" });
    },
    onError: (err: any) => { toast({ title: "Ошибка", description: err.message, variant: "destructive" }); },
  });

  const forceTrackSync = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/shop-agent/sync-tracks-to-crm", { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Синк треков завершён", description: `Обновлено: ${data.updated}, пропущено: ${data.skipped}, ошибок: ${data.errors}` });
    },
    onError: (err: any) => { toast({ title: "Ошибка синка", description: err.message, variant: "destructive" }); },
  });

  // Filtering
  let list = shops;
  if (!showNoOrders) list = list.filter(s => s.orderCount > 0);
  if (filter) list = list.filter(s => s.shipmentStore.toLowerCase().includes(filter.toLowerCase()));
  if (crmFilter === "crm") list = list.filter(s => s.crmExport);
  if (crmFilter === "no-crm") list = list.filter(s => !s.crmExport);
  if (noteFilter === "open") list = list.filter(s => s.noteStatus === "open");
  if (noteFilter === "resolved") list = list.filter(s => s.noteStatus === "resolved");
  const statusFiltered = list.filter((s) => {
    if (statusFilter === "green") return s.orderCount > 0 && s.checkedCount >= s.orderCount;
    if (statusFilter === "yellow") return s.checkedCount > 0 && s.checkedCount < s.orderCount;
    if (statusFilter === "red") return s.checkedCount === 0;
    return true;
  });
  const filtered = [...statusFiltered].sort((a, b) => {
    let va: any, vb: any;
    switch (sortKey) {
      case "store": va = a.shipmentStore.toLowerCase(); vb = b.shipmentStore.toLowerCase(); break;
      case "orderCount": va = a.orderCount; vb = b.orderCount; break;
      case "checkedCount": va = a.orderCount > 0 ? a.checkedCount / a.orderCount : 0; vb = b.orderCount > 0 ? b.checkedCount / b.orderCount : 0; break;
      case "withPassword": va = a.withPassword; vb = b.withPassword; break;
      case "recipeCount": va = (emailRecipeMap.has(a.shipmentStore) ? 1 : 0) + (browserRecipeMap.has(a.shipmentStore) ? 1 : 0); vb = (emailRecipeMap.has(b.shipmentStore) ? 1 : 0) + (browserRecipeMap.has(b.shipmentStore) ? 1 : 0); break;
    }
    if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
    const cmp = String(va).localeCompare(String(vb));
    return sortDir === "asc" ? cmp : -cmp;
  });
  const shopsWithOrders = shops.filter(s => s.orderCount > 0);
  const totalOrders = shopsWithOrders.reduce((sum, s) => sum + s.orderCount, 0);
  const withPasswords = shopsWithOrders.reduce((sum, s) => sum + s.withPassword, 0);
  const withEmailRecipe = shopsWithOrders.filter((s) => emailRecipeMap.has(s.shipmentStore)).length;
  const withBrowserRecipe = shopsWithOrders.filter((s) => browserRecipeMap.has(s.shipmentStore)).length;
  const withAnyRecipe = shopsWithOrders.filter((s) => emailRecipeMap.has(s.shipmentStore) || browserRecipeMap.has(s.shipmentStore)).length;
  const fullyChecked = shopsWithOrders.filter((s) => s.orderCount > 0 && s.checkedCount >= s.orderCount).length;
  const partiallyChecked = shopsWithOrders.filter((s) => s.checkedCount > 0 && s.checkedCount < s.orderCount).length;
  const notChecked = shopsWithOrders.filter((s) => s.checkedCount === 0).length;

  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;

  const SortHeader = ({ label, field, align = "left" }: { label: string; field: ShopSortKey; align?: string }) => (
    <th className={`p-2 text-${align} cursor-pointer select-none hover:bg-muted/80 transition-colors`} onClick={() => { if (sortKey === field) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(field); setSortDir(field === "store" ? "asc" : "desc"); } }}>
      <span className={`inline-flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>{label} {sortKey === field ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-30" />}</span>
    </th>
  );

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex gap-2 items-center flex-wrap text-xs">
        <div className="relative max-w-[220px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input placeholder="Поиск..." value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-8 h-8 text-xs" />
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => setAddShopOpen(true)}>
          <Plus className="w-3.5 h-3.5" /> Добавить
        </Button>
        <div className="bg-muted rounded-md px-2.5 py-1 font-medium">
          {shopsWithOrders.length} маг. · {totalOrders} заказов
        </div>
        <div className="bg-muted rounded-md px-2.5 py-1 font-medium" title="Магазины с рецептами">
          🧾 {withAnyRecipe} (<Mail className="w-3 h-3 inline mr-0.5 text-purple-600" />{withEmailRecipe} + <Monitor className="w-3 h-3 inline mr-0.5 text-blue-600" />{withBrowserRecipe})
        </div>
        <div className="w-px h-5 bg-border" />
        <div className={`rounded-md px-2.5 py-1 font-medium cursor-pointer transition-colors ${statusFilter === "green" ? "bg-green-200 ring-2 ring-green-400" : "bg-green-50 hover:bg-green-100"}`} onClick={() => setStatusFilter(statusFilter === "green" ? "all" : "green")}>
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block mr-1" />{fullyChecked}
        </div>
        <div className={`rounded-md px-2.5 py-1 font-medium cursor-pointer transition-colors ${statusFilter === "yellow" ? "bg-yellow-200 ring-2 ring-yellow-400" : "bg-yellow-50 hover:bg-yellow-100"}`} onClick={() => setStatusFilter(statusFilter === "yellow" ? "all" : "yellow")}>
          <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block mr-1" />{partiallyChecked}
        </div>
        <div className={`rounded-md px-2.5 py-1 font-medium cursor-pointer transition-colors ${statusFilter === "red" ? "bg-red-200 ring-2 ring-red-400" : "bg-red-50 hover:bg-red-100"}`} onClick={() => setStatusFilter(statusFilter === "red" ? "all" : "red")}>
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block mr-1" />{notChecked}
        </div>
        <div className="w-px h-5 bg-border" />
        <div className={`rounded-md px-2.5 py-1 font-medium cursor-pointer transition-colors ${showNoOrders ? "bg-blue-200 ring-2 ring-blue-400" : "bg-muted hover:bg-muted/80"}`} onClick={() => setShowNoOrders(!showNoOrders)} title="Показать магазины без заказов">
          Без заказов
        </div>
        <div className={`rounded-md px-2.5 py-1 font-medium cursor-pointer transition-colors ${crmFilter === "crm" ? "bg-green-200 ring-2 ring-green-400" : crmFilter === "no-crm" ? "bg-orange-200 ring-2 ring-orange-400" : "bg-muted hover:bg-muted/80"}`} onClick={() => setCrmFilter(f => f === "all" ? "crm" : f === "crm" ? "no-crm" : "all")} title="Фильтр по экспорту в CRM">
          CRM {crmFilter === "crm" ? "✓" : crmFilter === "no-crm" ? "✗" : ""}
        </div>
        <div className={`rounded-md px-2.5 py-1 font-medium cursor-pointer transition-colors ${noteFilter === "open" ? "ring-2 ring-yellow-400" : noteFilter === "resolved" ? "ring-2 ring-blue-400" : "bg-muted hover:bg-muted/80"}`} style={noteFilter === "open" ? { backgroundColor: "#fef9c3" } : noteFilter === "resolved" ? { backgroundColor: "#dbeafe" } : undefined} onClick={() => setNoteFilter(f => f === "all" ? "open" : f === "open" ? "resolved" : "all")} title="Фильтр: все → доработать → решено">
          {noteFilter === "open" ? "Доработать 🟡" : noteFilter === "resolved" ? "Решено 🔵" : "Доработать"}
        </div>
        <div className="w-px h-5 bg-border" />
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => forceTrackSync.mutate()} disabled={forceTrackSync.isPending}>
          {forceTrackSync.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Синк треков → CRM
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 text-left">#</th>
              <SortHeader label="Магазин" field="store" />
              <SortHeader label="Заказов (сейчас)" field="orderCount" align="right" />
              <SortHeader label="Проверено" field="checkedCount" align="right" />
              <th className="p-2 text-left">Email-ы</th>
              <SortHeader label="С паролем" field="withPassword" align="right" />
              <th className="p-2 text-left">Метод</th>
              <SortHeader label="Рецепт" field="recipeCount" align="center" />
              <th className="p-2 text-center">CRM</th>
              <th className="p-2 text-center">Доработать</th>
              <th className="p-2 text-center">Инструкция</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">{filter ? "Ничего не найдено" : "Нет данных"}</td></tr>
            ) : (
              filtered.map((s, idx) => {
                const statusColor = s.orderCount === 0 ? "bg-gray-400" : s.checkedCount === 0 ? "bg-red-500" : s.checkedCount >= s.orderCount ? "bg-green-500" : "bg-yellow-500";
                const method = getMethod(s.shipmentStore);
                const browserRecipe = browserRecipeMap.get(s.shipmentStore);
                const emailRecipe = emailRecipeMap.get(s.shipmentStore);
                const rowStyle =
                  s.noteStatus === "open" ? { backgroundColor: "#fef9c3" } :
                  s.noteStatus === "resolved" ? { backgroundColor: "#dbeafe" } :
                  s.crmExport ? { backgroundColor: "#dcfce7" } :
                  undefined;
                return (
                  <tr key={s.shipmentStore} className="border-b hover:bg-muted/30" style={rowStyle}>
                    <td className="p-2 text-xs text-muted-foreground">{idx + 1}</td>
                    <td className="p-2 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
                        {s.shipmentStore}
                      </span>
                    </td>
                    <td className="p-2 text-right font-mono">{s.orderCount}</td>
                    <td className="p-2 text-right text-xs font-mono">{s.checkedCount}/{s.orderCount} <span className="text-muted-foreground">({s.orderCount > 0 ? Math.round(s.checkedCount / s.orderCount * 100) : 0}%)</span></td>
                    <td className="p-2 text-xs text-muted-foreground">{s.emails.length > 0 ? <span title={s.emails.join(", ")}>{s.emails[0]}{s.emails.length > 1 && ` +${s.emails.length - 1}`}</span> : "—"}</td>
                    <td className="p-2 text-right">{s.orderCount > 0 && s.withPassword > 0 ? <span className="inline-flex items-center gap-1 justify-end"><CheckCircle2 className="w-3.5 h-3.5 text-green-600" /><span className="text-xs">{s.withPassword}/{s.orderCount}</span></span> : <span className="text-xs text-muted-foreground">{s.orderCount > 0 ? "0" : "—"}</span>}</td>
                    <td className="p-2">
                      <Select value={method} onValueChange={(val) => updateProfile.mutate({ domain: s.shipmentStore, data: { checkMethod: val } })}>
                        <SelectTrigger className="h-7 w-[110px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="lk">ЛК</SelectItem>
                          <SelectItem value="email">Почта</SelectItem>
                          <SelectItem value="email_lk">Почта/ЛК</SelectItem>
                          <SelectItem value="other">Прочее</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-2 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {browserRecipe ? (
                          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs gap-0.5" onClick={() => setViewRecipe(browserRecipe)} title="ЛК-рецепт">
                            <Monitor className="w-3 h-3 text-blue-600" />
                            <span className="text-green-600">{browserRecipe.successCount || 0}</span>/<span className="text-red-600">{browserRecipe.failCount || 0}</span>
                          </Button>
                        ) : null}
                        {emailRecipe ? (
                          <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs gap-0.5" onClick={() => setViewRecipe(emailRecipe)} title="Email-рецепт">
                            <Mail className="w-3 h-3 text-purple-600" />
                            <span className="text-green-600">{emailRecipe.successCount || 0}</span>/<span className="text-red-600">{emailRecipe.failCount || 0}</span>
                          </Button>
                        ) : null}
                        {!browserRecipe && !emailRecipe && <span className="text-xs text-muted-foreground">—</span>}
                      </div>
                    </td>
                    {/* CRM Export */}
                    <td className="p-2 text-center">
                      <Checkbox checked={s.crmExport} onCheckedChange={(checked) => updateProfile.mutate({ domain: s.shipmentStore, data: { crmExport: !!checked } })} />
                    </td>
                    {/* Доработать */}
                    <td className="p-2 text-center">
                      {s.noteStatus === "open" ? (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title={`${s.noteAuthor}: ${s.noteText}`} onClick={() => setNoteDialog({ domain: s.shipmentStore, text: s.noteText!, author: s.noteAuthor, date: s.notedAt, mode: "view", noteStatus: s.noteStatus, noteResolution: s.noteResolution, noteResolvedBy: s.noteResolvedBy })}>
                          <Eye className="w-3.5 h-3.5 text-yellow-600" />
                        </Button>
                      ) : s.noteStatus === "resolved" ? (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title={`Решено: ${s.noteResolution}`} onClick={() => setNoteDialog({ domain: s.shipmentStore, text: s.noteText!, author: s.noteAuthor, date: s.notedAt, mode: "view-resolved", noteStatus: s.noteStatus, noteResolution: s.noteResolution, noteResolvedBy: s.noteResolvedBy })}>
                          <CheckCircle className="w-3.5 h-3.5 text-blue-600" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setNoteInput(""); setNoteDialog({ domain: s.shipmentStore, text: "", author: null, date: null, mode: "add", noteStatus: null, noteResolution: null, noteResolvedBy: null }); }}>
                          <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </td>
                    {/* Инструкция */}
                    <td className="p-2 text-center">
                      {s.hasInstruction ? (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={async () => {
                          const res = await fetch(`/api/shop-agent/shop-instructions/${encodeURIComponent(s.shipmentStore)}`, { credentials: "include" });
                          const data = res.ok ? await res.json() : null;
                          setInstrForm({ mailProvider: data?.mailProvider || "fastmail", senderEmail: data?.senderEmail || "", subjectPattern: data?.subjectPattern || "", hasOrderId: data?.hasOrderId || false, orderIdPhrase: data?.orderIdPhrase || "", trackingPhrase: data?.trackingPhrase || "" });
                          setInstrDialog({ domain: s.shipmentStore, data });
                        }}>
                          <Eye className="w-3.5 h-3.5 text-blue-600" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setInstrForm({ mailProvider: "fastmail", senderEmail: "", subjectPattern: "", hasOrderId: false, orderIdPhrase: "", trackingPhrase: "" }); setInstrDialog({ domain: s.shipmentStore, data: null }); }}>
                          <Plus className="w-3.5 h-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Recipe Dialog */}
      <Dialog open={!!viewRecipe} onOpenChange={(open) => !open && setViewRecipe(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-auto">
          <DialogHeader><DialogTitle>Рецепт: {viewRecipe?.domain}</DialogTitle></DialogHeader>
          <div className="flex gap-4 text-xs text-muted-foreground mb-2">
            <span>Тип: <Badge variant="outline" className="text-xs ml-1">{viewRecipe?.loginType}</Badge></span>
            <span>Успешных: <strong className="text-green-600">{viewRecipe?.successCount || 0}</strong></span>
            <span>Неудачных: <strong className="text-red-600">{viewRecipe?.failCount || 0}</strong></span>
          </div>
          <pre className="bg-muted p-4 rounded-lg text-xs overflow-auto max-h-[60vh]">
            {viewRecipe ? JSON.stringify(viewRecipe.recipeJson, null, 2) : ""}
          </pre>
          <div className="flex justify-end mt-2">
            <Button variant="destructive" size="sm" onClick={() => viewRecipe && deleteRecipe.mutate(viewRecipe.id)}>
              <Trash2 className="w-3.5 h-3.5 mr-1" /> Удалить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Shop Dialog */}
      <Dialog open={addShopOpen} onOpenChange={setAddShopOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Добавить магазин</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Домен</Label>
              <Input placeholder="example.de" value={addShopDomain} onChange={e => setAddShopDomain(e.target.value)} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Метод</Label>
              <Select value={addShopMethod} onValueChange={setAddShopMethod}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="lk">ЛК</SelectItem>
                  <SelectItem value="email">Почта</SelectItem>
                  <SelectItem value="email_lk">Почта/ЛК</SelectItem>
                  <SelectItem value="other">Прочее</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" disabled={!addShopDomain.trim()} onClick={() => addShop.mutate({ domain: addShopDomain.trim().toLowerCase(), checkMethod: addShopMethod })}>
              Добавить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Note Dialog (Доработать) */}
      <Dialog open={!!noteDialog} onOpenChange={(open) => !open && setNoteDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {noteDialog?.mode === "view-resolved" ? "Решено" : "Доработать"}: {noteDialog?.domain}
            </DialogTitle>
          </DialogHeader>
          {noteDialog?.mode === "view" ? (
            <div className="space-y-3">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm whitespace-pre-wrap">{noteDialog.text}</div>
              <div className="text-xs text-muted-foreground">{noteDialog.author} · {noteDialog.date ? new Date(noteDialog.date).toLocaleString("ru") : ""}</div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => { setNoteInput(noteDialog.text); setNoteDialog({ ...noteDialog, mode: "add" }); }}>
                  Редактировать
                </Button>
                <Button variant="destructive" size="sm" onClick={() => { updateProfile.mutate({ domain: noteDialog.domain, data: { noteText: "" } }); setNoteDialog(null); }}>
                  Очистить
                </Button>
              </div>
            </div>
          ) : noteDialog?.mode === "view-resolved" ? (
            <div className="space-y-3">
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-xs whitespace-pre-wrap opacity-70">{noteDialog.text}</div>
              <div className="text-xs text-muted-foreground">{noteDialog.author} · {noteDialog.date ? new Date(noteDialog.date).toLocaleString("ru") : ""}</div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm whitespace-pre-wrap">{noteDialog.noteResolution}</div>
              <div className="text-xs text-muted-foreground">Решил: {noteDialog.noteResolvedBy}</div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="text-yellow-700 border-yellow-300 hover:bg-yellow-50" onClick={() => { setNoteInput(""); setNoteDialog({ ...noteDialog, mode: "add" }); }}>
                  Не работает
                </Button>
                <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" onClick={() => {
                  updateProfile.mutate({ domain: noteDialog.domain, data: { crmExport: true } });
                  setNoteDialog(null);
                }}>
                  Принять ✓
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {noteDialog?.noteStatus === "resolved" && (
                <div className="text-xs text-muted-foreground">Предыдущее решение не сработало — опишите что именно:</div>
              )}
              <Textarea placeholder="Описание проблемы..." value={noteInput} onChange={e => setNoteInput(e.target.value)} rows={4} />
              <Button className="w-full" disabled={!noteInput.trim()} onClick={() => { updateProfile.mutate({ domain: noteDialog!.domain, data: { noteText: noteInput.trim() } }); setNoteDialog(null); }}>
                Сохранить
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Instruction Dialog */}
      <Dialog open={!!instrDialog} onOpenChange={(open) => !open && setInstrDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Инструкция: {instrDialog?.domain}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {/* Mail provider hidden — all mail is now on Fastmail */}
            <div>
              <Label className="text-xs">С какой почты приходит</Label>
              <Input placeholder="orders@shop.de" value={instrForm.senderEmail} onChange={e => setInstrForm(f => ({ ...f, senderEmail: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Тема письма</Label>
              <Input placeholder="Bestellbestätigung" value={instrForm.subjectPattern} onChange={e => setInstrForm(f => ({ ...f, subjectPattern: e.target.value }))} className="mt-1" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={instrForm.hasOrderId} onCheckedChange={(v) => setInstrForm(f => ({ ...f, hasOrderId: !!v }))} id="hasOrderId" />
              <Label htmlFor="hasOrderId" className="text-xs">Указан номер заказа в письме</Label>
            </div>
            <div>
              <Label className="text-xs">Фраза с номером заказа</Label>
              <Input placeholder="Bestellnummer:" value={instrForm.orderIdPhrase} onChange={e => setInstrForm(f => ({ ...f, orderIdPhrase: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label className="text-xs">Фраза с треком</Label>
              <Input placeholder="Sendungsnummer:" value={instrForm.trackingPhrase} onChange={e => setInstrForm(f => ({ ...f, trackingPhrase: e.target.value }))} className="mt-1" />
            </div>
            {instrDialog?.data?.createdBy && (
              <div className="text-xs text-muted-foreground">Автор: {instrDialog.data.createdBy} · {new Date(instrDialog.data.updatedAt).toLocaleString("ru")}</div>
            )}
            <Button className="w-full" onClick={() => saveInstruction.mutate({ domain: instrDialog!.domain, data: instrForm })}>
              Сохранить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============= Missing Credentials Tab =============
type AccessFilter = "all" | "no-lk" | "no-mail" | "no-both";

function MissingCredentialsTab() {
  const [filter, setFilter] = useState("");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("all");

  const { data: shops = [], isLoading: shopsLoading } = useQuery<ShopSummary[]>({
    queryKey: ["/api/shop-agent/shops"],
    queryFn: async () => { const res = await fetch("/api/shop-agent/shops", { credentials: "include" }); if (!res.ok) throw new Error("Failed"); return res.json(); },
  });

  const { data: credentials = [], isLoading: credsLoading } = useQuery<ShopCredentialBrief[]>({
    queryKey: ["/api/shop-agent/credentials"],
    queryFn: async () => { const res = await fetch("/api/shop-agent/credentials", { credentials: "include" }); if (!res.ok) throw new Error("Failed"); return res.json(); },
  });

  const isLoading = shopsLoading || credsLoading;

  // Build set of domains that have credentials (ЛК)
  const credDomains = new Set(credentials.map((c) => c.domain.toLowerCase()));

  // Classify shops
  const enriched = shops.map((s) => {
    const domain = s.shipmentStore.toLowerCase();
    const hasLK = credDomains.has(domain);
    const hasMail = s.withMailAccess > 0;
    return { ...s, hasLK, hasMail };
  });

  // All shops without ЛК credentials
  const noLK = enriched.filter((s) => !s.hasLK);
  const noMail = noLK.filter((s) => !s.hasMail);
  const onlyMail = noLK.filter((s) => s.hasMail);

  // Apply filters
  let displayed = noLK;
  if (accessFilter === "no-both") displayed = noMail;
  else if (accessFilter === "no-mail") displayed = noMail;
  else if (accessFilter === "no-lk") displayed = onlyMail;

  // Sort: no mail access first (most critical), then by order count
  displayed = [...displayed].sort((a, b) => {
    if (a.hasMail !== b.hasMail) return a.hasMail ? 1 : -1;
    return b.orderCount - a.orderCount;
  });

  const filtered = filter
    ? displayed.filter((s) => s.shipmentStore.toLowerCase().includes(filter.toLowerCase()))
    : displayed;

  const totalOrders = noLK.reduce((sum, s) => sum + s.orderCount, 0);
  const withLK = enriched.filter((s) => s.hasLK);

  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input placeholder="Поиск по магазину..." value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-9" />
        </div>
        <span className="text-sm text-muted-foreground">
          Без ЛК: <strong className="text-orange-600">{noLK.length}</strong> из {shops.length} магазинов ({totalOrders} заказов)
        </span>
      </div>

      {/* Filter badges */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setAccessFilter("all")}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${accessFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-muted hover:bg-muted/80 border-transparent"}`}>
          Все без ЛК ({noLK.length})
        </button>
        <button onClick={() => setAccessFilter("no-both")}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${accessFilter === "no-both" ? "bg-red-600 text-white border-red-600" : "bg-muted hover:bg-muted/80 border-transparent"}`}>
          ⚠ Нет ЛК + нет почты ({noMail.length})
        </button>
        <button onClick={() => setAccessFilter("no-lk")}
          className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${accessFilter === "no-lk" ? "bg-orange-500 text-white border-orange-500" : "bg-muted hover:bg-muted/80 border-transparent"}`}>
          Нет ЛК, есть почта ({onlyMail.length})
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500" />
          <p className="text-lg font-medium text-foreground">Нет магазинов в этой категории</p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-2 text-left">#</th>
                <th className="p-2 text-left">Магазин</th>
                <th className="p-2 text-right">Заказов</th>
                <th className="p-2 text-left">Email-ы в заказах</th>
                <th className="p-2 text-center">ЛК</th>
                <th className="p-2 text-center">Почта</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, idx) => (
                <tr key={s.shipmentStore} className={`border-b hover:bg-muted/30 ${!s.hasMail ? "bg-red-50" : ""}`}>
                  <td className="p-2 text-xs text-muted-foreground">{idx + 1}</td>
                  <td className="p-2 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      {!s.hasMail ? (
                        <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                      )}
                      {s.shipmentStore}
                    </span>
                  </td>
                  <td className="p-2 text-right font-mono">{s.orderCount}</td>
                  <td className="p-2 text-xs text-muted-foreground">
                    {s.emails.length > 0 ? (
                      <span title={s.emails.join(", ")}>{s.emails[0]}{s.emails.length > 1 && ` +${s.emails.length - 1}`}</span>
                    ) : "—"}
                  </td>
                  <td className="p-2 text-center">
                    <Badge variant="destructive" className="text-xs">Нет</Badge>
                  </td>
                  <td className="p-2 text-center">
                    {s.hasMail ? (
                      <Badge variant="outline" className="text-xs text-green-600 border-green-300">✓ {s.withMailAccess}/{s.orderCount}</Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-red-500 border-red-300">Нет</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      <div className="text-xs text-muted-foreground pt-2">
        С ЛК: {withLK.length} магазинов ({withLK.reduce((s, c) => s + c.orderCount, 0)} заказов)
      </div>
    </div>
  );
}

// ============= Main Page =============
export default function ShopAgentPage() {
  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 p-4 border-b shrink-0">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold">Сбор треков</h1>
      </header>
      <main className="flex-1 overflow-auto p-4">
        <Tabs defaultValue="orders">
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="orders" className="gap-1.5">
                <ShoppingCartIcon className="w-4 h-4" />
                Заказы
              </TabsTrigger>
              <TabsTrigger value="shops" className="gap-1.5">
                <StoreIcon className="w-4 h-4" />
                Магазины
              </TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5">
                <History className="w-4 h-4" />
                История
              </TabsTrigger>
              <TabsTrigger value="missing" className="gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                Без доступа
              </TabsTrigger>
            </TabsList>
            <Link href="/settings?tab=shop-agent" className="p-2 rounded-md hover:bg-muted transition-colors" title="Настройки сбора треков">
              <Settings className="h-4 w-4 text-muted-foreground hover:text-foreground" />
            </Link>
          </div>

          <TabsContent value="orders"><OrdersTab /></TabsContent>
          <TabsContent value="shops"><ShopsTab /></TabsContent>
          <TabsContent value="history"><HistoryTab /></TabsContent>
          <TabsContent value="missing"><MissingCredentialsTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function ShoppingCartIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" />
      <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
    </svg>
  );
}
