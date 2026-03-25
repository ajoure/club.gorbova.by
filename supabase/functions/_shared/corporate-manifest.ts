/**
 * Shared Corporate Manifest Calculator — Pure module, no UI dependencies.
 * Sprint 3 PATCH S3-FIX-1: Server-side manifest recalculation.
 * 
 * 1:1 compatible with src/lib/corporate/corporateRuleEngine.ts::calculatePackageManifest()
 * Same conditions, required_data, legal_basis, document order.
 * 
 * Can be used in edge functions and potentially in frontend (via extraction).
 */

// ─── Types (self-contained, no imports from src/) ─────────────────

export type ProcedureMode = 'annual_meeting' | 'sole_participant_decision';
export type DocumentCategory = 'system_generated' | 'externally_provided' | 'conditional_generated';
export type LegalBasis = 'law_default' | 'charter_confirmed' | 'user_selected';
export type TemplateRuntimeStatus = 'active' | 'pending_sprint3';
export type RulesBasis = 'charter_confirmed' | 'law_default' | 'mixed';

export interface CharterRules {
  convening_authority: string;
  notice_days_min: number;
  notice_method: string;
  quorum_percent: number;
  has_board: boolean;
  has_auditor: boolean;
  has_audit_commission: boolean;
  allowed_meeting_formats: string[];
  allowed_voting_forms: string[];
  special_rules?: string;
}

export interface ManifestItem {
  template_code: string;
  title: string;
  included: boolean;
  reason: string;
  legal_basis: LegalBasis;
  category: DocumentCategory;
  required_data: string[];
  missing_data: string[];
  runtime_status?: TemplateRuntimeStatus;
}

interface TemplateDefinition {
  code: string;
  title: string;
  category: DocumentCategory;
  condition?: string;
}

// ─── Default charter rules (same as corporateTypes.ts) ────────────

const DEFAULT_CHARTER_RULES: CharterRules = {
  convening_authority: 'director',
  notice_days_min: 30,
  notice_method: 'registered_mail',
  quorum_percent: 50,
  has_board: false,
  has_auditor: false,
  has_audit_commission: false,
  allowed_meeting_formats: ['in_person'],
  allowed_voting_forms: ['open'],
};

// ─── Default runtime status map (fallback only) ──
// This is NOT the SoT — runtimeStatusOverrides from DB is the SoT.
// This map is a fallback for cases when DB query fails or template not found.
// Must be kept in sync with corporateTemplateSpec.ts as last resort.
const DEFAULT_RUNTIME_STATUS: Record<string, TemplateRuntimeStatus> = {
  corp_order_meeting: 'active',
  corp_notice: 'pending_sprint3',
  corp_notice_journal: 'pending_sprint3',
  corp_review_list: 'active',
  corp_draft_decisions: 'pending_sprint3',
  corp_registration_list: 'pending_sprint3',
  corp_protocol: 'pending_sprint3',
  corp_notification_decisions: 'pending_sprint3',
  corp_sole_decision: 'active',
  corp_sole_appendices: 'active',
  corp_ballot: 'pending_sprint3',
  corp_board_candidates: 'pending_sprint3',
  corp_board_consent: 'active',
  corp_auditor_candidates: 'active',
  corp_auditor_consent: 'active',
  corp_audit_commission: 'pending_sprint3',
  corp_agenda_change_notice: 'pending_sprint3',
  corp_charter_amendments: 'active',
};

/**
 * Resolve runtime_status for a template code.
 * Priority: runtimeStatusOverrides (from DB) > DEFAULT_RUNTIME_STATUS > 'pending_sprint3'
 * 
 * IMPORTANT: runtime_status ≠ template availability.
 * - runtime_status = proven readiness for runtime rendering (active | pending_sprint3)
 * - availability = DB active + template_path + storage file (checked by pre-flight)
 */
function resolveRuntimeStatus(
  code: string,
  overrides?: Record<string, TemplateRuntimeStatus>,
): TemplateRuntimeStatus {
  if (overrides && code in overrides) return overrides[code];
  return DEFAULT_RUNTIME_STATUS[code] || 'pending_sprint3';
}

// ─── Template constants (same order as corporateRuleEngine.ts) ────

const ANNUAL_MEETING_TEMPLATES: TemplateDefinition[] = [
  { code: 'corp_order_meeting', title: 'Решение (приказ) о проведении годового общего собрания участников', category: 'system_generated' },
  { code: 'corp_notice', title: 'Извещение участнику о проведении годового общего собрания', category: 'system_generated' },
  { code: 'corp_notice_journal', title: 'Журнал направления извещений участникам', category: 'system_generated' },
  { code: 'corp_review_list', title: 'Перечень документов, предоставляемых для ознакомления', category: 'system_generated' },
  { code: 'corp_draft_decisions', title: 'Проекты решений по вопросам повестки дня', category: 'system_generated' },
  { code: 'corp_registration_list', title: 'Список лиц, зарегистрированных для участия в собрании', category: 'system_generated' },
  { code: 'corp_protocol', title: 'Протокол годового общего собрания участников', category: 'system_generated' },
  { code: 'corp_notification_decisions', title: 'Уведомление участникам о принятых решениях', category: 'system_generated' },
];

const SOLE_PARTICIPANT_TEMPLATES: TemplateDefinition[] = [
  { code: 'corp_sole_decision', title: 'Решение единственного участника', category: 'system_generated' },
  { code: 'corp_sole_appendices', title: 'Приложения к решению единственного участника', category: 'conditional_generated' },
];

const CONDITIONAL_TEMPLATES: TemplateDefinition[] = [
  { code: 'corp_ballot', title: 'Бюллетень (карточка) для голосования', category: 'conditional_generated', condition: 'voting_form_secret_or_charter' },
  { code: 'corp_board_candidates', title: 'Сведения о кандидатах в совет директоров (наблюдательный совет)', category: 'conditional_generated', condition: 'has_board' },
  { code: 'corp_board_consent', title: 'Согласие кандидата в совет директоров (наблюдательный совет)', category: 'conditional_generated', condition: 'has_board' },
  { code: 'corp_auditor_candidates', title: 'Сведения о кандидате в ревизоры', category: 'conditional_generated', condition: 'has_auditor' },
  { code: 'corp_auditor_consent', title: 'Согласие кандидата в ревизоры', category: 'conditional_generated', condition: 'has_auditor' },
  { code: 'corp_audit_commission', title: 'Сведения о составе ревизионной комиссии', category: 'conditional_generated', condition: 'has_audit_commission' },
  { code: 'corp_agenda_change_notice', title: 'Уведомление об изменении повестки дня', category: 'conditional_generated' },
  { code: 'corp_charter_amendments', title: 'Проект изменений в устав / новая редакция устава', category: 'conditional_generated' },
];

const EXTERNALLY_PROVIDED_DOCUMENTS: TemplateDefinition[] = [
  { code: 'ext_annual_report', title: 'Годовой отчёт', category: 'externally_provided' },
  { code: 'ext_balance_sheet', title: 'Годовой бухгалтерский баланс', category: 'externally_provided' },
  { code: 'ext_audit_report', title: 'Аудиторское заключение', category: 'externally_provided' },
  { code: 'ext_auditor_conclusion', title: 'Заключение ревизора / ревизионной комиссии', category: 'externally_provided' },
];

// ─── Required data mapping (same as corporateRuleEngine.ts) ───────

const TEMPLATE_REQUIRED_DATA: Record<string, string[]> = {
  corp_order_meeting: ['entity.name', 'meeting.date', 'meeting.time', 'meeting.location.full'],
  corp_notice: ['entity.name', 'meeting.date', 'meeting.time', 'meeting.location.full', 'meeting.notice.date'],
  corp_notice_journal: ['entity.name', 'meeting.notice.date'],
  corp_review_list: ['entity.name'],
  corp_draft_decisions: ['entity.name'],
  corp_registration_list: ['entity.name', 'meeting.date'],
  corp_protocol: ['entity.name', 'meeting.date', 'meeting.time', 'meeting.location.full'],
  corp_notification_decisions: ['entity.name', 'meeting.date'],
  corp_sole_decision: ['entity.name'],
  corp_sole_appendices: ['entity.name'],
  corp_ballot: ['entity.name', 'meeting.date'],
  corp_board_candidates: ['entity.name'],
  corp_board_consent: ['entity.name'],
  corp_auditor_candidates: ['entity.name'],
  corp_auditor_consent: ['entity.name'],
  corp_audit_commission: ['entity.name'],
  corp_agenda_change_notice: ['entity.name', 'meeting.date'],
  corp_charter_amendments: ['entity.name'],
};

// ─── Main function ────────────────────────────────────────────────

/**
 * Server-side manifest calculation.
 * 1:1 compatible with corporateRuleEngine.ts::calculatePackageManifest().
 * Same conditions, same order, same legal_basis rules.
 */
export function calculateServerManifest(
  mode: ProcedureMode,
  charterRules: Partial<CharterRules>,
  params: {
    meeting?: { voting_form?: string };
    agenda?: { requires_charter_change?: boolean }[];
    governance?: { has_board?: boolean; has_auditor?: boolean; has_audit_commission?: boolean };
  },
  rulesBasis: RulesBasis = 'law_default',
): ManifestItem[] {
  const rules = { ...DEFAULT_CHARTER_RULES, ...charterRules };
  const manifest: ManifestItem[] = [];
  const legalBasis: LegalBasis = rulesBasis === 'mixed' ? 'charter_confirmed' : rulesBasis;

  // Base templates by mode
  const baseTemplates = mode === 'sole_participant_decision'
    ? SOLE_PARTICIPANT_TEMPLATES
    : ANNUAL_MEETING_TEMPLATES;

  for (const tpl of baseTemplates) {
    manifest.push({
      template_code: tpl.code,
      title: tpl.title,
      included: true,
      reason: mode === 'sole_participant_decision'
        ? 'Единственный участник — полномочия общего собрания'
        : 'Обязательный документ годового собрания',
      legal_basis: legalBasis,
      category: tpl.category,
      required_data: TEMPLATE_REQUIRED_DATA[tpl.code] || [],
      missing_data: [],
      runtime_status: RUNTIME_STATUS_MAP[tpl.code] || 'active',
    });
  }

  // Conditional templates — same logic as corporateRuleEngine.ts
  for (const tpl of CONDITIONAL_TEMPLATES) {
    let included = false;
    let reason = '';

    if (tpl.condition === 'voting_form_secret_or_charter') {
      const isSecret = params.meeting?.voting_form === 'secret';
      const charterRequiresBallot = rulesBasis === 'charter_confirmed';
      included = isSecret || charterRequiresBallot;
      reason = included
        ? (isSecret ? 'Тайное голосование — бюллетень обязателен' : 'Бюллетень предусмотрен уставом')
        : 'Открытое голосование — бюллетень не требуется';
    } else if (tpl.condition === 'has_board') {
      included = rules.has_board;
      reason = included ? 'Совет директоров предусмотрен уставом' : 'Совет директоров не предусмотрен';
    } else if (tpl.condition === 'has_auditor') {
      included = rules.has_auditor;
      reason = included ? 'Ревизор предусмотрен уставом' : 'Ревизор не предусмотрен';
    } else if (tpl.condition === 'has_audit_commission') {
      included = rules.has_audit_commission;
      reason = included ? 'Ревизионная комиссия предусмотрена уставом' : 'Ревизионная комиссия не предусмотрена';
    } else if (tpl.code === 'corp_charter_amendments') {
      const hasCharterQuestion = params.agenda?.some(a => a.requires_charter_change);
      included = !!hasCharterQuestion;
      reason = included ? 'В повестке есть вопрос об изменении устава' : 'Вопрос об изменении устава отсутствует в повестке';
    } else if (tpl.code === 'corp_agenda_change_notice') {
      included = false;
      reason = 'Включается при изменении повестки после первичного извещения';
    }

    // Charter-dependent conditions excluded if charter not confirmed
    if (tpl.condition && ['has_board', 'has_auditor', 'has_audit_commission'].includes(tpl.condition)) {
      if (rulesBasis === 'law_default') {
        included = false;
        reason = 'Правила устава не подтверждены — условный документ отключён';
      }
    }

    // Sole participant: no conditional templates
    if (mode === 'sole_participant_decision' && tpl.condition) {
      included = false;
      reason = 'Не применяется для решения единственного участника';
    }

    manifest.push({
      template_code: tpl.code,
      title: tpl.title,
      included,
      reason,
      legal_basis: tpl.condition ? (rulesBasis === 'charter_confirmed' ? 'charter_confirmed' : 'law_default') : 'user_selected',
      category: tpl.category,
      required_data: TEMPLATE_REQUIRED_DATA[tpl.code] || [],
      missing_data: [],
      runtime_status: RUNTIME_STATUS_MAP[tpl.code] || 'active',
    });
  }

  // Externally provided
  for (const doc of EXTERNALLY_PROVIDED_DOCUMENTS) {
    let included = true;
    let reason = 'Учитывается как внешний документ';

    if (doc.code === 'ext_auditor_conclusion') {
      const needsAuditor = rules.has_auditor || rules.has_audit_commission;
      included = needsAuditor;
      reason = needsAuditor
        ? 'Ревизор / ревизионная комиссия предусмотрены'
        : 'Ревизор не предусмотрен — заключение не требуется';
    }

    manifest.push({
      template_code: doc.code,
      title: doc.title,
      included,
      reason,
      legal_basis: 'law_default',
      category: 'externally_provided',
      required_data: [],
      missing_data: [],
    });
  }

  return manifest;
}
