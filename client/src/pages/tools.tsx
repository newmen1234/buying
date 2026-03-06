import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Plus, Wrench, Globe, Webhook, Server, MoreVertical, Trash2, Check, X, Mail, RefreshCw, AlertCircle, CheckCircle2, Upload, Download, FileSpreadsheet } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Tool } from "@shared/schema";

const formSchema = z.object({
  name: z.string().min(1, "Название обязательно"),
  description: z.string().optional(),
  type: z.enum(["api", "webhook", "internal"]).default("api"),
  isActive: z.boolean().default(true),
});

const emailAccountSchema = z.object({
  email: z.string().email("Введите корректный email"),
  displayName: z.string().optional(),
});

const retailcrmAccountSchema = z.object({
  displayName: z.string().min(1, "Название обязательно"),
  subdomain: z.string().min(1, "Поддомен обязателен"),
});

type FormData = z.infer<typeof formSchema>;
type EmailAccountFormData = z.infer<typeof emailAccountSchema>;
type RetailcrmAccountFormData = z.infer<typeof retailcrmAccountSchema>;

interface EmailAccount {
  id: number;
  toolId: number;
  email: string;
  secretKey: string;
  displayName: string | null;
  status: string | null;
  lastError: string | null;
  accountId: string | null;
  hasSecret: boolean;
  createdAt: string;
}

interface RetailcrmAccount {
  id: number;
  toolId: number;
  displayName: string;
  subdomain: string;
  secretKey: string;
  status: string | null;
  lastError: string | null;
  hasSecret: boolean;
  createdAt: string;
}

interface PayrollFileRecord {
  id: number;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
}

function PayrollFilesSection() {
  const { toast } = useToast();

  const { data: files, isLoading } = useQuery<PayrollFileRecord[]>({
    queryKey: ["/api/payroll-files"],
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/payroll-files", { method: "POST", body: formData });
      if (!res.ok) throw new Error((await res.json()).error || "Upload failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-files"] });
      toast({ title: "Файл ФОТ загружен" });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка загрузки", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/payroll-files/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll-files"] });
      toast({ title: "Файл удалён" });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
    e.target.value = "";
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-base">ФОТ</CardTitle>
            <CardDescription>Файлы фонда оплаты труда</CardDescription>
          </div>
        </div>
        <div>
          <input
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            id="payroll-file-input"
            onChange={handleFileSelect}
            data-testid="input-payroll-file"
          />
          <Button
            size="sm"
            onClick={() => document.getElementById("payroll-file-input")?.click()}
            disabled={uploadMutation.isPending}
            data-testid="button-upload-payroll"
          >
            <Upload className="w-4 h-4 mr-2" />
            {uploadMutation.isPending ? "Загрузка..." : "Загрузить файл"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !files?.length ? (
          <div className="text-center py-6 text-muted-foreground text-sm" data-testid="text-payroll-empty">
            Нет загруженных файлов
          </div>
        ) : (
          <div className="space-y-1">
            {files.map((file) => (
              <div
                key={file.id}
                className="flex items-center justify-between py-2 px-2 rounded-md hover-elevate text-sm"
                data-testid={`row-payroll-file-${file.id}`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <FileSpreadsheet className="w-4 h-4 text-green-600 shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium truncate" data-testid={`text-payroll-filename-${file.id}`}>{file.fileName}</div>
                    <div className="text-xs text-muted-foreground">{formatDate(file.uploadedAt)} · {formatSize(file.fileSize)}</div>
                  </div>
                </div>
                <div className="flex items-center gap-0 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => window.open(`/api/payroll-files/${file.id}/download`, "_blank")}
                    data-testid={`button-download-payroll-${file.id}`}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => deleteMutation.mutate(file.id)}
                    data-testid={`button-delete-payroll-${file.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Tools() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [toolDetailOpen, setToolDetailOpen] = useState(false);
  const [addEmailOpen, setAddEmailOpen] = useState(false);
  const [addRetailcrmOpen, setAddRetailcrmOpen] = useState(false);
  const [pendingSecretKey, setPendingSecretKey] = useState<string | null>(null);
  const { toast } = useToast();

  const isFastMailTool = (tool: Tool | null) => {
    return tool?.name?.toLowerCase().includes("fastmail");
  };

  const isRetailcrmTool = (tool: Tool | null) => {
    return tool?.name?.toLowerCase().includes("retailcrm");
  };

  const { data: allTools, isLoading } = useQuery<Tool[]>({
    queryKey: ["/api/tools"],
  });

  const tools = allTools?.filter(t => isFastMailTool(t) || isRetailcrmTool(t));

  const { data: emailAccounts, isLoading: emailAccountsLoading } = useQuery<EmailAccount[]>({
    queryKey: ["/api/tools", selectedTool?.id, "email-accounts"],
    enabled: !!selectedTool && isFastMailTool(selectedTool),
  });

  const { data: retailcrmAccounts, isLoading: retailcrmAccountsLoading } = useQuery<RetailcrmAccount[]>({
    queryKey: ["/api/tools", selectedTool?.id, "retailcrm-accounts"],
    enabled: !!selectedTool && isRetailcrmTool(selectedTool),
  });

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", description: "", type: "api", isActive: true },
  });

  const emailForm = useForm<EmailAccountFormData>({
    resolver: zodResolver(emailAccountSchema),
    defaultValues: { email: "", displayName: "" },
  });

  const retailcrmForm = useForm<RetailcrmAccountFormData>({
    resolver: zodResolver(retailcrmAccountSchema),
    defaultValues: { displayName: "", subdomain: "" },
  });

  const createMutation = useMutation({
    mutationFn: (data: FormData) => apiRequest("POST", "/api/tools", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools"] });
      setDialogOpen(false);
      form.reset();
      toast({ title: "Инструмент создан" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось создать инструмент", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/tools/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools"] });
      toast({ title: "Инструмент удален" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/tools/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools"] });
    },
  });

  const addEmailMutation = useMutation({
    mutationFn: (data: EmailAccountFormData) =>
      apiRequest("POST", `/api/tools/${selectedTool?.id}/email-accounts`, data),
    onSuccess: (response: { secretKeyRequired?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools", selectedTool?.id, "email-accounts"] });
      setAddEmailOpen(false);
      emailForm.reset();
      if (response.secretKeyRequired) {
        setPendingSecretKey(response.secretKeyRequired);
      }
      toast({ title: "Аккаунт добавлен", description: "Теперь добавьте API-токен в секреты" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось добавить аккаунт", variant: "destructive" });
    },
  });

  const verifyEmailMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/email-accounts/${id}/verify`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools", selectedTool?.id, "email-accounts"] });
      toast({ title: "Проверка завершена" });
    },
  });

  const deleteEmailMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/email-accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools", selectedTool?.id, "email-accounts"] });
      toast({ title: "Аккаунт удален" });
    },
  });

  // RetailCRM mutations
  const addRetailcrmMutation = useMutation({
    mutationFn: (data: RetailcrmAccountFormData) =>
      apiRequest("POST", `/api/tools/${selectedTool?.id}/retailcrm-accounts`, data),
    onSuccess: (response: { secretKeyRequired?: string }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools", selectedTool?.id, "retailcrm-accounts"] });
      setAddRetailcrmOpen(false);
      retailcrmForm.reset();
      if (response.secretKeyRequired) {
        setPendingSecretKey(response.secretKeyRequired);
      }
      toast({ title: "Аккаунт добавлен", description: "Теперь добавьте API ключ в секреты" });
    },
    onError: () => {
      toast({ title: "Ошибка", description: "Не удалось добавить аккаунт", variant: "destructive" });
    },
  });

  const verifyRetailcrmMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/retailcrm-accounts/${id}/verify`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools", selectedTool?.id, "retailcrm-accounts"] });
      toast({ title: "Проверка завершена" });
    },
  });

  const deleteRetailcrmMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/retailcrm-accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tools", selectedTool?.id, "retailcrm-accounts"] });
      toast({ title: "Аккаунт удален" });
    },
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "webhook":
        return <Webhook className="w-5 h-5" />;
      case "internal":
        return <Server className="w-5 h-5" />;
      default:
        return <Globe className="w-5 h-5" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case "webhook":
        return "Вебхук";
      case "internal":
        return "Внутренний";
      default:
        return "API";
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "webhook":
        return "text-purple-500 bg-purple-500/10";
      case "internal":
        return "text-blue-500 bg-blue-500/10";
      default:
        return "text-green-500 bg-green-500/10";
    }
  };

  const openToolDetail = (tool: Tool) => {
    setSelectedTool(tool);
    setToolDetailOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight" data-testid="text-tools-title">Инструменты</h1>
          <p className="text-muted-foreground mt-1">
            API-интеграции и сервисы для сотрудников
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-tool">
                <Plus className="w-4 h-4 mr-2" />
                Добавить инструмент
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Новый инструмент</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Название</FormLabel>
                      <FormControl>
                        <Input placeholder="Google Calendar API" {...field} data-testid="input-tool-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Описание</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Что делает этот инструмент..." {...field} data-testid="input-tool-description" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Тип</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-tool-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="api">API</SelectItem>
                          <SelectItem value="webhook">Вебхук</SelectItem>
                          <SelectItem value="internal">Внутренний</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <FormLabel>Активен</FormLabel>
                        <p className="text-sm text-muted-foreground">Инструмент доступен сотрудникам</p>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-tool-active" />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-tool">
                    {createMutation.isPending ? "Создание..." : "Создать"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
          <SidebarTrigger data-testid="button-sidebar-toggle" />
        </div>
      </div>

      <Dialog open={toolDetailOpen} onOpenChange={setToolDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-md flex items-center justify-center ${getTypeColor(selectedTool?.type ?? "api")}`}>
                {isFastMailTool(selectedTool) ? <Mail className="w-5 h-5" /> : getTypeIcon(selectedTool?.type ?? "api")}
              </div>
              {selectedTool?.name}
            </DialogTitle>
            <DialogDescription>
              {selectedTool?.description || "Нет описания"}
            </DialogDescription>
          </DialogHeader>

          {isFastMailTool(selectedTool) && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Email-аккаунты</h3>
                <Button size="sm" onClick={() => setAddEmailOpen(true)} data-testid="button-add-email">
                  <Plus className="w-4 h-4 mr-2" />
                  Добавить аккаунт
                </Button>
              </div>

              {pendingSecretKey && (
                <div className="p-4 border rounded-lg bg-amber-500/10 border-amber-500/30">
                  <p className="font-medium text-amber-700 dark:text-amber-400">Требуется API-токен</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Добавьте секрет <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{pendingSecretKey}</code> в настройках секретов проекта (вкладка "Secrets")
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Получите API-токен в настройках FastMail: Settings → Privacy & Security → Integrations
                  </p>
                  <Button size="sm" variant="outline" className="mt-3" onClick={() => setPendingSecretKey(null)}>
                    Понятно
                  </Button>
                </div>
              )}

              {emailAccountsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : emailAccounts?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                  <Mail className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>Нет подключенных аккаунтов</p>
                  <p className="text-sm mt-1">Добавьте email-аккаунт для интеграции с FastMail</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {emailAccounts?.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                      data-testid={`email-account-${account.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          account.status === "connected" ? "bg-green-500/10" : 
                          !account.hasSecret ? "bg-amber-500/10" : "bg-red-500/10"
                        }`}>
                          {account.status === "connected" ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          ) : (
                            <AlertCircle className={`w-5 h-5 ${!account.hasSecret ? "text-amber-500" : "text-red-500"}`} />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{account.displayName || account.email}</p>
                          <p className="text-sm text-muted-foreground">{account.email}</p>
                          {!account.hasSecret && (
                            <p className="text-sm text-amber-600 mt-1">
                              Добавьте секрет: <code className="bg-muted px-1 py-0.5 rounded text-xs font-mono">{account.secretKey}</code>
                            </p>
                          )}
                          {account.lastError && account.hasSecret && (
                            <p className="text-sm text-red-500 mt-1">{account.lastError}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={
                          account.status === "connected" ? "default" : 
                          !account.hasSecret ? "secondary" : "destructive"
                        }>
                          {account.status === "connected" ? "Подключено" : 
                           !account.hasSecret ? "Нет секрета" : "Ошибка"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => verifyEmailMutation.mutate(account.id)}
                          disabled={verifyEmailMutation.isPending}
                          data-testid={`button-verify-${account.id}`}
                        >
                          <RefreshCw className={`w-4 h-4 ${verifyEmailMutation.isPending ? "animate-spin" : ""}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteEmailMutation.mutate(account.id)}
                          data-testid={`button-delete-email-${account.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Dialog open={addEmailOpen} onOpenChange={setAddEmailOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Добавить email-аккаунт</DialogTitle>
                    <DialogDescription>
                      После добавления аккаунта вам нужно будет добавить API-токен в секреты проекта
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...emailForm}>
                    <form onSubmit={emailForm.handleSubmit((d) => addEmailMutation.mutate(d))} className="space-y-4">
                      <FormField
                        control={emailForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input placeholder="user@fastmail.com" {...field} data-testid="input-email" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={emailForm.control}
                        name="displayName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Отображаемое имя (опционально)</FormLabel>
                            <FormControl>
                              <Input placeholder="Рабочая почта" {...field} data-testid="input-display-name" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <DialogFooter>
                        <Button type="submit" disabled={addEmailMutation.isPending} data-testid="button-submit-email">
                          {addEmailMutation.isPending ? "Добавление..." : "Добавить"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {isRetailcrmTool(selectedTool) && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Аккаунты RetailCRM</h3>
                <Button size="sm" onClick={() => setAddRetailcrmOpen(true)} data-testid="button-add-retailcrm">
                  <Plus className="w-4 h-4 mr-2" />
                  Добавить аккаунт
                </Button>
              </div>

              {retailcrmAccountsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : retailcrmAccounts?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                  <Server className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>Нет подключенных аккаунтов</p>
                  <p className="text-sm mt-1">Добавьте аккаунт RetailCRM для интеграции с CRM</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {retailcrmAccounts?.map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between p-4 border rounded-lg"
                      data-testid={`retailcrm-account-${account.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          account.status === "connected" ? "bg-green-500/10" : 
                          !account.hasSecret ? "bg-amber-500/10" : "bg-red-500/10"
                        }`}>
                          {account.status === "connected" ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500" />
                          ) : (
                            <AlertCircle className={`w-5 h-5 ${!account.hasSecret ? "text-amber-500" : "text-red-500"}`} />
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{account.displayName}</p>
                          <p className="text-sm text-muted-foreground">
                            {account.subdomain}.retailcrm.ru
                          </p>
                          {account.lastError && (
                            <p className="text-sm text-red-500 mt-1">{account.lastError}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={
                          account.status === "connected" ? "default" : 
                          !account.hasSecret ? "secondary" : "destructive"
                        }>
                          {account.status === "connected" ? "Подключено" : 
                           !account.hasSecret ? "Нет секрета" : "Ошибка"}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => verifyRetailcrmMutation.mutate(account.id)}
                          disabled={verifyRetailcrmMutation.isPending}
                          data-testid={`button-verify-retailcrm-${account.id}`}
                        >
                          <RefreshCw className={`w-4 h-4 ${verifyRetailcrmMutation.isPending ? "animate-spin" : ""}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteRetailcrmMutation.mutate(account.id)}
                          data-testid={`button-delete-retailcrm-${account.id}`}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Dialog open={addRetailcrmOpen} onOpenChange={setAddRetailcrmOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Добавить аккаунт RetailCRM</DialogTitle>
                    <DialogDescription>
                      Укажите поддомен вашего RetailCRM (например, для myshop.retailcrm.ru введите myshop)
                    </DialogDescription>
                  </DialogHeader>
                  <Form {...retailcrmForm}>
                    <form onSubmit={retailcrmForm.handleSubmit((data) => addRetailcrmMutation.mutate(data))} className="space-y-4">
                      <FormField
                        control={retailcrmForm.control}
                        name="displayName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Название</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="Основной магазин" data-testid="input-retailcrm-name" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={retailcrmForm.control}
                        name="subdomain"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Поддомен</FormLabel>
                            <FormControl>
                              <div className="flex items-center gap-2">
                                <Input {...field} placeholder="myshop" data-testid="input-retailcrm-subdomain" />
                                <span className="text-muted-foreground whitespace-nowrap">.retailcrm.ru</span>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <DialogFooter>
                        <Button type="submit" disabled={addRetailcrmMutation.isPending} data-testid="button-submit-retailcrm">
                          {addRetailcrmMutation.isPending ? "Добавление..." : "Добавить"}
                        </Button>
                      </DialogFooter>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
            </div>
          )}

          {!isFastMailTool(selectedTool) && !isRetailcrmTool(selectedTool) && (
            <div className="py-8 text-center text-muted-foreground">
              <p>Настройки для этого инструмента пока недоступны</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-60 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : tools?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Wrench className="w-8 h-8 text-primary" />
            </div>
            <h3 className="font-semibold text-lg mb-2">Нет инструментов</h3>
            <p className="text-muted-foreground text-center mb-4">
              Добавьте API-интеграции, которые смогут использовать ваши сотрудники
            </p>
            <Button onClick={() => setDialogOpen(true)} data-testid="button-empty-create">
              <Plus className="w-4 h-4 mr-2" />
              Добавить инструмент
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {tools?.map((tool) => (
            <Card
              key={tool.id}
              className="group cursor-pointer hover-elevate"
              onClick={() => openToolDetail(tool)}
              data-testid={`card-tool-${tool.id}`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-md flex items-center justify-center ${getTypeColor(tool.type ?? "api")}`}>
                      {isFastMailTool(tool) ? <Mail className="w-5 h-5" /> : getTypeIcon(tool.type ?? "api")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">{tool.name}</CardTitle>
                      <CardDescription className="line-clamp-1">
                        {tool.description || "Нет описания"}
                      </CardDescription>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteMutation.mutate(tool.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Удалить
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{getTypeLabel(tool.type ?? "api")}</Badge>
                    <Badge variant={tool.isActive ? "default" : "secondary"}>
                      {tool.isActive ? (
                        <span className="flex items-center gap-1">
                          <Check className="w-3 h-3" />
                          Активен
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <X className="w-3 h-3" />
                          Неактивен
                        </span>
                      )}
                    </Badge>
                  </div>
                  <Switch
                    checked={tool.isActive ?? true}
                    onCheckedChange={(checked) => {
                      toggleMutation.mutate({ id: tool.id, isActive: checked });
                    }}
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`switch-tool-${tool.id}`}
                  />
                </div>
              </CardContent>
            </Card>
          ))}

          <Card
            className="border-dashed flex items-center justify-center min-h-[150px] cursor-pointer hover-elevate"
            onClick={() => setDialogOpen(true)}
            data-testid="card-create-tool"
          >
            <div className="text-center p-6">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <Plus className="w-6 h-6 text-primary" />
              </div>
              <p className="font-medium">Добавить инструмент</p>
              <p className="text-sm text-muted-foreground mt-1">Интегрируйте новый API</p>
            </div>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Предустановленные интеграции</CardTitle>
          <CardDescription>
            Подключенные AI-провайдеры
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-md bg-emerald-500/10 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
              </div>
              <div>
                <p className="font-medium">OpenAI (GPT-5.2, GPT-5.1, GPT-5-mini)</p>
                <p className="text-sm text-muted-foreground">Чат, генерация изображений, аудио</p>
              </div>
            </div>
            <Badge>Подключено</Badge>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-md bg-emerald-500/10 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
              </div>
              <div>
                <p className="font-medium">Anthropic (Claude Opus, Sonnet, Haiku)</p>
                <p className="text-sm text-muted-foreground">Продвинутое рассуждение, код</p>
              </div>
            </div>
            <Badge>Подключено</Badge>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-md bg-emerald-500/10 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-emerald-500" />
              </div>
              <div>
                <p className="font-medium">Google (Gemini 2.5 Pro, Flash)</p>
                <p className="text-sm text-muted-foreground">Мультимодальность, генерация изображений</p>
              </div>
            </div>
            <Badge>Подключено</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Payroll Files Section */}
      <PayrollFilesSection />

    </div>
  );
}
