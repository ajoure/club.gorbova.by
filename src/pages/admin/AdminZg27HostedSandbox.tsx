import { useLayoutEffect, useRef, useState } from 'react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
const CASES=['first_1','first_2','first_3','repeat_1','repeat_2','repeat_3'] as const;
type CaseId=typeof CASES[number];
type Stage='new'|'creating'|'ready'|'awaiting_customer'|'first_verified'|'finishing'|'unknown'|'passed'|'stopped';
type Item={stage:Stage;finish_started?:boolean;checkout_token?:string;code?:string;confirmed?:number;sum?:number};
type Run={run_id:string;started_at:string;cases:Partial<Record<CaseId,Item>>};
const AMOUNTS:Record<CaseId,number[]>={first_1:[129000],first_2:[64500,64500],first_3:[43000,43000,43000],repeat_1:[89000],repeat_2:[44500,44500],repeat_3:[29667,29667,29666]};
const PREFIX='zg27-sandbox-hosted-v1',TOKEN=/^[a-f0-9]{64}$/i;
function initial(actor:string):Run{
  try{const saved=JSON.parse(localStorage.getItem(`${PREFIX}:${actor}`)||'null');
    if(saved?.run_id&&saved?.started_at&&saved?.cases){for(const c of CASES){if(['creating','finishing'].includes(saved.cases[c]?.stage))saved.cases[c].stage='unknown'}return saved;}
  }catch{/* no card or private identity stored */}
  return {run_id:crypto.randomUUID(),started_at:new Date().toISOString(),cases:{}};
}
export default function AdminZg27HostedSandbox({actorId}:{actorId:string}){
  const [run,setRun]=useState(()=>initial(actorId)),[selected,setSelected]=useState<CaseId>('first_1'),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const running=useRef(false),generation=useRef(0),mounted=useRef(false),latest=useRef(run);latest.current=run;
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++}},[]);
  const item=run.cases[selected]??{stage:'new'};
  function persist(caseId:CaseId,next:Item){
    const updated={...latest.current,cases:{...latest.current.cases,[caseId]:next}};
    localStorage.setItem(`${PREFIX}:${actorId}`,JSON.stringify(updated));latest.current=updated;setRun(updated);
  }
  async function session(){const {data,error}=await supabase.auth.getSession();if(error||data.session?.user?.id!==actorId||!data.session?.access_token)throw Error('session_changed');return data.session.access_token;}
  async function action(operation:'hosted_create'|'hosted_inspect'|'hosted_finish_test'){
    if(running.current||!mounted.current)return;
    const caseId=selected,prior=latest.current.cases[caseId]??{stage:'new'};
    if(operation==='hosted_create'&&prior.stage!=='new'||operation==='hosted_finish_test'&&(prior.stage!=='first_verified'||prior.finish_started)||operation!=='hosted_create'&&!TOKEN.test(prior.checkout_token??''))return;
    running.current=true;setBusy(true);const epoch=++generation.current,active=()=>mounted.current&&generation.current===epoch;
    try{
      const jwt=await session();if(!active())return;
      if(operation!=='hosted_inspect')persist(caseId,{...prior,finish_started:operation==='hosted_finish_test'||prior.finish_started,stage:operation==='hosted_create'?'creating':'finishing'});
      const {data,error}=await supabase.functions.invoke('zg27-sandbox-acceptance',{headers:{Authorization:`Bearer ${jwt}`},body:{operation,run_id:run.run_id,started_at:run.started_at,case_id:caseId,
        ...(operation==='hosted_create'?{}:{checkout_token:prior.checkout_token})}});
      if(!active())return;await session();if(!active())return;
      if(error||data?.operation!==operation||data?.case_id!==caseId)throw Error('result_unknown');
      const code=typeof data.code==='string'&&/^[a-z_]{1,64}$/.test(data.code)?data.code:undefined;
      const values={...prior,finish_started:operation==='hosted_finish_test'||prior.finish_started,code,confirmed:Number.isSafeInteger(data.confirmed_payments)?data.confirmed_payments:undefined,sum:Number.isSafeInteger(data.sum_minor)?data.sum_minor:undefined};
      if(data.status==='hosted_ready'&&data.test_confirmed===true&&TOKEN.test(data.checkout_token??'')&&data.checkout_url===`https://checkout.bepaid.by/v2/checkout?token=${data.checkout_token}`){
        persist(caseId,{...values,stage:'ready',checkout_token:data.checkout_token});setNotice('TEST checkout проверен. Откройте платёжную страницу и используйте только публичную тестовую карту.');
      }else if(data.status==='passed'&&data.test_confirmed===true){persist(caseId,{...values,stage:'passed'});setNotice('План подтверждён: точное число TEST-платежей. Следующий план доступен.');}
      else if(data.status==='first_verified'&&data.test_confirmed===true){
        // An unknown mutating attempt can only be reconciled, never reopened for charging.
        persist(caseId,{...values,stage:prior.finish_started||['unknown','finishing','stopped'].includes(prior.stage)?'unknown':'first_verified'});setNotice('Первый TEST-платёж подтверждён.');
      }else if(data.status==='awaiting_customer'){persist(caseId,{...values,stage:prior.stage==='unknown'?'unknown':'awaiting_customer'});setNotice('Платёж ещё не завершён. Доступна только проверка результата.');}
      else{persist(caseId,{...values,stage:'stopped'});setNotice('Прогон остановлен. Повторная оплата отключена.');}
    }catch{if(active()){persist(caseId,{...prior,finish_started:operation==='hosted_finish_test'||prior.finish_started,stage:'unknown',code:'result_unknown'});setNotice('Результат неизвестен. Повторная отправка отключена; доступна только сверка.');}}
    finally{if(active()){running.current=false;setBusy(false)}}
  }
  async function openCheckout(){
    if(running.current||!TOKEN.test(item.checkout_token??''))return;
    running.current=true;setBusy(true);const epoch=++generation.current,active=()=>mounted.current&&epoch===generation.current;
    try{
      const jwt=await session();if(!active())return;
      const {data,error}=await supabase.functions.invoke('zg27-sandbox-acceptance',{headers:{Authorization:`Bearer ${jwt}`},body:{operation:'hosted_inspect',run_id:run.run_id,started_at:run.started_at,case_id:selected,checkout_token:item.checkout_token}});
      if(!active())return;await session();if(!active())return;
      if(error||data?.operation!=='hosted_inspect'||data?.case_id!==selected||data?.status!=='awaiting_customer'||data?.checkout_verified!==true){setNotice('Checkout не подтверждён или платёж уже обработан. Используйте проверку результата; окно оплаты не открыто.');return;}
      const tab=window.open(`https://checkout.bepaid.by/v2/checkout?token=${item.checkout_token}`,'_blank','noopener,noreferrer');
      if(!tab)setNotice('Открытие TEST-страницы запрошено. Если браузер заблокировал окно, разрешите всплывающие окна для этого сайта.');
    }catch{if(active())setNotice('Сессия или результат проверки изменились. Платёжная страница не открыта.');}
    finally{if(active()){running.current=false;setBusy(false)}}
  }
  return <AdminLayout><section className="mx-auto max-w-3xl space-y-4 p-4">
    <h1>ZG27 — hosted TEST-проверка</h1>
    <p>Только sandbox: 0 реальных денег. Заказы, пользователи и права не создаются. Первый платёж проходит через настоящий виджет bePaid; остальные TEST-платежи выполняются сразу вместо интервала 30 дней.</p>
    <div>{CASES.map((c,i)=><Button key={c} disabled={busy||CASES.slice(0,i).some(p=>run.cases[p]?.stage!=='passed')} onClick={()=>setSelected(c)}>{c.replace('first','Первое участие').replace('repeat','Повторное участие').replace('_',' — платежей: ')}</Button>)}</div>
    <p>TEST-график: {AMOUNTS[selected].map(n=>(n/100).toFixed(2)).join(' + ')} BYN. Первый платёж в виджете, остальные — автоматические TEST-списания по этому конечному графику. В рабочем договоре интервал 30 дней.</p>
    <p>Выбранный план: {selected}. Состояние: {item.stage}.{item.code&&` Код: ${item.code}.`}{item.confirmed!==undefined&&` Подтверждено платежей: ${item.confirmed}.`}{item.sum!==undefined&&` Сумма: ${(item.sum/100).toFixed(2)} BYN.`}</p>
    {item.stage==='new'&&<Button disabled={busy} onClick={()=>action('hosted_create')}>Создать TEST checkout один раз</Button>}
    {item.checkout_token&&<><Button disabled={busy||!['ready','awaiting_customer'].includes(item.stage)} onClick={openCheckout}>Открыть TEST-виджет bePaid</Button>
      <Button disabled={busy} onClick={()=>action('hosted_inspect')}>Проверить hosted результат без оплаты</Button></>}
    {item.stage==='first_verified'&&<Button disabled={busy} onClick={()=>action('hosted_finish_test')}>Выполнить оставшиеся TEST-списания</Button>}
    {item.stage==='unknown'&&!item.checkout_token&&<p>Ответ создания checkout неизвестен. Повторное создание запрещено; требуется отдельная сверка исходного запроса.</p>}
    <p role="status">{notice}</p>
  </section></AdminLayout>;
}
