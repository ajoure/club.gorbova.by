/**
 * Template Editor Mapper — bidirectional mapping between canonical tokens and UI labels.
 * 
 * Phase 1: Only scalar tokens for corp_order_meeting.
 * Loop/repeat block tokens will be added in Phase 2.
 * 
 * Uses existing tokenStringToLabel() from tokenRegistry.ts as primary source,
 * with a hardcoded fallback dictionary for corporate-specific tokens.
 */

import { tokenStringToLabel } from "@/lib/tokens/tokenRegistry";

// ── Fallback dictionary for tokens that may not be in fields_registry yet ──

const CORPORATE_TOKEN_LABELS: Record<string, string> = {
  // Organization
  "{{legal_details.leg_name}}": "Название организации",
  "{{legal_details.leg_short_name}}": "Краткое наименование",
  "{{legal_details.leg_org_form}}": "Организационно-правовая форма",
  "{{legal_details.leg_unp}}": "УНП",
  "{{legal_details.leg_address}}": "Юридический адрес",
  "{{legal_details.leg_director_name}}": "ФИО директора",
  "{{legal_details.leg_director_position}}": "Должность директора",
  "{{legal_details.leg_acts_on_basis}}": "Действует на основании",
  // Meeting
  "{{meeting.date}}": "Дата собрания",
  "{{meeting.time}}": "Время собрания",
  "{{meeting.location}}": "Место собрания",
  "{{meeting.format}}": "Форма проведения",
  "{{meeting.voting_form}}": "Форма голосования",
  // Notice
  "{{meeting.notice.date}}": "Дата направления извещения",
  "{{meeting.notice.method}}": "Способ извещения",
  // Document
  "{{document.number}}": "Номер документа",
  "{{document.date}}": "Дата документа",
  "{{document.city}}": "Место составления",
  // Report year
  "{{report_year}}": "Отчётный год",
  // Review
  "{{review.location}}": "Место ознакомления с документами",
  "{{review.date_from}}": "Дата начала ознакомления",
  "{{review.date_to}}": "Дата окончания ознакомления",
  // Chair/Secretary
  "{{chair.name}}": "ФИО председателя",
  "{{secretary.name}}": "ФИО секретаря",
  // Settlement
  "{{settlement_display}}": "Населённый пункт",
};

/**
 * Get UI label for a canonical token string.
 * First checks tokenRegistry (dynamic fields_registry), then falls back to hardcoded dict.
 */
export function getTokenLabel(tokenString: string): string | null {
  // Try dynamic registry first
  const registryLabel = tokenStringToLabel(tokenString);
  if (registryLabel) return registryLabel;
  
  // Fallback to hardcoded corporate dict
  return CORPORATE_TOKEN_LABELS[tokenString] || null;
}

/**
 * Convert raw template text (with {{tokens}}) to editor-friendly format
 * where tokens are shown as [UI Label].
 */
export function tokensToLabels(text: string): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match) => {
    const label = getTokenLabel(match);
    return label ? `[${label}]` : match;
  });
}

/**
 * Convert editor text (with [UI Labels]) back to canonical {{token}} format.
 */
export function labelsToTokens(text: string): string {
  // Build reverse map: label → tokenString
  const reverseMap = new Map<string, string>();
  
  // From hardcoded dict
  for (const [token, label] of Object.entries(CORPORATE_TOKEN_LABELS)) {
    reverseMap.set(label, token);
  }
  
  return text.replace(/\[([^\]]+)\]/g, (match, label: string) => {
    const token = reverseMap.get(label);
    return token || match;
  });
}

/**
 * Get all available tokens for the editor token picker.
 * Phase 1: Only scalar tokens relevant to corp_order_meeting.
 */
export function getEditorTokenList(): Array<{ tokenString: string; label: string; group: string }> {
  return Object.entries(CORPORATE_TOKEN_LABELS).map(([tokenString, label]) => {
    let group = "Прочее";
    if (tokenString.includes("legal_details")) group = "Организация";
    else if (tokenString.includes("meeting")) group = "Собрание";
    else if (tokenString.includes("document")) group = "Документ";
    else if (tokenString.includes("review")) group = "Ознакомление";
    else if (tokenString.includes("chair") || tokenString.includes("secretary")) group = "Участники";
    else if (tokenString.includes("report_year") || tokenString.includes("settlement")) group = "Общее";
    return { tokenString, label, group };
  });
}
