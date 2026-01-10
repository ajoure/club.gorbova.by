import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useUnreadMessagesCount } from "@/hooks/useUnreadMessagesCount";
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
  FileText,
  Plug,
  Handshake,
  Package,
  Wrench,
  CalendarClock,
  ClipboardCheck,
  MessageCircle,
  ClipboardList,
  Building2,
  FileStack,
  Inbox,
  Send,
  GraduationCap,
} from "lucide-react";

export function AdminSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { hasPermission, hasAnyPermission } = usePermissions();
  const unreadMessagesCount = useUnreadMessagesCount();
  const { data: unreadEmailCount = 0 } = useUnreadEmailCount();
  const totalUnread = unreadMessagesCount + unreadEmailCount;
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

  const isInboxActive = location.pathname === "/admin/inbox";
  const isIntegrationsActive = location.pathname.startsWith("/admin/integrations");
  const isContactsActive = location.pathname === "/admin/contacts" || location.pathname.startsWith("/admin/contacts/");
  const isDealsActive = location.pathname === "/admin/deals" || location.pathname.startsWith("/admin/deals/");
  const isProductsActive = location.pathname.startsWith("/admin/products-v2");
  const isInstallmentsActive = location.pathname === "/admin/installments";
  const isConsentsActive = location.pathname === "/admin/consents";
  const isPreregistrationsActive = location.pathname === "/admin/preregistrations";

  return (
    <Sidebar
      collapsible="icon"
      className="border-r-0"
      style={{
        background: "var(--gradient-sidebar)",
      }}
    >
      <SidebarHeader className="p-4" style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}>
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
        {/* CRM Section */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider px-3">
            {!collapsed && "CRM"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {/* Входящие */}
              {hasClientsPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isInboxActive}
                    tooltip={collapsed ? "Входящие" : undefined}
                  >
                    <NavLink
                      to="/admin/inbox"
                      end
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <Inbox className="h-5 w-5 shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="flex-1">Входящие</span>
                          {totalUnread > 0 && (
                            <Badge 
                              variant="destructive" 
                              className="h-5 min-w-5 px-1.5 text-xs"
                            >
                              {totalUnread}
                            </Badge>
                          )}
                        </>
                      )}
                      {collapsed && totalUnread > 0 && (
                        <span className="absolute top-0 right-0 h-2 w-2 bg-destructive rounded-full" />
                      )}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Сделки */}
              {hasEntitlementsPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isDealsActive}
                    tooltip={collapsed ? "Сделки" : undefined}
                  >
                    <NavLink
                      to="/admin/deals"
                      end
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <Handshake className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Сделки</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Контакты */}
              {hasClientsPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isContactsActive}
                    tooltip={collapsed ? "Контакты" : undefined}
                  >
                    <NavLink
                      to="/admin/contacts"
                      end
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <Users className="h-5 w-5 shrink-0" />
                      {!collapsed && (
                        <>
                          <span className="flex-1">Контакты</span>
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

              {/* Продукты */}
              {hasEntitlementsPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isProductsActive}
                    tooltip={collapsed ? "Продукты" : undefined}
                  >
                    <NavLink
                      to="/admin/products-v2"
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <Package className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Продукты</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Рассрочки */}
              {hasEntitlementsPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isInstallmentsActive}
                    tooltip={collapsed ? "Рассрочки" : undefined}
                  >
                    <NavLink
                      to="/admin/installments"
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <CalendarClock className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Рассрочки</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Предзаписи */}
              {hasClientsPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isPreregistrationsActive}
                    tooltip={collapsed ? "Предзаписи" : undefined}
                  >
                    <NavLink
                      to="/admin/preregistrations"
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <ClipboardList className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Предзаписи</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Рассылки */}
              {hasClientsPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === "/admin/broadcasts"}
                    tooltip={collapsed ? "Рассылки" : undefined}
                  >
                    <NavLink
                      to="/admin/broadcasts"
                      end
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <Send className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Рассылки</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Интеграции */}
              {hasEntitlementsPermission && (
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
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Служебные Section */}
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider px-3">
            {!collapsed && "Служебные"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
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

              {/* Тренинги */}
              {hasContentPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname.startsWith("/admin/training")}
                    tooltip={collapsed ? "Тренинги" : undefined}
                  >
                    <NavLink
                      to="/admin/training-modules"
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <GraduationCap className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Тренинги</span>}
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

              {/* Согласия */}
              {hasClientsPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={isConsentsActive}
                    tooltip={collapsed ? "Согласия" : undefined}
                  >
                    <NavLink
                      to="/admin/consents"
                      end
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <ClipboardCheck className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Согласия</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Исполнители */}
              {hasRolesPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === "/admin/executors"}
                    tooltip={collapsed ? "Исполнители" : undefined}
                  >
                    <NavLink
                      to="/admin/executors"
                      end
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <Building2 className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Исполнители</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Шаблоны документов */}
              {hasRolesPermission && (
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={location.pathname === "/admin/document-templates"}
                    tooltip={collapsed ? "Шаблоны документов" : undefined}
                  >
                    <NavLink
                      to="/admin/document-templates"
                      end
                      className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                      activeClassName="bg-sidebar-accent text-sidebar-primary"
                    >
                      <FileStack className="h-5 w-5 shrink-0" />
                      {!collapsed && <span>Шаблоны документов</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}

              {/* Участники клуба */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname.includes("/admin/integrations/telegram/clubs/") && location.pathname.includes("/members")}
                  tooltip={collapsed ? "Участники клуба" : undefined}
                >
                  <NavLink
                    to="/admin/integrations/telegram/clubs/fa547c41-3a84-4c4f-904a-427332a0506e/members"
                    end
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                    activeClassName="bg-sidebar-accent text-sidebar-primary"
                  >
                    <MessageCircle className="h-5 w-5 shrink-0" />
                    {!collapsed && <span>Участники клуба</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>

              {/* Аудит системы - только для super_admin */}
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={location.pathname === "/admin/system/audit"}
                  tooltip={collapsed ? "Аудит системы" : undefined}
                >
                  <NavLink
                    to="/admin/system/audit"
                    end
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
                    activeClassName="bg-sidebar-accent text-sidebar-primary"
                  >
                    <Wrench className="h-5 w-5 shrink-0" />
                    {!collapsed && <span>Аудит системы</span>}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
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

      <SidebarFooter className="p-3" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}>
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
