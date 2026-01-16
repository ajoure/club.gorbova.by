import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import logoImage from "@/assets/logo.png";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/integrations/supabase/client";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter, useSidebar } from "@/components/ui/sidebar";
import { NavLink } from "@/components/NavLink";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Calculator, Briefcase, ClipboardCheck, Sparkles, Target, LogOut, LayoutGrid, ChevronRight, Settings, ShoppingBag, BookOpen, User, Shield, Package, ChevronUp, LifeBuoy, Activity, Wallet, Cpu, GraduationCap, Archive } from "lucide-react";

const mainMenuItems = [{
  title: "Пульс",
  url: "/dashboard",
  icon: Activity
}, {
  title: "База знаний",
  url: "/knowledge",
  icon: BookOpen
}, {
  title: "Деньги",
  url: "/money",
  icon: Wallet
}, {
  title: "Саморазвитие",
  url: "/self-development",
  icon: Sparkles
}, {
  title: "Нейросеть",
  url: "/ai",
  icon: Cpu
}, {
  title: "Обучение",
  url: "/products",
  icon: GraduationCap
}];

const legacyMenuItems = [{
  title: "Бизнес",
  url: "/business",
  icon: Briefcase
}, {
  title: "Бухгалтер",
  url: "/accountant",
  icon: Calculator
}, {
  title: "Проверки",
  url: "/audits",
  icon: ClipboardCheck
}, {
  title: "Библиотека",
  url: "/library",
  icon: BookOpen
}];

const leaderToolsItems = [{
  title: "Матрица продуктивности",
  url: "/tools/eisenhower",
  icon: LayoutGrid
}, {
  title: "Колесо баланса",
  url: "/tools/balance-wheel",
  icon: Target
}];

// Profile menu items (moved from sidebar)
const profileMenuItems = [
  { title: "FAQ", url: "/docs", icon: BookOpen },
  { title: "Техподдержка", url: "/support", icon: LifeBuoy },
  { title: "Профиль", url: "/settings/profile", icon: User },
  { title: "Оплата и карты", url: "/settings/payment-methods", icon: ShoppingBag },
  { title: "Согласия", url: "/settings/consents", icon: Shield },
  { title: "Мои покупки", url: "/purchases", icon: Target },
];

export function AppSidebar() {
  const {
    state
  } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const {
    user,
    signOut,
    role
  } = useAuth();
  const {
    hasAdminAccess,
    isAdmin,
  } = usePermissions();
  const collapsed = state === "collapsed";

  // Fetch profile data including avatar_url from Telegram
  const { data: profile } = useQuery({
    queryKey: ["sidebar-profile", user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url, full_name")
        .eq("user_id", user.id)
        .single();
      return data;
    },
    enabled: !!user?.id,
  });

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const handleLogoClick = () => {
    const hostname = window.location.hostname;
    const isProductDomain = hostname !== "localhost" && 
                            hostname !== "127.0.0.1" &&
                            hostname !== "club.gorbova.by" && 
                            hostname !== "gorbova.by" &&
                            !hostname.includes(".lovable.app") &&
                            !hostname.includes(".lovableproject.com");
    
    if (isProductDomain) {
      window.location.href = "https://club.gorbova.by";
    } else {
      navigate("/");
    }
  };

  const getRoleLabel = () => {
    switch (role) {
      case "superadmin":
        return "Владелец";
      case "admin":
        return "Администратор";
      default:
        return "Пользователь";
    }
  };

  const getUserInitials = () => {
    if (user?.user_metadata?.full_name) {
      const names = user.user_metadata.full_name.split(" ");
      return names.map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
    }
    return user?.email?.slice(0, 2).toUpperCase() || "U";
  };

  const getNameParts = () => {
    const fullName = user?.user_metadata?.full_name || profile?.full_name;
    if (fullName) {
      const parts = fullName.trim().split(/\s+/);
      if (parts.length >= 2) {
        return {
          firstName: parts[0],
          lastName: parts.slice(1).join(" "),
        };
      }
      return { firstName: fullName, lastName: null };
    }
    return { firstName: user?.email || "Пользователь", lastName: null };
  };

  const showAdminLink = isAdmin() || hasAdminAccess();
  const { firstName, lastName } = getNameParts();

  return <Sidebar collapsible="icon" className="border-r-0" style={{
    background: "var(--gradient-sidebar)"
  }}>
      <SidebarHeader className="p-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}>
        <button 
          onClick={handleLogoClick}
          className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary rounded-xl w-full text-left"
          aria-label="Перейти на главную страницу"
        >
          <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0">
            <img src={logoImage} alt="Leader Hub" className="w-full h-full object-cover" />
          </div>
          {!collapsed && <div>
              <h1 className="font-bold text-lg text-sidebar-foreground">БУКВА ЗАКОНА</h1>
              <p className="text-xs text-sidebar-foreground/60">клуб по законодательству</p>
            </div>}
        </button>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider px-3">
            {!collapsed && "Главное меню"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainMenuItems.map(item => <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location.pathname === item.url} tooltip={collapsed ? item.title : undefined}>
                    <NavLink to={item.url} end className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary">
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider px-3">
            {!collapsed && "Инструменты лидера"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {leaderToolsItems.map(item => <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location.pathname === item.url} tooltip={collapsed ? item.title : undefined}>
                    <NavLink to={item.url} end className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary">
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!collapsed && <span className="text-sm leading-tight flex-1">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider px-3">
            {!collapsed && <span className="flex items-center gap-2"><Archive className="h-3.5 w-3.5" />Разное</span>}
            {collapsed && <Archive className="h-4 w-4" />}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {legacyMenuItems.map(item => <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location.pathname === item.url} tooltip={collapsed ? item.title : undefined}>
                    <NavLink to={item.url} end className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary">
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>)}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {showAdminLink && <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider px-3">
              {!collapsed && "Администрирование"}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={location.pathname.startsWith("/admin")} tooltip={collapsed ? "Админ-панель" : undefined}>
                    <NavLink to="/admin" className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent" activeClassName="bg-sidebar-accent text-sidebar-primary">
                      <Settings className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Админ-панель</span>}
                      {!collapsed && <ChevronRight className="ml-auto h-4 w-4 opacity-50" />}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>}
      </SidebarContent>

      <SidebarFooter className="p-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button 
              className="w-full rounded-xl p-3 hover:bg-sidebar-accent/80 transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50"
              style={{ background: "hsl(var(--sidebar-accent))" }}
            >
              <div className="flex items-center gap-3">
                <Avatar className="h-10 w-10 shrink-0">
                  {profile?.avatar_url && (
                    <AvatarImage src={profile.avatar_url} alt="Аватар" className="object-cover" />
                  )}
                  <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-primary-foreground text-sm font-medium">
                    {getUserInitials()}
                  </AvatarFallback>
                </Avatar>
                {!collapsed && (
                  <div className="flex-1 min-w-0 text-left">
                    <div className="leading-tight">
                      <p className="text-sm font-medium text-sidebar-foreground truncate">
                        {firstName}
                      </p>
                      {lastName && (
                        <p className="text-sm font-medium text-sidebar-foreground truncate">
                          {lastName}
                        </p>
                      )}
                    </div>
                    <p className="text-xs text-sidebar-foreground/60 mt-0.5">
                      {getRoleLabel()}
                    </p>
                  </div>
                )}
                <ChevronUp className="h-4 w-4 text-sidebar-foreground/60 shrink-0" />
              </div>
            </button>
          </DropdownMenuTrigger>
          
          <DropdownMenuContent 
            side="top" 
            align="start" 
            className="w-56 mb-2 bg-card border-border"
            sideOffset={8}
          >
            <DropdownMenuLabel className="font-normal">
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  {profile?.avatar_url && (
                    <AvatarImage src={profile.avatar_url} alt="Аватар" className="object-cover" />
                  )}
                  <AvatarFallback className="bg-gradient-to-br from-primary to-accent text-primary-foreground text-xs">
                    {getUserInitials()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{firstName} {lastName}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
              </div>
            </DropdownMenuLabel>
            
            <DropdownMenuSeparator />
            
            {profileMenuItems.map((item) => (
              <DropdownMenuItem 
                key={item.url}
                onClick={() => navigate(item.url)}
                className="cursor-pointer gap-2"
              >
                <item.icon className="h-4 w-4" />
                {item.title}
              </DropdownMenuItem>
            ))}
            
            <DropdownMenuSeparator />
            
            <DropdownMenuItem 
              onClick={handleSignOut}
              className="cursor-pointer gap-2 text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>;
}
