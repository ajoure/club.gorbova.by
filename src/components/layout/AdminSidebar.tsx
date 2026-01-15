import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { useUnreadMessagesCount } from "@/hooks/useUnreadMessagesCount";
import { useUnreadEmailCount } from "@/hooks/useUnreadEmailCount";
import { useUnmappedProductsCount } from "@/hooks/useUnmappedProductsCount";
import { useAdminMenuSettings, MENU_ICONS, MenuItem, MenuGroup } from "@/hooks/useAdminMenuSettings";
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
import { MenuSettingsDialog } from "@/components/admin/MenuSettingsDialog";
import {
  LogOut,
  ArrowLeft,
  Settings,
  Cog,
} from "lucide-react";

export function AdminSidebar() {
  const { state } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { hasPermission, hasAnyPermission, isSuperAdmin: isSuperAdminFn } = usePermissions();
  const isSuperAdmin = isSuperAdminFn();
  const unreadMessagesCount = useUnreadMessagesCount();
  const { data: unreadEmailCount = 0 } = useUnreadEmailCount();
  const { data: unmappedProductsCount = 0 } = useUnmappedProductsCount();
  const totalUnread = unreadMessagesCount + unreadEmailCount;
  const collapsed = state === "collapsed";
  
  const [menuSettingsOpen, setMenuSettingsOpen] = useState(false);
  const { menuSettings, updateSettings, resetSettings, isUpdating } = useAdminMenuSettings();

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

  // Permission mappings for menu items
  const permissionMap: Record<string, boolean> = {
    "users.view": hasAnyPermission(["users.view", "users.update", "users.block", "users.delete"]),
    "roles.view": hasAnyPermission(["roles.view", "roles.manage", "admins.manage"]),
    "entitlements.view": hasAnyPermission(["entitlements.view", "entitlements.manage"]),
    "content.view": hasAnyPermission(["content.view", "content.edit", "content.publish"]),
    "audit.view": hasPermission("audit.view"),
  };

  // Check if user has permission for a menu item
  const hasMenuItemPermission = (item: MenuItem): boolean => {
    if (!item.permission) return true;
    return permissionMap[item.permission] ?? true;
  };

  // Check if path is active
  const isPathActive = (path: string): boolean => {
    if (path === "/admin/inbox") return location.pathname === path;
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
    // Show badge for payments page when there are unmapped products
    if (item.path === "/admin/payments" && unmappedProductsCount > 0) {
      return { count: unmappedProductsCount, show: true };
    }
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
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all hover:bg-sidebar-accent"
            activeClassName="bg-sidebar-accent text-sidebar-primary"
          >
            {IconComponent && <IconComponent className="h-5 w-5 shrink-0" />}
            {!collapsed && (
              <>
                <span className="flex-1">{item.label}</span>
                {badge.show && (
                  <Badge 
                    variant="destructive" 
                    className="h-5 min-w-5 px-1.5 text-xs"
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

    return (
      <SidebarGroup key={group.id}>
        <SidebarGroupLabel className="text-sidebar-foreground/50 text-xs uppercase tracking-wider px-3">
          {!collapsed && group.label}
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {visibleItems.map((item) => renderMenuItem(item, group.id))}
          </SidebarMenu>
        </SidebarGroupContent>
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
                <h1 className="font-bold text-lg text-sidebar-foreground">
                  Админ-панель
                </h1>
                <p className="text-xs text-sidebar-foreground/60">
                  Управление
                </p>
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
