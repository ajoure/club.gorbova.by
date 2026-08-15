import { ReactNode, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { resolveAdminSectionForPath, ADMIN_SECTIONS } from "@/lib/adminMenuRegistry";

interface AdminRouteGuardProps {
  children: ReactNode;
}

/**
 * RBAC v3 — AdminRouteGuard. Deny-by-default.
 *
 * Логика:
 *   1. Если путь не относится к /admin/* — пропускаем без проверки.
 *   2. Если super_admin / admin / kill-switch выключен — пропускаем (bypass внутри useAdminAccess).
 *   3. Если путь маппится в OPEN_PATHS — пропускаем.
 *   4. Если путь не нашли в реестре — закрываем (редирект на первую доступную секцию).
 *   5. Если уровень доступа < view — закрываем.
 */
export function AdminRouteGuard({ children }: AdminRouteGuardProps) {
  const location = useLocation();
  const access = useAdminAccess();

  const pathname = location.pathname;
  const pathWithSearch = `${location.pathname}${location.search}`;
  const isAdminPath = pathname.startsWith("/admin");

  useEffect(() => {
    if (!isAdminPath || access.isLoading) return;
    if (access.canAccessPath(pathWithSearch)) return;
    // лог только когда реально закрываем
    // eslint-disable-next-line no-console
    console.warn("[AdminRouteGuard] denied:", pathname);
  }, [pathname, pathWithSearch, isAdminPath, access]);

  if (!isAdminPath) return <>{children}</>;

  if (access.isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (access.canAccessPath(pathWithSearch)) {
    return <>{children}</>;
  }

  // Найти первую доступную секцию для редиректа
  const fallback = findFirstAccessibleAdminPath(access);
  if (fallback && fallback !== pathname) {
    return <Navigate to={fallback} replace />;
  }
  // Иначе — вообще нет доступа к админке
  return <Navigate to="/dashboard" replace />;
}

function findFirstAccessibleAdminPath(access: ReturnType<typeof useAdminAccess>): string | null {
  for (const s of ADMIN_SECTIONS) {
    if (s.resources?.length) {
      const resource = s.resources.find((candidate) =>
        access.canAccessResource(s.code, candidate.code),
      );
      if (resource) return resource.route;
      continue;
    }
    if (access.canAccessSection(s.code)) return s.routePrefix;
  }
  return null;
}

// Re-export for сайдбара/тестов
export { resolveAdminSectionForPath };
