import { resolveSectionAccess, type AiAccessStatusUi } from '../_shared/ai-access.ts';

/** Add-only projection using the existing managed section gate. Kept local to
 * AI status so introducing this mode does not change the CB21 runtime bundle. */
export async function withRegulationsAccess(service: any, userId: string, status: AiAccessStatusUi): Promise<AiAccessStatusUi> {
  if (!status.allowed_scenarios.some(s => s.code === 'accounting_regulations')) return status;
  const allowed = await resolveSectionAccess(service, userId, 'ai_accounting_regulations');
  return {
    ...status,
    allowed_scenarios: status.allowed_scenarios.map(s => s.code === 'accounting_regulations'
      ? { code: s.code, allowed, denial_reason: allowed ? undefined : 'accounting_regulations_not_in_products' } : s),
    allowed_modes: { ...status.allowed_modes, prompt: allowed || status.allowed_scenarios.some(s => s.code !== 'accounting_regulations' && s.allowed) },
    denial_reasons: { ...status.denial_reasons, accounting_regulations_not_in_products: 'Сервис «Регламенты бухгалтерии» не входит в ваши активные продукты.' },
  };
}
