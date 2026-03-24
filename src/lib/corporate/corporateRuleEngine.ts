/**
 * Corporate Rule Engine
 * 
 * Pure functions for procedure mode detection, quorum calculation,
 * package manifest building, session validation, and default agenda.
 * 
 * Designed as shared-ready for future server-side use.
 */

import type {
  ProcedureMode,
  Participant,
  CharterRules,
  CorporateParams,
  PackageManifestItem,
  QuorumResult,
  ValidationResult,
  ValidationIssue,
  DocumentCategory,
  LegalBasis,
  AgendaItem,
  TemplateRuntimeStatus,
} from './corporateTypes';

import { getTemplateSpec } from './corporateTemplateSpec';

import {
  DEFAULT_CHARTER_RULES,
  LAW_ANNUAL_MEETING_DEADLINE_MONTH,
  LAW_ANNUAL_MEETING_DEADLINE_DAY,
  LAW_NOTICE_DAYS_MIN,
  LAW_REVIEW_DAYS_MIN,
} from './corporateTypes';

// ─── Template Constants (Sprint 2 bridge) ─────────────────────────

interface TemplateDefinition {
  code: string;
  title: string;
  category: DocumentCategory;
  condition?: string;
}

export const ANNUAL_MEETING_TEMPLATES: TemplateDefinition[] = [
  { code: 'corp_order_meeting', title: 'Решение (приказ) о проведении годового общего собрания участников', category: 'system_generated' },
  { code: 'corp_notice', title: 'Извещение участнику о проведении годового общего собрания', category: 'system_generated' },
  { code: 'corp_notice_journal', title: 'Журнал направления извещений участникам', category: 'system_generated' },
  { code: 'corp_review_list', title: 'Перечень документов, предоставляемых для ознакомления', category: 'system_generated' },
  { code: 'corp_draft_decisions', title: 'Проекты решений по вопросам повестки дня', category: 'system_generated' },
  { code: 'corp_registration_list', title: 'Список лиц, зарегистрированных для участия в собрании', category: 'system_generated' },
  { code: 'corp_protocol', title: 'Протокол годового общего собрания участников', category: 'system_generated' },
  { code: 'corp_notification_decisions', title: 'Уведомление участникам о принятых решениях', category: 'system_generated' },
];

export const SOLE_PARTICIPANT_TEMPLATES: TemplateDefinition[] = [
  { code: 'corp_sole_decision', title: 'Решение единственного участника', category: 'system_generated' },
  { code: 'corp_sole_appendices', title: 'Приложения к решению единственного участника', category: 'conditional_generated' },
];

export const CONDITIONAL_TEMPLATES: TemplateDefinition[] = [
  { code: 'corp_ballot', title: 'Бюллетень (карточка) для голосования', category: 'conditional_generated', condition: 'voting_form_secret_or_charter' },
  { code: 'corp_board_candidates', title: 'Сведения о кандидатах в совет директоров (наблюдательный совет)', category: 'conditional_generated', condition: 'has_board' },
  { code: 'corp_board_consent', title: 'Согласие кандидата в совет директоров (наблюдательный совет)', category: 'conditional_generated', condition: 'has_board' },
  { code: 'corp_auditor_candidates', title: 'Сведения о кандидате в ревизоры', category: 'conditional_generated', condition: 'has_auditor' },
  { code: 'corp_auditor_consent', title: 'Согласие кандидата в ревизоры', category: 'conditional_generated', condition: 'has_auditor' },
  { code: 'corp_audit_commission', title: 'Сведения о составе ревизионной комиссии', category: 'conditional_generated', condition: 'has_audit_commission' },
  { code: 'corp_agenda_change_notice', title: 'Уведомление об изменении повестки дня', category: 'conditional_generated' },
  { code: 'corp_charter_amendments', title: 'Проект изменений в устав / новая редакция устава', category: 'conditional_generated' },
];

export const EXTERNALLY_PROVIDED_DOCUMENTS: TemplateDefinition[] = [
  { code: 'ext_annual_report', title: 'Годовой отчёт', category: 'externally_provided' },
  { code: 'ext_balance_sheet', title: 'Годовой бухгалтерский баланс', category: 'externally_provided' },
  { code: 'ext_audit_report', title: 'Аудиторское заключение', category: 'externally_provided' },
  { code: 'ext_auditor_conclusion', title: 'Заключение ревизора / ревизионной комиссии', category: 'externally_provided' },
];

// ─── Required Data Mapping (business-level, NOT technical placeholders) ────

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

function getRequiredDataForTemplate(code: string): string[] {
  return TEMPLATE_REQUIRED_DATA[code] || [];
}

// ─── Core Functions ───────────────────────────────────────────────

export function determineProcedureMode(participants: Participant[]): ProcedureMode {
  if (participants.length === 1) return 'sole_participant_decision';
  return 'annual_meeting';
}

export function calculateQuorum(
  participants: Participant[],
  charterRules: Partial<CharterRules>
): QuorumResult {
  const rules = { ...DEFAULT_CHARTER_RULES, ...charterRules };
  const totalShares = participants.reduce((sum, p) => sum + p.share_percent, 0);
  const presentShares = participants
    .filter(p => p.attendance === 'present' || p.attendance === 'absentee_vote')
    .reduce((sum, p) => sum + p.share_percent, 0);

  const actualPercent = totalShares > 0 ? (presentShares / totalShares) * 100 : 0;

  return {
    total_shares: totalShares,
    present_shares: presentShares,
    quorum_percent_required: rules.quorum_percent,
    quorum_percent_actual: Math.round(actualPercent * 100) / 100,
    has_quorum: actualPercent >= rules.quorum_percent,
  };
}

// ─── Default Agenda ───────────────────────────────────────────────

/**
 * Возвращает предзаполненную повестку дня в зависимости от procedure_mode и charter rules.
 */
export function getDefaultAgenda(
  mode: ProcedureMode,
  charterRules: Partial<CharterRules>
): AgendaItem[] {
  const rules = { ...DEFAULT_CHARTER_RULES, ...charterRules };
  const items: AgendaItem[] = [];
  let n = 1;

  if (mode === 'sole_participant_decision') {
    items.push({ number: n++, title: 'Утверждение годового отчёта' });
    items.push({ number: n++, title: 'Утверждение годовой бухгалтерской отчётности' });
    items.push({ number: n++, title: 'Распределение прибыли и убытков' });
    if (rules.has_auditor) {
      items.push({ number: n++, title: 'Назначение ревизора' });
    }
    if (rules.has_audit_commission) {
      items.push({ number: n++, title: 'Формирование ревизионной комиссии' });
    }
  } else {
    items.push({ number: n++, title: 'Утверждение годового отчёта' });
    items.push({ number: n++, title: 'Утверждение годовой бухгалтерской отчётности' });
    items.push({ number: n++, title: 'Распределение прибыли и убытков' });
    if (rules.has_board) {
      items.push({ number: n++, title: 'Избрание членов совета директоров (наблюдательного совета)' });
    }
    if (rules.has_auditor) {
      items.push({ number: n++, title: 'Избрание ревизора' });
    }
    if (rules.has_audit_commission) {
      items.push({ number: n++, title: 'Избрание членов ревизионной комиссии' });
    }
  }

  return items;
}

// ─── Smart Date Defaults ──────────────────────────────────────────

/**
 * Рассчитывает даты по умолчанию для собрания.
 */
export function getDefaultDates(
  reportYear: number,
  charterRules: Partial<CharterRules>
): { meetingDate: string; noticeDate: string; reviewDateFrom: string } {
  const rules = { ...DEFAULT_CHARTER_RULES, ...charterRules };

  // Meeting: 31 марта (report_year+1) — или сегодня + 35 дней если deadline прошёл
  const deadlineDate = new Date(reportYear + 1, LAW_ANNUAL_MEETING_DEADLINE_MONTH - 1, LAW_ANNUAL_MEETING_DEADLINE_DAY);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let meetingDateObj: Date;
  if (deadlineDate > today) {
    // Use 2 weeks before deadline as a reasonable default
    meetingDateObj = new Date(deadlineDate);
    meetingDateObj.setDate(meetingDateObj.getDate() - 14);
    if (meetingDateObj < today) meetingDateObj = new Date(today.getTime() + 35 * 86400000);
  } else {
    // Deadline already passed, suggest ~35 days from now
    meetingDateObj = new Date(today.getTime() + 35 * 86400000);
  }

  const noticeDays = rules.notice_days_min || LAW_NOTICE_DAYS_MIN;
  const noticeDateObj = new Date(meetingDateObj.getTime() - noticeDays * 86400000);
  const reviewDateObj = new Date(meetingDateObj.getTime() - LAW_REVIEW_DAYS_MIN * 86400000);

  const fmt = (d: Date) => d.toISOString().split('T')[0];

  return {
    meetingDate: fmt(meetingDateObj),
    noticeDate: fmt(noticeDateObj),
    reviewDateFrom: fmt(reviewDateObj),
  };
}

// ─── Package Manifest ─────────────────────────────────────────────

export function calculatePackageManifest(
  mode: ProcedureMode,
  charterRules: Partial<CharterRules>,
  params: Partial<CorporateParams>,
  rulesBasis: 'charter_confirmed' | 'law_default' | 'mixed' = 'law_default'
): PackageManifestItem[] {
  const rules = { ...DEFAULT_CHARTER_RULES, ...charterRules };
  const manifest: PackageManifestItem[] = [];
  const legalBasis: LegalBasis = rulesBasis === 'mixed' ? 'charter_confirmed' : rulesBasis;

  const baseTemplates = mode === 'sole_participant_decision'
    ? SOLE_PARTICIPANT_TEMPLATES
    : ANNUAL_MEETING_TEMPLATES;

  for (const tpl of baseTemplates) {
    const spec = getTemplateSpec(tpl.code);
    manifest.push({
      template_code: tpl.code,
      title: tpl.title,
      included: true,
      reason: mode === 'sole_participant_decision'
        ? 'Единственный участник — полномочия общего собрания'
        : 'Обязательный документ годового собрания',
      legal_basis: legalBasis,
      category: tpl.category,
      required_data: getRequiredDataForTemplate(tpl.code),
      missing_data: [],
      runtime_status: (spec?.runtime_status as TemplateRuntimeStatus) || 'active',
    });
  }

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

    // Conditional templates tied to charter_confirmed rules are excluded
    // if charter is not confirmed (correction #8)
    if (tpl.condition && ['has_board', 'has_auditor', 'has_audit_commission'].includes(tpl.condition)) {
      if (rulesBasis === 'law_default') {
        included = false;
        reason = 'Правила устава не подтверждены — условный документ отключён';
      }
    }

    if (mode === 'sole_participant_decision' && tpl.condition) {
      included = false;
      reason = 'Не применяется для решения единственного участника';
    }

    const spec = getTemplateSpec(tpl.code);
    manifest.push({
      template_code: tpl.code,
      title: tpl.title,
      included,
      reason,
      legal_basis: tpl.condition ? (rulesBasis === 'charter_confirmed' ? 'charter_confirmed' : 'law_default') : 'user_selected',
      category: tpl.category,
      required_data: getRequiredDataForTemplate(tpl.code),
      missing_data: [],
      runtime_status: (spec?.runtime_status as TemplateRuntimeStatus) || 'active',
    });
  }

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

// ─── Validation ───────────────────────────────────────────────────

export type ValidationContext = 'edit' | 'confirm';

export function validateSession(
  mode: ProcedureMode,
  params: Partial<CorporateParams>,
  charterRules: Partial<CharterRules>,
  reportYear: number,
  rulesBasis: 'charter_confirmed' | 'law_default' | 'mixed',
  context: ValidationContext = 'confirm'
): ValidationResult {
  const rules = { ...DEFAULT_CHARTER_RULES, ...charterRules };
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // 1. Meeting deadline — blocking only on confirm
  if (mode === 'annual_meeting' && params.meeting?.date) {
    const meetingDate = new Date(params.meeting.date);
    const deadline = new Date(reportYear + 1, LAW_ANNUAL_MEETING_DEADLINE_MONTH - 1, LAW_ANNUAL_MEETING_DEADLINE_DAY);
    if (meetingDate > deadline) {
      const issue: ValidationIssue = {
        code: 'MEETING_AFTER_DEADLINE',
        message: `Годовое собрание должно быть проведено не позднее ${LAW_ANNUAL_MEETING_DEADLINE_DAY}.0${LAW_ANNUAL_MEETING_DEADLINE_MONTH}.${reportYear + 1}`,
        field: 'meeting.date',
        blocking: context === 'confirm',
      };
      if (context === 'confirm') errors.push(issue);
      else warnings.push(issue);
    }
  }

  // 2. Notice period
  if (mode === 'annual_meeting' && params.notice?.date && params.meeting?.date) {
    const noticeDate = new Date(params.notice.date);
    const meetingDate = new Date(params.meeting.date);
    const diffDays = Math.floor((meetingDate.getTime() - noticeDate.getTime()) / (1000 * 60 * 60 * 24));
    const minDays = rules.notice_days_min || LAW_NOTICE_DAYS_MIN;
    if (diffDays < minDays) {
      const issue: ValidationIssue = {
        code: 'NOTICE_TOO_LATE',
        message: `Извещение должно быть направлено не менее чем за ${minDays} дней до собрания (сейчас: ${diffDays} дней)`,
        field: 'notice.date',
        blocking: context === 'confirm',
      };
      if (context === 'confirm') errors.push(issue);
      else warnings.push(issue);
    }
  }

  // 3. Review period
  if (mode === 'annual_meeting' && params.review?.date_from && params.meeting?.date) {
    const reviewFrom = new Date(params.review.date_from);
    const meetingDate = new Date(params.meeting.date);
    const diffDays = Math.floor((meetingDate.getTime() - reviewFrom.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < LAW_REVIEW_DAYS_MIN) {
      warnings.push({
        code: 'REVIEW_PERIOD_SHORT',
        message: `Рекомендуемый срок ознакомления с документами — не менее ${LAW_REVIEW_DAYS_MIN} дней (сейчас: ${diffDays} дней)`,
        field: 'review.date_from',
        blocking: false,
      });
    }
  }

  // 4. Quorum
  if (mode === 'annual_meeting' && params.participants && params.participants.length > 0) {
    const quorum = calculateQuorum(params.participants, charterRules);
    if (!quorum.has_quorum) {
      errors.push({
        code: 'NO_QUORUM',
        message: `Нет кворума: присутствует ${quorum.quorum_percent_actual}% (требуется ${quorum.quorum_percent_required}%)`,
        field: 'participants',
        blocking: true,
      });
    }
  }

  // 5. No participants
  if (!params.participants || params.participants.length === 0) {
    errors.push({
      code: 'NO_PARTICIPANTS',
      message: 'Не указан ни один участник общества',
      field: 'participants',
      blocking: true,
    });
  }

  // 6. No agenda
  if (mode === 'annual_meeting' && (!params.agenda || params.agenda.length === 0)) {
    errors.push({
      code: 'NO_AGENDA',
      message: 'Не указана повестка дня',
      field: 'agenda',
      blocking: true,
    });
  }

  // 7. Charter not confirmed — only if charter_extraction_status is not confirmed
  if (rulesBasis === 'law_default') {
    warnings.push({
      code: 'NO_CHARTER',
      message: 'Правила устава не подтверждены — используются общие правила закона. Рекомендуется загрузить устав или подтвердить правила вручную.',
      blocking: false,
    });
  }

  // 8. Meeting format
  if (params.meeting?.format && rules.allowed_meeting_formats.length > 0) {
    if (!rules.allowed_meeting_formats.includes(params.meeting.format)) {
      errors.push({
        code: 'INVALID_MEETING_FORMAT',
        message: `Форма проведения «${params.meeting.format}» не допускается по уставу`,
        field: 'meeting.format',
        blocking: true,
      });
    }
  }

  // 9. Voting form
  if (params.meeting?.voting_form && rules.allowed_voting_forms.length > 0) {
    const vf = params.meeting.voting_form;
    if (vf !== 'mixed' && !rules.allowed_voting_forms.includes(vf as 'open' | 'secret')) {
      errors.push({
        code: 'INVALID_VOTING_FORM',
        message: `Форма голосования «${vf}» не допускается по уставу`,
        field: 'meeting.voting_form',
        blocking: true,
      });
    }
  }

  return {
    valid: errors.length === 0,
    blocking_errors: errors,
    non_blocking_warnings: warnings,
  };
}
