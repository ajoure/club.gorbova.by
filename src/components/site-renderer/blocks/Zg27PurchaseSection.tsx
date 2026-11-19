import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { PaymentDialog } from '@/components/payment/PaymentDialog';
import { InlineAuthForm } from '@/components/auth/InlineAuthForm';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
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
export function Zg27PurchaseSection({ content, pageId }: { content: Record<string, unknown>; pageId?:string|null }) {
  const { user, loading } = useAuth();
  const [open,setOpen] = useState(false);
  const navigate = useNavigate();
  const pageSlug = typeof content.page_slug === 'string' ? content.page_slug : '';
  const [quotePageSlug,setQuotePageSlug] = useState(pageSlug);
  const [selectedId, setSelectedId] = useState('');
  const [consent, setConsent] = useState(false);
  const [consentScope,setConsentScope]=useState('');
  const [busy, setBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [preparedToken, setPreparedToken] = useState<string | null>(null);
  const currentScope = `${user?.id ?? ''}:${pageSlug}:${quotePageSlug}:${open}`;
  const validConsent=consent&&consentScope===currentScope;
  const scopeRef = useRef({ scope: currentScope, generation: 0 });
  if (scopeRef.current.scope !== currentScope) scopeRef.current = { scope: currentScope, generation: scopeRef.current.generation + 1 };
  useEffect(() => () => { scopeRef.current = { scope: '', generation: scopeRef.current.generation + 1 }; }, []);
  const query = useQuery({
    queryKey: ['zg27-quote', user?.id, quotePageSlug],
    enabled: open && !!user && ['zg27pervoe', 'zg27povtor'].includes(pageSlug), retry: false, staleTime: 0,
    queryFn: async ({ queryKey, signal }): Promise<Quote> => {
      const expectedActor = queryKey[1];
      const { data: { session } } = await supabase.auth.getSession();
      if (!expectedActor || session?.user.id !== expectedActor) throw new Error('zg27_login_required');
      const { data, error } = await supabase.functions.invoke('zg27-public-quote', {
        body: { page_slug: quotePageSlug }, headers: { Authorization: `Bearer ${session.access_token}` }, signal,
      });
      if (error || data?.error) {
        let code = data?.error;
        if (!code && error?.context instanceof Response) code = (await error.context.json().catch(() => ({}))).error;
        throw new Error(code || 'zg27_quote_unavailable');
      }
      if (data?.status==='wrong_page') {
        if(!['zg27pervoe','zg27povtor'].includes(data.page_slug))throw new Error('zg27_quote_unavailable');
      } else if(data?.status!=='ready'||data.product_id!=='e71c0dbb-baf2-4b6c-a950-bf0f728708af'
        ||!['first','repeat'].includes(data.category)||data.policy_version!=='zg27-v1'||!Array.isArray(data.offers)||data.offers.length!==3) {
        throw new Error('zg27_quote_unavailable');
      }
      return data;
    },
  });
  useEffect(() => { setQuotePageSlug(pageSlug); },[user?.id,pageSlug]);
  useEffect(() => { if(open && query.data?.status==='wrong_page')setQuotePageSlug(query.data.page_slug); },[open,query.data]);
  useEffect(() => {
    if(content.product_id!=='e71c0dbb-baf2-4b6c-a950-bf0f728708af'||!['zg27pervoe','zg27povtor'].includes(pageSlug))return;
    const onAction=(event:Event)=>{const detail=(event as CustomEvent).detail;
      if(pageId && detail?.sourcePageId!==pageId)return;
      if(detail?.action==='open-zg27-payment'&&(!detail.payload?.product_id||detail.payload.product_id===content.product_id))setOpen(true);};
    window.addEventListener('lovable:site-action',onAction);return()=>window.removeEventListener('lovable:site-action',onAction);
  },[content.product_id,pageSlug,pageId]);
  useEffect(() => { setSelectedId(''); setConsent(false); setCheckoutError(''); setPreparedToken(null); setBusy(false); }, [user?.id, pageSlug,open,quotePageSlug]);
  const quote = query.data?.status === 'ready' ? query.data : null;
  const selected = quote?.offers.find((offer) => offer.offer_id === selectedId) ?? quote?.offers[0];
  async function prepareCheckout() {
    if (!selected || !quote || busy || (selected.amounts_minor.length > 1 && !validConsent)) return;
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
        body: { product_id: quote.product_id, tariff_id: selected.tariff_id, offer_id: selected.offer_id, page_slug: quote.category==='first'?'zg27pervoe':'zg27povtor',
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
  const checkoutContent=<>
      <p>Материалы и сопровождение — по 30 апреля 2027 года включительно.</p>
      {loading || (!!user && query.isPending) ? <p role="status">Проверяем условия участия…</p> : !user ? <>
        <p>Войдите в аккаунт, в котором вы проходили ЦБ. Мы проверим историю обучения и определим вашу стоимость участия.</p>
        <InlineAuthForm defaultTab="login" contextNote="Войдите в аккаунт участника ЦБ" onAuthenticated={async()=>{await query.refetch()}}/>
      </> : query.isError ? <div role="alert" className="space-y-3"><p>{messageFor(query.error.message)}</p><Button variant="outline" onClick={() => query.refetch()}>Повторить проверку</Button></div>
      : query.data?.status === 'wrong_page' ? <p role="status">Проверяем доступные вам условия…</p> : quote && selected ? <>
        <p className="text-xl font-medium">{quote.category === 'repeat' ? 'Повторное участие' : 'Первое участие'}: {money(selected.total_minor)}</p>
        <RadioGroup aria-label="Выберите способ оплаты" value={selected.offer_id} disabled={busy||!!preparedToken}
          onValueChange={(value)=>{setSelectedId(value);setConsent(false);setCheckoutError('')}}>
          {quote.offers.map(offer=><label key={offer.offer_id} className="flex cursor-pointer items-start gap-3 rounded-xl border p-4">
            <RadioGroupItem value={offer.offer_id} aria-label={offer.amounts_minor.length===1?'Оплатить сразу':`В ${offer.amounts_minor.length} платежа без надбавки`}/>
            <span>{offer.amounts_minor.length===1?'Оплатить сразу':`В ${offer.amounts_minor.length} платежа без надбавки`}
              <span className="mt-1 block text-sm text-muted-foreground">{offer.amounts_minor.map(money).join(' + ')}{offer.amounts_minor.length>1?'. Первый платёж сейчас, следующие — каждые 30 дней.':''}</span>
            </span>
          </label>)}
        </RadioGroup>
        {selected.amounts_minor.length > 1 && <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={validConsent} disabled={busy} onCheckedChange={value=>{setConsentScope(currentScope);setConsent(value===true)}} aria-label="Согласие на автоматические платежи"/>
          <span>Оформляю подписку на {selected.amounts_minor.length} автоматических платежа и разрешаю списания по графику: {selected.amounts_minor.map(money).join(' + ')}, всего {money(selected.total_minor)}. Первый платёж сейчас, следующие — каждые 30 дней. После последнего платежа списания прекращаются.</span>
        </label>}
        {checkoutError && <p role="alert" className="text-destructive">{checkoutError}</p>}
        <Button className="w-full sm:w-auto whitespace-normal h-auto min-h-11" onClick={prepareCheckout} disabled={busy || (selected.amounts_minor.length > 1 && !validConsent)}>
          {busy ? 'Готовим оплату…' : preparedToken ? 'Открыть подготовленную оплату' : `Перейти к оплате ${money(selected.amounts_minor[0])}`}
        </Button>
        <p className="text-sm text-muted-foreground">Доступ откроется после подтверждения оплаты, а при рассрочке — после оформления подписки с автоматическими платежами.</p>
      </> : null}
  </>;
  return <PaymentDialog open={open} onOpenChange={setOpen} productId="e71c0dbb-baf2-4b6c-a950-bf0f728708af"
    productName="Участие в «Закрой год 2027»" price="" zg27CheckoutContent={checkoutContent}/>;
}
