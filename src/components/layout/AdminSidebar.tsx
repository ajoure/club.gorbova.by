import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useRbac } from "@/hooks/useRbac";
import { useUnreadMessagesCount } from "@/hooks/useUnreadMessagesCount";
import { useUnreadEmailCount } from "@/hooks/useUnreadEmailCount";
import { useAdminMenuSettings, MENU_ICONS, MenuItem, MenuGroup } from "@/hooks/useAdminMenuSettings";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { ADMIN_SECTIONS, resolveAdminSectionForPath } from "@/lib/adminMenuRegistry";
import { supabase } from "@/integrations/supabase/client";
import { CONTACT_CENTER_VISIBLE_UNREAD_QK } from "@/constants/inboxQueryKeys";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { MenuSettingsDialog } from "@/components/admin/MenuSettingsDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LogOut,
  ArrowLeft,
  Settings,
  Cog,
  ScrollText,
  Wrench,
  ChevronUp,
  ChevronDown,
  Activity,
  BookOpen,
  ShieldCheck,
} from "lucide-react";

export function AdminSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { isSuperAdmin } = useRbac();
  const adminAccess = useAdminAccess();
  const unreadMessagesCount = useUnreadMessagesCount();
  const { data: unreadEmailCount = 0 } = useUnreadEmailCount();
  const { data: contactCenterVisibleUnread = null } = useQuery<number | null>({
    queryKey: CONTACT_CENTER_VISIBLE_UNREAD_QK,
    queryFn: async () => null,
    enabled: false,
    initialData: null,
  });
  const fallbackUnread = (unreadMessagesCount || 0) + (unreadEmailCount || 0);
  const totalUnread =
    location.pathname.startsWith("/admin/communication") &&
    typeof contactCenterVisibleUnread === "number"
      ? contactCenterVisibleUnread
      : fallbackUnread;
  const collapsed = state === "collapsed";
  
  const [menuSettingsOpen, setMenuSettingsOpen] = useState(false);
  const { menuSettings, updateSettings, resetSettings, isUpdating } = useAdminMenuSettings();
  
  // Collapsible groups state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => 
    new Set(menuSettings.map(g => g.id))
  );
  
  const toggleGroup = (groupId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

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

  // Fetch profile data including avatar_url
  const { data: profile } = useQuery({
    queryKey: ["admin-sidebar-profile", user?.id],
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
    navigate("/auth");
  };

  const getUserInitials = () => {
    if (user?.user_metadata?.full_name) {
      const names = user.user_metadata.full_name.split(" ");
      return names.map((n: string) => n[0]).join("").toUpperCase().slice(0, 2);
    }
    return user?.email?.slice(0, 2).toUpperCase() || "U";
  };

  // Split full name into first and last name for two-line display
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

  const { firstName, lastName } = getNameParts();

  // RBAC v3: проверка через каталог секций (admin_section) + get_admin_access.
  // permissionMap полностью удалён. Единственный bypass — kill-switch
  // app_settings.admin_section_gating_enabled или роли super_admin/admin
  // (обрабатывается внутри useAdminAccess).
  const hasMenuItemPermission = (item: MenuItem): boolean => {
    // Standard menu items carry the canonical section code. Prefer it over a
    // shared/legacy path (notably the old Telegram club-members link).
    const section = ADMIN_SECTIONS.find((candidate) => candidate.code === item.id);
    if (section) {
      if (section.resources?.length) {
        return section.resources.some((resource) =>
          adminAccess.canAccessResource(section.code, resource.code),
        );
      }
      return adminAccess.canAccessSection(item.id);
    }
    // Резолвим секцию по пути пункта меню (надёжнее, чем item.id, т.к.
    // item.id в DEFAULT_MENU совпадает с section.code, но могут быть кастомные пункты).
    const resolved = resolveAdminSectionForPath(item.path);
    if (resolved.kind === "open") return true;
    if (resolved.kind === "unknown") {
      // Незнакомый путь в кастомном меню — закрываем для не-админов.
      return adminAccess.isSuperAdmin || adminAccess.isAdmin;
    }
    if (resolved.resourceCode) {
      return adminAccess.canAccessResource(resolved.sectionCode!, resolved.resourceCode);
    }
    return adminAccess.canAccessSection(resolved.sectionCode!);
  };

  // Check if path is active
  const isPathActive = (path: string): boolean => {
    // /admin/inbox removed - now redirects to /admin/communication
    if (path === "/admin/contacts") return location.pathname === path || location.pathname.startsWith("/admin/contacts/");
    if (path === "/admin/deals") return location.pathname === path || location.pathname.startsWith("/admin/deals/");
    if (path === "/admin/refunds-v2") return location.pathname === path;
    if (path.startsWith("/admin/integrations")) return location.pathname.startsWith("/admin/integrations");
    if (path.startsWith("/admin/training")) return location.pathname.startsWith("/admin/training");
    if (path.includes("/members")) return location.pathname.includes("/admin/integrations/telegram/clubs/") && location.pathname.includes("/members");
    return location.pathname === path || location.pathname.startsWith(path);
  };

  // Get badge for menu item
  const getBadge = (item: MenuItem): { count: number; show: boolean } => {
    if (item.badge === "unread") return { count: totalUnread, show: totalUnread > 0 };
    if (item.badge === "duplicates") return { count: duplicateCount || 0, show: (duplicateCount || 0) > 0 };
    return { count: 0, show: false };
  };

  // Render a single menu item
  const renderMenuItem = (item: MenuItem, groupId: string) => {
    if (!hasMenuItemPermission(item)) return null;
    
    const IconComponent = MENU_ICONS[item.icon];
    const isActive = isPathActive(item.path);
    const badge = getBadge(item);

    return (
      <SidebarMenuItem key={`${groupId}-${item.id}`}>
        <SidebarMenuButton
          asChild
          isActive={isActive}
          tooltip={collapsed ? item.label : undefined}
        >
          <NavLink
            to={item.path}
            end={!item.path.includes("/")}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all hover:bg-sidebar-accent"
            activeClassName="bg-sidebar-accent text-sidebar-primary"
          >
            {IconComponent && <IconComponent className="h-4 w-4 shrink-0" />}
            {!collapsed && (
              <>
                <span className="flex-1 text-xs">{item.label}</span>
                {badge.show && (
                  <Badge 
                    variant="destructive" 
                    className="h-4 min-w-4 px-1 text-[10px]"
                  >
                    {badge.count}
                  </Badge>
                )}
              </>
            )}
            {collapsed && badge.show && (
              <span className="absolute top-0 right-0 h-2 w-2 bg-destructive rounded-full" />
            )}
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  // Render a menu group
  const renderMenuGroup = (group: MenuGroup) => {
    const visibleItems = group.items
      .filter(hasMenuItemPermission)
      .sort((a, b) => a.order - b.order);
    
    if (visibleItems.length === 0) return null;
    
    const isExpanded = expandedGroups.has(group.id);

    return (
      <SidebarGroup key={group.id}>
        {!collapsed ? (
          <button
            onClick={() => toggleGroup(group.id)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-sidebar-foreground/50 text-[10px] uppercase tracking-wider hover:text-sidebar-foreground/70 transition-colors"
          >
            <span>{group.label}</span>
            <ChevronDown className={cn(
              "h-3 w-3 transition-transform duration-200",
              isExpanded ? "rotate-0" : "-rotate-90"
            )} />
          </button>
        ) : (
          <SidebarGroupLabel className="text-sidebar-foreground/50 text-[10px] uppercase tracking-wider px-3" />
        )}
        {(collapsed || isExpanded) && (
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => renderMenuItem(item, group.id))}
            </SidebarMenu>
          </SidebarGroupContent>
        )}
      </SidebarGroup>
    );
  };

  return (
    <>
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
            <div className="flex-1">
              <span className="font-medium text-xs text-sidebar-foreground">
                Панель управления
              </span>
            </div>
            )}
            {!collapsed && isSuperAdmin && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                onClick={() => setMenuSettingsOpen(true)}
              >
                <Cog className="h-4 w-4" />
              </Button>
            )}
          </div>
        </SidebarHeader>

        <SidebarContent className="px-2">
          {/* Dynamic menu groups */}
          {menuSettings
            .sort((a, b) => a.order - b.order)
            .map(renderMenuGroup)}

          {/* Back to app - always visible */}
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip={collapsed ? "Назад к приложению" : undefined}
                  >
                    <NavLink
                      to="/dashboard"
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <div
                className="rounded-xl p-3 cursor-pointer hover:opacity-90 transition-opacity"
                style={{
                  background: "hsl(var(--sidebar-accent))",
                }}
              >
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10 shrink-0">
                    {profile?.avatar_url && (
                      <AvatarImage src={profile.avatar_url} alt="Аватар" className="object-cover" />
                    )}
                    <AvatarFallback className="bg-gradient-to-br from-destructive to-orange-500 text-white text-sm font-medium">
                      {getUserInitials()}
                    </AvatarFallback>
                  </Avatar>
                  {!collapsed && (
                    <div className="flex-1 min-w-0">
                      <div className="leading-tight">
                        <p className="text-xs font-medium text-sidebar-foreground truncate">
                          {firstName}
                        </p>
                        {lastName && (
                          <p className="text-xs font-medium text-sidebar-foreground truncate">
                            {lastName}
                          </p>
                        )}
                      </div>
                      <p className="text-[10px] text-sidebar-foreground/60 mt-0.5">
                        Администратор
                      </p>
                    </div>
                  )}
                  <ChevronUp className="h-4 w-4 shrink-0 text-sidebar-foreground/60" />
                </div>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top" className="w-56">
              <DropdownMenuItem onClick={() => navigate("/admin/audit")} className="gap-2">
                <ScrollText className="h-4 w-4" />
                Аудит-лог
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/admin/system/audit")} className="gap-2">
                <Wrench className="h-4 w-4" />
                Аудит системы
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/admin/system-health")} className="gap-2">
                <Activity className="h-4 w-4" />
                Здоровье системы
              </DropdownMenuItem>
              {isSuperAdmin && (
                <DropdownMenuItem onClick={() => navigate("/admin/docs")} className="gap-2">
                  <BookOpen className="h-4 w-4" />
                  Документация системы
                </DropdownMenuItem>
              )}
              {isSuperAdmin && (
                <DropdownMenuItem onClick={() => navigate("/admin/telegram/audit-shape-runs")} className="gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Telegram audit-shape runs
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="gap-2 text-destructive focus:text-destructive">
                <LogOut className="h-4 w-4" />
                Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      {/* Menu Settings Dialog */}
      <MenuSettingsDialog
        open={menuSettingsOpen}
        onOpenChange={setMenuSettingsOpen}
        menuSettings={menuSettings}
        onSave={updateSettings}
        onReset={resetSettings}
        isSaving={isUpdating}
      />
    </>
  );
}
