import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {SalesRuntimeControls} from '@/components/admin/chat/SalesRuntimeControls';

const mocks=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mocks.invoke}}}));
vi.mock('@/hooks/useAdminAccess',()=>({useAdminAccess:()=>({canAccessSection:()=>true})}));
vi.mock('@/components/admin/chat/SalesKnowledgeEditor',()=>({SalesKnowledgeEditor:({campaignScope}:any)=><span data-testid="knowledge-scope">{campaignScope??'auto'}</span>}));
vi.mock('@/components/admin/chat/SalesScenarioPreview',()=>({SalesScenarioPreview:()=>null}));
vi.mock('sonner',()=>({toast:{success:vi.fn(),error:vi.fn()}}));

const source={page_id:'page-from-settings',block_id:'form-from-settings',label:'Предзапись · Форма 1'};
const route={id:'customer-campaign',page_id:source.page_id,block_id:source.block_id,trigger_phrase:'Фраза из настроек менеджера'};
const base={available:true,can_configure:true,can_edit_campaign:false,can_switch_test:true,questionnaire_sources:[source],customer_route:route,customer_mode:'off',
 campaign:{mode:'owner_test',knowledge_version:'verified-kb',trigger_phrase:'Тестовая фраза',delay_min_seconds:60,delay_max_seconds:180,followup_min_seconds:10,followup_max_seconds:15}};
function mount(){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 render(<QueryClientProvider client={client}><SalesRuntimeControls userId="owner" businessAccountId="business"/></QueryClientProvider>);return client;}
beforeEach(()=>{mocks.invoke.mockReset();mocks.invoke.mockResolvedValue({data:base,error:null});});
afterEach(()=>cleanup());

describe('existing sales controls configure the questionnaire route',()=>{
 it('saves server-selected page, form, exact previous route and knowledge version without enabling a campaign',async()=>{
  const client=mount();await screen.findByText('Автопродажи ЦБ21 · тест');
  fireEvent.click(screen.getByRole('button',{name:'Настройки задержки автопродаж'}));
  expect(screen.getByLabelText('Анкета клиентской кампании')).toHaveValue(`${source.page_id}|${source.block_id}`);
  fireEvent.change(screen.getByLabelText('Кодовая фраза клиентской кампании'),{target:{value:'Новая фраза от менеджера'}});
  fireEvent.click(screen.getByRole('button',{name:'Сохранить маршрут анкеты'}));
  await waitFor(()=>expect(mocks.invoke).toHaveBeenCalledWith('sales-runtime-control',expect.objectContaining({body:expect.objectContaining({
   action:'questionnaire_route',source_page_id:source.page_id,source_block_id:source.block_id,trigger_phrase:'Новая фраза от менеджера',expected_route:route,expected_knowledge_version:'verified-kb',
  })})));
  expect(mocks.invoke.mock.calls.some(([,args])=>args.body.action==='enable')).toBe(false);client.clear();
 });
 it('changes controller and knowledge editor to the selected customer campaign',async()=>{
  mocks.invoke.mockImplementation(async(_name,args)=>({error:null,data:args.body.campaign_scope==='questionnaire_customer'
   ? {...base,can_edit_campaign:true,campaign:{...base.campaign,mode:'off',source_page_id:source.page_id}}:base}));
  const client=mount();await screen.findByText('Автопродажи ЦБ21 · тест');
  fireEvent.click(screen.getByRole('button',{name:'Открыть клиентскую кампанию'}));
  await screen.findByText('Автопродажи ЦБ21 · клиенты');
  expect(mocks.invoke).toHaveBeenCalledWith('sales-runtime-control',expect.objectContaining({body:expect.objectContaining({action:'status',campaign_scope:'questionnaire_customer'})}));
  fireEvent.click(screen.getByRole('button',{name:'Настройки задержки автопродаж'}));
  expect(screen.getByTestId('knowledge-scope')).toHaveTextContent('questionnaire_customer');client.clear();
 });
 it('does not offer route edits while the customer campaign is enabled or configuration to staff',async()=>{
  mocks.invoke.mockResolvedValue({data:{...base,customer_mode:'questionnaire_customer'},error:null});
  const client=mount();await screen.findByText('Автопродажи ЦБ21 · тест');
  fireEvent.click(screen.getByRole('button',{name:'Настройки задержки автопродаж'}));
  expect(screen.getByRole('button',{name:'Сохранить маршрут анкеты'})).toBeDisabled();client.clear();cleanup();
  mocks.invoke.mockResolvedValue({data:{...base,can_configure:false,can_switch_test:false},error:null});
  const staff=mount();await screen.findByText('Автопродажи ЦБ21 · тест');
  expect(screen.queryByRole('button',{name:'Настройки задержки автопродаж'})).not.toBeInTheDocument();staff.clear();
 });
});
