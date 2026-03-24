/**
 * Corporate Documents Module — Type Definitions
 * 
 * Structured types for corporate meeting/decision draft sessions,
 * charter rules, participants, package manifests, and formatting constraints.
 * 
 * PATCH 1 / Sprint 1 — Intake + Draft + Rule Layer
 */

// ─── Procedure Mode ───────────────────────────────────────────────

export type ProcedureMode = 'annual_meeting' | 'sole_participant_decision';

export type CharterSourceType = 'upload_docx' | 'upload_pdf' | 'upload_image' | 'text' | 'manual';

export type CharterExtractionStatus = 'none' | 'pending' | 'extracted' | 'confirmed' | 'failed';

export type CharterConfirmedBy = 'ai_extraction' | 'manual';

export type RulesBasis = 'charter_confirmed' | 'law_default' | 'mixed';

export type DraftSessionStatus =
  | 'draft'
  | 'charter_pending'
  | 'params_pending'
  | 'preview'
  | 'confirmed'
  | 'generating'
  | 'generated'
  | 'cancelled';

// ─── Participants ─────────────────────────────────────────────────

export interface ParticipantRepresentative {
  name: string;
  /** Основание полномочий: доверенность, приказ и т.д. */
  basis: string;
}

export interface Participant {
  /** UUID из legal_details_persons (если физлицо-участник) */
  person_id?: string;
  /** UUID из client_legal_details (если участник — юрлицо) */
  entity_id?: string;
  type: 'individual' | 'legal_entity';
  name: string;
  /** Размер доли в процентах */
  share_percent: number;
  /** Количество голосов */
  vote_count: number;
  /** Представитель (если участник действует через представителя) */
  representative?: ParticipantRepresentative;
  /** Форма участия */
  attendance: 'present' | 'absent' | 'absentee_vote';
}

// ─── Agenda ───────────────────────────────────────────────────────

export interface AgendaItem {
  number: number;
  title: string;
  description?: string;
  requires_charter_change?: boolean;
}

// ─── Corporate Parameters ─────────────────────────────────────────

export interface MeetingDetails {
  date?: string;        // ISO date
  time?: string;        // HH:MM
  location?: string;
  format?: 'in_person' | 'absentee' | 'mixed';
  voting_form?: 'open' | 'secret' | 'mixed';
}

export interface NoticeDetails {
  date?: string;
  method?: string;       // 'registered_mail' | 'courier' | 'email' | 'other'
  days_before?: number;
}

export interface ReviewDetails {
  location?: string;
  date_from?: string;
  date_to?: string;
}

export interface GovernanceBodies {
  has_board: boolean;
  has_auditor: boolean;
  has_audit_commission: boolean;
}

export interface CandidateEntry {
  person_id?: string;
  name: string;
}

export interface PersonReference {
  person_id?: string;
  name?: string;
}

export interface ProfitDistribution {
  net_profit?: number;
  dividend_amount?: number;
  retain_amount?: number;
}

export interface CorporateParams {
  meeting: MeetingDetails;
  notice: NoticeDetails;
  review: ReviewDetails;
  agenda: AgendaItem[];
  participants: Participant[];
  governance: GovernanceBodies;
  candidates: {
    board?: CandidateEntry[];
    auditor?: CandidateEntry[];
  };
  chair: PersonReference;
  secretary: PersonReference;
  profit_distribution?: ProfitDistribution;
}

// ─── Charter Rules ────────────────────────────────────────────────

export interface CharterRules {
  convening_authority: 'director' | 'board' | 'participants';
  /** Минимум дней для извещения */
  notice_days_min: number;
  notice_method: string;
  /** Процент для кворума */
  quorum_percent: number;
  has_board: boolean;
  has_auditor: boolean;
  has_audit_commission: boolean;
  allowed_meeting_formats: ('in_person' | 'absentee' | 'mixed')[];
  allowed_voting_forms: ('open' | 'secret')[];
  special_rules?: string;
}

/** Правила по умолчанию (общее правило закона) */
export const DEFAULT_CHARTER_RULES: CharterRules = {
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

// ─── Package Manifest ─────────────────────────────────────────────

export type DocumentCategory = 'system_generated' | 'externally_provided' | 'conditional_generated';

export type LegalBasis = 'law_default' | 'charter_confirmed' | 'user_selected';

export type TemplateAvailability =
  | 'available'
  | 'pending_sprint3'
  | 'missing_db_record'
  | 'inactive_template'
  | 'missing_template_path'
  | 'missing_storage_file'
  | 'not_applicable';

export type TemplateRuntimeStatus = 'active' | 'pending_sprint3';

export interface PackageManifestItem {
  template_code: string;
  title: string;
  included: boolean;
  reason: string;
  legal_basis: LegalBasis;
  category: DocumentCategory;
  required_data: string[];
  missing_data: string[];
  /** Runtime status from corporateTemplateSpec — source of truth */
  runtime_status?: TemplateRuntimeStatus;
  /** DB template UUID after resolver enrichment */
  db_template_id?: string;
  /** Storage path after resolver enrichment */
  template_path?: string;
  /** Availability after resolver check */
  availability?: TemplateAvailability;
}

// ─── Quorum ───────────────────────────────────────────────────────

export interface QuorumResult {
  total_shares: number;
  present_shares: number;
  quorum_percent_required: number;
  quorum_percent_actual: number;
  has_quorum: boolean;
}

// ─── Validation ───────────────────────────────────────────────────

export interface ValidationIssue {
  code: string;
  message: string;
  field?: string;
  blocking: boolean;
}

export interface ValidationResult {
  valid: boolean;
  blocking_errors: ValidationIssue[];
  non_blocking_warnings: ValidationIssue[];
}

// ─── Draft Session (DB row shape) ─────────────────────────────────

export interface CorporateDraftSession {
  id: string;
  public_id: string | null;
  profile_id: string;
  legal_details_id: string | null;
  report_year: number;
  procedure_mode: ProcedureMode;
  procedure_mode_override_reason: string | null;
  charter_source_type: CharterSourceType | null;
  charter_extraction_status: CharterExtractionStatus;
  charter_file_path: string | null;
  charter_raw_text: string | null;
  extracted_charter_rules: Partial<CharterRules>;
  confirmed_charter_rules: Partial<CharterRules>;
  charter_confirmed_at: string | null;
  charter_confirmed_by: CharterConfirmedBy | null;
  corporate_params: Partial<CorporateParams>;
  rules_basis: RulesBasis;
  package_manifest: PackageManifestItem[];
  warnings: string[];
  blocking_errors: ValidationIssue[];
  non_blocking_warnings: ValidationIssue[];
  status: DraftSessionStatus;
  metadata: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Legal Deadlines (общее правило закона) ───────────────────────

/** Крайняя дата проведения годового собрания (31 марта следующего года) */
export const LAW_ANNUAL_MEETING_DEADLINE_MONTH = 3; // март
export const LAW_ANNUAL_MEETING_DEADLINE_DAY = 31;

/** Минимальный срок извещения (дней) */
export const LAW_NOTICE_DAYS_MIN = 30;

/** Минимальный срок доступа к документам для ознакомления (дней) */
export const LAW_REVIEW_DAYS_MIN = 20;

// ─── Document Formatting Constraints (Sprint 2 bridge) ───────────
// See also: docs/corporate-document-formatting.md

export const DOCUMENT_FORMAT_CONSTRAINTS = {
  /** Поля страницы (мм) — по Инструкции по делопроизводству */
  page_margins: {
    top: 20,
    bottom: 20,
    left: 30,
    right: 10,
  },
  /** Обязательные реквизиты документа */
  required_requisites: [
    'наименование организации',
    'название вида документа',
    'дата документа',
    'регистрационный индекс',
    'место составления или издания',
    'текст документа',
    'подпись',
  ],
  /** Правила для протокола */
  protocol_rules: {
    title_case: 'uppercase', // название вида документа — прописными
    numbering: 'sequential_per_year',
    required_sections: ['СЛУШАЛИ', 'ВЫСТУПИЛИ', 'РЕШИЛИ'],
  },
  /** Правила для приказа / решения */
  order_rules: {
    title_case: 'uppercase',
    numbering: 'sequential_per_year',
  },
} as const;
