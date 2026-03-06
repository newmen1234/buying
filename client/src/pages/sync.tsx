import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { RefreshCw, Loader2 } from "lucide-react";
import { useState } from "react";

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
  duration: number | null;
}

const JOB_TYPE_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  night: { label: "Ночной синк", variant: "secondary" },
  day: { label: "Дневной синк", variant: "default" },
  manual: { label: "Ручной синк", variant: "outline" },
  crm_export: { label: "Выгрузка CRM", variant: "outline" },
  de_tracking: { label: "Треки DE", variant: "secondary" },
  crm_export_de: { label: "Выгрузка CRM DE", variant: "outline" },
};

function JobTypeBadge({ type }: { type: string }) {
  const config = JOB_TYPE_LABELS[type] || { label: type, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

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

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
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
    second: "2-digit",
  });
}

export default function SyncPage() {
  const { toast } = useToast();
  const [isTriggering, setIsTriggering] = useState(false);

  const { data: history = [], isLoading } = useQuery<SyncHistoryEntry[]>({
    queryKey: ["/api/sync/history"],
    queryFn: () => fetch("/api/sync/history?limit=50", { credentials: "include" }).then(r => r.json()),
    refetchInterval: 5000,
  });

  const hasSyncing = history.some(h => h.status === "syncing");

  const handleManualSync = async () => {
    setIsTriggering(true);
    try {
      await apiRequest("POST", "/api/logistics/refresh-cache");
      toast({ title: "Синхронизация запущена" });
    } catch (err: any) {
      toast({ title: "Ошибка запуска", description: err.message, variant: "destructive" });
    } finally {
      setIsTriggering(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-muted-foreground">История фоновых процессов</p>
        </div>
        <Button
          onClick={handleManualSync}
          disabled={isTriggering || hasSyncing}
        >
          {isTriggering || hasSyncing ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Запустить синк вручную
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>История</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              Записей пока нет. Процессы будут отображаться здесь автоматически.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Процесс</TableHead>
                    <TableHead>Начало</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead className="text-right">Кол-во</TableHead>
                    <TableHead>Длительность</TableHead>
                    <TableHead>Ошибка</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map(row => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <JobTypeBadge type={row.jobType} />
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
                          formatDuration(row.duration)
                        )}
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
