import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  RefreshCw,
  ChevronRight,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  CheckSquare,
  Download,
  Upload,
  X,
  Clock,
  Settings,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

type StoreSettingItem = {
  siteCode: string;
  siteName: string;
  groupName: string;
  enabled: boolean;
  orderCount: number;
};

type StoreGroupFilter = "all" | "europe" | "china";
type DeliveryTypeFilter = "all" | "ls" | "shopogolic" | "china";

type DeliveryTypeSettingItem = { deliveryCode: string; groupName: string; orderCount: number };

const DELIVERY_GROUP_LABELS: Record<string, string> = { ls: "LS logistic", shopogolic: "Shopogolic", china: "Китай" };

function getDeliveryCategory(deliveryCode: string | null, site: string | null, storeGroupMap: Map<string, string>, deliveryCodeMap: Map<string, string>): DeliveryTypeFilter {
  if (site && storeGroupMap.get(site) === "china") return "china";
  if (deliveryCode && deliveryCodeMap.has(deliveryCode)) return (deliveryCodeMap.get(deliveryCode) as DeliveryTypeFilter) || "ls";
  return "ls";
}

type ParcelDeSortField = "orderNumber" | "trackingNumber" | "status" | "trackCreatedAt" | "createdAt" | "daysAge" | "firstEventDate" | "lastEventDate" | "daysWaiting" | "checkedAt" | "lastEvent";
type SortDir = "asc" | "desc";
const PARCEL_PAGE_SIZE = 20;

function ParcelTrackingDeSection() {
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [statuses, setStatuses] = useState<Record<string, { status: string; subStatus: string; lastEvent: string; lastLocation: string; lastUpdate: string; firstEventDate: string | null; lastEventDate: string | null; checkedAt: string; carrier?: string | null }>>({});
  const [checkingOne, setCheckingOne] = useState<string | null>(null);
  const [sortField, setSortField] = useState<ParcelDeSortField>("daysAge");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [batchStarting, setBatchStarting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string[] | null>(null);
  const [summaryFilter, setSummaryFilter] = useState<{ type: string; tracks?: string[]; orderNumbers?: { orderId: string; orderNumber: string }[] } | null>(null);
  const [selectedParcels, setSelectedParcels] = useState<Set<string>>(new Set());
  const [crmExportDeStarting, setCrmExportDeStarting] = useState(false);
  const [crmExportDeDismissed, setCrmExportDeDismissed] = useState(false);

  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery<{
    parcels: { orderId: string; orderNumber: string; trackingNumber: string; isBulk: boolean; trackCreatedAt: string | null; createdAt: string | null; customer: string; site?: string | null; deliveryCode?: string | null }[];
    crmSubdomain?: string;
  }>({
    queryKey: ["/api/logistics/parcel-tracking-de"],
  });

  // Store settings
  const [storeGroupFilter, setStoreGroupFilter] = useState<StoreGroupFilter>("all");
  const [deliveryTypeFilter, setDeliveryTypeFilter] = useState<DeliveryTypeFilter>("all");
  const [showStoreSettings, setShowStoreSettings] = useState(false);
  const [editStores, setEditStores] = useState<StoreSettingItem[]>([]);
  const [savingStores, setSavingStores] = useState(false);

  // Delivery type settings
  const [showDeliveryTypeSettings, setShowDeliveryTypeSettings] = useState(false);
  const [editDeliveryTypes, setEditDeliveryTypes] = useState<DeliveryTypeSettingItem[]>([]);
  const [savingDeliveryTypes, setSavingDeliveryTypes] = useState(false);

  const deliveryTypeSettingsQuery = useQuery<{ settings: DeliveryTypeSettingItem[] }>({
    queryKey: ["/api/logistics/delivery-type-settings"],
  });

  // Map delivery codes → group for filtering
  const deliveryCodeMap = useMemo(() => {
    const map = new Map<string, string>();
    if (deliveryTypeSettingsQuery.data?.settings) {
      for (const s of deliveryTypeSettingsQuery.data.settings) {
        map.set(s.deliveryCode, s.groupName);
      }
    }
    return map;
  }, [deliveryTypeSettingsQuery.data]);

  const storeSettingsQuery = useQuery<{ stores: StoreSettingItem[] }>({
    queryKey: ["/api/logistics/tracking-store-settings"],
  });

  const savedStatuses = useQuery<{ statuses: Record<string, any> }>({
    queryKey: ["/api/logistics/parcel-tracking-de/statuses"],
  });

  useEffect(() => {
    if (savedStatuses.data?.statuses) {
      setStatuses((prev) => ({ ...savedStatuses.data!.statuses, ...prev }));
    }
  }, [savedStatuses.data]);

  const batchStatus = useQuery<{
    inProgress: boolean;
    status: string;
    diagnostic?: string;
    elapsed: number;
    total: number;
    processed: number;
    statuses: Record<string, any>;
    nextScheduledCheck?: string | null;
    scheduledCheckInProgress?: boolean;
    lastCheckAt?: string | null;
    lastCheckTracksCount?: number;
    nextCheckIsSecondPass?: boolean;
    schedule?: { time: string; label: string }[];
    amazonSync?: { lastSyncAt: string | null; lastResult: { total: number; delivered: number; inTransit: number; sheetRows: number; errors: string[]; timestamp: string } | null };
  }>({
    queryKey: ["/api/logistics/parcel-tracking-de/batch-status"],
    refetchInterval: (query) => query.state.data?.inProgress ? 2000 : false,
  });

  const checkSummary = useQuery<{
    toCheck: number; totalParcels: number; uniqueTracks: number; totalOrdersInCrm: number;
    funnel?: {
      totalOrdersInCrm: number; siteFiltered: number; ordersAfterSite: number;
      totalParcels: number; consolidatedOrders: number; consolidatedParcels: number;
      ordersWithoutTracks: number; ordersWithoutTracksList: { orderId: string; orderNumber: string }[];
      uniqueTracks: number; duplicateTracks: number; duplicateTracksList: string[];
      amazonSF: number; amazonTracksList: string[];
      amazonDeCount: number; amazonDeTracks: string[];
      sfCount: number; sfTracks: string[];
      amazonDeliveredCount: number;
      delivered: number; deliveredTracksList: string[];
    };
  }>({
    queryKey: ["/api/logistics/parcel-tracking-de/check-summary"],
    refetchInterval: false,
  });

  const crmExportDeStatus = useQuery<{ inProgress: boolean; status: string; total: number; processed: number; errors: number }>({
    queryKey: ["/api/logistics/export-statuses-to-crm-de/status"],
    refetchInterval: 3000,
  });

  const quotaQuery = useQuery<{ quotaTotal: number; quotaUsed: number; quotaRemain: number; todayUsed: number }>({
    queryKey: ["/api/logistics/track17-quota"],
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (batchStatus.data && !batchStatus.data.inProgress && batchStatus.data.statuses && Object.keys(batchStatus.data.statuses).length > 0) {
      setStatuses((prev) => ({ ...prev, ...batchStatus.data!.statuses }));
      // Refresh summary and statuses after batch completes
      checkSummary.refetch();
      savedStatuses.refetch();
    }
  }, [batchStatus.data?.inProgress]);

  const toggleParcelDeSelection = useCallback((trackingNumber: string) => {
    setSelectedParcels(prev => {
      const next = new Set(prev);
      if (next.has(trackingNumber)) next.delete(trackingNumber);
      else next.add(trackingNumber);
      return next;
    });
  }, []);

  const startBatchCheck = async (fromDate?: string) => {
    setBatchStarting(true);
    try {
      await fetch("/api/logistics/parcel-tracking-de/check-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(fromDate ? { fromDate } : {}),
      });
      batchStatus.refetch();
    } catch (err) {
      console.error("Batch check start error:", err);
    } finally {
      setBatchStarting(false);
    }
  };

  const startStatusBatchCheck = async (statusNames: string[]) => {
    if (!data?.parcels) return;
    const filterSet = new Set(statusNames);
    let tracks: string[];
    if (filterSet.has("Не проверен")) {
      tracks = data.parcels.filter(p => !statuses[p.trackingNumber]?.status).map(p => p.trackingNumber);
    } else {
      tracks = data.parcels.filter(p => filterSet.has(statuses[p.trackingNumber]?.status)).map(p => p.trackingNumber);
    }
    if (tracks.length === 0) return;
    setBatchStarting(true);
    try {
      await fetch("/api/logistics/parcel-tracking-de/check-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ trackingNumbers: tracks }),
      });
      batchStatus.refetch();
    } catch (err) {
      console.error("Status batch check error:", err);
    } finally {
      setBatchStarting(false);
    }
  };

  const startCrmDeExport = useCallback(async () => {
    if (!data?.parcels || data.parcels.length === 0) return;
    setCrmExportDeStarting(true);
    setCrmExportDeDismissed(false);
    try {
      const body: any = {};
      if (selectedParcels.size > 0) {
        body.items = data.parcels
          .filter(p => selectedParcels.has(p.trackingNumber))
          .map(p => ({ orderId: p.orderId, trackingNumber: p.trackingNumber, site: (p as any).site }));
      } else {
        body.exportAll = true;
      }
      await fetch("/api/logistics/export-statuses-to-crm-de", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.error("CRM DE export start error:", err);
    } finally {
      setCrmExportDeStarting(false);
    }
  }, [data, selectedParcels]);

  const getDaysAge = useCallback((createdAt: string | null) => {
    if (!createdAt) return 0;
    try {
      const dt = new Date(createdAt.replace(" ", "T"));
      if (isNaN(dt.getTime())) return 0;
      return Math.max(0, Math.floor((Date.now() - dt.getTime()) / (1000 * 60 * 60 * 24)));
    } catch { return 0; }
  }, []);

  const getDaysWaiting = useCallback((trackingNumber: string) => {
    const st = statuses[trackingNumber];
    if (!st?.status?.startsWith("Доставлена") || !st?.lastEventDate) return null;
    try {
      const d = new Date(st.lastEventDate.replace(" ", "T"));
      if (isNaN(d.getTime())) return null;
      return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
    } catch { return null; }
  }, [statuses]);

  // Build store group map from saved settings
  const storeGroupMap = useMemo(() => {
    const m = new Map<string, string>();
    if (storeSettingsQuery.data?.stores) {
      for (const s of storeSettingsQuery.data.stores) {
        m.set(s.siteCode, s.groupName);
      }
    }
    return m;
  }, [storeSettingsQuery.data]);

  const openStoreSettings = useCallback(() => {
    if (storeSettingsQuery.data?.stores) {
      setEditStores(storeSettingsQuery.data.stores.map(s => ({ ...s })));
    }
    setShowStoreSettings(true);
  }, [storeSettingsQuery.data]);

  const saveStoreSettings = useCallback(async () => {
    setSavingStores(true);
    try {
      await fetch("/api/logistics/tracking-store-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          settings: editStores.map(s => ({
            siteCode: s.siteCode,
            siteName: s.siteName,
            groupName: s.groupName,
            enabled: s.enabled,
          })),
        }),
      });
      setShowStoreSettings(false);
      queryClient.invalidateQueries({ queryKey: ["/api/logistics/tracking-store-settings"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logistics/parcel-tracking-de"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logistics/parcel-tracking-de/check-summary"] });
    } catch (err) {
      console.error("Save store settings error:", err);
    } finally {
      setSavingStores(false);
    }
  }, [editStores, queryClient]);

  // Top-row statuses shown inline with "Все" button
  const TOP_ROW_STATUSES: Array<{ label: string; match: (s: string) => boolean; color: string }> = [
    { label: "Доставлена", match: (s) => s.startsWith("Доставлена") || s === "Доставлен", color: "bg-green-100 text-green-800 border-green-200" },
    { label: "Ожидание данных от 17track", match: (s) => s === "В пути — ожидание данных", color: "bg-cyan-100 text-cyan-800 border-cyan-200" },
  ];
  const STATUS_GROUPS: Array<{ label: string; match: (s: string) => boolean; color: string }> = [
    { label: "В пути", match: (s) => s.startsWith("В пути"), color: "bg-blue-100 text-blue-800 border-blue-200" },
    { label: "Проблема", match: (s) => s.startsWith("Проблема"), color: "bg-red-100 text-red-800 border-red-200" },
    { label: "Не отслеживается", match: (s) => s.startsWith("Не отслеживается"), color: "bg-gray-100 text-gray-600 border-gray-200" },
  ];

  // Parcels filtered by store group (Европа / Китай) — used for status counts + table
  const groupFilteredParcels = useMemo(() => {
    if (!data?.parcels) return [];
    if (storeGroupFilter === "all") return data.parcels;
    return data.parcels.filter(p => {
      const group = p.site ? storeGroupMap.get(p.site) : undefined;
      return (group || "europe") === storeGroupFilter;
    });
  }, [data, storeGroupFilter, storeGroupMap]);

  // Parcels filtered by delivery type (LS logistic / Shopogolic / Китай)
  const deliveryTypeFilteredParcels = useMemo(() => {
    if (deliveryTypeFilter === "all") return groupFilteredParcels;
    return groupFilteredParcels.filter(p => getDeliveryCategory(p.deliveryCode || null, p.site || null, storeGroupMap, deliveryCodeMap) === deliveryTypeFilter);
  }, [groupFilteredParcels, deliveryTypeFilter, storeGroupMap, deliveryCodeMap]);

  // Counts for delivery type filter buttons
  const deliveryTypeCounts = useMemo(() => {
    const counts = { ls: 0, shopogolic: 0, china: 0 };
    for (const p of groupFilteredParcels) {
      const cat = getDeliveryCategory(p.deliveryCode || null, p.site || null, storeGroupMap, deliveryCodeMap);
      if (cat === "ls") counts.ls++;
      else if (cat === "shopogolic") counts.shopogolic++;
      else if (cat === "china") counts.china++;
    }
    return counts;
  }, [groupFilteredParcels, storeGroupMap, deliveryCodeMap]);

  const statusCounts = useMemo(() => {
    if (deliveryTypeFilteredParcels.length === 0) return {};
    const counts: Record<string, number> = {};
    let unchecked = 0;
    for (const p of deliveryTypeFilteredParcels) {
      const st = statuses[p.trackingNumber];
      if (st?.status) {
        counts[st.status] = (counts[st.status] || 0) + 1;
      } else {
        unchecked++;
      }
    }
    if (unchecked > 0) counts["Не проверен"] = unchecked;
    return counts;
  }, [deliveryTypeFilteredParcels, statuses]);

  const topRowCounts = useMemo(() => {
    const items: Array<{ label: string; color: string; count: number; statuses: string[] }> = [];
    for (const def of TOP_ROW_STATUSES) {
      const matching = Object.entries(statusCounts).filter(([s]) => def.match(s));
      if (matching.length > 0) {
        const count = matching.reduce((sum, [, c]) => sum + c, 0);
        items.push({ label: def.label, color: def.color, count, statuses: matching.map(([s]) => s) });
      }
    }
    return items;
  }, [statusCounts]);

  const deliveredWaitingCount = useMemo(() => {
    return deliveryTypeFilteredParcels.filter(p => {
      const w = getDaysWaiting(p.trackingNumber);
      return w !== null && w > 2;
    }).length;
  }, [deliveryTypeFilteredParcels, getDaysWaiting]);

  const groupedStatusCounts = useMemo(() => {
    const topUsed = new Set<string>();
    for (const def of TOP_ROW_STATUSES) {
      Object.keys(statusCounts).filter(s => def.match(s)).forEach(s => topUsed.add(s));
    }
    const groups: Array<{ label: string; color: string; totalCount: number; items: Array<{ status: string; count: number }> }> = [];
    const used = new Set<string>(topUsed);
    for (const group of STATUS_GROUPS) {
      const matching = Object.entries(statusCounts)
        .filter(([s]) => group.match(s) && !topUsed.has(s))
        .sort(([, a], [, b]) => b - a);
      if (matching.length > 0) {
        const totalCount = matching.reduce((sum, [, c]) => sum + c, 0);
        matching.forEach(([s]) => used.add(s));
        groups.push({ label: group.label, color: group.color, totalCount, items: matching.map(([s, c]) => ({ status: s, count: c })) });
      }
    }
    for (const [status, count] of Object.entries(statusCounts)) {
      if (!used.has(status)) {
        groups.push({ label: status, color: "bg-muted text-muted-foreground border-border", totalCount: count, items: [{ status, count }] });
      }
    }
    return groups;
  }, [statusCounts]);

  const filtered = useMemo(() => {
    let items = deliveryTypeFilteredParcels;

    if (summaryFilter?.tracks) {
      const trackSet = new Set(summaryFilter.tracks);
      items = items.filter(p => trackSet.has(p.trackingNumber));
    } else if (statusFilter) {
      if (statusFilter[0] === "__delivered_waiting") {
        items = items.filter(p => {
          const w = getDaysWaiting(p.trackingNumber);
          return w !== null && w > 2;
        });
      } else {
        const filterSet = new Set(statusFilter);
        if (filterSet.has("Не проверен")) {
          items = items.filter(p => !statuses[p.trackingNumber]?.status);
        } else {
          items = items.filter(p => filterSet.has(statuses[p.trackingNumber]?.status));
        }
      }
    }
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter((p) => {
      const st = statuses[p.trackingNumber];
      return (
        p.orderNumber.toLowerCase().includes(q) ||
        p.trackingNumber.toLowerCase().includes(q) ||
        p.customer.toLowerCase().includes(q) ||
        (st?.status && st.status.toLowerCase().includes(q)) ||
        (st?.carrier && st.carrier.toLowerCase().includes(q)) ||
        (st?.lastEvent && st.lastEvent.toLowerCase().includes(q))
      );
    });
  }, [deliveryTypeFilteredParcels, searchQuery, statuses, statusFilter, summaryFilter, getDaysWaiting]);

  const sorted = useMemo(() => {
    const items = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    const parseDate = (d: string | null | undefined) => {
      if (!d) return 0;
      try { const t = new Date(d.replace(" ", "T")).getTime(); return isNaN(t) ? 0 : t; } catch { return 0; }
    };
    items.sort((a, b) => {
      const sa = statuses[a.trackingNumber];
      const sb = statuses[b.trackingNumber];
      let cmp = 0;
      switch (sortField) {
        case "orderNumber": cmp = a.orderNumber.localeCompare(b.orderNumber); break;
        case "trackingNumber": cmp = a.trackingNumber.localeCompare(b.trackingNumber); break;
        case "status": cmp = (sa?.status || "").localeCompare(sb?.status || ""); break;
        case "trackCreatedAt": cmp = parseDate(a.trackCreatedAt) - parseDate(b.trackCreatedAt); break;
        case "createdAt": cmp = parseDate(a.createdAt) - parseDate(b.createdAt); break;
        case "daysAge": cmp = getDaysAge(a.createdAt) - getDaysAge(b.createdAt); break;
        case "firstEventDate": cmp = parseDate(sa?.firstEventDate) - parseDate(sb?.firstEventDate); break;
        case "lastEventDate": cmp = parseDate(sa?.lastEventDate) - parseDate(sb?.lastEventDate); break;
        case "daysWaiting": cmp = (getDaysWaiting(a.trackingNumber) ?? -1) - (getDaysWaiting(b.trackingNumber) ?? -1); break;
        case "checkedAt": cmp = parseDate(sa?.checkedAt) - parseDate(sb?.checkedAt); break;
        case "lastEvent": cmp = (sa?.lastEvent || "").localeCompare(sb?.lastEvent || ""); break;
      }
      return cmp * dir;
    });
    return items;
  }, [filtered, sortField, sortDir, statuses, getDaysAge, getDaysWaiting]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PARCEL_PAGE_SIZE));
  const paginated = sorted.slice((page - 1) * PARCEL_PAGE_SIZE, page * PARCEL_PAGE_SIZE);

  const allDeOnPageSelected = paginated.length > 0 && paginated.every(p => selectedParcels.has(p.trackingNumber));

  const toggleSelectAllDeOnPage = useCallback(() => {
    setSelectedParcels(prev => {
      const next = new Set(prev);
      if (allDeOnPageSelected) {
        paginated.forEach(p => next.delete(p.trackingNumber));
      } else {
        paginated.forEach(p => next.add(p.trackingNumber));
      }
      return next;
    });
  }, [paginated, allDeOnPageSelected]);

  useEffect(() => { setPage(1); }, [searchQuery, sortField, sortDir, statusFilter, summaryFilter, storeGroupFilter, deliveryTypeFilter]);

  const toggleSort = (field: ParcelDeSortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ field }: { field: ParcelDeSortField }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 ml-1 text-muted-foreground/50" />;
    return sortDir === "asc" ? <ArrowUp className="w-3 h-3 ml-1" /> : <ArrowDown className="w-3 h-3 ml-1" />;
  };

  const checkSingle = async (trackingNumber: string) => {
    setCheckingOne(trackingNumber);
    try {
      const resp = await fetch("/api/logistics/parcel-tracking-de/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumbers: [trackingNumber] }),
      });
      if (!resp.ok) throw new Error("Check failed");
      const result = await resp.json();
      setStatuses((prev) => ({ ...prev, ...result.statuses }));
    } catch (err) {
      console.error("Check single error:", err);
    } finally {
      setCheckingOne(null);
    }
  };

  const fmtDate = (d: string | null | undefined) => {
    if (!d) return "—";
    try {
      const dt = new Date(d.replace(" ", "T"));
      if (isNaN(dt.getTime())) return "—";
      return dt.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
    } catch { return "—"; }
  };

  const fmtDateTime = (d: string | null | undefined) => {
    if (!d) return "—";
    try {
      const dt = new Date(d.replace(" ", "T"));
      if (isNaN(dt.getTime())) return "—";
      return dt.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
    } catch { return "—"; }
  };

  const statusColor = (status: string): string => {
    if (status === "Доставлена") return "bg-green-100 text-green-800 border-green-200";
    if (status.startsWith("В пути")) return "bg-blue-100 text-blue-800 border-blue-200";
    if (status.startsWith("Проблема")) return "bg-red-100 text-red-800 border-red-200";
    if (status.startsWith("Не отслеживается")) return "bg-gray-100 text-gray-600 border-gray-200";
    return "bg-muted text-muted-foreground border-border";
  };

  const crmUrl = (orderId: string) => {
    const sub = data?.crmSubdomain || "";
    return sub ? `https://${sub}.retailcrm.ru/orders/${orderId}/edit` : "#";
  };

  const exportCsv = () => {
    const rows = sorted;
    if (rows.length === 0) return;
    const headers = ["Заказ", "Трек", "Перевозчик", "Статус", "Подстатус", "Последнее событие", "Местоположение", "Дата создания", "Дни", "Принята перевозчиком", "Посл. движение (дата)", "Проверено", "Клиент", "Консолид."];
    const csvRows = [headers.join(";")];
    for (const p of rows) {
      const st = statuses[p.trackingNumber];
      const days = getDaysAge(p.createdAt);
      const cols = [
        p.orderNumber,
        p.trackingNumber,
        st?.carrier || "",
        st?.status || "",
        st?.subStatus || "",
        (st?.lastEvent || "").replace(/;/g, ","),
        (st?.lastLocation || "").replace(/;/g, ","),
        p.createdAt || "",
        String(days),
        st?.firstEventDate || "",
        st?.lastEventDate || "",
        st?.checkedAt ? new Date(st.checkedAt).toLocaleString("ru-RU") : "",
        p.customer,
        p.isBulk ? "Да" : "Нет",
      ];
      csvRows.push(cols.join(";"));
    }
    const bom = "\uFEFF";
    const blob = new Blob([bom + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const filterLabel = statusFilter ? `_${statusFilter.join("+")}` : "_все";
    a.download = `parcels_de${filterLabel}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="outline"
          onClick={() => startBatchCheck()}
          disabled={batchStarting || batchStatus.data?.inProgress}
          data-testid="button-check-all-de"
        >
          {batchStatus.data?.inProgress ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          {batchStatus.data?.inProgress ? "Проверка..." : `Проверить (${checkSummary.data?.toCheck ?? "..."})`}
        </Button>

        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по номеру, треку, статусу..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-parcel-de-search"
          />
        </div>
        {data?.parcels && (
          <span className="text-sm text-muted-foreground" data-testid="text-parcel-de-count">
            {filtered.length} из {data.parcels.length} посылок
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-muted-foreground/30" />

        <Button
          variant="outline"
          onClick={startCrmDeExport}
          disabled={crmExportDeStarting || crmExportDeStatus.data?.inProgress || batchStatus.data?.inProgress}
          data-testid="button-export-crm-de"
        >
          {crmExportDeStatus.data?.inProgress ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Upload className="w-4 h-4 mr-2" />
          )}
          {crmExportDeStatus.data?.inProgress
            ? `Выгрузка ${crmExportDeStatus.data.processed}/${crmExportDeStatus.data.total}...`
            : selectedParcels.size > 0
              ? `Выгрузить в CRM (${selectedParcels.size})`
              : "Выгрузить в CRM"
          }
        </Button>

        {selectedParcels.size > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedParcels(new Set())}
            data-testid="button-clear-selection-de"
          >
            Сбросить выбор
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={exportCsv}
          disabled={sorted.length === 0}
          data-testid="button-export-csv-de"
        >
          <Download className="w-4 h-4 mr-2" />
          CSV{statusFilter ? ` (${statusFilter.join(", ")})` : ""}
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={openStoreSettings}
          data-testid="button-store-settings-de"
          title="Настройки магазинов"
        >
          <Settings className="w-4 h-4" />
        </Button>

        {quotaQuery.data && (
          <div className="flex items-center gap-2 ml-auto text-xs text-muted-foreground" data-testid="text-track17-quota">
            <span>17track:</span>
            <span className={quotaQuery.data.quotaRemain < 100 ? "text-destructive font-medium" : ""}>
              осталось {quotaQuery.data.quotaRemain.toLocaleString("ru-RU")}
            </span>
            <span className="text-muted-foreground/50">из {quotaQuery.data.quotaTotal.toLocaleString("ru-RU")}</span>
            {quotaQuery.data.todayUsed > 0 && (
              <span>(сегодня: {quotaQuery.data.todayUsed})</span>
            )}
          </div>
        )}
        {batchStatus.data?.scheduledCheckInProgress ? (
          <div className="flex items-center gap-1 text-xs text-blue-600" data-testid="text-de-auto-check">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Авто-проверка...</span>
          </div>
        ) : (
          <div
            className="flex items-center gap-2 text-xs text-muted-foreground cursor-default"
            data-testid="text-de-schedule"
            title={batchStatus.data?.schedule
              ? `Расписание (MSK):\n${batchStatus.data.schedule.map(s => `  ${s.time} — ${s.label}`).join("\n")}\n\n1-й проход: запрос статусов в 17track\n2-й проход: повторный запрос (данные от перевозчиков) → экспорт в CRM`
              : undefined}
          >
            <Clock className="w-3 h-3 flex-shrink-0" />
            {batchStatus.data?.lastCheckAt && (() => {
              try {
                const dt = new Date(batchStatus.data.lastCheckAt);
                const timeStr = dt.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
                const count = batchStatus.data.lastCheckTracksCount || 0;
                return <span>Проверено: {timeStr}{count > 0 ? ` (${count} треков)` : ""}</span>;
              } catch { return null; }
            })()}
            {batchStatus.data?.lastCheckAt && batchStatus.data?.nextScheduledCheck && (
              <span className="text-muted-foreground/40">·</span>
            )}
            {batchStatus.data?.nextScheduledCheck && (() => {
              try {
                const dt = new Date(batchStatus.data.nextScheduledCheck);
                const timeStr = dt.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
                const passLabel = batchStatus.data.nextCheckIsSecondPass ? "2-й проход → CRM" : "1-й проход";
                return <span>Следующая: {timeStr} <span className="text-muted-foreground/60">({passLabel})</span></span>;
              } catch { return null; }
            })()}
          </div>
        )}
      </div>

      {checkSummary.data?.funnel && (() => {
        const fn = checkSummary.data.funnel;
        const parcels = data?.parcels || [];
        const handleDeductionClick = (type: string, tracks?: string[], orderNumbers?: { orderId: string; orderNumber: string }[]) => {
          if (summaryFilter?.type === type) {
            setSummaryFilter(null);
          } else {
            setSummaryFilter({ type, tracks, orderNumbers });
            setStatusFilter(null);
          }
        };
        // Count parcels in table matching each deduction
        const duplicateTracksSet = new Set(fn.duplicateTracksList);
        const amazonDeTracksSet = new Set(fn.amazonDeTracks || []);
        const sfTracksSet = new Set(fn.sfTracks || []);
        const deliveredTracksSet = new Set(fn.deliveredTracksList);
        const duplicateParcels = parcels.filter(p => duplicateTracksSet.has(p.trackingNumber)).length;
        const amazonDeParcels = parcels.filter(p => amazonDeTracksSet.has(p.trackingNumber)).length;
        const sfParcels = parcels.filter(p => sfTracksSet.has(p.trackingNumber)).length;
        const deliveredParcels = parcels.filter(p => deliveredTracksSet.has(p.trackingNumber)).length;
        const deductionBtn = (type: string, count: number, label: string, parcelsCount?: number, tracks?: string[], orderNumbers?: { orderId: string; orderNumber: string }[]) => {
          if (count === 0) return null;
          const isActive = summaryFilter?.type === type;
          const showParcels = parcelsCount !== undefined && parcelsCount !== count;
          return (
            <button
              key={type}
              onClick={() => handleDeductionClick(type, tracks, orderNumbers)}
              className={`underline decoration-dotted underline-offset-2 cursor-pointer transition-colors ${isActive ? "text-foreground font-semibold" : "hover:text-foreground"}`}
              title={showParcels ? `${count} уник. треков / ${parcelsCount} посылок в таблице` : undefined}
            >
              {count}{showParcels && <span className="text-muted-foreground/60 no-underline">/{parcelsCount}</span>} ({label}){isActive && " ✕"}
            </button>
          );
        };
        const amazonDeDelivered = fn.amazonDeliveredCount || 0;
        const amazonDeLabel = amazonDeDelivered > 0
          ? `Amazon: ${(fn.amazonDeCount || 0) - amazonDeDelivered} в пути + ${amazonDeDelivered} доставлено`
          : "Amazon";
        const deductions = [
          deductionBtn("no-track", fn.ordersWithoutTracks, "нет трек-номера", undefined, undefined, fn.ordersWithoutTracksList),
          deductionBtn("duplicates", fn.duplicateTracks, "дубликаты трек-номеров", duplicateParcels, fn.duplicateTracksList),
          deductionBtn("amazon-de", fn.amazonDeCount || 0, amazonDeLabel, amazonDeParcels, fn.amazonDeTracks),
          deductionBtn("sf", fn.sfCount || 0, "SF", sfParcels, fn.sfTracks),
          deductionBtn("delivered", fn.delivered, "доставлены", deliveredParcels, fn.deliveredTracksList),
        ].filter(Boolean);
        return (
          <div className="text-xs text-muted-foreground font-mono leading-relaxed space-y-0.5" data-testid="de-check-summary">
            <div>Заказов в CRM «Отправлен магазином»: {fn.totalOrdersInCrm} − {fn.siteFiltered} ip-shatskaia/darkstore = {fn.ordersAfterSite} заказов → {fn.totalParcels} посылок ({fn.consolidatedOrders} консолид. заказов + {fn.consolidatedParcels} посылок)</div>
            <div>
              К проверке: {checkSummary.data.toCheck} треков ({fn.totalParcels} за вычетом:{" "}
              {deductions.map((d, i) => (
                <span key={i}>{i > 0 && ", "}{d}</span>
              ))}
              )
            </div>
            {summaryFilter?.type === "no-track" && summaryFilter.orderNumbers && summaryFilter.orderNumbers.length > 0 && (
              <div className="mt-2 p-2 bg-muted/50 rounded-md border">
                <div className="font-semibold mb-1">Заказы без трек-номера:</div>
                <div className="flex flex-wrap gap-1.5">
                  {summaryFilter.orderNumbers.map((o) => (
                    <a
                      key={o.orderId}
                      href={data?.crmSubdomain ? `https://${data.crmSubdomain}.retailcrm.ru/orders/${o.orderId}/edit` : "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 underline"
                    >
                      {o.orderNumber}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {batchStatus.data?.inProgress && (
        <div className="space-y-1" data-testid="de-batch-progress">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{batchStatus.data.status}</span>
            <span className="text-muted-foreground tabular-nums">{batchStatus.data.processed}/{batchStatus.data.total}</span>
          </div>
          <Progress value={batchStatus.data.total > 0 ? (batchStatus.data.processed / batchStatus.data.total) * 100 : 0} className="h-2" />
        </div>
      )}

      {!batchStatus.data?.inProgress && batchStatus.data?.status && batchStatus.data.status.startsWith("Готово") && (
        <div className="text-sm text-muted-foreground" data-testid="de-batch-done">
          {batchStatus.data.status}
        </div>
      )}

      {crmExportDeStatus.data?.inProgress && crmExportDeStatus.data.status && (() => {
        const cs = crmExportDeStatus.data;
        const pct = cs.total > 0 && cs.processed > 0 ? Math.min(100, Math.round((cs.processed / cs.total) * 100)) : 0;
        return (
          <Card>
            <CardContent className="py-3 px-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  <span className="text-muted-foreground" data-testid="text-crm-export-de-status">{cs.status}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0">
                  {cs.processed > 0 && <span data-testid="text-crm-export-de-progress">{cs.processed}/{cs.total} ({pct}%)</span>}
                  {cs.errors > 0 && <span className="text-destructive">{cs.errors} ошибок</span>}
                </div>
              </div>
              {cs.total > 0 && (
                <div className="mt-2 h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${pct > 0 ? pct : 2}%` }} />
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {!crmExportDeStatus.data?.inProgress && crmExportDeStatus.data?.status && crmExportDeStatus.data.status.startsWith("Готово") && !crmExportDeDismissed && (
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-crm-export-de-result">
                <CheckSquare className="w-4 h-4 text-primary" />
                <span>{crmExportDeStatus.data.status}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCrmExportDeDismissed(true)}
                data-testid="button-dismiss-crm-export-de"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Store group filter: Все | Европа | Китай */}
      <div className="flex items-center gap-2" data-testid="de-store-group-filter">
        <span className="text-xs text-muted-foreground font-medium">Регион:</span>
        {(["all", "europe", "china"] as StoreGroupFilter[]).map(g => {
          const label = g === "all" ? "Все" : g === "europe" ? "Европа" : "Китай";
          const isActive = storeGroupFilter === g;
          return (
            <button
              key={g}
              onClick={() => setStoreGroupFilter(g)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${isActive ? "bg-foreground text-background border-foreground" : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"}`}
              data-testid={`filter-de-group-${g}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Delivery type filter: Все | LS logistic | Shopogolic | Китай */}
      {/* Delivery type filter: Все | LS logistic | Shopogolic | Китай */}
      <div className="flex items-center gap-2" data-testid="de-delivery-type-filter">
        <span className="text-xs text-muted-foreground font-medium">Тип доставки:</span>
        {([
          { key: "all" as DeliveryTypeFilter, label: "Все" },
          { key: "ls" as DeliveryTypeFilter, label: "LS logistic" },
          { key: "shopogolic" as DeliveryTypeFilter, label: "Shopogolic" },
          { key: "china" as DeliveryTypeFilter, label: "Китай" },
        ]).map(({ key, label }) => {
          const isActive = deliveryTypeFilter === key;
          const count = key === "all" ? groupFilteredParcels.length : deliveryTypeCounts[key];
          return (
            <button
              key={key}
              onClick={() => setDeliveryTypeFilter(key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${isActive ? "bg-foreground text-background border-foreground" : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"}`}
              data-testid={`filter-de-delivery-${key}`}
            >
              {label} ({count})
            </button>
          );
        })}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            setEditDeliveryTypes(deliveryTypeSettingsQuery.data?.settings || []);
            setShowDeliveryTypeSettings(true);
          }}
          data-testid="button-delivery-type-settings"
        >
          <Settings className="w-3.5 h-3.5" />
        </Button>
      </div>

      {(groupedStatusCounts.length > 0 || topRowCounts.length > 0) && (
        <div className="space-y-1.5" data-testid="de-status-informers">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => { setStatusFilter(null); setSummaryFilter(null); }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${!statusFilter && !summaryFilter ? "bg-foreground text-background border-foreground" : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"}`}
              data-testid="filter-de-all"
            >
              Все ({deliveryTypeFilteredParcels.length})
            </button>
            {topRowCounts.map((item) => {
              const isActive = statusFilter && item.statuses.every(s => statusFilter.includes(s)) && statusFilter.length === item.statuses.length;
              return (
                <button
                  key={item.label}
                  onClick={() => { setStatusFilter(isActive ? null : item.statuses); setSummaryFilter(null); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${isActive ? "ring-2 ring-offset-1 ring-foreground/30" : ""} ${item.color}`}
                  data-testid={`filter-de-${item.label}`}
                >
                  {item.label} ({item.count})
                </button>
              );
            })}
            {deliveredWaitingCount > 0 && (() => {
              const isActive = statusFilter?.[0] === "__delivered_waiting";
              return (
                <button
                  onClick={() => { setStatusFilter(isActive ? null : ["__delivered_waiting"]); setSummaryFilter(null); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${isActive ? "ring-2 ring-offset-1 ring-foreground/30" : ""} bg-orange-100 text-orange-800 border-orange-200`}
                  data-testid="filter-de-delivered-waiting"
                >
                  Доставлено &gt; 2 дн. ({deliveredWaitingCount})
                </button>
              );
            })()}
          </div>
          {groupedStatusCounts.map((group) => {
            const allStatuses = group.items.map(i => i.status);
            const isGroupActive = statusFilter && allStatuses.every(s => statusFilter.includes(s)) && statusFilter.length === allStatuses.length;
            return (
              <div key={group.label} className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => { setStatusFilter(isGroupActive ? null : allStatuses); setSummaryFilter(null); }}
                  className={`px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors cursor-pointer ${isGroupActive ? "ring-2 ring-offset-1 ring-foreground/30" : ""} ${group.color}`}
                  data-testid={`filter-de-group-${group.label}`}
                >
                  {group.label} ({group.totalCount})
                </button>
                {group.items.length > 1 && group.items.map(({ status, count }) => {
                  const isActive = statusFilter && statusFilter.length === 1 && statusFilter[0] === status;
                  return (
                    <button
                      key={status}
                      onClick={() => { setStatusFilter(isActive ? null : [status]); setSummaryFilter(null); }}
                      className={`px-2 py-1 rounded-md text-xs border transition-colors cursor-pointer ${isActive ? "ring-2 ring-offset-1 ring-foreground/30" : "opacity-80"} ${group.color}`}
                      data-testid={`filter-de-${status}`}
                    >
                      {status} ({count})
                    </button>
                  );
                })}
                <button
                  onClick={(e) => { e.stopPropagation(); startStatusBatchCheck(allStatuses); }}
                  disabled={batchStarting || batchStatus.data?.inProgress}
                  className={`px-1.5 py-1 rounded-md text-xs border transition-colors cursor-pointer hover:bg-muted/80 disabled:opacity-50 disabled:cursor-not-allowed ${group.color}`}
                  title={`Проверить все «${group.label}» (${group.totalCount})`}
                  data-testid={`check-de-${group.label}`}
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-destructive" data-testid="text-parcel-de-error">{(error as Error).message}</p>
          </CardContent>
        </Card>
      )}

      {data && !isLoading && (
        <>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[40px]">
                        <Checkbox
                          checked={allDeOnPageSelected}
                          onCheckedChange={toggleSelectAllDeOnPage}
                          data-testid="checkbox-select-all-de"
                        />
                      </TableHead>
                      <TableHead className="min-w-[100px] cursor-pointer select-none" onClick={() => toggleSort("orderNumber")}>
                        <span className="flex items-center">Заказ<SortIcon field="orderNumber" /></span>
                      </TableHead>
                      <TableHead className="min-w-[160px] cursor-pointer select-none" onClick={() => toggleSort("trackingNumber")}>
                        <span className="flex items-center">Трек-номер<SortIcon field="trackingNumber" /></span>
                      </TableHead>
                      <TableHead className="min-w-[100px]">Перевозчик</TableHead>
                      <TableHead className="min-w-[80px]">Тип</TableHead>
                      <TableHead className="min-w-[140px] cursor-pointer select-none" onClick={() => toggleSort("status")}>
                        <span className="flex items-center">Статус<SortIcon field="status" /></span>
                      </TableHead>
                      <TableHead className="min-w-[110px] cursor-pointer select-none" onClick={() => toggleSort("createdAt")}>
                        <span className="flex items-center">Дата заказа<SortIcon field="createdAt" /></span>
                      </TableHead>
                      <TableHead className="min-w-[70px] cursor-pointer select-none" onClick={() => toggleSort("daysAge")}>
                        <span className="flex items-center">Дней<SortIcon field="daysAge" /></span>
                      </TableHead>
                      <TableHead className="min-w-[110px] cursor-pointer select-none" onClick={() => toggleSort("trackCreatedAt")}>
                        <span className="flex items-center">Дата отправки<SortIcon field="trackCreatedAt" /></span>
                      </TableHead>
                      <TableHead className="min-w-[120px] cursor-pointer select-none" onClick={() => toggleSort("firstEventDate")}>
                        <span className="flex items-center">Принята перевозчиком<SortIcon field="firstEventDate" /></span>
                      </TableHead>
                      <TableHead className="min-w-[120px] cursor-pointer select-none" onClick={() => toggleSort("lastEventDate")}>
                        <span className="flex items-center">Посл. движение<SortIcon field="lastEventDate" /></span>
                      </TableHead>
                      <TableHead className="min-w-[90px] cursor-pointer select-none" onClick={() => toggleSort("daysWaiting")}>
                        <span className="flex items-center">Ожидание<SortIcon field="daysWaiting" /></span>
                      </TableHead>
                      <TableHead className="min-w-[150px] cursor-pointer select-none" onClick={() => toggleSort("checkedAt")}>
                        <span className="flex items-center">Проверен<SortIcon field="checkedAt" /></span>
                      </TableHead>
                      <TableHead className="min-w-[200px] cursor-pointer select-none" onClick={() => toggleSort("lastEvent")}>
                        <span className="flex items-center">Последнее событие<SortIcon field="lastEvent" /></span>
                      </TableHead>
                      <TableHead className="min-w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginated.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={15} className="text-center text-muted-foreground py-8">
                          {searchQuery ? "Ничего не найдено" : "Нет посылок в статусе «Отправлен магазином»"}
                        </TableCell>
                      </TableRow>
                    ) : (
                      paginated.map((parcel) => {
                        const st = statuses[parcel.trackingNumber];
                        const isChecking = checkingOne === parcel.trackingNumber;
                        const days = getDaysAge(parcel.createdAt);
                        return (
                          <TableRow key={`${parcel.orderId}-${parcel.trackingNumber}`} data-testid={`row-parcel-de-${parcel.trackingNumber}`}>
                            <TableCell>
                              <Checkbox
                                checked={selectedParcels.has(parcel.trackingNumber)}
                                onCheckedChange={() => toggleParcelDeSelection(parcel.trackingNumber)}
                                data-testid={`checkbox-parcel-de-${parcel.trackingNumber}`}
                              />
                            </TableCell>
                            <TableCell className="font-medium">
                              <a href={crmUrl(parcel.orderId)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-foreground hover:underline" data-testid={`link-order-de-${parcel.orderId}`}>
                                {parcel.orderNumber}
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </TableCell>
                            <TableCell className="font-mono text-sm">{parcel.trackingNumber}</TableCell>
                            <TableCell className="text-sm">
                              {st?.carrier ? (
                                <span className="text-muted-foreground">{st.carrier}</span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {parcel.isBulk ? (
                                <Badge variant="secondary" className="text-xs" data-testid={`badge-bulk-${parcel.trackingNumber}`}>
                                  консолид.
                                </Badge>
                              ) : (
                                <span className="text-muted-foreground text-xs">индив.</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {st?.status ? (
                                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${statusColor(st.status)}`} data-testid={`badge-status-de-${parcel.trackingNumber}`}>
                                  {st.status}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-sm">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums">{fmtDate(parcel.createdAt)}</TableCell>
                            <TableCell className="text-sm tabular-nums font-medium">{days}</TableCell>
                            <TableCell className="text-sm tabular-nums">{fmtDate(parcel.trackCreatedAt)}</TableCell>
                            <TableCell className="text-sm tabular-nums">
                              {st?.firstEventDate ? fmtDate(st.firstEventDate) : "—"}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums">
                              {st?.lastEventDate ? fmtDate(st.lastEventDate) : "—"}
                              {st?.lastEventDate && (() => {
                                const d = new Date(st.lastEventDate.replace(" ", "T"));
                                if (isNaN(d.getTime())) return null;
                                const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
                                return <div className="text-xs text-muted-foreground">{diff} дн. назад</div>;
                              })()}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums">
                              {(() => {
                                const w = getDaysWaiting(parcel.trackingNumber);
                                if (w === null) return <span className="text-muted-foreground">—</span>;
                                return <span className={w > 2 ? "text-orange-600 font-medium" : ""}>{w}</span>;
                              })()}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums">{st?.checkedAt ? fmtDateTime(st.checkedAt) : "—"}</TableCell>
                            <TableCell className="text-sm max-w-[250px]">
                              {st?.lastEvent ? (
                                <span className="line-clamp-2" title={st.lastEvent}>
                                  {st.lastLocation ? `${st.lastLocation}: ` : ""}{st.lastEvent}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => checkSingle(parcel.trackingNumber)}
                                disabled={isChecking}
                                data-testid={`button-check-de-${parcel.trackingNumber}`}
                              >
                                {isChecking ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-4 h-4" />
                                )}
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} data-testid="button-parcel-de-prev">Назад</Button>
              <span className="text-sm text-muted-foreground" data-testid="text-parcel-de-page">{page} / {totalPages}</span>
              <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} data-testid="button-parcel-de-next">Вперёд</Button>
            </div>
          )}
        </>
      )}

      {/* Store settings dialog */}
      <Dialog open={showStoreSettings} onOpenChange={setShowStoreSettings}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Настройки магазинов</DialogTitle>
          </DialogHeader>
          {storeSettingsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Europe group */}
              <div>
                <h3 className="text-sm font-semibold mb-2 text-blue-700">Европа</h3>
                <div className="space-y-1">
                  {editStores
                    .filter(s => s.groupName === "europe")
                    .sort((a, b) => a.siteName.localeCompare(b.siteName))
                    .map(store => (
                      <div key={store.siteCode} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <Switch
                            checked={store.enabled}
                            onCheckedChange={(checked) => {
                              setEditStores(prev => prev.map(s =>
                                s.siteCode === store.siteCode ? { ...s, enabled: checked } : s
                              ));
                            }}
                          />
                          <span className={`text-sm truncate ${!store.enabled ? "text-muted-foreground line-through" : ""}`}>
                            {store.siteName}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            ({store.orderCount})
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setEditStores(prev => prev.map(s =>
                              s.siteCode === store.siteCode ? { ...s, groupName: "china" } : s
                            ));
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded border border-transparent hover:border-border transition-colors"
                          title="Переместить в группу Китай"
                        >
                          → Китай
                        </button>
                      </div>
                    ))}
                  {editStores.filter(s => s.groupName === "europe").length === 0 && (
                    <p className="text-xs text-muted-foreground italic py-2">Нет магазинов</p>
                  )}
                </div>
              </div>

              {/* China group */}
              <div>
                <h3 className="text-sm font-semibold mb-2 text-red-700">Китай</h3>
                <div className="space-y-1">
                  {editStores
                    .filter(s => s.groupName === "china")
                    .sort((a, b) => a.siteName.localeCompare(b.siteName))
                    .map(store => (
                      <div key={store.siteCode} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <Switch
                            checked={store.enabled}
                            onCheckedChange={(checked) => {
                              setEditStores(prev => prev.map(s =>
                                s.siteCode === store.siteCode ? { ...s, enabled: checked } : s
                              ));
                            }}
                          />
                          <span className={`text-sm truncate ${!store.enabled ? "text-muted-foreground line-through" : ""}`}>
                            {store.siteName}
                          </span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            ({store.orderCount})
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setEditStores(prev => prev.map(s =>
                              s.siteCode === store.siteCode ? { ...s, groupName: "europe" } : s
                            ));
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded border border-transparent hover:border-border transition-colors"
                          title="Переместить в группу Европа"
                        >
                          → Европа
                        </button>
                      </div>
                    ))}
                  {editStores.filter(s => s.groupName === "china").length === 0 && (
                    <p className="text-xs text-muted-foreground italic py-2">Нет магазинов</p>
                  )}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowStoreSettings(false)}>
              Отмена
            </Button>
            <Button onClick={saveStoreSettings} disabled={savingStores}>
              {savingStores && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delivery type settings dialog */}
      <Dialog open={showDeliveryTypeSettings} onOpenChange={setShowDeliveryTypeSettings}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Настройки типов доставки</DialogTitle>
          </DialogHeader>
          {deliveryTypeSettingsQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {(["ls", "shopogolic", "china"] as const).map(group => (
                <div key={group}>
                  <h3 className={`text-sm font-semibold mb-2 ${group === "ls" ? "text-blue-700" : group === "shopogolic" ? "text-purple-700" : "text-red-700"}`}>
                    {DELIVERY_GROUP_LABELS[group]}
                  </h3>
                  <div className="space-y-1">
                    {editDeliveryTypes
                      .filter(s => s.groupName === group)
                      .sort((a, b) => b.orderCount - a.orderCount)
                      .map(item => (
                        <div key={item.deliveryCode} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className="text-sm font-mono truncate">{item.deliveryCode}</span>
                            <span className="text-xs text-muted-foreground shrink-0">({item.orderCount})</span>
                          </div>
                          <div className="flex gap-1">
                            {(["ls", "shopogolic", "china"] as const).filter(g => g !== group).map(target => (
                              <button
                                key={target}
                                onClick={() => {
                                  setEditDeliveryTypes(prev => prev.map(s =>
                                    s.deliveryCode === item.deliveryCode ? { ...s, groupName: target } : s
                                  ));
                                }}
                                className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded border border-transparent hover:border-border transition-colors"
                              >
                                → {DELIVERY_GROUP_LABELS[target]}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    {editDeliveryTypes.filter(s => s.groupName === group).length === 0 && (
                      <p className="text-xs text-muted-foreground italic py-2">Нет кодов доставки</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeliveryTypeSettings(false)}>
              Отмена
            </Button>
            <Button
              disabled={savingDeliveryTypes}
              onClick={async () => {
                setSavingDeliveryTypes(true);
                try {
                  await fetch("/api/logistics/delivery-type-settings", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ settings: editDeliveryTypes.map(s => ({ deliveryCode: s.deliveryCode, groupName: s.groupName })) }),
                  });
                  await deliveryTypeSettingsQuery.refetch();
                  setShowDeliveryTypeSettings(false);
                } catch (err) {
                  console.error("Save delivery type settings error:", err);
                } finally {
                  setSavingDeliveryTypes(false);
                }
              }}
            >
              {savingDeliveryTypes && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TrackingDePage() {
  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 p-4 border-b shrink-0">
        <SidebarTrigger />
        <h1 className="text-lg font-semibold">Трекинг треков</h1>
      </header>
      <main className="flex-1 overflow-auto p-4">
        <ParcelTrackingDeSection />
      </main>
    </div>
  );
}
