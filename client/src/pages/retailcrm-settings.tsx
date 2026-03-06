import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { RefreshCw, Loader2, Save } from "lucide-react";

interface SyncHistoryEntry {
  id: number;
  jobType: string;
  dateFrom: string;
  dateTo: string;
  status: string;
  ordersCount: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string | null;
}

interface CrmSyncStats {
  lastByType: Record<string, SyncHistoryEntry>;
  recentHistory: SyncHistoryEntry[];
}

const JOB_TYPE_LABELS: Record<string, string> = {
  night: "Ночной синк",
  day: "Дневной синк",
  manual: "Ручной синк",
  night_retry: "Ночной (повтор)",
  day_retry: "Дневной (повтор)",
};

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "syncing":
      return (
        <Badge variant="outline" className="gap-1 border-yellow-500 text-yellow-600">
          <Loader2 className="w-3 h-3 animate-spin" />
          В процессе
        </Badge>
      );
    case "done":
      return <Badge className="bg-green-600 hover:bg-green-700">Готово</Badge>;
    case "error":
      return <Badge variant="destructive">Ошибка</Badge>;
    case "cancelled":
      return <Badge variant="secondary">Отменён</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const seconds = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  if (seconds < 60) return `${seconds} сек`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  if (min < 60) return `${min} мин ${sec > 0 ? `${sec} сек` : ""}`.trim();
  const hrs = Math.floor(min / 60);
  const remainMin = min % 60;
  return `${hrs} ч ${remainMin > 0 ? `${remainMin} мин` : ""}`.trim();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function RetailCrmSettings() {
  const { toast } = useToast();
  const [syncDaysInput, setSyncDaysInput] = useState<string>("");
  const [isTriggering, setIsTriggering] = useState(false);

  // Fetch current settings
  const { data: settings, isLoading: isLoadingSettings } = useQuery<{ syncDays: number }>({
    queryKey: ["/api/settings/crm"],
    queryFn: () => fetch("/api/settings/crm", { credentials: "include" }).then(r => r.json()),
  });

  // Fetch sync stats
  const { data: stats, isLoading: isLoadingStats } = useQuery<CrmSyncStats>({
    queryKey: ["/api/settings/crm/sync-stats"],
    queryFn: () => fetch("/api/settings/crm/sync-stats", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 10000,
  });

  // Initialize input when settings load
  if (settings && syncDaysInput === "") {
    setSyncDaysInput(String(settings.syncDays));
  }

  const saveMutation = useMutation({
    mutationFn: async (syncDays: number) => {
      return apiRequest("PUT", "/api/settings/crm", { syncDays });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/crm"] });
      toast({ title: "Настройки сохранены" });
    },
    onError: (error: any) => {
      toast({ title: "Ошибка сохранения", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const days = parseInt(syncDaysInput, 10);
    if (!days || days < 1 || days > 365) {
      toast({ title: "Введите число от 1 до 365", variant: "destructive" });
      return;
    }
    saveMutation.mutate(days);
  };

  const handleManualSync = async () => {
    setIsTriggering(true);
    try {
      await apiRequest("POST", "/api/logistics/refresh-cache");
      toast({ title: "Синхронизация запущена" });
      queryClient.invalidateQueries({ queryKey: ["/api/settings/crm/sync-stats"] });
    } catch (err: any) {
      toast({ title: "Ошибка запуска", description: err.message, variant: "destructive" });
    } finally {
      setIsTriggering(false);
    }
  };

  const hasSyncing = stats?.recentHistory?.some(h => h.status === "syncing") || false;

  return (
    <div className="space-y-6">
      {/* Sync period settings */}
      <Card>
        <CardHeader>
          <CardTitle>Период синхронизации</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingSettings ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground whitespace-nowrap">Синхронизировать за последние</span>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={syncDaysInput}
                  onChange={(e) => setSyncDaysInput(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">дней</span>
              </div>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saveMutation.isPending || syncDaysInput === String(settings?.syncDays)}
              >
                {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span className="ml-1">Сохранить</span>
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Применяется ко всем синхронизациям: автоматическим (02:00 и 14:00 MSK) и ручным.
          </p>
        </CardContent>
      </Card>

      {/* Manual sync */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Синхронизация</CardTitle>
          <Button
            onClick={handleManualSync}
            disabled={isTriggering || hasSyncing}
            size="sm"
          >
            {isTriggering || hasSyncing ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Запустить вручную
          </Button>
        </CardHeader>
        <CardContent>
          {isLoadingStats ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !stats?.recentHistory?.length ? (
            <p className="text-muted-foreground text-center py-4">Нет данных о синхронизациях.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Процесс</TableHead>
                    <TableHead>Начало</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Заказов</TableHead>
                    <TableHead>Длительность</TableHead>
                    <TableHead>Запустил</TableHead>
                    <TableHead>Ошибка</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {stats.recentHistory.map(row => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Badge variant="outline">{JOB_TYPE_LABELS[row.jobType] || row.jobType}</Badge>
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {formatDateTime(row.startedAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.ordersCount || "—"}
                      </TableCell>
                      <TableCell className="text-sm whitespace-nowrap">
                        {row.status === "syncing" ? (
                          <span className="text-yellow-600">В процессе...</span>
                        ) : (
                          formatDuration(row.startedAt, row.completedAt)
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.triggeredBy || "—"}
                      </TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate text-destructive">
                        {row.errorMessage || ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
