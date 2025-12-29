import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavLink } from "@/components/NavLink";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Users,
  Shield,
  ScrollText,
  LogOut,
  ArrowLeft,
  Settings,
  Package,
  FileText,
  ShoppingCart,
  CreditCard,
  Copy,
} from "lucide-react";

export function AdminSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { hasPermission, hasAnyPermission } = usePermissions();
  const collapsed = state === "collapsed";

  // Fetch duplicate count
  const { data: duplicateCount } = useQuery({
    queryKey: ["duplicate-count-sidebar"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("duplicate_cases")
        .select("*", { count: "exact", head: true })
        .eq("status", "new");
      if (error) return 0;
      return count || 0;
    },
    refetchInterval: 60000, // Refresh every minute
  });

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const getUserInitials = () => {
    if (user?.user_metadata?.full_name) {
      const names = user.user_metadata.full_name.split(" ");
      return names.map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
    }
    return user?.email?.slice(0, 2).toUpperCase() || "U";
  };

  // Build menu items based on permissions
  const adminMenuItems: Array<{ 
    title: string; 
    url: string; 
    icon: typeof Users; 
    badge?: number;
  }> = [];

  if (hasAnyPermission(["users.view", "users.update", "users.block", "users.delete"])) {
    adminMenuItems.push({ title: "Клиенты", url: "/admin/users", icon: Users });
  }

  if (hasAnyPermission(["roles.view", "roles.manage", "admins.manage"])) {
    adminMenuItems.push({ title: "Сотрудники и роли", url: "/admin/roles", icon: Shield });
  }

  if (hasAnyPermission(["entitlements.view", "entitlements.manage"])) {
    adminMenuItems.push({ title: "Доступы", url: "/admin/entitlements", icon: Package });
    adminMenuItems.push({ title: "Продукты", url: "/admin/products", icon: ShoppingCart });
    adminMenuItems.push({ title: "Платежи", url: "/admin/payments", icon: CreditCard });
  }

  if (hasAnyPermission(["users.view", "users.update"])) {
    adminMenuItems.push({ 
      title: "Дубли", 
      url: "/admin/duplicates", 
      icon: Copy,
      badge: duplicateCount || undefined,
    });
  }

  if (hasAnyPermission(["content.view", "content.edit", "content.publish"])) {
    adminMenuItems.push({ title: "Контент", url: "/admin/content", icon: FileText });
  }

  if (hasPermission("audit.view")) {
    adminMenuItems.push({ title: "Аудит-лог", url: "/admin/audit", icon: ScrollText });
  }

  return (
    <Sidebar
      collapsible="icon"
      className="border-r-0"
      style={{
        background: "var(--gradient-sidebar)",
      }}
    >
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-destructive to-orange-500 flex items-center justify-center shrink-0">
            <Settings className="w-5 h-5 text-white" />
          </div>
          {!collapsed && (
            <div>
              <h1 className="font-bold text-lg text-sidebar-foreground">
                Админ-панель
              </h1>
              <p className="text-xs text-sidebar-foreground/60">
                Управление
              </p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider px-3">
            {!collapsed && "Управление"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {adminMenuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === item.url}
                    tooltip={collapsed ? item.title : undefined}
                  >
                    <NavLink
                      to={item.url}
                      end
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <item.icon className="h-5 w-5 shrink-0" />
                      {!collapsed && (
                        <span className="flex-1">{item.title}</span>
                      )}
                      {!collapsed && item.badge && item.badge > 0 && (
                        <Badge 
                          variant="destructive" 
                          className="h-5 min-w-5 px-1.5 text-xs"
                        >
                          {item.badge}
                        </Badge>
                      )}
                      {collapsed && item.badge && item.badge > 0 && (
                        <span className="absolute top-1 right-1 w-2 h-2 bg-destructive rounded-full" />
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  tooltip={collapsed ? "Назад к приложению" : undefined}
                >
                  <NavLink
                    to="/"
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent text-sidebar-foreground/70"
                  >
                    <ArrowLeft className="h-5 w-5 shrink-0" />
                    {!collapsed && <span>Назад к приложению</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-3">
        <div
          className="rounded-xl p-3"
          style={{
            background: "hsl(var(--sidebar-accent))",
          }}
        >
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarFallback className="bg-gradient-to-br from-destructive to-orange-500 text-white text-sm font-medium">
                {getUserInitials()}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-sidebar-foreground truncate">
                  {user?.user_metadata?.full_name || user?.email}
                </p>
                <p className="text-xs text-sidebar-foreground/60">
                  Администратор
                </p>
              </div>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={handleSignOut}
              className="h-8 w-8 shrink-0 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
