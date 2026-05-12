// ============================================================================
// document-scenario-resolver.ts (backend)
// ----------------------------------------------------------------------------
// Backend mirror of src/utils/resolveDocumentScenario.ts.
// Keep logic in sync. Do not diverge.
//
// Канон контракта: tariff_offers.meta.document_scenarios[]
// (см. mem://architecture/documents/document-scenarios-sot).
// Legacy-поле `payment_methods` читается, но не пишется.
// ============================================================================

import type { PaymentChannel } from './document-resolver-v2/payment-channel.ts';

export type PayerType = 'individual' | 'legal_entity';

export interface DocumentScenario {
  id: string;
  payer_type: PayerType;
  payment_channels: PaymentChannel[];
  template_id: string | null;
  executor_id: string | null;
  requires_required_requisites: boolean;
  is_enabled: boolean;
}

export interface RawScenario {
  id?: string;
  payer_type?: string;
  payment_channels?: string[] | null;
  payment_methods?: string[] | null;
  template_id?: string | null;
  executor_id?: string | null;
  requires_required_requisites?: boolean;
  is_enabled?: boolean;
}

function normalizeScenario(raw: RawScenario, idx: number): DocumentScenario {
  const channels = (raw.payment_channels ?? raw.payment_methods ?? []) as string[];
  return {
    id: raw.id || `idx_${idx}`,
    payer_type: (raw.payer_type as PayerType) || 'individual',
    payment_channels: channels as PaymentChannel[],
    template_id: raw.template_id || null,
    executor_id: raw.executor_id || null,
    requires_required_requisites: raw.requires_required_requisites === true,
    is_enabled: raw.is_enabled !== false,
  };
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

export function resolveDocumentScenario(
  meta: OfferMetaForResolver | null | undefined,
  channel: PaymentChannel | null,
  payerType: PayerType,
): ResolvedScenario {
  const rawList = Array.isArray(meta?.document_scenarios) ? meta!.document_scenarios! : [];
  const scenarios = rawList.map(normalizeScenario).filter((s) => s.is_enabled);

  const candidates = scenarios.filter((s) => {
    if (s.payer_type !== payerType) return false;
    if (s.payment_channels.length === 0) return true;
    if (!channel) return false;
    return s.payment_channels.includes(channel);
  });

  const specific = candidates.find((s) => s.payment_channels.length > 0);
  const match = specific || candidates[0] || null;

  if (match && (match.template_id || match.executor_id)) {
    return {
      source: 'scenario',
      scenario_id: match.id,
      payer_type: match.payer_type,
      template_id: match.template_id,
      executor_id: match.executor_id,
      requires_required_requisites: match.requires_required_requisites,
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
