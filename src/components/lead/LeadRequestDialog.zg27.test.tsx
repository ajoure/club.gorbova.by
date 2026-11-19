import {render,screen,fireEvent,waitFor,cleanup,act} from '@testing-library/react';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import {LeadRequestDialog} from './LeadRequestDialog';
const m=vi.hoisted(()=>({user:{id:'a'},start:vi.fn(),rpc:vi.fn(),url:vi.fn(),error:vi.fn()}));
vi.mock('@/contexts/AuthContext',()=>({useAuth:()=>({user:m.user,session:{user:{id:m.user.id,email:'synthetic@example.invalid'}}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:m.rpc,from:()=>{const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{full_name:'Synthetic',phone:'123456789'}})};return q}}}));
vi.mock('@/lib/startBankInstallment',()=>({startBankInstallment:(...a:any[])=>m.start(...a)}));
vi.mock('@/utils/accessAlias',()=>({getAccessAwareUrl:(...a:any[])=>m.url(...a)}));
vi.mock('sonner',()=>({toast:{error:(...a:any[])=>m.error(...a),success:vi.fn()}}));
vi.mock('@/hooks/useComposableQuoteSummary',()=>({useComposableQuoteSummary:()=>({items:[],total:null})}));
vi.mock('@/hooks/useTelegramLink',()=>({useTelegramLinkStatus:()=>({data:null,refetch:vi.fn()})}));
vi.mock('@/components/telegram/TelegramCompactCard',()=>({TelegramCompactCard:()=>null}));
const props={open:true,onOpenChange:vi.fn(),offerId:'bank',bankInstallmentRuntime:{enabled:true,provider:'rr' as const},bankLinkUrl:'https://synthetic.invalid/legacy',strictBankCheckout:true};
afterEach(cleanup);beforeEach(()=>{vi.clearAllMocks();m.user={id:'a'}});
async function submit(){const phone=await screen.findByLabelText('Телефон заявителя *');await waitFor(()=>expect(phone).toHaveValue('123456789'));await act(async()=>{fireEvent.submit(phone.closest('form')!)})}
describe('scoped bank dialog retains real existing form without legacy fallback',()=>{
 it('failed RR request stays in form, never reads credits or opens shared static link',async()=>{
  m.start.mockRejectedValue(Error('synthetic failure'));render(<LeadRequestDialog {...props}/>);await submit();await waitFor(()=>expect(m.error).toHaveBeenCalled());
  expect(m.start).toHaveBeenCalledWith(expect.objectContaining({expectedUserId:'a',customerCreditRequestedMinor:0}));expect(m.rpc).not.toHaveBeenCalled();expect(m.url).not.toHaveBeenCalled();expect(screen.getByLabelText('Телефон заявителя *')).toHaveValue('123456789');
 });
 it('ignores late bank redirect after account switch',async()=>{
  let resolve:any;m.start.mockReturnValue(new Promise(r=>resolve=r));const v=render(<LeadRequestDialog {...props}/>);await submit();await waitFor(()=>expect(m.start).toHaveBeenCalledOnce());
  m.user={id:'b'};v.rerender(<LeadRequestDialog {...props}/>);await act(async()=>resolve({mode:'runtime',paymentUrl:'https://synthetic.invalid/owned-a'}));expect(m.url).not.toHaveBeenCalled();
 });
});
