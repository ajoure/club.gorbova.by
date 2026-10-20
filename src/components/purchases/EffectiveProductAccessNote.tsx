import { formatInTimeZone } from 'date-fns-tz';
import { CB2_PRODUCT_ID, cb2AccessSourceLabel } from '@/lib/cb2Access';
import { useCb2AccessWindow } from '@/hooks/useCb2AccessWindow';

export function EffectiveProductAccessNote({ userId, productId }: { userId?: string | null; productId?: string | null }) {
  const active = productId === CB2_PRODUCT_ID && !!userId;
  const { data, isPending, isError } = useCb2AccessWindow(userId, active);
  if (!active) return null;
  return <div data-testid="cb2-effective-access" className="min-w-0 max-w-full rounded-md bg-muted/50 px-3 py-2 text-xs sm:text-sm break-words" aria-live="polite">
    {isPending ? 'Срок доступа уточняется…' : isError ? 'Не удалось уточнить срок доступа. Обновите страницу.' : !data?.has_access ? 'Срок доступа к курсу завершён' : <>
      <span className="font-medium">Доступ к курсу: {data.effective_end_at ? `до ${formatInTimeZone(data.effective_end_at, 'Europe/Minsk', 'dd.MM.yyyy, HH:mm')} (Минск)` : 'бессрочно'}</span>
      <span className="block text-muted-foreground">{cb2AccessSourceLabel(data.source_kind)}</span>
    </>}
  </div>;
}
