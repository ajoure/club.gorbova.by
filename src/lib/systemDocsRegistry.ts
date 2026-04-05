/**
 * SYSTEM_DOCS_REGISTRY — Единый реестр доменов системной документации.
 *
 * SoT для всех доменных документов. Хранилище: admin_docs (section_key).
 * Две дорожки: manual (POINT A/B/C…) и AUTO-CURRENT (managed_by='system').
 */

export interface DocMeta {
  title?: string;
  domain_key?: string;
  summary?: string;
  sort_order?: number;
  source?: "manual" | "seed" | "nightly_discovery_snapshot" | "manual_refresh";
  snapshot_at?: string;
  snapshot_tz?: string;
  batch_id?: string;
  managed_by?: "manual" | "system";
  approval_state?: string;
  tags?: string[];
  truncated?: boolean;
  full_size_bytes?: number;
}

export interface DocVersion {
  id: string;
  section_key: string;
  version_label: string;
  status: string;
  content_text: string;
  meta: DocMeta | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface SystemDocDomain {
  key: string;
  title: string;
  sortOrder: number;
  shortcutRoute?: string;
  exportFileName: string;
}

export const SYSTEM_DOC_DOMAINS: SystemDocDomain[] = [
  {
    key: "platform_master",
    title: "Архитектура платформы",
    sortOrder: 0,
    exportFileName: "system-architecture-master.md",
  },
  {
    key: "products_sales",
    title: "Продукты и тарифы",
    sortOrder: 1,
    shortcutRoute: "/admin/products-v2/docs",
    exportFileName: "products-sales.md",
  },
  {
    key: "sites_pages_forms",
    title: "Сайты и формы",
    sortOrder: 2,
    exportFileName: "sites-pages-forms.md",
  },
  {
    key: "trainings_access",
    title: "Тренинги и доступы",
    sortOrder: 3,
    exportFileName: "trainings-access.md",
  },
  {
    key: "orders_payments",
    title: "Сделки и платежи",
    sortOrder: 4,
    exportFileName: "orders-payments.md",
  },
  {
    key: "integrations",
    title: "Интеграции",
    sortOrder: 5,
    exportFileName: "integrations.md",
  },
  {
    key: "open_tails",
    title: "Открытые хвосты",
    sortOrder: 6,
    exportFileName: "open-tails.md",
  },
  {
    key: "live_events",
    title: "Live Events v2",
    sortOrder: 7,
    exportFileName: "live-events-v2.md",
  },
];

export const AUTO_CURRENT_LABEL = "AUTO-CURRENT";

/** Check if a version is system-managed AUTO-CURRENT */
export function isAutoVersion(doc: DocVersion): boolean {
  return (
    doc.version_label === AUTO_CURRENT_LABEL &&
    (doc.meta as DocMeta)?.managed_by === "system"
  );
}

/** Get manual versions only (exclude AUTO-CURRENT) */
export function getManualVersions(versions: DocVersion[]): DocVersion[] {
  return versions.filter((v) => !isAutoVersion(v));
}

/** Get AUTO-CURRENT version if exists */
export function getAutoVersion(versions: DocVersion[]): DocVersion | undefined {
  return versions.find((v) => isAutoVersion(v));
}

export type ViewMode = "manual" | "auto";
