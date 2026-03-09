/**
 * RBAC-SOT.1: Единый UI-адаптер RBAC
 * 
 * Тонкая обёртка над usePermissions — единственный SoT для проверки ролей и прав в UI.
 * Все админские компоненты должны использовать useRbac() вместо прямого usePermissions().
 */
import { usePermissions } from "@/hooks/usePermissions";

export function useRbac() {
  const perms = usePermissions();

  return {
    // State
    loading: perms.loading,
    roles: perms.userRoles,
    permissions: perms.permissions,

    // Role checks (pre-computed booleans)
    isAdmin: perms.isAdmin(),
    isSuperAdmin: perms.isSuperAdmin(),
    isViewOnly: perms.isViewOnlyRole(),
    hasAdminAccess: perms.hasAdminAccess(),

    // Permission functions
    hasPermission: perms.hasPermission,
    hasAnyPermission: perms.hasAnyPermission,
    hasRole: perms.hasRole,
    canWrite: perms.canWrite,

    // Refetch
    refetch: perms.refetch,
  };
}
