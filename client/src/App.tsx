import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import { Bot, Settings, LogOut, ShieldX, Truck, Store, LayoutDashboard } from "lucide-react";
import NotFound from "@/pages/not-found";
import SettingsPage from "@/pages/settings";
import ShopAgentPage from "@/pages/shop-agent";
import TrackingDePage from "@/pages/tracking-de";
import { useAuth } from "@/hooks/use-auth";
import type { AppSection } from "@shared/models/auth";

type MenuItem = {
  title: string;
  url: string;
  icon: typeof Truck;
  section: AppSection;
};

type MenuGroup = {
  label?: string;
  items: MenuItem[];
};

const menuGroups: MenuGroup[] = [
  {
    items: [
      { title: "Дашборд", url: "/", icon: LayoutDashboard, section: "dashboard" },
    ],
  },
  {
    items: [
      { title: "Сбор треков", url: "/shop-agent", icon: Store, section: "shop_agent" },
      { title: "Трекинг треков", url: "/tracking-de", icon: Truck, section: "tracking_de" },
    ],
  },
];

const bottomMenuItems: MenuItem[] = [
  { title: "Настройки", url: "/settings", icon: Settings, section: "settings" },
];

function AppSidebar() {
  const [location] = useLocation();
  const { user, logout, isLoggingOut } = useAuth();

  const allowedSections = user?.allowedSections || [];

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-3">
        <Link href="/" className="text-base font-semibold text-sidebar-foreground">
          Buying
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {menuGroups.map((group, groupIdx) => {
          const visibleItems = group.items.filter(item => {
            if (user?.isAdmin) return true;
            return allowedSections.includes(item.section);
          });
          if (visibleItems.length === 0) return null;

          return (
            <SidebarGroup key={groupIdx} className="px-4 pt-0">
              {group.label && (
                <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              )}
              <SidebarGroupContent>
                <SidebarMenu>
                  {visibleItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={location === item.url || (item.url !== "/" && location.startsWith(item.url))}
                      >
                        <Link href={item.url} data-testid={`nav-${item.url.replace("/", "") || "home"}`}>
                          <item.icon className="w-4 h-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter className="px-4 pb-4 pt-0">
        {(() => {
          const visibleBottom = bottomMenuItems.filter(item => {
            if (user?.isAdmin) return true;
            return allowedSections.includes(item.section);
          });
          if (visibleBottom.length === 0) return null;
          return (
            <SidebarMenu className="mb-2">
              {visibleBottom.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url || (item.url !== "/" && location.startsWith(item.url))}
                  >
                    <Link href={item.url} data-testid={`nav-${item.url.replace("/", "") || "home"}`}>
                      <item.icon className="w-4 h-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          );
        })()}
        {user && (
          <div className="flex items-center gap-3 p-3 rounded-md bg-sidebar-accent">
            <Avatar className="w-8 h-8">
              <AvatarImage src={user.profileImageUrl || undefined} />
              <AvatarFallback className="text-xs">
                {(user.firstName?.[0] || "") + (user.lastName?.[0] || "")}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout()}
              disabled={isLoggingOut}
              data-testid="button-logout"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center">
      <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <ShieldX className="w-8 h-8 text-destructive" />
      </div>
      <h2 className="text-xl font-semibold mb-2">Доступ запрещён</h2>
      <p className="text-muted-foreground mb-4">
        У вас нет доступа к этому разделу
      </p>
      <Link href="/">
        <Button data-testid="button-go-home">На главную</Button>
      </Link>
    </div>
  );
}

function ProtectedRoute({ section, component: Component }: { section: AppSection; component: React.ComponentType }) {
  const { user } = useAuth();
  const allowedSections = user?.allowedSections || [];
  const hasAccess = user?.isAdmin || allowedSections.includes(section);
  
  if (!hasAccess) {
    return <AccessDenied />;
  }
  
  return <Component />;
}

function DashboardPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">Buying Dashboard</h1>
      <p className="text-muted-foreground mt-2">Coming soon</p>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/">
        {() => <ProtectedRoute section="dashboard" component={DashboardPage} />}
      </Route>
      <Route path="/shop-agent">
        {() => <ProtectedRoute section="shop_agent" component={ShopAgentPage} />}
      </Route>
      <Route path="/tracking-de">
        {() => <ProtectedRoute section="tracking_de" component={TrackingDePage} />}
      </Route>
      <Route path="/settings">
        {() => <ProtectedRoute section="settings" component={SettingsPage} />}
      </Route>
      <Route>{() => <Redirect to="/" />}</Route>
    </Switch>
  );
}

function LoginPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get("error");

  const errorMessages: Record<string, string> = {
    domain_not_allowed: "Вход разрешён только для пользователей @newmen.info",
    email_not_allowed: "Ваш email не в списке приглашённых. Обратитесь к администратору.",
    auth_failed: "Ошибка аутентификации. Попробуйте ещё раз.",
    no_user: "Не удалось получить данные пользователя",
    login_failed: "Ошибка входа. Попробуйте ещё раз.",
    session_failed: "Ошибка сессии. Попробуйте ещё раз.",
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-8 space-y-4">
        {error && (
          <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm text-center">
            {errorMessages[error] || "Произошла ошибка"}
          </div>
        )}
        <Button
          className="w-full"
          size="lg"
          onClick={() => window.location.href = "/api/login"}
          data-testid="button-login"
        >
          Login
        </Button>
      </div>
    </div>
  );
}

function AccessDeniedPage() {
  const { user, logout } = useAuth();
  
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="w-full max-w-md p-8 space-y-6 text-center">
        <div className="w-16 h-16 rounded-md bg-destructive/10 flex items-center justify-center mx-auto">
          <Bot className="w-10 h-10 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold">Доступ ограничен</h1>
        <p className="text-muted-foreground">
          Ваш аккаунт ({user?.email}) ожидает одобрения администратора.
        </p>
        <Button
          variant="outline"
          onClick={() => logout()}
          data-testid="button-logout-access-denied"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Выйти
        </Button>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <main className="flex-1 overflow-auto">
          <Router />
        </main>
      </div>
    </SidebarProvider>
  );
}

function AppContent() {
  const { user, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="space-y-4 text-center">
          <Skeleton className="w-16 h-16 rounded-md mx-auto" />
          <Skeleton className="w-32 h-4 mx-auto" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  if (!user?.isApproved) {
    return <AccessDeniedPage />;
  }

  return <AuthenticatedApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppContent />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
