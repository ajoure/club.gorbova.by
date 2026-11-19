import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { SitePageRenderer } from '@/components/site-renderer/SitePageRenderer';
import { PaymentDialog } from '@/components/payment/PaymentDialog';
import { HtmlIframePreview } from '@/components/shared/HtmlIframePreview';
import { Zg27PurchaseSection } from './Zg27PurchaseSection';

const mock = vi.hoisted(() => ({ user: null as any, invoke: vi.fn(), getSession: vi.fn(), legacyQuote:vi.fn(), inlineAuth:vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user, loading: false }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke: mock.invoke }, auth: { getSession: mock.getSession } } }));
vi.mock('@/hooks/useComposableQuoteSummary',()=>({useComposableQuoteSummary:(...args:any[])=>mock.legacyQuote(...args)}));
vi.mock('@/hooks/usePermissions',()=>({usePermissions:()=>({isAdmin:false,isSuperAdmin:false})}));
vi.mock('@/hooks/useTelegramLink',()=>({useTelegramLinkStatus:()=>({isLinked:true,isLoading:false}),useStartTelegramLink:()=>({})}));
vi.mock('@/components/auth/InlineAuthForm',()=>({InlineAuthForm:(props:any)=>{mock.inlineAuth(props);return <div>Каноническая форма входа</div>}}));
const content = { product_id: 'e71c0dbb-baf2-4b6c-a950-bf0f728708af', page_slug: 'zg27povtor' };
const quote = { status: 'ready', category: 'repeat', policy_version: 'zg27-v1', product_id: content.product_id,
  offers: [[89000],[44500,44500],[29667,29667,29666]].map((amounts, i) => ({ offer_id: `offer-${i+1}`, tariff_id: 'tariff-repeat',
    amounts_minor: amounts, total_minor: 89000, interval_days: 30 })) };
function view() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function RouteProbe() { return <output data-testid="route">{useLocation().pathname}</output>; }
  const tree = () => <QueryClientProvider client={client}><MemoryRouter initialEntries={['/zg27povtor']} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Zg27PurchaseSection content={content} /><RouteProbe /></MemoryRouter></QueryClientProvider>;
  const result = render(tree()); act(()=>window.dispatchEvent(new CustomEvent('lovable:site-action',{detail:{action:'open-zg27-payment',payload:{}}}))); return { ...result, client, refresh: () => result.rerender(tree()) };
}
beforeEach(() => { mock.user = null; mock.invoke.mockReset();mock.inlineAuth.mockClear();mock.legacyQuote.mockReset().mockReturnValue({items:[],total:null}); mock.getSession.mockReset().mockImplementation(async () => ({ data: { session: mock.user ? { user: mock.user, access_token: 'synthetic' } : null } })); });
afterEach(cleanup);
describe('ZG27 purchase section commercial scenario', () => {
  it('renderer headless metadata ignores visual padding settings and adds no wrapper/layout block',()=>{
    mock.user={id:'user-a'};
    const v=render(<QueryClientProvider client={new QueryClient()}><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><SitePageRenderer pageId="page" blocks={[
      {id:'headless',type:'zg27_checkout',content,settings:{paddingTop:200,paddingBottom:200}} as any,
    ]}/></MemoryRouter></QueryClientProvider>);
    expect(v.container.querySelector('[data-block-id="headless"]')).toBeNull();expect(v.container.querySelector('section')).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(mock.invoke).not.toHaveBeenCalled();
  });
  it('has no visible DOM or quote until real iframe button bridge; closing leaves authored HTML unchanged',async()=>{
    mock.user={id:'user-a'};mock.invoke.mockResolvedValue({data:quote,error:null});
    const html='<button data-lovable-action="open-zg27-payment">Исходная кнопка</button>';
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const v=render(<QueryClientProvider client={client}><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><HtmlIframePreview html={html} pageId="page" blockId="html"/><Zg27PurchaseSection content={content} pageId="page"/></MemoryRouter></QueryClientProvider>);
    const frame=v.container.querySelector('iframe')!;const before=frame.getAttribute('srcdoc');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(v.container.querySelector('#zg27-payment')).toBeNull();expect(mock.invoke).not.toHaveBeenCalled();
    act(()=>window.dispatchEvent(new CustomEvent('lovable:site-action',{detail:{action:'open-zg27-payment',sourcePageId:'different-page',payload:{}}})));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(mock.invoke).not.toHaveBeenCalled();
    act(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'site-action',action:'open-zg27-payment',payload:{}},source:frame.contentWindow})));
    await screen.findByText(/Повторное участие:/);expect(screen.getByRole('dialog')).toHaveClass('backdrop-blur-2xl');expect(mock.legacyQuote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Close'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(frame.getAttribute('srcdoc')).toBe(before);
  });
  it('non-ZG products ignore scoped content override and retain existing dialog flow',()=>{
    mock.user=null;render(<QueryClientProvider client={new QueryClient()}><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><PaymentDialog open onOpenChange={()=>{}} productId="other-product" productName="Другой продукт" price="100" zg27CheckoutContent={<div>Недопустимое переопределение</div>}/></MemoryRouter></QueryClientProvider>);
    expect(screen.queryByText('Недопустимое переопределение')).not.toBeInTheDocument();expect(mock.legacyQuote).toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
  it('does not store a new actor quote in the previous actor query cache', async () => {
    let finish: (value: any) => void = () => {};
    mock.user = { id: 'user-a' };
    mock.getSession.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ data: { session: { user: { id: 'user-b' }, access_token: 'synthetic-b' } } });
    mock.invoke.mockResolvedValue({ data: quote, error: null });
    const v = view(); await waitFor(() => expect(mock.getSession).toHaveBeenCalledOnce());
    await act(async () => { mock.user = { id: 'user-b' }; v.refresh(); });
    await screen.findByText(/Повторное участие:/);
    await act(async () => { finish({ data: { session: { user: { id: 'user-b' }, access_token: 'synthetic-b' } } }); });
    expect(mock.invoke).toHaveBeenCalledOnce();
    expect(mock.invoke).toHaveBeenCalledWith('zg27-public-quote', expect.objectContaining({ headers: { Authorization: 'Bearer synthetic-b' } }));
    expect(v.client.getQueryData(['zg27-quote','user-a','zg27povtor'])).toBeUndefined();
    expect(v.client.getQueryData(['zg27-quote','user-b','zg27povtor'])).toEqual(quote);
  });
  it('ignores a late checkout link after switching to another account', async () => {
    let finish: (value: any) => void = () => {};
    mock.user = { id: 'user-a' }; mock.invoke.mockImplementation(async (name: string) => name === 'zg27-public-quote'
      ? { data: quote, error: null } : await new Promise(resolve => { finish = resolve; }));
    const v = view(); await screen.findByText(/Повторное участие:/);
    fireEvent.click(screen.getByRole('button', { name: /Перейти к оплате/ }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('zg27-create-full-link', expect.anything()));
    await act(async () => { mock.user = { id: 'user-b' }; v.refresh(); });
    await act(async () => { finish({ data: { success: true, url_token: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, error: null }); });
    expect(screen.getByTestId('route')).toHaveTextContent('/zg27povtor');
    expect(screen.queryByRole('button', { name: /Открыть подготовленную/ })).not.toBeInTheDocument();
  });
  it('anonymous stays in canonical inline auth inside existing payment dialog, no quote or route change',()=>{
    view();expect(screen.getByRole('dialog',{name:'Подтверждение оплаты'})).toBeInTheDocument();
    expect(screen.getByText('Каноническая форма входа')).toBeInTheDocument();expect(mock.inlineAuth).toHaveBeenCalled();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();expect(mock.invoke).not.toHaveBeenCalled();expect(mock.legacyQuote).not.toHaveBeenCalled();
    expect(screen.getByTestId('route')).toHaveTextContent('/zg27povtor');
  });
  it('shows canonical repeat schedule and requires explicit consent before creating a link', async () => {
    mock.user = { id: 'user-a' }; mock.invoke.mockImplementation(async (name: string) => ({ data: name === 'zg27-public-quote' ? quote : { error: 'synthetic_failure' }, error: null }));
    view(); await screen.findByText(/Повторное участие:/);
    fireEvent.click(screen.getByRole('radio', { name: /В 3 платежа/ }));
    const pay = screen.getByRole('button', { name: /Перейти к оплате/ }); expect(pay).toBeDisabled();
    expect(screen.getAllByText(/296,67.*296,67.*296,66/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox')); expect(pay).toBeEnabled(); fireEvent.click(pay);
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('public-create-installment-link', { headers: { Authorization: 'Bearer synthetic' }, body: {
      product_id: quote.product_id, tariff_id: 'tariff-repeat', offer_id: 'offer-3', page_slug: 'zg27povtor',
      zg27_consent: { accepted: true, policy_version: 'zg27-v1', amounts_minor: [29667,29667,29666], interval_days: 30, total_minor: 89000 },
    } }));
    await screen.findByRole('alert');
  });
  it('full payment uses hosted endpoint without any saved-card/MIT call', async () => {
    mock.user = { id: 'user-a' }; mock.invoke.mockImplementation(async (name: string) => ({ data: name === 'zg27-public-quote' ? quote : { error: 'synthetic_failure' }, error: null }));
    view(); await screen.findByText(/Повторное участие:/); fireEvent.click(screen.getByRole('button', { name: /Перейти к оплате/ }));
    await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('zg27-create-full-link', expect.anything()));
    expect(mock.invoke.mock.calls.some(([name]) => /saved-card|tokenize|direct-charge/.test(name))).toBe(false);
    await screen.findByRole('alert');
  });
  it('wrong-category page selects canonical conditions inside the same modal without navigation',async()=>{
    mock.user={id:'user-a'};mock.invoke.mockImplementation(async(_name:string,args:any)=>({data:args.body.page_slug==='zg27povtor'
      ?{status:'wrong_page',page_slug:'zg27pervoe'}:{...quote,category:'first',offers:quote.offers.map(o=>({...o,total_minor:129000,amounts_minor:o.amounts_minor.length===1?[129000]:o.amounts_minor.length===2?[64500,64500]:[43000,43000,43000]}))},error:null}));
    view();await screen.findByText(/Первое участие:/);expect(screen.queryByText(/Повторное участие:/)).not.toBeInTheDocument();
    expect(screen.getByTestId('route')).toHaveTextContent('/zg27povtor');expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/Перейти к оплате/}));
    await waitFor(()=>expect(mock.invoke).toHaveBeenCalledWith('zg27-create-full-link',expect.objectContaining({body:expect.objectContaining({page_slug:'zg27pervoe'})})));
    await screen.findByRole('alert');
  });
  it('logout removes prior account price and consent immediately', async () => {
    mock.user = { id: 'user-a' }; mock.invoke.mockResolvedValue({ data: quote, error: null });
    const v = view(); await screen.findByText(/Повторное участие:/);
    await act(async () => { mock.user = null; v.refresh(); });
    expect(screen.queryByText(/Повторное участие:/)).not.toBeInTheDocument();
    expect(screen.getByText('Каноническая форма входа')).toBeInTheDocument();
  });
});
