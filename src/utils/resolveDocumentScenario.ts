// ============================================================================
// resolveDocumentScenario.ts (frontend)
// ----------------------------------------------------------------------------
// Shared резолвер сценария документа по (payer_type, payment_channel).
// Канон контракта: tariff_offers.meta.document_scenarios[] (см.
// mem://architecture/documents/document-scenarios-sot).
//
// Поддерживает legacy-поле `payment_methods` (read-only): новые записи
// сохраняются только как `payment_channels`.
//
// Backend mirror: supabase/functions/_shared/document-scenario-resolver.ts.
// Keep logic in sync. Do not diverge.
// ============================================================================

import type { PaymentChannel } from './derivePaymentChannel';

export type PayerType = 'individual' | 'entrepreneur' | 'legal_entity';

/** RU-лейблы (SOT для UI). */
export const PAYER_TYPE_LABELS_RU: Record<PayerType, string> = {
  individual: 'Физлицо',
  entrepreneur: 'ИП',
  legal_entity: 'Юрлицо',
};

export interface DocumentScenario {
  id: string;
  payer_type: PayerType;
  /** Канонический список каналов; пустой массив = «любой канал». */
  payment_channels: PaymentChannel[];
  template_id: string | null;
  executor_id: string | null;
  requires_required_requisites?: boolean;
  is_enabled: boolean;
}

/** Legacy-форма: то, что фактически лежит в БД у части офферов. */
export interface RawScenario {
  id?: string;
  payer_type?: PayerType | string;
  payment_channels?: string[] | null;
  payment_methods?: string[] | null; // legacy
  template_id?: string | null;
  executor_id?: string | null;
  requires_required_requisites?: boolean;
  is_enabled?: boolean;
}

export function normalizeScenario(raw: RawScenario, fallbackId = ''): DocumentScenario {
  const channels = (raw.payment_channels ?? raw.payment_methods ?? []) as string[];
  return {
    id: raw.id || fallbackId || cryptoRandomId(),
    payer_type: (raw.payer_type as PayerType) || 'individual',
    payment_channels: channels as PaymentChannel[],
    template_id: raw.template_id || null,
    executor_id: raw.executor_id || null,
    requires_required_requisites: raw.requires_required_requisites === true,
    // По умолчанию включён (legacy записи без флага считаем активными).
    is_enabled: raw.is_enabled !== false,
  };
}

function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `scn_${Math.random().toString(36).slice(2, 10)}`;
}

export type ResolveSource = 'scenario' | 'defaults' | 'none';

export interface ResolvedScenario {
  source: ResolveSource;
  scenario_id: string | null;
  payer_type: PayerType | null;
  template_id: string | null;
  executor_id: string | null;
  requires_required_requisites: boolean;
  matched_channel: PaymentChannel | null;
}

export interface OfferMetaForResolver {
  document_scenarios?: RawScenario[] | null;
  document_defaults?: {
    template_id?: string | null;
    executor_id?: string | null;
  } | null;
}

/**
 * Алгоритм:
 *   1. Из meta.document_scenarios берём только is_enabled !== false.
 *   2. Совпадение: payer_type === payerType
 *      AND (payment_channels пустой ИЛИ содержит channel).
 *      При пустом списке каналов сценарий матчится для любого channel.
 *   3. Если найдено несколько — берём первый с непустым списком каналов
 *      (более специфичный), иначе любой первый.
 *   4. Иначе fallback на document_defaults (template_id/executor_id).
 *   5. Иначе source='none'.
 */
export function resolveDocumentScenario(
  meta: OfferMetaForResolver | null | undefined,
  channel: PaymentChannel | null,
  payerType: PayerType,
): ResolvedScenario {
  const rawList = Array.isArray(meta?.document_scenarios) ? meta!.document_scenarios! : [];
  const scenarios = rawList
    .map((raw, i) => normalizeScenario(raw, `idx_${i}`))
    .filter((s) => s.is_enabled);

  const candidates = scenarios.filter((s) => {
    if (s.payer_type !== payerType) return false;
    if (s.payment_channels.length === 0) return true;
    if (!channel) return false;
    return s.payment_channels.includes(channel);
  });

  // Приоритет — сценарий с непустым списком каналов (более специфичный).
  const specific = candidates.find((s) => s.payment_channels.length > 0);
  let match = specific || candidates[0] || null;

  // ИП-fallback: если для entrepreneur нет сценария — ищем сценарий ФЛ
  // (ИП традиционно подписывает по физлицу, если иное не задано явно).
  if (!match && payerType === 'entrepreneur') {
    const indCandidates = scenarios.filter((s) => {
      if (s.payer_type !== 'individual') return false;
      if (s.payment_channels.length === 0) return true;
      if (!channel) return false;
      return s.payment_channels.includes(channel);
    });
    match = indCandidates.find((s) => s.payment_channels.length > 0) || indCandidates[0] || null;
  }

  if (match && (match.template_id || match.executor_id)) {
    return {
      source: 'scenario',
      scenario_id: match.id,
      payer_type: match.payer_type,
      template_id: match.template_id,
      executor_id: match.executor_id,
      requires_required_requisites: match.requires_required_requisites === true,
      matched_channel: channel,
    };
  }

  const defs = meta?.document_defaults;
  if (defs && (defs.template_id || defs.executor_id)) {
    return {
      source: 'defaults',
      scenario_id: null,
      payer_type: null,
      template_id: defs.template_id || null,
      executor_id: defs.executor_id || null,
      requires_required_requisites: false,
      matched_channel: channel,
    };
  }

  return {
    source: 'none',
    scenario_id: null,
    payer_type: null,
    template_id: null,
    executor_id: null,
    requires_required_requisites: false,
    matched_channel: channel,
  };
}

export function sourceLabelRu(source: ResolveSource): string {
  if (source === 'scenario') return 'По сценарию кнопки';
  if (source === 'defaults') return 'По умолчанию';
  return 'Источник не задан';
}
