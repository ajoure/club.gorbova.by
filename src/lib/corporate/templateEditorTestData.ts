/**
 * Test data for template editor preview.
 * Phase 1: Scalar data only for corp_order_meeting.
 * 
 * This data is used for raw preview — substitution of tokens with realistic values.
 */

export const EDITOR_TEST_DATA: Record<string, string> = {
  // Organization
  "{{legal_details.leg_name}}": "Общество с ограниченной ответственностью «Альфа Консалтинг»",
  "{{legal_details.leg_short_name}}": "ООО «Альфа Консалтинг»",
  "{{legal_details.leg_org_form}}": "Общество с ограниченной ответственностью",
  "{{legal_details.leg_unp}}": "192345678",
  "{{legal_details.leg_address}}": "220030, г. Минск, ул. Интернациональная, д. 36, оф. 501",
  "{{legal_details.leg_director_name}}": "Иванов Иван Иванович",
  "{{legal_details.leg_director_position}}": "Директор",
  "{{legal_details.leg_acts_on_basis}}": "Устава",
  // Meeting
  "{{meeting.date}}": "31.03.2026",
  "{{meeting.time}}": "10:00",
  "{{meeting.location}}": "г. Минск, ул. Интернациональная, д. 36, оф. 501",
  "{{meeting.format}}": "очная",
  "{{meeting.voting_form}}": "открытое",
  // Notice
  "{{meeting.notice.date}}": "28.02.2026",
  "{{meeting.notice.method}}": "заказным письмом",
  // Document
  "{{document.number}}": "1",
  "{{document.date}}": "25.02.2026",
  "{{document.city}}": "г. Минск",
  // Report year
  "{{report_year}}": "2025",
  // Review
  "{{review.location}}": "г. Минск, ул. Интернациональная, д. 36, оф. 501",
  "{{review.date_from}}": "01.03.2026",
  "{{review.date_to}}": "30.03.2026",
  // Chair/Secretary
  "{{chair.name}}": "Петров Пётр Петрович",
  "{{secretary.name}}": "Сидорова Елена Александровна",
  // Settlement
  "{{settlement_display}}": "г. Минск",
};

/**
 * Replace all {{tokens}} in text with test data values.
 */
export function applyTestData(text: string): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match) => {
    return EDITOR_TEST_DATA[match] || `⚠️ ${match}`;
  });
}
