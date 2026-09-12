// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {SalesKnowledgeEditor} from './SalesKnowledgeEditor';
const mock=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:mock.invoke}}}));
const fact={id:'topic-1',title:'Деньги',text:'Разбираем наличные и безналичные расчёты.',source_id:'source-1',source_revision:'old-source-revision',source_sha256:'old-source-sha',module_id:'module-1',binding_block_id:'block-1'};
const snapshot={facts:[fact],knowledge_version:'version-1',facts_sha256:'before-sha',product_id:'product-1',versions:[],sources:[{id:'source-1',title:'Деньги — видеолекция',ready:true,source_revision:'current-source-revision',source_sha256:'current-source-sha',targets:[{block_id:'block-1',module_id:'module-1',title:'Деньги',open_now:false,in_product:true}]}]};
const preview={valid:true,errors:[],facts_sha256:'reviewed-sha',added:0,changed:1,removed:0,unchanged:0};
beforeEach(()=>{mock.invoke.mockReset();mock.invoke.mockImplementation(async(_,req)=>({data:req.body.action==='knowledge_status'?snapshot:req.body.action==='knowledge_apply'?{...preview,applied:true}:preview}))});
afterEach(cleanup);
async function open(editable=true){render(<SalesKnowledgeEditor userId="user-1" businessAccountId="business-1" editable={editable}/>);fireEvent.click(screen.getByRole('button',{name:'Открыть базу знаний'}));await screen.findByText('База знаний: 1 описаний')}
it('shows future-program membership separately from closed lesson and hides technical references',async()=>{
 await open();expect(screen.getByText(/В составе продаваемого продукта.*Урок сейчас закрыт/)).toBeTruthy();
 expect(screen.queryByText('source-1')).toBeNull();expect(screen.queryByText('version-1')).toBeNull();
});
it('requires exact preview confirmation and submits only the scoped knowledge operation',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:'Деньги'}));fireEvent.change(screen.getByLabelText('Описание 1'),{target:{value:'Новое описание тем урока.'}});
 fireEvent.click(screen.getByRole('button',{name:'Проверить изменения'}));const save=await screen.findByRole('button',{name:'Сохранить проверенную версию'});expect((save as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(save);await screen.findByText('Версия сохранена. Автопродажи остаются выключенными.');
 const request=mock.invoke.mock.calls.find(([,req])=>req.body.action==='knowledge_apply')![1].body;
 expect(request).toMatchObject({user_id:'user-1',business_account_id:'business-1',expected_knowledge_version:'version-1',expected_facts_sha:'before-sha',approved_facts_sha:'reviewed-sha'});
 expect(request.facts[0].text).toBe('Новое описание тем урока.');expect(mock.invoke.mock.calls.some(([,req])=>req.body.action==='enable')).toBe(false);
});
it('changing text invalidates the reviewed fingerprint and confirmation',async()=>{
 await open();fireEvent.click(screen.getByRole('button',{name:'Деньги'}));fireEvent.click(screen.getByRole('button',{name:'Проверить изменения'}));await screen.findByRole('checkbox');fireEvent.click(screen.getByRole('checkbox'));
 fireEvent.change(screen.getByLabelText('Описание 1'),{target:{value:'Другая версия.'}});expect(screen.queryByRole('button',{name:'Сохранить проверенную версию'})).toBeNull();
});
it('imports drafts without rewriting stale source hashes or automatically saving',async()=>{
 await open();const packet={target_product_id:'product-1',facts:[{...fact,text:'Описание из подготовленного пакета.'}]};
 fireEvent.change(screen.getByLabelText('Пакет описаний'),{target:{files:[{size:100,text:async()=>JSON.stringify(packet)}]}});
 await screen.findByText(/Пакет загружен в черновик/);fireEvent.click(screen.getByRole('button',{name:'Проверить изменения'}));await screen.findByRole('checkbox');
 const request=mock.invoke.mock.calls.find(([,req])=>req.body.action==='knowledge_preview')![1].body;
 expect(request.facts[0].source_revision).toBe('old-source-revision');expect(request.facts[0].source_sha256).toBe('old-source-sha');
 expect(mock.invoke.mock.calls.some(([,req])=>req.body.action==='knowledge_apply')).toBe(false);
});
it('read-only mode prevents editing or applying and a failed preview cannot be saved',async()=>{
 await open(false);fireEvent.click(screen.getByRole('button',{name:'Деньги'}));expect((screen.getByLabelText('Описание 1') as HTMLTextAreaElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'Проверить изменения'}) as HTMLButtonElement).disabled).toBe(true);
 cleanup();await open();mock.invoke.mockRejectedValueOnce(Error('Ошибка проверки'));fireEvent.click(screen.getByRole('button',{name:'Проверить изменения'}));await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Сохранить проверенную версию'})).toBeNull();
});
