// PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B — generation status (read-only).
//
// Pure resolver: classifies generation availability from facts already in memory.
// Does NOT call canonical-document-generate-strict / -regenerate / -hook.
// Does NOT allocate document numbers. Does NOT write audit.
//
// If a future caller wants to attach the real scenario resolver, it must pass
// a read-only `scenarioProbe` that has been proven side-effect-free. Until that
// integration lands (Approve D and beyond), `scenarioProbe` is intentionally
// omitted and `scenario_found` defaults to false.

import type { GenerationCode, GenerationInfo, InternalDocument } from './types.ts';

export interface GenerationFacts {
  order_id: string | null;
  is_refund: boolean;
  stripe_account_resolved: boolean | null; // null = not applicable (bepaid)
  internal_documents: InternalDocument[];
  scenario_found?: boolean;
  scenario_in_progress?: boolean;
  scenario_failed?: boolean;
  missing_requisites?: boolean;
}

export function classifyGeneration(facts: GenerationFacts): GenerationInfo {
  let blocked: GenerationCode | null = null;
  const sf = !!facts.scenario_found;

  if (facts.is_refund) blocked = 'REFUND_USES_PARENT_DOCUMENTS';
  else if (!facts.order_id) blocked = 'PAYMENT_NOT_LINKED_TO_ORDER';
  else if (facts.stripe_account_resolved === false) blocked = 'STRIPE_ACCOUNT_NOT_RESOLVED';
  else if (!sf) blocked = 'NO_DOCUMENT_SCENARIO';
  else if (facts.internal_documents.length > 0 && facts.internal_documents.some((d) => d.status === 'ready' || d.status === 'sent' || d.status === 'generated'))
    blocked = 'DOCUMENT_ALREADY_GENERATED';
  else if (facts.scenario_in_progress) blocked = 'GENERATION_IN_PROGRESS';
  else if (facts.scenario_failed) blocked = 'GENERATION_FAILED';
  else if (facts.missing_requisites) blocked = 'MISSING_REQUIRED_REQUISITES';

  return {
    scenario_found: sf,
    can_generate: sf && blocked === null,
    blocked_reason: blocked,
  };
}
