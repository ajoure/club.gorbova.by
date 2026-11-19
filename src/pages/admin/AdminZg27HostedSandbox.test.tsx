import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import AdminZg27HostedSandbox from './AdminZg27HostedSandbox';
const mock=vi.hoisted(()=>({invoke:vi.fn(),getSession:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mock.invoke},auth:{getSession:mock.getSession}}}));
vi.mock('@/components/layout/AdminLayout',()=>({AdminLayout:({children}:any)=><div>{children}</div>}));
const TOKEN='a'.repeat(64),KEY='zg27-sandbox-hosted-v1:actor-A',run={run_id:'12345678-1234-4234-8234-123456789abc',started_at:new Date().toISOString()};
const button=(name:string)=>screen.getByRole('button',{name});
beforeEach(()=>{localStorage.clear();sessionStorage.clear();mock.invoke.mockReset();mock.getSession.mockReset().mockResolvedValue({data:{session:{user:{id:'actor-A'},access_token:'private-jwt'}},error:null})});afterEach(()=>{cleanup();vi.restoreAllMocks()});
describe('hosted sandbox operator explicit stages',()=>{
  it('creates once, opens allowlisted button with no URL/token in DOM, separate H2H cursor',async()=>{
    sessionStorage.setItem('zg27-sandbox-test-run-v1:actor-A','old-h2h-cursor');const open=vi.fn();
    mock.invoke.mockImplementation(async(_name,{body})=>body.operation==='hosted_inspect'?{data:{operation:body.operation,case_id:body.case_id,status:'awaiting_customer',checkout_verified:true},error:null}:({data:{operation:body.operation,case_id:body.case_id,status:'hosted_ready',test_confirmed:true,checkout_token:TOKEN,checkout_url:`https://checkout.bepaid.by/v2/checkout?token=${TOKEN}`},error:null}));
    const view=render(<AdminZg27HostedSandbox actorId="actor-A" navigate={open}/>);fireEvent.click(button('Создать TEST checkout один раз'));fireEvent.click(button('Создать TEST checkout один раз'));
    await screen.findByText(/TEST checkout проверен/);expect(mock.invoke).toHaveBeenCalledOnce();expect(mock.invoke.mock.calls[0][1].headers.Authorization).toBe('Bearer private-jwt');
    fireEvent.click(button('Открыть TEST-виджет bePaid'));await waitFor(()=>expect(open).toHaveBeenCalledOnce());expect(open.mock.calls[0][0]).toBe(`https://checkout.bepaid.by/v2/checkout?token=${TOKEN}`);
    expect(document.body.textContent).not.toContain(TOKEN);expect(document.querySelector('a[href]')).toBeNull();expect(document.body.textContent).not.toContain('private-jwt');expect(sessionStorage.getItem('zg27-sandbox-test-run-v1:actor-A')).toBe('old-h2h-cursor');
    view.unmount();render(<AdminZg27HostedSandbox actorId="actor-A" navigate={open}/>);expect(screen.queryByRole('button',{name:'Создать TEST checkout один раз'})).not.toBeInTheDocument();expect(button('Открыть TEST-виджет bePaid')).toBeEnabled();
  });
  it('forged persisted checkout token cannot open widget without fresh server test proof',async()=>{
    const open=vi.fn();localStorage.setItem(KEY,JSON.stringify({...run,cases:{first_1:{stage:'ready',checkout_token:TOKEN}}}));
    mock.invoke.mockResolvedValue({data:{operation:'hosted_inspect',case_id:'first_1',status:'stopped',code:'checkout_unconfirmed',checkout_verified:false},error:null});
    render(<AdminZg27HostedSandbox actorId="actor-A" navigate={open}/>);fireEvent.click(button('Открыть TEST-виджет bePaid'));await screen.findByText(/Checkout не подтверждён/);expect(open).not.toHaveBeenCalled();expect(mock.invoke.mock.calls[0][1].body.operation).toBe('hosted_inspect');
  });
  it('only verified terminal plan unlocks the next case; inspect never auto-finishes',async()=>{
    localStorage.setItem(KEY,JSON.stringify({...run,cases:{first_1:{stage:'ready',checkout_token:TOKEN}}}));
    mock.invoke.mockImplementation(async(_,{body})=>({data:{operation:body.operation,case_id:body.case_id,status:'passed',test_confirmed:true,confirmed_payments:1,sum_minor:129000},error:null}));
    render(<AdminZg27HostedSandbox actorId="actor-A"/>);expect(button('Первое участие — платежей: 2')).toBeDisabled();fireEvent.click(button('Проверить hosted результат без оплаты'));
    await screen.findByText(/План подтверждён/);expect(button('Первое участие — платежей: 2')).toBeEnabled();expect(mock.invoke).toHaveBeenCalledOnce();expect(mock.invoke.mock.calls[0][1].body.operation).toBe('hosted_inspect');
  });
  it('finish persists before dispatch; unknown/remount cannot reopen finish even after first_verified',async()=>{
    localStorage.setItem(KEY,JSON.stringify({...run,cases:{first_1:{stage:'passed'},first_2:{stage:'first_verified',checkout_token:TOKEN}}}));
    mock.invoke.mockImplementation(async(_,{body})=>{expect(JSON.parse(localStorage.getItem(KEY)!).cases.first_2.finish_started).toBe(true);return {data:{operation:body.operation,case_id:body.case_id,status:'stopped',code:'provider_result_unknown'},error:null}});
    const view=render(<AdminZg27HostedSandbox actorId="actor-A"/>);fireEvent.click(button('Первое участие — платежей: 2'));fireEvent.click(button('Выполнить оставшиеся TEST-списания'));await screen.findByText(/Прогон остановлен/);
    expect(screen.queryByRole('button',{name:'Выполнить оставшиеся TEST-списания'})).not.toBeInTheDocument();view.unmount();
    mock.invoke.mockImplementation(async(_,{body})=>({data:{operation:body.operation,case_id:body.case_id,status:'first_verified',test_confirmed:true},error:null}));
    render(<AdminZg27HostedSandbox actorId="actor-A"/>);fireEvent.click(button('Первое участие — платежей: 2'));fireEvent.click(button('Проверить hosted результат без оплаты'));await screen.findByText(/Первый TEST-платёж подтверждён/);
    expect(screen.queryByRole('button',{name:'Выполнить оставшиеся TEST-списания'})).not.toBeInTheDocument();expect(button('Первое участие — платежей: 3')).toBeDisabled();
  });
  it('late completion after unmount leaves creating cursor for reconciliation, no next call',async()=>{
    let resolve!:(x:any)=>void;mock.invoke.mockImplementation(()=>new Promise(r=>{resolve=r}));const view=render(<AdminZg27HostedSandbox actorId="actor-A"/>);
    fireEvent.click(button('Создать TEST checkout один раз'));await waitFor(()=>expect(mock.invoke).toHaveBeenCalledOnce());view.unmount();
    await act(async()=>resolve({data:{operation:'hosted_create',case_id:'first_1',status:'hosted_ready',test_confirmed:true,checkout_token:TOKEN,checkout_url:`https://checkout.bepaid.by/v2/checkout?token=${TOKEN}`},error:null}));
    render(<AdminZg27HostedSandbox actorId="actor-A"/>);expect(screen.queryByRole('button',{name:'Создать TEST checkout один раз'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Открыть TEST-виджет bePaid'})).not.toBeInTheDocument();expect(mock.invoke).toHaveBeenCalledOnce();
  });
  it('fresh session actor mismatch blocks provider dispatch and widget opening',async()=>{
    mock.getSession.mockResolvedValue({data:{session:{user:{id:'actor-B'},access_token:'other'}},error:null});render(<AdminZg27HostedSandbox actorId="actor-A"/>);
    fireEvent.click(button('Создать TEST checkout один раз'));await screen.findByText(/Сессия изменилась: session_not_sent/);expect(mock.invoke).not.toHaveBeenCalled();
  });
  it('account change ignores late create response and cannot open previous actor token',async()=>{
    let resolve!:(x:any)=>void;mock.invoke.mockImplementation(()=>new Promise(r=>{resolve=r}));const view=render(<AdminZg27HostedSandbox key="actor-A" actorId="actor-A"/>);
    fireEvent.click(button('Создать TEST checkout один раз'));await waitFor(()=>expect(mock.invoke).toHaveBeenCalledOnce());
    mock.getSession.mockResolvedValue({data:{session:{user:{id:'actor-B'},access_token:'other'}},error:null});view.rerender(<AdminZg27HostedSandbox key="actor-B" actorId="actor-B"/>);
    await act(async()=>resolve({data:{operation:'hosted_create',case_id:'first_1',status:'hosted_ready',test_confirmed:true,checkout_token:TOKEN,checkout_url:`https://checkout.bepaid.by/v2/checkout?token=${TOKEN}`},error:null}));
    expect(screen.queryByRole('button',{name:'Открыть TEST-виджет bePaid'})).not.toBeInTheDocument();expect(localStorage.getItem('zg27-sandbox-hosted-v1:actor-B')).toBeNull();expect(mock.invoke).toHaveBeenCalledOnce();
  });

  it('manual new run archives unknown exact old bytes, creates fresh UUID and sends nothing',()=>{
    const old=JSON.stringify({...run,cases:{first_1:{stage:'unknown',code:'result_unknown',checkout_token:TOKEN,finish_started:true}}});localStorage.setItem(KEY,old);
    render(<AdminZg27HostedSandbox actorId="actor-A"/>);fireEvent.click(button('Начать новый отдельный TEST-прогон'));
    const fresh=JSON.parse(localStorage.getItem(KEY)!);expect(fresh.run_id).not.toBe(run.run_id);expect(fresh.cases).toEqual({});
    expect(localStorage.getItem(`zg27-sandbox-hosted-v1:archive:actor-A:${run.run_id}`)).toBe(old);expect(mock.invoke).not.toHaveBeenCalled();expect(button('Создать TEST checkout один раз')).toBeEnabled();
    expect(JSON.parse(localStorage.getItem(`zg27-sandbox-hosted-v1:archive:actor-A:${run.run_id}`)!).cases.first_1.stage).toBe('unknown');
  });
  it('local expired create and finish reject as not_sent before session/provider dispatch',async()=>{
    localStorage.setItem(KEY,JSON.stringify({...run,started_at:new Date(Date.now()-2*3600000).toISOString(),cases:{first_1:{stage:'new'}}}));
    const view=render(<AdminZg27HostedSandbox actorId="actor-A"/>);fireEvent.click(button('Создать TEST checkout один раз'));await screen.findByText(/Срок прогона истёк/);expect(mock.invoke).not.toHaveBeenCalled();expect(mock.getSession).not.toHaveBeenCalled();expect(JSON.parse(localStorage.getItem(KEY)!).cases.first_1.stage).toBe('new');
    view.unmount();localStorage.setItem(KEY,JSON.stringify({...run,started_at:new Date(Date.now()-2*3600000).toISOString(),cases:{first_1:{stage:'passed'},first_2:{stage:'first_verified',checkout_token:TOKEN}}}));
    render(<AdminZg27HostedSandbox actorId="actor-A"/>);fireEvent.click(button('Первое участие — платежей: 2'));fireEvent.click(button('Выполнить оставшиеся TEST-списания'));await screen.findByText(/Срок прогона истёк/);expect(mock.invoke).not.toHaveBeenCalled();expect(JSON.parse(localStorage.getItem(KEY)!).cases.first_2.finish_started).not.toBe(true);
  });
  it.each([400,401,403,503])('SDK HTTP%s is classified before-provider only for400/401/403',async status=>{
    mock.invoke.mockResolvedValue({data:null,error:{context:{status}}});render(<AdminZg27HostedSandbox actorId="actor-A"/>);fireEvent.click(button('Создать TEST checkout один раз'));
    await screen.findByText(status===503?/Результат неизвестен/:/Запрос не отправлен провайдеру/);const saved=JSON.parse(localStorage.getItem(KEY)!);
    expect(saved.cases.first_1.stage).toBe(status===503?'unknown':'new');expect(saved.cases.first_1.code).toBe(status===503?'result_unknown':`http_${status}_not_sent`);expect(mock.invoke).toHaveBeenCalledOnce();
  });

});
