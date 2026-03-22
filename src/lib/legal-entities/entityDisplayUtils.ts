/**
 * entityDisplayUtils — display helpers for entity list views.
 *
 * getEntityShortName: strips org form prefix from leg_name for compact display.
 * getEntityTypeBadge: returns "ЮЛ" or "ИП".
 * getEntityUnp: returns UNP based on client_type.
 */

import type { ClientLegalDetails } from "@/hooks/useLegalDetails";

/** Known org form prefixes to strip from the beginning of leg_name */
const ORG_FORM_PREFIXES = [
  "Закрытое акционерное общество",
  "Открытое акционерное общество",
  "Общество с ограниченной ответственностью",
  "Общество с дополнительной ответственностью",
  "Унитарное предприятие",
  "Частное унитарное предприятие",
  "Совместное общество с ограниченной ответственностью",
  "Иностранное общество с ограниченной ответственностью",
  "Производственный кооператив",
  "Коммунальное унитарное предприятие",
  "Республиканское унитарное предприятие",
  "Государственное предприятие",
  "Индивидуальный предприниматель",
  "ЗАО", "ОАО", "ООО", "ОДО", "УП", "ЧУП", "СООО", "ИООО", "ПК", "КУП", "РУП", "ГП", "ИП",
];

/**
 * Short name without org form — for list/table display.
 * Strips known org form from the beginning of leg_name, trims quotes.
 * Falls back to original value if stripping produces empty string.
 */
export function getEntityShortName(entity: ClientLegalDetails): string {
  if (entity.client_type === "entrepreneur") {
    return entity.ent_name || "ИП без названия";
  }

  const raw = entity.leg_name;
  if (!raw) return "Организация без названия";

  // Try to strip org form prefix (case-insensitive, greedy longest match first)
  const sorted = [...ORG_FORM_PREFIXES].sort((a, b) => b.length - a.length);
  let cleaned = raw;
  for (const prefix of sorted) {
    if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleaned = cleaned.slice(prefix.length);
      break;
    }
  }

  // Trim whitespace, quotes, dashes
  cleaned = cleaned.replace(/^[\s"«»'"\-—]+/, "").replace(/[\s"«»'"]+$/, "");

  return cleaned || raw;
}

export function getEntityTypeBadge(entity: ClientLegalDetails): string {
  return entity.client_type === "entrepreneur" ? "ИП" : "ЮЛ";
}

export function getEntityUnp(entity: ClientLegalDetails): string | null {
  return entity.client_type === "entrepreneur" ? entity.ent_unp : entity.leg_unp;
}
