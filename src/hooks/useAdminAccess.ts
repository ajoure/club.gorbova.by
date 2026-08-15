import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRbac } from "@/hooks/useRbac";
import {
  AccessLevel,
  resolveAdminSectionForPath,
} from "@/lib/adminMenuRegistry";

/**
 * RBAC v3 — useAdminAccess
 *
 * Получает реальные доступы пользователя через RPC `public.get_admin_access(_user_id)`.
 * Источник истины — таблицы admin_section / admin_resource / role_admin_section_access /
 * role_admin_resource_access. Никакого fallback "разрешить всё" нет.
 *
 * Правила вычисления уровня:
 *   - super_admin           → 'manage' для всего (минуя RPC)
 *   - admin                 → 'manage' для всего (минуя RPC)
 *   - остальные             → строго то, что вернул RPC; чего нет в ответе — 'none'.
 *
 * Resource override > section.
 * Уровни: manage > edit > view > none.
 */

const LEVEL_RANK: Record<AccessLevel, number> = {
  none: 0,
  view: 1,
  edit: 2,
  manage: 3,
};

interface RawAccessRow {
  section_code: string;
  resource_code: string | null;
  access_level: AccessLevel;
  source: string;
}

export interface AdminAccessApi {
  isLoading: boolean;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  /** Полная карта section_code → level (после применения override от RPC). */
  sections: ReadonlyMap<string, AccessLevel>;
  /** section_code → (resource_code → level). */
  resources: ReadonlyMap<string, ReadonlyMap<string, AccessLevel>>;
  /** kill-switch: если выключен — admin/super_admin видят всё без гейтинга. */
  gatingEnabled: boolean;

  getSectionLevel(sectionCode: string): AccessLevel;
  getResourceLevel(sectionCode: string, resourceCode: string): AccessLevel;
  canAccessSection(sectionCode: string, min?: AccessLevel): boolean;
  canAccessResource(sectionCode: string, resourceCode: string, min?: AccessLevel): boolean;
  /** Главная проверка для AdminRouteGuard. Deny-by-default. */
  canAccessPath(pathOrLocation: string, min?: AccessLevel): boolean;
}

export function useAdminAccess(): AdminAccessApi {
  const { user } = useAuth();
  const { isSuperAdmin, isAdmin } = useRbac();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-access", user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const [accessRes, gatingRes] = await Promise.all([
        supabase.rpc("get_admin_access", { _user_id: user!.id }),
        supabase
          .from("app_settings")
          .select("value")
          .eq("key", "admin_section_gating_enabled")
          .maybeSingle(),
      ]);

      if (accessRes.error) {
        // НЕ глотаем — это единственный источник истины.
        console.error("[useAdminAccess] get_admin_access failed:", accessRes.error);
        throw accessRes.error;
      }

      const rows = (accessRes.data ?? []) as RawAccessRow[];
      const gatingValue = gatingRes.data?.value as { enabled?: boolean } | null | undefined;
      const gatingEnabled = gatingValue?.enabled !== false; // по умолчанию включено

      return { rows, gatingEnabled };
    },
  });

  return useMemo<AdminAccessApi>(() => {
    const sections = new Map<string, AccessLevel>();
    const resources = new Map<string, Map<string, AccessLevel>>();

    for (const row of data?.rows ?? []) {
      if (row.resource_code) {
        let perSection = resources.get(row.section_code);
        if (!perSection) {
          perSection = new Map();
          resources.set(row.section_code, perSection);
        }
        perSection.set(row.resource_code, row.access_level);
      } else {
        sections.set(row.section_code, row.access_level);
      }
    }

    const gatingEnabled = data?.gatingEnabled ?? true;
    const bypass = !gatingEnabled || isSuperAdmin || isAdmin;

    const getSectionLevel = (sectionCode: string): AccessLevel => {
      if (bypass) return "manage";
      return sections.get(sectionCode) ?? "none";
    };
    const getResourceLevel = (sectionCode: string, resourceCode: string): AccessLevel => {
      if (bypass) return "manage";
      const perSection = resources.get(sectionCode);
      const override = perSection?.get(resourceCode);
      if (override) return override;
      return getSectionLevel(sectionCode);
    };
    const meets = (have: AccessLevel, min: AccessLevel) => LEVEL_RANK[have] >= LEVEL_RANK[min];

    const canAccessSection = (sectionCode: string, min: AccessLevel = "view") =>
      meets(getSectionLevel(sectionCode), min);
    const canAccessResource = (sectionCode: string, resourceCode: string, min: AccessLevel = "view") =>
      meets(getResourceLevel(sectionCode, resourceCode), min);

    const canAccessPath = (pathOrLocation: string, min: AccessLevel = "view") => {
      if (bypass) return true;
      const r = resolveAdminSectionForPath(pathOrLocation);
      if (r.kind === "open") return true;
      if (r.kind === "unknown") return false; // deny-by-default
      if (r.resourceCode) return canAccessResource(r.sectionCode!, r.resourceCode, min);
      return canAccessSection(r.sectionCode!, min);
    };

    return {
      isLoading: !!user?.id && isLoading,
      isSuperAdmin,
      isAdmin,
      sections,
      resources,
      gatingEnabled,
      getSectionLevel,
      getResourceLevel,
      canAccessSection,
      canAccessResource,
      canAccessPath,
    };
  }, [data, isLoading, user?.id, isSuperAdmin, isAdmin]);
}
