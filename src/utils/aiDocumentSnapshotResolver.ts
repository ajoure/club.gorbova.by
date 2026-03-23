/**
 * Client-side snapshot resolver for AI document generation.
 * Used for PREVIEW only — final snapshot is built server-side.
 */

import type { ClientLegalDetails } from "@/hooks/useLegalDetails";
import type { LinkRow } from "@/hooks/useEntityPersonLinks";

export interface SnapshotData {
  entity: ClientLegalDetails | null;
  person: Record<string, unknown> | null;
  signerPerson: Record<string, unknown> | null;
  link: LinkRow | null;
}

function fullNameToInitials(fullName: string): string {
  if (!fullName) return "";
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]} ${parts[1][0]}.`;
  return `${parts[0]} ${parts[1][0]}.${parts[2][0]}.`;
}

function buildEntityAddress(e: ClientLegalDetails): string {
  if (e.client_type === "individual") {
    return [
      e.ind_address_index, e.ind_address_region, e.ind_address_district,
      e.ind_address_city, e.ind_address_street, e.ind_address_house,
      e.ind_address_apartment && `кв. ${e.ind_address_apartment}`,
    ].filter(Boolean).join(", ");
  }
  if (e.client_type === "entrepreneur") return e.ent_address || "";
  return e.leg_address || "";
}

function entityName(e: ClientLegalDetails): string {
  if (e.client_type === "individual") return e.ind_full_name || "";
  if (e.client_type === "entrepreneur") return e.ent_name || "";
  return e.leg_name || "";
}

export interface TokenEntry {
  token: string;
  label: string;
  value: string;
  source: string;
  filled: boolean;
}

/**
 * Resolve preview tokens from selected data sources.
 * Returns array of token entries for the preview table.
 */
export function resolvePreviewTokens(
  placeholders: string[],
  data: SnapshotData
): TokenEntry[] {
  const { entity, person, signerPerson, link } = data;

  const tokenMap: Record<string, { value: string; source: string; label: string }> = {};

  // Document tokens
  tokenMap["document_number"] = { value: "(авто)", source: "Система", label: "Номер документа" };
  tokenMap["document_date"] = { value: new Date().toLocaleDateString("ru-RU"), source: "Система", label: "Дата документа" };
  tokenMap["document_date_short"] = { value: new Date().toLocaleDateString("ru-RU"), source: "Система", label: "Дата (кратко)" };

  // Entity tokens
  if (entity) {
    const name = entityName(entity);
    const addr = buildEntityAddress(entity);
    tokenMap["entity_name"] = { value: name, source: "ЮЛ/ИП", label: "Наименование" };
    tokenMap["entity_short_name"] = { value: name, source: "ЮЛ/ИП", label: "Краткое наименование" };
    tokenMap["entity_unp"] = { value: entity.ent_unp || entity.leg_unp || "", source: "ЮЛ/ИП", label: "УНП" };
    tokenMap["entity_address"] = { value: addr, source: "ЮЛ/ИП", label: "Адрес" };
    tokenMap["entity_bank"] = { value: entity.bank_name || "", source: "ЮЛ/ИП", label: "Банк" };
    tokenMap["entity_bank_code"] = { value: entity.bank_code || "", source: "ЮЛ/ИП", label: "БИК" };
    tokenMap["entity_account"] = { value: entity.bank_account || "", source: "ЮЛ/ИП", label: "Расчётный счёт" };
    tokenMap["entity_phone"] = { value: entity.phone || "", source: "ЮЛ/ИП", label: "Телефон" };
    tokenMap["entity_email"] = { value: entity.email || "", source: "ЮЛ/ИП", label: "Email" };
    tokenMap["entity_director"] = { value: entity.leg_director_name || "", source: "ЮЛ/ИП", label: "ФИО директора" };
    tokenMap["entity_director_short"] = { value: fullNameToInitials(entity.leg_director_name || ""), source: "ЮЛ/ИП", label: "Директор (кратко)" };
    tokenMap["entity_director_position"] = { value: entity.leg_director_position || "", source: "ЮЛ/ИП", label: "Должность директора" };
    tokenMap["entity_acts_on_basis"] = { value: entity.leg_acts_on_basis || entity.ent_acts_on_basis || "", source: "ЮЛ/ИП", label: "Действует на основании" };
    tokenMap["entity_org_form"] = { value: entity.leg_org_form || "", source: "ЮЛ/ИП", label: "Орг. форма" };
    // Aliases
    tokenMap["client_name"] = tokenMap["entity_name"];
    tokenMap["client_address"] = tokenMap["entity_address"];
    tokenMap["client_unp"] = tokenMap["entity_unp"];
    tokenMap["client_phone"] = tokenMap["entity_phone"];
    tokenMap["client_email"] = tokenMap["entity_email"];
    tokenMap["client_bank"] = tokenMap["entity_bank"];
    tokenMap["client_account"] = tokenMap["entity_account"];
  }

  // Person tokens
  if (person) {
    const p = person as Record<string, string>;
    tokenMap["person_full_name"] = { value: p.full_name || "", source: "Физлицо", label: "ФИО" };
    tokenMap["person_short_name"] = { value: fullNameToInitials(p.full_name || ""), source: "Физлицо", label: "ФИО (кратко)" };
    tokenMap["person_personal_number"] = { value: p.personal_number || "", source: "Физлицо", label: "Личный номер" };
    tokenMap["person_birth_date"] = { value: p.birth_date || "", source: "Физлицо", label: "Дата рождения" };
    tokenMap["person_passport_series"] = { value: p.passport_series || "", source: "Физлицо", label: "Серия паспорта" };
    tokenMap["person_passport_number"] = { value: p.passport_number || "", source: "Физлицо", label: "Номер паспорта" };
    tokenMap["person_passport_issued_by"] = { value: p.passport_issued_by || "", source: "Физлицо", label: "Выдан" };
    tokenMap["person_passport_issued_date"] = { value: p.passport_issued_date || "", source: "Физлицо", label: "Дата выдачи" };
    tokenMap["person_passport_valid_until"] = { value: p.passport_valid_until || "", source: "Физлицо", label: "Действителен до" };
    tokenMap["person_phone"] = { value: p.phone || "", source: "Физлицо", label: "Телефон" };
    tokenMap["person_email"] = { value: p.email || "", source: "Физлицо", label: "Email" };
    tokenMap["person_address"] = { value: p.registration_address || "", source: "Физлицо", label: "Адрес" };
  }

  // Signer tokens
  if (signerPerson) {
    const s = signerPerson as Record<string, string>;
    tokenMap["signer.full_name"] = { value: s.full_name || "", source: "Подписант", label: "ФИО подписанта" };
    tokenMap["signer.short_name"] = { value: fullNameToInitials(s.full_name || ""), source: "Подписант", label: "Подписант (кратко)" };
    tokenMap["signer.personal_number"] = { value: s.personal_number || "", source: "Подписант", label: "Личный номер" };
    tokenMap["signer.passport_series"] = { value: s.passport_series || "", source: "Подписант", label: "Серия паспорта" };
    tokenMap["signer.passport_number"] = { value: s.passport_number || "", source: "Подписант", label: "Номер паспорта" };
    tokenMap["signer.passport_issued_by"] = { value: s.passport_issued_by || "", source: "Подписант", label: "Выдан" };
    tokenMap["signer.passport_issued_date"] = { value: s.passport_issued_date || "", source: "Подписант", label: "Дата выдачи" };
    tokenMap["signer.passport_valid_until"] = { value: s.passport_valid_until || "", source: "Подписант", label: "Действителен до" };
    tokenMap["signer.phone"] = { value: s.phone || "", source: "Подписант", label: "Телефон" };
    tokenMap["signer.email"] = { value: s.email || "", source: "Подписант", label: "Email" };
    tokenMap["signer.address"] = { value: s.registration_address || "", source: "Подписант", label: "Адрес" };
  }

  // Link tokens
  if (link) {
    tokenMap["link.role_label"] = { value: link.role_label || "", source: "Связь", label: "Роль" };
    tokenMap["link.position"] = { value: link.position_label || link.custom_position_text || "", source: "Связь", label: "Должность" };
    tokenMap["link.acts_on_basis"] = { value: link.acts_on_basis || "", source: "Связь", label: "Действует на основании" };
    tokenMap["link.share_percent"] = { value: link.share_percent != null ? String(link.share_percent) : "", source: "Связь", label: "Доля %" };
  }

  // Build result for each placeholder
  const cleanKeys = placeholders.map((p) => p.replace(/^\{\{/, "").replace(/\}\}$/, ""));
  
  return cleanKeys.map((key) => {
    const entry = tokenMap[key];
    return {
      token: `{{${key}}}`,
      label: entry?.label || key,
      value: entry?.value || "",
      source: entry?.source || "—",
      filled: !!(entry?.value),
    };
  });
}
