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
  Plug,
  Copy,
  Database,
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
    refetchInterval: 60000,
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

  const hasClientsPermission = hasAnyPermission(["users.view", "users.update", "users.block", "users.delete"]);
  const hasRolesPermission = hasAnyPermission(["roles.view", "roles.manage", "admins.manage"]);
  const hasEntitlementsPermission = hasAnyPermission(["entitlements.view", "entitlements.manage"]);
  const hasContentPermission = hasAnyPermission(["content.view", "content.edit", "content.publish"]);
  const hasAuditPermission = hasPermission("audit.view");

  const isIntegrationsActive = location.pathname.startsWith("/admin/integrations");
  const isClientsActive = location.pathname === "/admin/users" || location.pathname.startsWith("/admin/users/");

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
              {/* Клиенты */}
              {hasClientsPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isClientsActive}
                    tooltip={collapsed ? "Клиенты" : undefined}
                  >
                    <NavLink
                      to="/admin/users"
                      end
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <Users className="h-5 w-5 shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="flex-1">Клиенты</span>
                          {duplicateCount && duplicateCount > 0 && (
                            <Badge 
                              variant="destructive" 
                              className="h-5 min-w-5 px-1.5 text-xs"
                            >
                              {duplicateCount}
                            </Badge>
                          )}
                        </>
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Сотрудники и роли */}
              {hasRolesPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === "/admin/roles"}
                    tooltip={collapsed ? "Сотрудники и роли" : undefined}
                  >
                    <NavLink
                      to="/admin/roles"
                      end
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <Shield className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Сотрудники и роли</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Доступы, Продукты */}
              {hasEntitlementsPermission && (
                <>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === "/admin/entitlements"}
                      tooltip={collapsed ? "Доступы" : undefined}
                    >
                      <NavLink
                        to="/admin/entitlements"
                        end
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                        activeClassName="bg-sidebar-accent text-sidebar-primary"
                      >
                        <Package className="h-5 w-5 shrink-0" />
                        {!collapsed && <span>Доступы</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === "/admin/products"}
                      tooltip={collapsed ? "Продукты" : undefined}
                    >
                      <NavLink
                        to="/admin/products"
                        end
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                        activeClassName="bg-sidebar-accent text-sidebar-primary"
                      >
                        <ShoppingCart className="h-5 w-5 shrink-0" />
                        {!collapsed && <span>Продукты</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  
                  {/* Интеграции */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={isIntegrationsActive}
                      tooltip={collapsed ? "Интеграции" : undefined}
                    >
                      <NavLink
                        to="/admin/integrations/crm"
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                        activeClassName="bg-sidebar-accent text-sidebar-primary"
                      >
                        <Plug className="h-5 w-5 shrink-0" />
                        {!collapsed && <span>Интеграции</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>

                  {/* Справочник полей */}
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname === "/admin/fields"}
                      tooltip={collapsed ? "Справочник полей" : undefined}
                    >
                      <NavLink
                        to="/admin/fields"
                        end
                        className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                        activeClassName="bg-sidebar-accent text-sidebar-primary"
                      >
                        <Database className="h-5 w-5 shrink-0" />
                        {!collapsed && <span>Справочник полей</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </>
              )}

              {/* Контент */}
              {hasContentPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === "/admin/content"}
                    tooltip={collapsed ? "Контент" : undefined}
                  >
                    <NavLink
                      to="/admin/content"
                      end
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <FileText className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Контент</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Аудит-лог */}
              {hasAuditPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === "/admin/audit"}
                    tooltip={collapsed ? "Аудит-лог" : undefined}
                  >
                    <NavLink
                      to="/admin/audit"
                      end
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <ScrollText className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Аудит-лог</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
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
