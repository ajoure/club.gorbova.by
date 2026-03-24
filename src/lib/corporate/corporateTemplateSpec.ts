/**
 * Corporate Template Specification — Machine-readable config
 * 
 * Sprint 2: Source of truth for template metadata, business rules,
 * required data, and runtime readiness.
 * 
 * This file does NOT duplicate manifest constants from corporateRuleEngine.ts.
 * It EXTENDS them with generation-level metadata needed for:
 * - DOCX placeholder mapping
 * - Business required_data vs technical placeholders
 * - Runtime activation status
 * - Legal basis conditions
 */

export type TemplateCategory = 'system_generated' | 'conditional_generated' | 'externally_provided';

export type RuntimeStatus = 'active' | 'pending_sprint3';

export interface TemplateSpec {
  /** Unique template code — must match document_templates.code AND manifest constants */
  code: string;

  /** Human-readable title in nominative case */
  title: string;

  /** Document type for DB (вид документа) */
  doc_type: string;

  /** Generation category */
  category: TemplateCategory;

  /** Which procedure mode(s) this template applies to */
  applies_to: ('annual_meeting' | 'sole_participant_decision')[];

  /** Condition for inclusion (null = always included for applicable mode) */
  condition: string | null;

  /** Legal basis type */
  legal_basis: 'law_default' | 'charter_confirmed' | 'user_selected';

  /** Business-level required data (NOT technical placeholders) */
  required_data: string[];

  /** Optional/conditional data */
  optional_data: string[];

  /** Technical DOCX placeholders used in the template */
  placeholders: string[];

  /** Whether template uses loops (arrays) */
  has_loops: boolean;

  /** Runtime activation status */
  runtime_status: RuntimeStatus;

  /** Default sort order within package */
  sort_order: number;

  /** Notes about the template */
  notes: string;
}

// ─── Annual Meeting Core Templates (always included for annual_meeting) ────

export const TEMPLATE_SPECS: TemplateSpec[] = [
  // ── Annual Meeting Core (8) ──────────────────────────────────
  {
    code: 'corp_order_meeting',
    title: 'Решение (приказ) о проведении годового общего собрания участников',
    doc_type: 'решение',
    category: 'system_generated',
    applies_to: ['annual_meeting'],
    condition: null,
    legal_basis: 'law_default',
    required_data: [
      'entity.name',           // Наименование организации
      'meeting.date',          // Дата собрания
      'meeting.time',          // Время собрания
      'meeting.location.full', // Место проведения
    ],
    optional_data: [
      'entity.director_name',
      'entity.director_position',
      'meeting.report_year',
    ],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{meeting.date}}',
      '{{meeting.time}}',
      '{{meeting.location.full}}',
      '{{meeting.report_year}}',
      '{{legal_details.leg_director_name}}',
      '{{legal_details.leg_director_position}}',
      '{{settlement_display}}',
      '{{document.date}}',
      '{{document.number}}',
    ],
    has_loops: false,
    runtime_status: 'active',
    sort_order: 1,
    notes: 'Акт созыва собрания. Может быть решением директора, приказом или иным актом в зависимости от модели созыва (convening_authority из устава). По умолчанию — решение исполнительного органа.',
  },
  {
    code: 'corp_notice',
    title: 'Извещение участнику о проведении годового общего собрания',
    doc_type: 'извещение',
    category: 'system_generated',
    applies_to: ['annual_meeting'],
    condition: null,
    legal_basis: 'law_default',
    required_data: [
      'entity.name',
      'meeting.date',
      'meeting.time',
      'meeting.location.full',
      'meeting.notice.date',
    ],
    optional_data: [
      'person.full_name',        // Заполняется для каждого участника
      'meeting.review.location.full',
      'meeting.review.start',
    ],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{meeting.date}}',
      '{{meeting.time}}',
      '{{meeting.location.full}}',
      '{{meeting.notice.date}}',
      '{{meeting.review.location.full}}',
      '{{meeting.review.start}}',
      '{{settlement_display}}',
      '{{person.full_name}}',
      '{{meeting.report_year}}',
    ],
    has_loops: true,
    runtime_status: 'pending_sprint3',
    sort_order: 2,
    notes: 'Генерируется для каждого участника. Содержит повестку дня (loop: agenda.items). Плоские поля доступны сейчас, loop-подстановка — Sprint 3.',
  },
  {
    code: 'corp_notice_journal',
    title: 'Журнал направления извещений участникам',
    doc_type: 'журнал',
    category: 'system_generated',
    applies_to: ['annual_meeting'],
    condition: null,
    legal_basis: 'law_default',
    required_data: [
      'entity.name',
      'meeting.notice.date',
    ],
    optional_data: [
      'meeting.notice.method',
    ],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{meeting.notice.date}}',
      '{{meeting.notice.method}}',
      '{{settlement_display}}',
    ],
    has_loops: true,
    runtime_status: 'pending_sprint3',
    sort_order: 3,
    notes: 'Табличный документ. Содержит loop по участникам (package.participants). Activation — Sprint 3.',
  },
  {
    code: 'corp_review_list',
    title: 'Перечень документов, предоставляемых для ознакомления',
    doc_type: 'перечень',
    category: 'system_generated',
    applies_to: ['annual_meeting'],
    condition: null,
    legal_basis: 'law_default',
    required_data: [
      'entity.name',
    ],
    optional_data: [
      'meeting.review.location.full',
      'meeting.review.start',
      'meeting.report_year',
    ],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{meeting.review.location.full}}',
      '{{meeting.review.start}}',
      '{{meeting.report_year}}',
      '{{settlement_display}}',
    ],
    has_loops: false,
    runtime_status: 'active',
    sort_order: 4,
    notes: 'Список материалов для ознакомления участников перед собранием. Плоская структура, без loops.',
  },
  {
    code: 'corp_draft_decisions',
    title: 'Проекты решений по вопросам повестки дня',
    doc_type: 'проекты решений',
    category: 'system_generated',
    applies_to: ['annual_meeting'],
    condition: null,
    legal_basis: 'law_default',
    required_data: [
      'entity.name',
    ],
    optional_data: [
      'meeting.report_year',
    ],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{meeting.report_year}}',
      '{{settlement_display}}',
    ],
    has_loops: true,
    runtime_status: 'pending_sprint3',
    sort_order: 5,
    notes: 'Содержит loop по вопросам повестки и проектам решений (agenda.items, decision.items). Activation — Sprint 3.',
  },
  {
    code: 'corp_registration_list',
    title: 'Список лиц, зарегистрированных для участия в собрании',
    doc_type: 'список',
    category: 'system_generated',
    applies_to: ['annual_meeting'],
    condition: null,
    legal_basis: 'law_default',
    required_data: [
      'entity.name',
      'meeting.date',
    ],
    optional_data: [
      'meeting.registration.date',
      'meeting.registration.from',
      'meeting.registration.to',
    ],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{meeting.date}}',
      '{{meeting.registration.date}}',
      '{{meeting.registration.from}}',
      '{{meeting.registration.to}}',
      '{{settlement_display}}',
    ],
    has_loops: true,
    runtime_status: 'pending_sprint3',
    sort_order: 6,
    notes: 'Табличный документ. Содержит loop по участникам. Activation — Sprint 3.',
  },
  {
    code: 'corp_protocol',
    title: 'Протокол годового общего собрания участников',
    doc_type: 'протокол',
    category: 'system_generated',
    applies_to: ['annual_meeting'],
    condition: null,
    legal_basis: 'law_default',
    required_data: [
      'entity.name',
      'meeting.date',
      'meeting.time',
      'meeting.location.full',
    ],
    optional_data: [
      'package.chairperson.full_name',
      'package.secretary.full_name',
      'meeting.report_year',
    ],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{meeting.date}}',
      '{{meeting.time}}',
      '{{meeting.location.full}}',
      '{{meeting.report_year}}',
      '{{package.chairperson.full_name}}',
      '{{package.secretary.full_name}}',
      '{{settlement_display}}',
      '{{document.number}}',
    ],
    has_loops: true,
    runtime_status: 'pending_sprint3',
    sort_order: 7,
    notes: 'Центральный документ собрания. Содержит loops: agenda.items, package.participants, результаты голосования. Наиболее сложный шаблон. Activation — Sprint 3.',
  },
  {
    code: 'corp_notification_decisions',
    title: 'Уведомление участникам о принятых решениях',
    doc_type: 'уведомление',
    category: 'system_generated',
    applies_to: ['annual_meeting'],
    condition: null,
    legal_basis: 'law_default',
    required_data: [
      'entity.name',
      'meeting.date',
    ],
    optional_data: [
      'person.full_name',
    ],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{meeting.date}}',
      '{{person.full_name}}',
      '{{settlement_display}}',
    ],
    has_loops: true,
    runtime_status: 'pending_sprint3',
    sort_order: 8,
    notes: 'Генерируется для каждого участника. Содержит loop по решениям. Activation — Sprint 3.',
  },

  // ── Sole Participant (2) ─────────────────────────────────────
  {
    code: 'corp_sole_decision',
    title: 'Решение единственного участника',
    doc_type: 'решение',
    category: 'system_generated',
    applies_to: ['sole_participant_decision'],
    condition: null,
    legal_basis: 'law_default',
    required_data: [
      'entity.name',
    ],
    optional_data: [
      'person.full_name',
      'meeting.report_year',
    ],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{person.full_name}}',
      '{{meeting.report_year}}',
      '{{settlement_display}}',
      '{{document.date}}',
      '{{document.number}}',
    ],
    has_loops: false,
    runtime_status: 'active',
    sort_order: 1,
    notes: 'Основной документ для ООО/ОДО с одним участником. НЕ "протокол", НЕ "собрание". Подписант — единственный участник, не "Председатель".',
  },
  {
    code: 'corp_sole_appendices',
    title: 'Приложения к решению единственного участника',
    doc_type: 'приложения',
    category: 'conditional_generated',
    applies_to: ['sole_participant_decision'],
    condition: 'has_appendices',
    legal_basis: 'user_selected',
    required_data: [
      'entity.name',
    ],
    optional_data: [],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{settlement_display}}',
      '{{document.date}}',
    ],
    has_loops: false,
    runtime_status: 'active',
    sort_order: 2,
    notes: 'Условный шаблон. Включается если есть приложения к решению (изменения устава, утверждённые документы).',
  },

  // ── Conditional Templates (8, includes corp_ballot) ──────────
  {
    code: 'corp_ballot',
    title: 'Бюллетень (карточка) для голосования',
    doc_type: 'бюллетень',
    category: 'conditional_generated',
    applies_to: ['annual_meeting'],
    condition: 'voting_form_secret_or_charter',
    legal_basis: 'charter_confirmed',
    required_data: [
      'entity.name',
      'meeting.date',
    ],
    optional_data: [
      'person.full_name',
    ],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{meeting.date}}',
      '{{person.full_name}}',
      '{{settlement_display}}',
    ],
    has_loops: true,
    runtime_status: 'pending_sprint3',
    sort_order: 9,
    notes: 'Условный: включается при тайном голосовании или если бюллетень предусмотрен уставом. Содержит loop по вопросам повестки. Activation — Sprint 3.',
  },
  {
    code: 'corp_board_candidates',
    title: 'Сведения о кандидатах в совет директоров (наблюдательный совет)',
    doc_type: 'сведения',
    category: 'conditional_generated',
    applies_to: ['annual_meeting'],
    condition: 'has_board',
    legal_basis: 'charter_confirmed',
    required_data: [
      'entity.name',
    ],
    optional_data: [],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{settlement_display}}',
    ],
    has_loops: true,
    runtime_status: 'pending_sprint3',
    sort_order: 10,
    notes: 'Включается только если совет директоров предусмотрен подтверждённым уставом (charter_confirmed). Содержит loop по кандидатам.',
  },
  {
    code: 'corp_board_consent',
    title: 'Согласие кандидата в совет директоров (наблюдательный совет)',
    doc_type: 'согласие',
    category: 'conditional_generated',
    applies_to: ['annual_meeting'],
    condition: 'has_board',
    legal_basis: 'charter_confirmed',
    required_data: [
      'entity.name',
    ],
    optional_data: [
      'person.full_name',
    ],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{person.full_name}}',
      '{{settlement_display}}',
    ],
    has_loops: false,
    runtime_status: 'active',
    sort_order: 11,
    notes: 'Включается только если совет директоров предусмотрен подтверждённым уставом. Генерируется для каждого кандидата.',
  },
  {
    code: 'corp_auditor_candidates',
    title: 'Сведения о кандидате в ревизоры',
    doc_type: 'сведения',
    category: 'conditional_generated',
    applies_to: ['annual_meeting'],
    condition: 'has_auditor',
    legal_basis: 'charter_confirmed',
    required_data: [
      'entity.name',
    ],
    optional_data: [],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{settlement_display}}',
    ],
    has_loops: false,
    runtime_status: 'active',
    sort_order: 12,
    notes: 'Включается только если ревизор предусмотрен подтверждённым уставом.',
  },
  {
    code: 'corp_auditor_consent',
    title: 'Согласие кандидата в ревизоры',
    doc_type: 'согласие',
    category: 'conditional_generated',
    applies_to: ['annual_meeting'],
    condition: 'has_auditor',
    legal_basis: 'charter_confirmed',
    required_data: [
      'entity.name',
    ],
    optional_data: [
      'person.full_name',
    ],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{person.full_name}}',
      '{{settlement_display}}',
    ],
    has_loops: false,
    runtime_status: 'active',
    sort_order: 13,
    notes: 'Включается только если ревизор предусмотрен подтверждённым уставом.',
  },
  {
    code: 'corp_audit_commission',
    title: 'Сведения о составе ревизионной комиссии',
    doc_type: 'сведения',
    category: 'conditional_generated',
    applies_to: ['annual_meeting'],
    condition: 'has_audit_commission',
    legal_basis: 'charter_confirmed',
    required_data: [
      'entity.name',
    ],
    optional_data: [],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{settlement_display}}',
    ],
    has_loops: true,
    runtime_status: 'pending_sprint3',
    sort_order: 14,
    notes: 'Включается только если ревизионная комиссия предусмотрена подтверждённым уставом. Содержит loop по членам комиссии.',
  },
  {
    code: 'corp_agenda_change_notice',
    title: 'Уведомление об изменении повестки дня',
    doc_type: 'уведомление',
    category: 'conditional_generated',
    applies_to: ['annual_meeting'],
    condition: 'agenda_changed_after_notice',
    legal_basis: 'user_selected',
    required_data: [
      'entity.name',
      'meeting.date',
    ],
    optional_data: [],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{meeting.date}}',
      '{{settlement_display}}',
    ],
    has_loops: true,
    runtime_status: 'pending_sprint3',
    sort_order: 15,
    notes: 'Включается при изменении повестки после первичного извещения. Содержит loop по новым/измененным вопросам.',
  },
  {
    code: 'corp_charter_amendments',
    title: 'Проект изменений в устав / новая редакция устава',
    doc_type: 'проект',
    category: 'conditional_generated',
    applies_to: ['annual_meeting', 'sole_participant_decision'],
    condition: 'agenda_has_charter_change',
    legal_basis: 'user_selected',
    required_data: [
      'entity.name',
    ],
    optional_data: [],
    placeholders: [
      '{{legal_details.leg_name}}',
      '{{settlement_display}}',
    ],
    has_loops: false,
    runtime_status: 'active',
    sort_order: 16,
    notes: 'Включается если в повестке есть вопрос об изменении устава.',
  },
];

// ─── Externally Provided Documents (NOT templates, only manifest entries) ───

export interface ExternalDocSpec {
  code: string;
  title: string;
  condition: string | null;
  notes: string;
}

export const EXTERNAL_DOCS: ExternalDocSpec[] = [
  {
    code: 'ext_annual_report',
    title: 'Годовой отчёт',
    condition: null,
    notes: 'Готовится руководством организации. Система не генерирует.',
  },
  {
    code: 'ext_balance_sheet',
    title: 'Годовой бухгалтерский баланс',
    condition: null,
    notes: 'Готовится бухгалтерией. Система не генерирует.',
  },
  {
    code: 'ext_audit_report',
    title: 'Аудиторское заключение',
    condition: null,
    notes: 'Готовится внешним аудитором. Система не генерирует.',
  },
  {
    code: 'ext_auditor_conclusion',
    title: 'Заключение ревизора / ревизионной комиссии',
    condition: 'has_auditor_or_commission',
    notes: 'Условный внешний документ. Включается при наличии ревизора или ревизионной комиссии.',
  },
];

// ─── Helper: Get spec by code ─────────────────────────────────────

export function getTemplateSpec(code: string): TemplateSpec | undefined {
  return TEMPLATE_SPECS.find(s => s.code === code);
}

/** Templates that are ready for runtime generation now */
export function getRuntimeReadyTemplates(): TemplateSpec[] {
  return TEMPLATE_SPECS.filter(s => s.runtime_status === 'active');
}

/** Templates that need Sprint 3 arrays/loops support */
export function getPendingSprint3Templates(): TemplateSpec[] {
  return TEMPLATE_SPECS.filter(s => s.runtime_status === 'pending_sprint3');
}
