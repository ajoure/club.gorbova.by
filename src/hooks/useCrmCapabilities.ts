import { useMemo } from "react";
import { useAdminAccess } from "@/hooks/useAdminAccess";

/**
 * useCrmCapabilities — единый источник CRUD-capabilities для CRM-доменов.
 *
 * Правила (согласуется с миграцией 20260721-* CRM RBAC v3 alignment):
 *   super_admin / admin                         → всё разрешено
 *   admin_section_access(section) >= 'edit'     → create + update + delete
 *   admin_section_access(section) === 'view'    → только чтение
 *   иначе                                       → всё запрещено
 *
 * Threshold = 'edit', потому что бизнес-требование: "полный доступ / manage / edit"
 * должны давать все мутации; read-only не даёт мутаций.
 *
 * Не заводит параллельные роли — использует существующие admin_section записи.
 */
export type CrmDomain = "deals" | "companies" | "contacts";

export interface CrmDomainCapabilities {
  canRead: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export interface CrmCapabilitiesApi {
  isLoading: boolean;
  deals: CrmDomainCapabilities;
  companies: CrmDomainCapabilities;
  contacts: CrmDomainCapabilities;
  can(domain: CrmDomain, action: keyof CrmDomainCapabilities): boolean;
}

const EMPTY: CrmDomainCapabilities = {
  canRead: false,
  canCreate: false,
  canEdit: false,
  canDelete: false,
};

const FULL: CrmDomainCapabilities = {
  canRead: true,
  canCreate: true,
  canEdit: true,
  canDelete: true,
};

export function useCrmCapabilities(): CrmCapabilitiesApi {
  const access = useAdminAccess();

  return useMemo(() => {
    const build = (section: CrmDomain): CrmDomainCapabilities => {
      if (access.isSuperAdmin || access.isAdmin) return FULL;
      const level = access.getSectionLevel(section);
      if (level === "manage" || level === "edit") return FULL;
      if (level === "view") return { ...EMPTY, canRead: true };
      return EMPTY;
    };

    const deals = build("deals");
    const companies = build("companies");
    const contacts = build("contacts");

    return {
      isLoading: access.isLoading,
      deals,
      companies,
      contacts,
      can: (domain, action) => ({ deals, companies, contacts }[domain][action]),
    };
  }, [
    access.isLoading,
    access.isSuperAdmin,
    access.isAdmin,
    access.getSectionLevel,
  ]);
}
