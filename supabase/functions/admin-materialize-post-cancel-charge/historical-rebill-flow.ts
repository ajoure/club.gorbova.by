// Keep the unrelated shared/CB21 release untouched. Only the bePaid entry
// points adopt this guard; the ordinary engine and adapters remain canonical.
export * from '../_shared/rebill/rebill_flow.ts';
import { runRebillFlow as canonicalFlow, type RebillFlowDeps, type RebillFlowInput, type RebillFlowResult } from '../_shared/rebill/rebill_flow.ts';
import { buildRebillDepsAdapter as canonicalDeps } from '../_shared/rebill/rebill_deps_adapter.ts';
import { inspectHistoricalReceipt, type HistoricalReceiptDecision } from './historical-receipt-guard.ts';

type HistoricalDeps = RebillFlowDeps & { inspectHistoricalReceipt?: (uid: string) => Promise<HistoricalReceiptDecision> };

export function buildRebillDepsAdapter(db: Parameters<typeof canonicalDeps>[0]): HistoricalDeps {
  return { ...canonicalDeps(db), inspectHistoricalReceipt: uid => inspectHistoricalReceipt(db, uid) };
}

export async function runRebillFlow(deps: HistoricalDeps, input: RebillFlowInput): Promise<RebillFlowResult> {
  const historical = await deps.inspectHistoricalReceipt?.(input.payment.uid);
  if (historical?.kind === 'preserved') return { decision: 'resumed_repoint_only', mode: input.mode,
    proceedLegacy: false, rebill_order_id: historical.orderId, reason: 'historical_receipt_preserved' };
  if (historical?.kind === 'hold') return { decision: 'conflict_uid', mode: input.mode,
    proceedLegacy: false, reason: historical.reason };
  return canonicalFlow(deps, input);
}
