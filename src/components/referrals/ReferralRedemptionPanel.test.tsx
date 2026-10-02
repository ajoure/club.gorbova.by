import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReferralRedemptionPanel } from './ReferralRedemptionPanel';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),allowed:true,success:vi.fn(),error:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mocks.rpc}}));
vi.mock('@/hooks/useRbac',()=>({useRbac:()=>({hasPermission:()=>mocks.allowed})}));
vi.mock('sonner',()=>({toast:{success:mocks.success,error:mocks.error}}));
const item={product_id:'product',product_name:'Тестовый продукт',tariff_id:'tariff',tariff_name:'Бизнес',offer_id:'offer',amount_minor:25000,recurring:{},eligible:true};
const quoted={quote_id:'immutable-quote',items:[{...item,price_minor:300000,starts_at:'2026-10-02T12:00:00Z',expires_at:'2027-10-02T12:00:00Z'}],total_minor:300000,internal_minor:177000,converted_cash_minor:118000,subsidy_minor:5000,balances:{internal:177000,available:118000},expires_at:'2026-10-02T12:10:00Z'};
const context={registered:true,balances:{internal:177000,available:118000},catalog:[item],permissions:{convert_cash:true,subsidy:true,override_catalog:true,reverse:true},provider_product_ids:[],history:[]};
const mount=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><ReferralRedemptionPanel partnerId="partner"/></QueryClientProvider>);
beforeEach(()=>{vi.clearAllMocks();mocks.allowed=true;mocks.rpc.mockImplementation(async(name:string)=>({data:name==='referral_admin_redemption_context'?context:quoted,error:null}));});
afterEach(cleanup);
async function openAndFill(){mount();await waitFor(()=>expect(screen.getByRole('button',{name:'Выдать продукты за бонусы'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Выдать продукты за бонусы'}));fireEvent.change(screen.getByLabelText('Продукт, тариф и предложение'),{target:{value:'offer'}});fireEvent.change(screen.getByLabelText('Основание выдачи и исключений'),{target:{value:'Согласованный обмен бонусов'}});}
describe('referral redemption confirmation',()=>{
 it('does not fetch privileged data without an explicit permission',()=>{mocks.allowed=false;mount();expect(mocks.rpc).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Выдать продукты за бонусы'})).not.toBeInTheDocument();});
 it('sends exact cash amount and consent, invalidates confirmation after edits',async()=>{
  await openAndFill();fireEvent.change(screen.getByLabelText('Перевести денежную часть в бонусы, BYN'),{target:{value:'1180,00'}});fireEvent.change(screen.getByLabelText('Подтверждение согласия клиента'),{target:{value:'Согласие клиента в CRM'}});fireEvent.click(screen.getByRole('checkbox',{name:/Покрыть недостающую/}));fireEvent.click(screen.getByRole('button',{name:'Рассчитать'}));
  await screen.findByText('Проверьте перед подтверждением');const call=mocks.rpc.mock.calls.find(([name])=>name==='referral_admin_quote_redemption');expect(call?.[1].p_request.cash_minor).toBe(118000);expect(call?.[1].p_request.consent_reference).toBe('Согласие клиента в CRM');expect(call?.[1].p_request.allow_subsidy).toBe(true);
  fireEvent.change(screen.getByLabelText('Количество месяцев или дней'),{target:{value:'6'}});expect(screen.queryByRole('button',{name:'Списать бонусы и выдать доступы'})).not.toBeInTheDocument();
 });
 it('retries the same immutable quote after lost response, then verifies the journal',async()=>{
  let attempts=0;let completed=false;mocks.rpc.mockImplementation(async(name:string)=>{
   if(name==='referral_admin_redemption_context')return {data:{...context,history:completed?[{id:quoted.quote_id,status:'completed',items:[],created_at:quoted.items[0].starts_at,internal_minor:177000,converted_cash_minor:118000,subsidy_minor:5000}]:[]},error:null};
   if(name==='referral_admin_commit_redemption'){completed=true;attempts++;return attempts===1?{data:null,error:new Error('network_response_lost')}:{data:{redemption_id:quoted.quote_id,status:'already_completed'},error:null};}
   return {data:quoted,error:null};
  });
  await openAndFill();fireEvent.click(screen.getByRole('button',{name:'Рассчитать'}));await screen.findByText('Проверьте перед подтверждением');fireEvent.click(screen.getByRole('button',{name:'Списать бонусы и выдать доступы'}));await waitFor(()=>expect(mocks.error).toHaveBeenCalled());await waitFor(()=>expect(screen.getByRole('button',{name:'Списать бонусы и выдать доступы'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Списать бонусы и выдать доступы'}));await waitFor(()=>expect(mocks.success).toHaveBeenCalled());
  expect(mocks.rpc.mock.calls.filter(([name])=>name==='referral_admin_commit_redemption').map(([,args])=>args)).toEqual([{p_quote_id:quoted.quote_id},{p_quote_id:quoted.quote_id}]);
  expect(mocks.rpc.mock.calls.filter(([name])=>name==='referral_admin_quote_redemption')).toHaveLength(1);
 });
});
