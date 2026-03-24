/**
 * Shared DOCX generation helpers.
 * Sprint 3: extracted from ai-generate-document-package to avoid duplication.
 * Used by: ai-generate-document-package, ai-generate-corporate-package.
 */

export function dateToRussianFormat(date: Date): string {
  const months = [
    "января","февраля","марта","апреля","мая","июня",
    "июля","августа","сентября","октября","ноября","декабря",
  ];
  return `${date.getDate()} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

export function fullNameToInitials(fullName: string): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1][0]}.`;
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
}

export function generateDocumentNumber(prefix = "AI"): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const r = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `${prefix}-${y}${m}${d}-${r}`;
}

export function buildAddress(entity: Record<string, unknown>): string {
  const ct = entity.client_type as string;
  if (ct === "individual") {
    return [
      entity.ind_address_index, entity.ind_address_region, entity.ind_address_district,
      entity.ind_address_city, entity.ind_address_street, entity.ind_address_house,
      entity.ind_address_apartment && `кв. ${entity.ind_address_apartment}`,
    ].filter(Boolean).join(", ");
  }
  if (ct === "entrepreneur") return (entity.ent_address as string) || "";
  return (entity.leg_address as string) || "";
}

export function entityName(entity: Record<string, unknown>): string {
  const ct = entity.client_type as string;
  if (ct === "individual") return (entity.ind_full_name as string) || "";
  if (ct === "entrepreneur") return (entity.ent_name as string) || "";
  return (entity.leg_name as string) || "";
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_\-. ]/g, "").trim().replace(/\s+/g, "_").slice(0, 60);
}
