import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Shield, ShieldCheck, User, Check, X, Mail, Plus, Trash2, ChevronDown, ChevronUp, Eye, Upload, Loader2, Save, RotateCcw, BookOpen, KeyRound, MessageSquare, XCircle, ShieldCheck as ShieldCheckIcon, Clock, RefreshCw, Package, Bot, Pencil } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { User as UserType, AllowedEmail } from "@shared/models/auth";
import { APP_SECTIONS, type AppSection } from "@shared/models/auth";
import Tools from "@/pages/tools";
import SyncPage from "@/pages/sync";
import RetailCrmSettings from "@/pages/retailcrm-settings";

const SECTION_LABELS: Record<AppSection, string> = {
  dashboard: "Дашборд",
  shop_agent: "Сбор треков",
  tracking_de: "Трекинг треков",
  settings: "Настройки",
};

export default function Settings() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [newEmail, setNewEmail] = useState("");
  const [newEmailSections, setNewEmailSections] = useState<string[]>([]);
  const [newEmailIsAdmin, setNewEmailIsAdmin] = useState(false);
  const [expandedWhitelistId, setExpandedWhitelistId] = useState<string | null>(null);
  
  const { data: users = [], isLoading } = useQuery<UserType[]>({
    queryKey: ["/api/users"],
    enabled: !!currentUser?.isAdmin,
  });

  const { data: allowedEmails = [], isLoading: isLoadingEmails } = useQuery<AllowedEmail[]>({
    queryKey: ["/api/allowed-emails"],
    enabled: !!currentUser?.isAdmin,
  });

  const addEmailMutation = useMutation({
    mutationFn: async (data: { email: string; allowedSections: string[]; isAdmin: boolean }) => {
      return apiRequest("POST", "/api/allowed-emails", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/allowed-emails"] });
      setNewEmail("");
      setNewEmailSections([]);
      setNewEmailIsAdmin(false);
      toast({ title: "Email добавлен" });
    },
    onError: (error: any) => {
      const message = error?.message || "Ошибка добавления";
      toast({ title: message, variant: "destructive" });
    },
  });

  const updateWhitelistMutation = useMutation({
    mutationFn: async ({ id, allowedSections, isAdmin }: { id: string; allowedSections: string[]; isAdmin: boolean }) => {
      return apiRequest("PATCH", `/api/allowed-emails/${id}`, { allowedSections, isAdmin });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/allowed-emails"] });
      toast({ title: "Настройки обновлены" });
    },
    onError: () => {
      toast({ title: "Ошибка обновления", variant: "destructive" });
    },
  });

  const removeEmailMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/allowed-emails/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/allowed-emails"] });
      toast({ title: "Email удалён" });
    },
    onError: () => {
      toast({ title: "Ошибка удаления", variant: "destructive" });
    },
  });

  const handleAddEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (newEmail.trim()) {
      addEmailMutation.mutate({
        email: newEmail.trim(),
        allowedSections: newEmailSections,
        isAdmin: newEmailIsAdmin,
      });
    }
  };

  const toggleNewEmailSection = (section: string) => {
    setNewEmailSections(prev => 
      prev.includes(section) 
        ? prev.filter(s => s !== section)
        : [...prev, section]
    );
  };

  const toggleWhitelistSection = (entry: AllowedEmail, section: string) => {
    const currentSections = entry.allowedSections || [];
    const newSections = currentSections.includes(section)
      ? currentSections.filter(s => s !== section)
      : [...currentSections, section];
    updateWhitelistMutation.mutate({
      id: entry.id,
      allowedSections: newSections,
      isAdmin: entry.isAdmin || false,
    });
  };

  const toggleWhitelistAdmin = (entry: AllowedEmail) => {
    updateWhitelistMutation.mutate({
      id: entry.id,
      allowedSections: entry.allowedSections || [],
      isAdmin: !entry.isAdmin,
    });
  };

  const grantAllWhitelistSections = (entry: AllowedEmail) => {
    updateWhitelistMutation.mutate({
      id: entry.id,
      allowedSections: [...APP_SECTIONS],
      isAdmin: entry.isAdmin || false,
    });
  };

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<UserType> }) => {
      return apiRequest("PATCH", `/api/users/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Пользователь обновлён" });
    },
    onError: () => {
      toast({ title: "Ошибка обновления", variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/users/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "Пользователь удалён" });
    },
    onError: (error: any) => {
      const message = error?.message || "Ошибка удаления";
      toast({ title: message, variant: "destructive" });
    },
  });

  const toggleApproval = (user: UserType) => {
    updateUserMutation.mutate({
      id: user.id,
      data: { isApproved: !user.isApproved },
    });
  };

  const toggleAdmin = (user: UserType) => {
    if (user.id === currentUser?.id) {
      toast({ title: "Нельзя изменить свои права", variant: "destructive" });
      return;
    }
    updateUserMutation.mutate({
      id: user.id,
      data: { isAdmin: !user.isAdmin },
    });
  };

  const toggleSection = (user: UserType, section: AppSection) => {
    const currentSections = user.allowedSections || [];
    const hasSection = currentSections.includes(section);
    const newSections = hasSection
      ? currentSections.filter(s => s !== section)
      : [...currentSections, section];
    
    updateUserMutation.mutate({
      id: user.id,
      data: { allowedSections: newSections },
    });
  };

  const grantAllSections = (user: UserType) => {
    updateUserMutation.mutate({
      id: user.id,
      data: { allowedSections: [...APP_SECTIONS] },
    });
  };

  if (!currentUser?.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center">
        <Shield className="w-16 h-16 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Доступ ограничен</h2>
        <p className="text-muted-foreground">
          Только администраторы могут управлять пользователями
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <header className="flex items-center gap-2 p-4 border-b shrink-0">
          <SidebarTrigger data-testid="button-sidebar-toggle" />
          <h1 className="text-lg font-semibold">Настройки</h1>
        </header>
        <main className="flex-1 overflow-auto p-4">
          <div className="grid gap-4">
            {[1, 2, 3].map(i => (
              <Card key={i}>
                <CardContent className="p-6">
                  <Skeleton className="h-20 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-2 p-4 border-b shrink-0">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        <h1 className="text-lg font-semibold" data-testid="text-settings-title">Настройки</h1>
      </header>
      <main className="flex-1 overflow-auto p-4">

      <Tabs defaultValue={new URLSearchParams(window.location.search).get("tab") || "users"}>
        <TabsList>
          <TabsTrigger value="users">Пользователи</TabsTrigger>
          <TabsTrigger value="tools">Инструменты</TabsTrigger>
          <TabsTrigger value="retailcrm">RetailCRM</TabsTrigger>
          <TabsTrigger value="sync">Синхронизация</TabsTrigger>
          <TabsTrigger value="shop-agent">Сбор треков</TabsTrigger>
          <TabsTrigger value="de-tracking">DE трекинг</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-6 mt-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="w-5 h-5" />
            Пользователи
          </CardTitle>
          <CardDescription>
            Управляйте доступом пользователей @newmen.info к разделам системы
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {users?.length === 0 && (
              <p className="text-muted-foreground text-center py-8">
                Пользователи ещё не зарегистрировались
              </p>
            )}

            {users.map(user => (
              <div
                key={user.id}
                className="flex items-center gap-3 px-3 py-2 rounded-md border"
                data-testid={`card-user-${user.id}`}
              >
                <Avatar className="w-7 h-7 shrink-0">
                  <AvatarImage src={user.profileImageUrl || undefined} />
                  <AvatarFallback className="text-xs">
                    {(user.firstName?.[0] || "") + (user.lastName?.[0] || "")}
                  </AvatarFallback>
                </Avatar>

                <div className="min-w-0 w-32 shrink-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">
                      {user.firstName} {user.lastName}
                    </span>
                    {user.isAdmin && (
                      <Badge variant="default" className="text-[10px] px-1 py-0 h-4">Админ</Badge>
                    )}
                    {user.id === currentUser?.id && (
                      <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">Вы</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>

                {user.isApproved && (
                  <div className="flex flex-wrap gap-1 flex-1 min-w-0">
                    {APP_SECTIONS.map(section => {
                      const hasSection = (user.allowedSections || []).includes(section);
                      return (
                        <label
                          key={section}
                          className="flex items-center gap-1.5 px-2 py-1 rounded border text-xs cursor-pointer hover:bg-muted/50"
                        >
                          <Checkbox
                            checked={hasSection}
                            onCheckedChange={() => toggleSection(user, section)}
                            disabled={updateUserMutation.isPending}
                            className="w-3.5 h-3.5"
                            data-testid={`checkbox-section-${section}-${user.id}`}
                          />
                          {SECTION_LABELS[section]}
                        </label>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center gap-1 shrink-0 ml-auto">
                  <Button
                    variant={user.isApproved ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs px-2"
                    onClick={() => toggleApproval(user)}
                    disabled={updateUserMutation.isPending}
                    data-testid={`button-toggle-approval-${user.id}`}
                  >
                    {user.isApproved ? <><Check className="w-3 h-3 mr-1" />Активен</> : <><X className="w-3 h-3 mr-1" />Заблок.</>}
                  </Button>
                  {user.id !== currentUser?.id && (
                    <>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => toggleAdmin(user)} disabled={updateUserMutation.isPending} data-testid={`button-toggle-admin-${user.id}`}>
                        <Shield className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { if (confirm(`Удалить ${user.firstName} ${user.lastName}?`)) deleteUserMutation.mutate(user.id); }} disabled={deleteUserMutation.isPending} data-testid={`button-delete-user-${user.id}`}>
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Разрешённые email
          </CardTitle>
          <CardDescription>
            Добавьте email и настройте доступ заранее. При первом входе пользователь автоматически получит указанные права.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4 mb-6 p-4 rounded-md border bg-muted/30">
            <form onSubmit={handleAddEmail} className="flex flex-wrap gap-2">
              <Input
                type="email"
                placeholder="user@newmen.info"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="flex-1 min-w-[200px]"
                data-testid="input-new-email"
              />
              <Button
                type="submit"
                disabled={addEmailMutation.isPending || !newEmail.trim()}
                data-testid="button-add-email"
              >
                <Plus className="w-4 h-4 mr-1" />
                Добавить
              </Button>
            </form>
            
            {newEmail.trim() && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={newEmailIsAdmin}
                      onCheckedChange={(checked) => setNewEmailIsAdmin(!!checked)}
                      data-testid="checkbox-new-email-admin"
                    />
                    <span className="text-sm font-medium">Администратор</span>
                  </label>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Доступные разделы:</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setNewEmailSections([...APP_SECTIONS])}
                      data-testid="button-new-email-all-sections"
                    >
                      Все разделы
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {APP_SECTIONS.map(section => (
                      <label
                        key={section}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-md border cursor-pointer hover-elevate"
                      >
                        <Checkbox
                          checked={newEmailSections.includes(section)}
                          onCheckedChange={() => toggleNewEmailSection(section)}
                          data-testid={`checkbox-new-email-section-${section}`}
                        />
                        <span className="text-sm">{SECTION_LABELS[section]}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {isLoadingEmails ? (
            <Skeleton className="h-20 w-full" />
          ) : allowedEmails.length === 0 ? (
            <p className="text-muted-foreground text-center py-4">
              Список пустой — никто не может войти. Добавьте email.
            </p>
          ) : (
            <div className="space-y-2">
              {allowedEmails.map(entry => {
                const isExpanded = expandedWhitelistId === entry.id;
                const sections = entry.allowedSections || [];
                return (
                  <div
                    key={entry.id}
                    className="rounded-md border"
                    data-testid={`row-allowed-email-${entry.id}`}
                  >
                    <div className="flex items-center justify-between p-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setExpandedWhitelistId(isExpanded ? null : entry.id)}
                          data-testid={`button-expand-email-${entry.id}`}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </Button>
                        <span className="text-sm font-medium truncate">{entry.email}</span>
                        {entry.isAdmin && (
                          <Badge variant="default" className="gap-1">
                            <ShieldCheck className="w-3 h-3" />
                            Админ
                          </Badge>
                        )}
                        {sections.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {sections.length} разделов
                          </span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeEmailMutation.mutate(entry.id)}
                        disabled={removeEmailMutation.isPending}
                        data-testid={`button-remove-email-${entry.id}`}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                    
                    {isExpanded && (
                      <div className="px-4 pb-4 space-y-3 border-t pt-3">
                        <div className="flex items-center gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Checkbox
                              checked={entry.isAdmin || false}
                              onCheckedChange={() => toggleWhitelistAdmin(entry)}
                              disabled={updateWhitelistMutation.isPending}
                              data-testid={`checkbox-whitelist-admin-${entry.id}`}
                            />
                            <span className="text-sm font-medium">Администратор</span>
                          </label>
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">Разделы:</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => grantAllWhitelistSections(entry)}
                              disabled={updateWhitelistMutation.isPending}
                              data-testid={`button-whitelist-all-sections-${entry.id}`}
                            >
                              Все разделы
                            </Button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {APP_SECTIONS.map(section => (
                              <label
                                key={section}
                                className="flex items-center gap-2 px-3 py-1.5 rounded-md border cursor-pointer hover-elevate"
                              >
                                <Checkbox
                                  checked={sections.includes(section)}
                                  onCheckedChange={() => toggleWhitelistSection(entry, section)}
                                  disabled={updateWhitelistMutation.isPending}
                                  data-testid={`checkbox-whitelist-section-${section}-${entry.id}`}
                                />
                                <span className="text-sm">{SECTION_LABELS[section]}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="tools" className="mt-6">
          <Tools />
        </TabsContent>

        <TabsContent value="retailcrm" className="mt-6">
          <RetailCrmSettings />
        </TabsContent>

        <TabsContent value="sync" className="mt-6">
          <SyncPage />
        </TabsContent>

        <TabsContent value="shop-agent" className="mt-6">
          <ShopAgentSettings />
        </TabsContent>

        <TabsContent value="de-tracking" className="mt-6">
          <DeTrackingSettings />
        </TabsContent>

      </Tabs>
      </main>
    </div>
  );
}

// ============= Shop Agent Settings (Credentials, Recipes, Prompt) =============

interface ShopCredential {
  id: number;
  domain: string;
  email: string;
  encryptedPassword: string;
  loginUrl: string | null;
  notes: string | null;
  legalEntity: string | null;
  status: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

// All email is now on Fastmail
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

function getEmailProvider(email: string): "Fastmail" | string {
  const domain = (email.toLowerCase().split("@")[1] || "").trim();
  if (FASTMAIL_DOMAINS.some((d) => domain === d)) return "Fastmail";
  return "Fastmail"; // all mail is on Fastmail now
}

function EmailDistributionReport({ credentials }: { credentials: ShopCredential[] }) {
  const [open, setOpen] = useState(false);

  // Get unique emails per ЮЛ (same email can belong to different ЮЛ)
  const uniquePerLE = new Map<string, { email: string; legalEntity: string; provider: string }>();
  for (const c of credentials) {
    const le = c.legalEntity || "—";
    const key = `${c.email.toLowerCase()}::${le}`;
    if (!uniquePerLE.has(key)) {
      uniquePerLE.set(key, {
        email: c.email.toLowerCase(),
        legalEntity: le,
        provider: getEmailProvider(c.email),
      });
    }
  }

  // Group by email domain → { domain, newmenCount, vateboCount }
  const domainStats = new Map<string, { domain: string; newmen: number; vatebo: number }>();
  for (const entry of uniquePerLE.values()) {
    const emailDomain = entry.email.split("@")[1] || "unknown";
    if (!domainStats.has(emailDomain)) {
      domainStats.set(emailDomain, { domain: emailDomain, newmen: 0, vatebo: 0 });
    }
    const stat = domainStats.get(emailDomain)!;
    if (entry.legalEntity === "Newmen") stat.newmen++;
    else if (entry.legalEntity === "Vatebo") stat.vatebo++;
    else stat.newmen++; // fallback
  }

  // Sort by total desc
  const allRows = Array.from(domainStats.values()).sort((a, b) => {
    return (b.newmen + b.vatebo) - (a.newmen + a.vatebo);
  });

  const totalNewmen = allRows.reduce((s, r) => s + r.newmen, 0);
  const totalVatebo = allRows.reduce((s, r) => s + r.vatebo, 0);
  const totalAll = totalNewmen + totalVatebo;

  return (
    <div className="border rounded-lg">
      <button
        className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-2">
          Распределение аккаунтов
          <span className="text-xs text-muted-foreground font-normal">({totalAll} email-ов)</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs">
            <span className="w-2 h-2 rounded-full bg-blue-500" />Fastmail
          </span>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>
      {open && (
        <div className="border-t">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="p-2 text-left">Домен</th>
                <th className="p-2 text-right">Newmen</th>
                <th className="p-2 text-right">Vatebo</th>
                <th className="p-2 text-right">Всего</th>
              </tr>
            </thead>
            <tbody>
              {allRows.map((r) => (
                <tr key={r.domain} className="border-b hover:bg-muted/30">
                  <td className="p-2 font-mono text-xs">{r.domain}</td>
                  <td className="p-2 text-right font-mono">{r.newmen || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-2 text-right font-mono">{r.vatebo || <span className="text-muted-foreground">—</span>}</td>
                  <td className="p-2 text-right font-mono font-medium">{r.newmen + r.vatebo}</td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-muted/50 font-medium">
                <td className="p-2">Итого</td>
                <td className="p-2 text-right font-mono">{totalNewmen}</td>
                <td className="p-2 text-right font-mono">{totalVatebo}</td>
                <td className="p-2 text-right font-mono">{totalAll}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ShopAgentSettings() {
  return (
    <Tabs defaultValue="credentials">
      <TabsList>
        <TabsTrigger value="credentials" className="gap-1.5">
          <KeyRound className="w-4 h-4" />
          Учётные данные
        </TabsTrigger>
        <TabsTrigger value="prompt" className="gap-1.5">
          <MessageSquare className="w-4 h-4" />
          Промт
        </TabsTrigger>
        <TabsTrigger value="task-prompts" className="gap-1.5">
          <Bot className="w-4 h-4" />
          Промпты задач
        </TabsTrigger>
        <TabsTrigger value="knowledge" className="gap-1.5">
          <BookOpen className="w-4 h-4" />
          Знания
        </TabsTrigger>
      </TabsList>
      <TabsContent value="credentials">
        <CredentialsTab />
      </TabsContent>
      <TabsContent value="prompt">
        <PromptTab />
      </TabsContent>
      <TabsContent value="task-prompts">
        <TaskPromptsTab />
      </TabsContent>
      <TabsContent value="knowledge">
        <KnowledgeTab />
      </TabsContent>
    </Tabs>
  );
}

function CredentialsTab() {
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ domain: "", email: "", password: "", loginUrl: "", notes: "", legalEntity: "" });
  const [showImport, setShowImport] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importEntity, setImportEntity] = useState("Newmen");

  const { data: credentials = [], isLoading } = useQuery<ShopCredential[]>({
    queryKey: ["/api/shop-agent/credentials"],
    queryFn: async () => {
      const res = await fetch("/api/shop-agent/credentials", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof form) => apiRequest("POST", "/api/shop-agent/credentials", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/credentials"] });
      toast({ title: "Учётные данные добавлены" });
      setShowAdd(false);
      setForm({ domain: "", email: "", password: "", loginUrl: "", notes: "", legalEntity: "" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof form }) =>
      apiRequest("PUT", `/api/shop-agent/credentials/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/credentials"] });
      toast({ title: "Обновлено" });
      setEditId(null);
      setForm({ domain: "", email: "", password: "", loginUrl: "", notes: "", legalEntity: "" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/shop-agent/credentials/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/credentials"] });
      toast({ title: "Удалено" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (data: { csvData: string; legalEntity: string }) => {
      const res = await apiRequest("POST", "/api/shop-agent/credentials/import", data);
      return res.json();
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/credentials"] });
      toast({ title: `Импортировано: ${result.imported}, пропущено: ${result.skipped}${result.errors?.length ? `, ошибок: ${result.errors.length}` : ""}` });
      setShowImport(false);
      setCsvText("");
    },
    onError: (err: any) => {
      toast({ title: "Ошибка импорта", description: err.message, variant: "destructive" });
    },
  });

  const startEdit = (cred: ShopCredential) => {
    setEditId(cred.id);
    setForm({ domain: cred.domain, email: cred.email, password: "", loginUrl: cred.loginUrl || "", notes: cred.notes || "", legalEntity: cred.legalEntity || "" });
  };

  const handleCsvFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      setCsvText(evt.target?.result as string || "");
    };
    reader.readAsText(file);
  };

  const statusBadge = (status: string | null) => {
    switch (status) {
      case "active":
        return <Badge className="bg-green-100 text-green-800 text-xs"><ShieldCheckIcon className="w-3 h-3 mr-1" />Active</Badge>;
      case "login_failed":
        return <Badge variant="destructive" className="text-xs"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case "disabled":
        return <Badge variant="secondary" className="text-xs">Disabled</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">{status}</Badge>;
    }
  };

  if (isLoading) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button onClick={() => { setShowAdd(true); setEditId(null); setForm({ domain: "", email: "", password: "", loginUrl: "", notes: "", legalEntity: "" }); }}>
          <Plus className="w-4 h-4 mr-2" />
          Добавить
        </Button>
        <Button variant="outline" onClick={() => setShowImport(true)}>
          <Upload className="w-4 h-4 mr-2" />
          Импорт CSV
        </Button>
        <span className="text-sm text-muted-foreground">{credentials.length} записей</span>
      </div>

      {showImport && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Импорт учётных данных из CSV</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">ЮЛ Выкупа</label>
                <select
                  className="border rounded-md px-3 py-2 text-sm bg-background w-full h-9"
                  value={importEntity}
                  onChange={(e) => setImportEntity(e.target.value)}
                >
                  <option value="Newmen">Newmen</option>
                  <option value="Vatebo">Vatebo</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Файл CSV</label>
                <Input type="file" accept=".csv,.txt,.tsv" onChange={handleCsvFileUpload} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Или вставьте CSV (домен, email, пароль [, URL, заметки])</label>
              <textarea
                className="w-full border rounded-md p-2 text-xs font-mono h-32 bg-background"
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
                placeholder={"domain;email;password\namazon.de;user@mail.com;MyPass123\nzalando.de;shop@mail.com;Pass456"}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => importMutation.mutate({ csvData: csvText, legalEntity: importEntity })}
                disabled={!csvText.trim() || importMutation.isPending}
              >
                {importMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Upload className="w-4 h-4 mr-2" />}
                Импортировать
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setShowImport(false); setCsvText(""); }}>
                Отмена
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(showAdd || editId !== null) && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Домен</label>
                <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="mediamarkt.de" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Email</label>
                <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="user@example.com" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Пароль {editId ? "(оставьте пустым чтобы не менять)" : ""}</label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">URL входа (опционально)</label>
                <Input value={form.loginUrl} onChange={(e) => setForm({ ...form, loginUrl: e.target.value })} placeholder="https://..." />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">ЮЛ Выкупа</label>
                <select
                  className="border rounded-md px-3 py-2 text-sm bg-background w-full h-9"
                  value={form.legalEntity}
                  onChange={(e) => setForm({ ...form, legalEntity: e.target.value })}
                >
                  <option value="">— Не выбрано —</option>
                  <option value="Newmen">Newmen</option>
                  <option value="Vatebo">Vatebo</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Заметки</label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Доп. информация..." />
              </div>
            </div>
            <div className="flex gap-2">
              {editId !== null ? (
                <Button size="sm" onClick={() => updateMutation.mutate({ id: editId, data: form })}>
                  Сохранить
                </Button>
              ) : (
                <Button size="sm" onClick={() => createMutation.mutate(form)} disabled={!form.domain || !form.email || !form.password}>
                  Добавить
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => { setShowAdd(false); setEditId(null); }}>
                Отмена
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Email distribution report */}
      {credentials.length > 0 && <EmailDistributionReport credentials={credentials} />}

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="p-2 text-left">Домен</th>
              <th className="p-2 text-left">Email</th>
              <th className="p-2 text-left">Пароль</th>
              <th className="p-2 text-left">ЮЛ</th>
              <th className="p-2 text-left">URL входа</th>
              <th className="p-2 text-left">Статус</th>
              <th className="p-2 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {credentials.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  Добавьте учётные данные магазинов для автоматической проверки
                </td>
              </tr>
            ) : (
              credentials.map((c) => (
                <tr key={c.id} className="border-b hover:bg-muted/30">
                  <td className="p-2 font-medium">{c.domain}</td>
                  <td className="p-2">{c.email}</td>
                  <td className="p-2 text-muted-foreground">••••••</td>
                  <td className="p-2 text-xs">
                    {c.legalEntity ? (
                      <Badge variant="outline" className="text-xs">{c.legalEntity}</Badge>
                    ) : "—"}
                  </td>
                  <td className="p-2 text-xs text-muted-foreground truncate max-w-[200px]">{c.loginUrl || "—"}</td>
                  <td className="p-2">{statusBadge(c.status)}</td>
                  <td className="p-2 text-right">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(c)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => deleteMutation.mutate(c.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PromptTab() {
  const { toast } = useToast();
  const [promptText, setPromptText] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  const { data, isLoading } = useQuery<{ prompt: string | null }>({
    queryKey: ["/api/shop-agent/prompt"],
    queryFn: async () => {
      const res = await fetch("/api/shop-agent/prompt", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load prompt");
      return res.json();
    },
  });

  useEffect(() => {
    if (data?.prompt) {
      setPromptText(data.prompt);
      setHasChanges(false);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (prompt: string) => {
      return apiRequest("PUT", "/api/shop-agent/prompt", { prompt });
    },
    onSuccess: () => {
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/prompt"] });
      toast({ title: "Промт сохранён" });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка сохранения", description: err.message, variant: "destructive" });
    },
  });

  const handleChange = (value: string) => {
    setPromptText(value);
    setHasChanges(true);
  };

  const handleReset = () => {
    if (data?.prompt) {
      setPromptText(data.prompt);
    }
    setHasChanges(false);
  };

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Системный промт для AI-навигатора. Определяет как агент взаимодействует с сайтами магазинов.
          </p>
        </div>
        <div className="flex gap-2">
          {hasChanges && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="w-4 h-4 mr-1" />
              Отмена
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => saveMutation.mutate(promptText)}
            disabled={!hasChanges || saveMutation.isPending || !promptText.trim()}
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-1 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-1" />
            )}
            Сохранить
          </Button>
        </div>
      </div>

      <textarea
        value={promptText}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Введите системный промт для AI-навигатора..."
        className="w-full min-h-[500px] font-mono text-sm leading-relaxed border rounded-md p-3 bg-background"
      />

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{promptText.length} символов</span>
        {hasChanges && <span className="text-orange-500">Есть несохранённые изменения</span>}
      </div>
    </div>
  );
}

// ============================================================
// Task Prompts Tab (for autonomous task watcher)
// ============================================================

interface TaskPromptItem {
  id: number;
  taskType: string;
  promptTemplate: string;
  updatedAt: string;
}

const TASK_TYPE_LABELS: Record<string, string> = {
  email_recipe: "Email рецепт",
  lk_setup: "Настройка ЛК",
  general: "Общая задача",
};

const TASK_TYPE_DESCRIPTIONS: Record<string, string> = {
  email_recipe: "Создание/исправление email-рецептов. Плейсхолдеры: {{domain}}, {{domain_prefix}}, {{note_text}}, {{check_method}}, {{sender}}, {{subject_pattern}}, {{knowledge}}",
  lk_setup: "Настройка проверки через ЛК (личный кабинет). Плейсхолдеры: {{domain}}, {{note_text}}, {{check_method}}, {{sender}}, {{knowledge}}",
  general: "Произвольные задачи. Плейсхолдеры: {{domain}}, {{note_text}}, {{check_method}}, {{knowledge}}",
};

function TaskPromptsTab() {
  const { toast } = useToast();

  const { data: prompts = [], isLoading } = useQuery<TaskPromptItem[]>({
    queryKey: ["/api/shop-agent/task-prompts"],
    queryFn: async () => {
      const res = await fetch("/api/shop-agent/task-prompts", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const [editingType, setEditingType] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const saveMutation = useMutation({
    mutationFn: async ({ taskType, promptTemplate }: { taskType: string; promptTemplate: string }) => {
      return apiRequest("PUT", `/api/shop-agent/task-prompts/${encodeURIComponent(taskType)}`, { promptTemplate });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/task-prompts"] });
      toast({ title: "Промпт сохранён" });
      setEditingType(null);
    },
    onError: (err: any) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Шаблоны промптов для автономного task watcher. Определяют как AI-агент обрабатывает задачи "Доработать".
      </p>

      {prompts.map((p) => (
        <Card key={p.taskType}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">{TASK_TYPE_LABELS[p.taskType] || p.taskType}</CardTitle>
                <CardDescription className="text-xs mt-1">
                  {TASK_TYPE_DESCRIPTIONS[p.taskType] || ""}
                </CardDescription>
              </div>
              {editingType === p.taskType ? (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditingType(null)}>
                    <X className="w-4 h-4 mr-1" />Отмена
                  </Button>
                  <Button size="sm" onClick={() => saveMutation.mutate({ taskType: p.taskType, promptTemplate: editText })}
                    disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
                    Сохранить
                  </Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => { setEditingType(p.taskType); setEditText(p.promptTemplate); }}>
                  <Pencil className="w-4 h-4 mr-1" />Редактировать
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {editingType === p.taskType ? (
              <textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                className="w-full min-h-[400px] font-mono text-xs leading-relaxed border rounded-md p-3 bg-background"
              />
            ) : (
              <pre className="text-xs font-mono bg-muted p-3 rounded-md overflow-auto max-h-[300px] whitespace-pre-wrap">
                {p.promptTemplate}
              </pre>
            )}
            <div className="flex justify-between mt-2 text-xs text-muted-foreground">
              <span>{p.promptTemplate.length} символов</span>
              <span>Обновлено: {new Date(p.updatedAt).toLocaleString("ru")}</span>
            </div>
          </CardContent>
        </Card>
      ))}

      {prompts.length === 0 && (
        <div className="text-center text-muted-foreground py-8">
          Нет промптов. Добавьте через SQL или API.
        </div>
      )}
    </div>
  );
}

// ============================================================
// Knowledge Tab (recipe_knowledge base)
// ============================================================

interface KnowledgeItem {
  id: number;
  category: string;
  topic: string;
  content: string;
  examples: any;
  tags: string[] | null;
  createdAt: string;
  updatedAt: string;
}

const KNOWLEDGE_CATEGORIES = [
  { value: "workflow", label: "Workflow" },
  { value: "gotcha", label: "Gotcha" },
  { value: "extraction", label: "Extraction" },
  { value: "email_type", label: "Email Type" },
  { value: "sender_pattern", label: "Sender Pattern" },
  { value: "carrier", label: "Carrier" },
  { value: "lk_login", label: "ЛК Login" },
];

const CATEGORY_COLORS: Record<string, string> = {
  workflow: "bg-blue-100 text-blue-800",
  gotcha: "bg-orange-100 text-orange-800",
  extraction: "bg-green-100 text-green-800",
  email_type: "bg-purple-100 text-purple-800",
  sender_pattern: "bg-cyan-100 text-cyan-800",
  carrier: "bg-yellow-100 text-yellow-800",
  lk_login: "bg-red-100 text-red-800",
};

function KnowledgeTab() {
  const { toast } = useToast();
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [editItem, setEditItem] = useState<KnowledgeItem | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    category: "gotcha",
    topic: "",
    content: "",
    tags: "",
    examples: "",
  });

  const { data: items = [], isLoading } = useQuery<KnowledgeItem[]>({
    queryKey: ["/api/shop-agent/recipe-knowledge"],
    queryFn: async () => {
      const res = await fetch("/api/shop-agent/recipe-knowledge", { credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/shop-agent/recipe-knowledge", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/recipe-knowledge"] });
      toast({ title: "Знание добавлено" });
      setShowAdd(false);
      setForm({ category: "gotcha", topic: "", content: "", tags: "", examples: "" });
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => apiRequest("PUT", `/api/shop-agent/recipe-knowledge/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/recipe-knowledge"] });
      toast({ title: "Знание обновлено" });
      setEditItem(null);
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/shop-agent/recipe-knowledge/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/shop-agent/recipe-knowledge"] });
      toast({ title: "Знание удалено" });
      setEditItem(null);
    },
    onError: (err: any) => toast({ title: "Ошибка", description: err.message, variant: "destructive" }),
  });

  const filtered = filterCategory === "all" ? items : items.filter(i => i.category === filterCategory);

  const handleSave = () => {
    const tags = form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [];
    let examples = null;
    if (form.examples.trim()) {
      try { examples = JSON.parse(form.examples); } catch {
        toast({ title: "Ошибка", description: "Examples: невалидный JSON", variant: "destructive" });
        return;
      }
    }
    if (editItem) {
      updateMutation.mutate({ id: editItem.id, data: { ...form, tags, examples } });
    } else {
      createMutation.mutate({ ...form, tags, examples });
    }
  };

  const openEdit = (item: KnowledgeItem) => {
    setEditItem(item);
    setForm({
      category: item.category,
      topic: item.topic,
      content: item.content,
      tags: item.tags?.join(", ") || "",
      examples: item.examples ? JSON.stringify(item.examples, null, 2) : "",
    });
  };

  const openAdd = () => {
    setEditItem(null);
    setForm({ category: "gotcha", topic: "", content: "", tags: "", examples: "" });
    setShowAdd(true);
  };

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          База знаний для AI-агента. {items.length} записей.
        </p>
        <div className="flex gap-2">
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-[160px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все категории</SelectItem>
              {KNOWLEDGE_CATEGORIES.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={openAdd}>
            <Plus className="w-4 h-4 mr-1" />Добавить
          </Button>
        </div>
      </div>

      <div className="border rounded-md">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-2 font-medium w-[120px]">Категория</th>
              <th className="text-left p-2 font-medium w-[200px]">Тема</th>
              <th className="text-left p-2 font-medium">Содержание</th>
              <th className="text-left p-2 font-medium w-[100px]">Теги</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b hover:bg-muted/30 cursor-pointer" onClick={() => openEdit(item)}>
                <td className="p-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${CATEGORY_COLORS[item.category] || "bg-gray-100"}`}>
                    {item.category}
                  </span>
                </td>
                <td className="p-2 font-mono text-xs">{item.topic}</td>
                <td className="p-2 text-xs text-muted-foreground truncate max-w-[400px]">
                  {item.content.slice(0, 120)}...
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-1">
                    {item.tags?.slice(0, 3).map(t => (
                      <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="p-4 text-center text-muted-foreground">Нет записей</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Dialog for add/edit */}
      <Dialog open={showAdd || !!editItem} onOpenChange={(open) => { if (!open) { setShowAdd(false); setEditItem(null); } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editItem ? `Редактировать: ${editItem.topic}` : "Добавить знание"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Категория</Label>
                <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v }))}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KNOWLEDGE_CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Тема (topic)</Label>
                <Input
                  className="mt-1"
                  placeholder="dhl_tracking_regex"
                  value={form.topic}
                  onChange={e => setForm(f => ({ ...f, topic: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Содержание</Label>
              <Textarea
                className="mt-1 font-mono text-xs"
                rows={8}
                placeholder="Описание знания..."
                value={form.content}
                onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              />
            </div>

            <div>
              <Label className="text-xs">Теги (через запятую)</Label>
              <Input
                className="mt-1"
                placeholder="tracking, dhl, regex"
                value={form.tags}
                onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              />
            </div>

            <div>
              <Label className="text-xs">Примеры (JSON, опционально)</Label>
              <Textarea
                className="mt-1 font-mono text-xs"
                rows={4}
                placeholder='[{"domain": "crocs.de", "pattern": "..."}]'
                value={form.examples}
                onChange={e => setForm(f => ({ ...f, examples: e.target.value }))}
              />
            </div>

            <div className="flex justify-between pt-2">
              {editItem ? (
                <Button variant="destructive" size="sm" onClick={() => deleteMutation.mutate(editItem.id)}
                  disabled={deleteMutation.isPending}>
                  <Trash2 className="w-4 h-4 mr-1" />Удалить
                </Button>
              ) : <div />}
              <Button onClick={handleSave}
                disabled={!form.topic.trim() || !form.content.trim() || createMutation.isPending || updateMutation.isPending}>
                {(createMutation.isPending || updateMutation.isPending) ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-1" />
                )}
                {editItem ? "Обновить" : "Добавить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeTrackingSettings() {
  const { toast } = useToast();

  const batchStatus = useQuery<{
    nextScheduledCheck?: string | null;
    scheduledCheckInProgress?: boolean;
    lastCheckAt?: string | null;
    lastCheckTracksCount?: number;
    nextCheckIsSecondPass?: boolean;
    schedule?: { time: string; label: string }[];
    amazonSync?: {
      lastSyncAt: string | null;
      lastResult: {
        total: number;
        delivered: number;
        inTransit: number;
        sheetRows: number;
        errors: string[];
        timestamp: string;
      } | null;
    };
  }>({
    queryKey: ["/api/logistics/parcel-tracking-de/batch-status"],
    refetchInterval: 30000,
  });

  const amazonSyncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/logistics/amazon-sheet-sync"),
    onSuccess: async () => {
      toast({ title: "Amazon Sheet синхронизация завершена" });
      queryClient.invalidateQueries({ queryKey: ["/api/logistics/parcel-tracking-de/batch-status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/logistics/parcel-tracking-de/statuses"] });
    },
    onError: (err: any) => {
      toast({ title: "Ошибка синхронизации", description: err.message, variant: "destructive" });
    },
  });

  const fmtTime = (iso: string | null | undefined) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch { return iso; }
  };

  const fmtMinutes = (iso: string | null | undefined) => {
    if (!iso) return "";
    const diff = new Date(iso).getTime() - Date.now();
    if (diff < 0) return "сейчас";
    const min = Math.round(diff / 60000);
    if (min < 60) return `через ${min} мин`;
    const h = Math.floor(min / 60);
    return `через ${h}ч ${min % 60}мин`;
  };

  const d = batchStatus.data;
  const amz = d?.amazonSync;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Расписание DE трекинга
          </CardTitle>
          <CardDescription>
            Проверка статусов посылок через 17track API и Amazon Google Sheet
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {d?.schedule && (
            <div>
              <h4 className="text-sm font-medium mb-2">Расписание (МСК):</h4>
              <div className="grid grid-cols-2 gap-1 text-sm max-w-md">
                {d.schedule.map((s, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="font-mono text-muted-foreground">{s.time}</span>
                    <span>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="border rounded-lg p-3 space-y-1">
              <h4 className="text-sm font-medium flex items-center gap-1.5">
                <Package className="w-4 h-4" />
                17track
              </h4>
              <div className="text-sm text-muted-foreground">
                <div>Последняя проверка: {fmtTime(d?.lastCheckAt)}</div>
                {d?.lastCheckTracksCount !== undefined && d.lastCheckTracksCount > 0 && (
                  <div>Проверено треков: {d.lastCheckTracksCount}</div>
                )}
              </div>
            </div>

            <div className="border rounded-lg p-3 space-y-1">
              <h4 className="text-sm font-medium flex items-center gap-1.5">
                <Package className="w-4 h-4" />
                Amazon Sheet
              </h4>
              <div className="text-sm text-muted-foreground">
                <div>Последняя проверка: {fmtTime(amz?.lastSyncAt)}</div>
                {amz?.lastResult && (
                  <>
                    <div>Обработано: {amz.lastResult.total}, доставлено: {amz.lastResult.delivered}, в пути: {amz.lastResult.inTransit}</div>
                    {amz.lastResult.errors.length > 0 && (
                      <div className="text-red-500">Ошибки: {amz.lastResult.errors.join(", ")}</div>
                    )}
                  </>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => amazonSyncMutation.mutate()}
                disabled={amazonSyncMutation.isPending}
                className="mt-2"
              >
                {amazonSyncMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                Синхронизировать
              </Button>
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            Следующая проверка: {fmtTime(d?.nextScheduledCheck)} ({fmtMinutes(d?.nextScheduledCheck)})
            {d?.nextCheckIsSecondPass && " — 2-й проход + CRM экспорт"}
            {d?.scheduledCheckInProgress && <Badge variant="outline" className="ml-2">Выполняется</Badge>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
