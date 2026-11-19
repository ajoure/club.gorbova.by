import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';

type Offer = { offer_id: string; tariff_id: string; total_minor: number; amounts_minor: number[]; interval_days: 30 };
type Quote = { status: 'ready'; product_id: string; category: 'first' | 'repeat'; policy_version: 'zg27-v1'; offers: Offer[] }
  | { status: 'wrong_page'; page_slug: 'zg27pervoe' | 'zg27povtor' };
const money = (minor: number) => new Intl.NumberFormat('ru-BY', { style: 'currency', currency: 'BYN' }).format(minor / 100);
const messageFor = (code: string) => ({
  zg27_not_eligible: 'Участие доступно выпускникам ЦБ. Если вы уже проходили обучение, напишите в поддержку — проверим историю зачисления.',
  zg27_sale_closed: 'Приём оплат по этому предложению завершён.',
  zg27_login_required: 'Войдите в свой аккаунт, чтобы продолжить.',
  zg27_wrong_page: 'Для вашего аккаунта предусмотрена другая страница участия. Обновите страницу.',
}[code] || 'Не удалось подготовить оплату. Повторите проверку. Если ошибка сохраняется, напишите в поддержку.');

/** Category and exact kopeck schedule come exclusively from the authenticated server quote. */
export function Zg27PurchaseSection({ content }: { content: Record<string, unknown> }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const pageSlug = typeof content.page_slug === 'string' ? content.page_slug : '';
  const [selectedId, setSelectedId] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [preparedToken, setPreparedToken] = useState<string | null>(null);
  const currentScope = `${user?.id ?? ''}:${pageSlug}`;
  const scopeRef = useRef({ scope: currentScope, generation: 0 });
  if (scopeRef.current.scope !== currentScope) scopeRef.current = { scope: currentScope, generation: scopeRef.current.generation + 1 };
  useEffect(() => () => { scopeRef.current = { scope: '', generation: scopeRef.current.generation + 1 }; }, []);
  const query = useQuery({
    queryKey: ['zg27-quote', user?.id, pageSlug],
    enabled: !!user && ['zg27pervoe', 'zg27povtor'].includes(pageSlug), retry: false, staleTime: 0,
    queryFn: async ({ queryKey, signal }): Promise<Quote> => {
      const expectedActor = queryKey[1];
      const { data: { session } } = await supabase.auth.getSession();
      if (!expectedActor || session?.user.id !== expectedActor) throw new Error('zg27_login_required');
      const { data, error } = await supabase.functions.invoke('zg27-public-quote', {
        body: { page_slug: pageSlug }, headers: { Authorization: `Bearer ${session.access_token}` }, signal,
      });
      if (error || data?.error) {
        let code = data?.error;
        if (!code && error?.context instanceof Response) code = (await error.context.json().catch(() => ({}))).error;
        throw new Error(code || 'zg27_quote_unavailable');
      }
      if (data?.status !== 'ready' && data?.status !== 'wrong_page') throw new Error('zg27_quote_unavailable');
      return data;
    },
  });
  useEffect(() => { setSelectedId(''); setConsent(false); setCheckoutError(''); setPreparedToken(null); setBusy(false); }, [user?.id, pageSlug]);
  const quote = query.data?.status === 'ready' ? query.data : null;
  const selected = quote?.offers.find((offer) => offer.offer_id === selectedId) ?? quote?.offers[0];
  async function prepareCheckout() {
    if (!selected || !quote || busy || (selected.amounts_minor.length > 1 && !consent)) return;
    if (preparedToken) { navigate(`/pay/${preparedToken}`); return; }
    const attemptGeneration = scopeRef.current.generation;
    setBusy(true); setCheckoutError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (scopeRef.current.generation !== attemptGeneration) return;
      if (!user?.id || session?.user.id !== user.id) throw new Error('zg27_login_required');
      const installment = selected.amounts_minor.length > 1;
      const { data, error } = await supabase.functions.invoke(installment ? 'public-create-installment-link' : 'zg27-create-full-link', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { product_id: quote.product_id, tariff_id: selected.tariff_id, offer_id: selected.offer_id, page_slug: pageSlug,
          ...(installment ? { zg27_consent: { accepted: true, policy_version: quote.policy_version,
            amounts_minor: selected.amounts_minor, interval_days: selected.interval_days, total_minor: selected.total_minor } } : {}) },
      });
      if (scopeRef.current.generation !== attemptGeneration) return;
      if (error || !data?.success || !/^[0-9a-f-]{36}$/i.test(data?.url_token || '')) {
        let code = data?.error;
        if (!code && error?.context instanceof Response) code = (await error.context.json().catch(() => ({}))).error;
        throw new Error(code || 'zg27_link_creation_failed');
      }
      setPreparedToken(data.url_token);
      navigate(`/pay/${data.url_token}`);
    } catch (error) { if (scopeRef.current.generation === attemptGeneration) setCheckoutError(messageFor(error instanceof Error ? error.message : '')); }
    finally { if (scopeRef.current.generation === attemptGeneration) setBusy(false); }
  }
  return <section id="zg27-payment" className="bg-background px-5 py-12 text-foreground scroll-mt-20" aria-labelledby="zg27-payment-title">
    <div className="mx-auto max-w-3xl space-y-6 rounded-2xl border p-5 sm:p-8">
      <h2 id="zg27-payment-title" className="text-2xl font-semibold">Участие в «Закрой год 2027»</h2>
      <p>Материалы и сопровождение — по 30 апреля 2027 года включительно.</p>
      {loading || (!!user && query.isPending) ? <p role="status">Проверяем условия участия…</p> : !user ? <>
        <p>Войдите в аккаунт, в котором вы проходили ЦБ. Мы проверим историю обучения и определим вашу стоимость участия.</p>
        <Button asChild><Link to={`/auth?redirectTo=${encodeURIComponent(location.pathname + '#zg27-payment')}`}>Войти и проверить стоимость</Link></Button>
      </> : query.isError ? <div role="alert" className="space-y-3"><p>{messageFor(query.error.message)}</p><Button variant="outline" onClick={() => query.refetch()}>Повторить проверку</Button></div>
      : query.data?.status === 'wrong_page' ? <>
        <p>Для вашего аккаунта доступны условия {query.data.page_slug === 'zg27povtor' ? 'повторного участия' : 'первого участия'}.</p>
        <Button asChild><Link to={`/${query.data.page_slug}#zg27-payment`}>Перейти к своим условиям</Link></Button>
      </> : quote && selected ? <>
        <p className="text-xl font-medium">{quote.category === 'repeat' ? 'Повторное участие' : 'Первое участие'}: {money(selected.total_minor)}</p>
        <fieldset className="space-y-3"><legend className="mb-3 font-medium">Выберите способ оплаты</legend>
          {quote.offers.map((offer) => <label key={offer.offer_id} className="flex cursor-pointer items-start gap-3 rounded-xl border p-4">
            <input type="radio" name="zg27-payment-plan" checked={selected.offer_id === offer.offer_id} disabled={busy || !!preparedToken}
              onChange={() => { setSelectedId(offer.offer_id); setConsent(false); setCheckoutError(''); }} className="mt-1" />
            <span>{offer.amounts_minor.length === 1 ? 'Оплатить сразу' : `В ${offer.amounts_minor.length} платежа без надбавки`}
              <span className="mt-1 block text-sm text-muted-foreground">{offer.amounts_minor.map(money).join(' + ')}{offer.amounts_minor.length > 1 ? '. Первый платёж сейчас, следующие — каждые 30 дней.' : ''}</span>
            </span>
          </label>)}
        </fieldset>
        {selected.amounts_minor.length > 1 && <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={consent} disabled={busy} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
          <span>Оформляю подписку на {selected.amounts_minor.length} автоматических платежа и разрешаю списания по графику: {selected.amounts_minor.map(money).join(' + ')}, всего {money(selected.total_minor)}. Первый платёж сейчас, следующие — каждые 30 дней. После последнего платежа списания прекращаются.</span>
        </label>}
        {checkoutError && <p role="alert" className="text-destructive">{checkoutError}</p>}
        <Button className="w-full sm:w-auto whitespace-normal h-auto min-h-11" onClick={prepareCheckout} disabled={busy || (selected.amounts_minor.length > 1 && !consent)}>
          {busy ? 'Готовим оплату…' : preparedToken ? 'Открыть подготовленную оплату' : `Перейти к оплате ${money(selected.amounts_minor[0])}`}
        </Button>
        <p className="text-sm text-muted-foreground">Доступ откроется после успешной оплаты. При оплате частями оставшиеся платежи сохраняются по согласованному графику.</p>
      </> : null}
    </div>
  </section>;
}
