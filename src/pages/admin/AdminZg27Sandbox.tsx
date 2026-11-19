import { useAuth } from '@/contexts/AuthContext';
import { useLayoutEffect, useRef, useState } from 'react';
import { AdminLayout } from '@/components/layout/AdminLayout';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
const CASES=['first_1','first_2','first_3','repeat_1','repeat_2','repeat_3'] as const;
const LABELS=['Первое участие: 1290 BYN, 1 платёж','Первое участие: 1290 BYN, 2 платежа','Первое участие: 1290 BYN, 3 платежа',
  'Повторное участие: 890 BYN, 1 платёж','Повторное участие: 890 BYN, 2 платежа','Повторное участие: 890 BYN, 3 платежа'];
type Row={label:string;status:string;count:number;sum:number};
const KEY='zg27-sandbox-test-run-v1';
function initialRun(actorId:string){
  try{const saved=JSON.parse(sessionStorage.getItem(`${KEY}:${actorId}`)||'null');if(saved?.run_id&&saved?.started_at)return saved;}catch{/* no identity/card data */}
  return {run_id:crypto.randomUUID(),started_at:new Date().toISOString(),started:false};
}
export default function AdminZg27Sandbox(){
  const {user}=useAuth();
  return user?<SandboxRun key={user.id} actorId={user.id}/>:<AdminLayout><p>Войдите в аккаунт администратора.</p></AdminLayout>;
}
function SandboxRun({actorId}:{actorId:string}){
  const [run]=useState(()=>initialRun(actorId));const busy=useRef(false),generation=useRef(0),mounted=useRef(false);
  useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++}},[]);
  const [started,setStarted]=useState(Boolean(run.started)),[rows,setRows]=useState<Row[]>([]),[notice,setNotice]=useState('');
  async function start(){
    if(busy.current||started||!mounted.current)return;busy.current=true;const current=++generation.current;const active=()=>mounted.current&&generation.current===current;setStarted(true);
    sessionStorage.setItem(`${KEY}:${actorId}`,JSON.stringify({...run,started:true}));
    setNotice('Выполняется проверка. Не закрывайте страницу.');
    try{
      for(let index=0;index<CASES.length;index++){
        if(!active())return;
        const {data:sessionData,error:sessionError}=await supabase.auth.getSession();
        if(!active())return;
        if(sessionError||sessionData.session?.user?.id!==actorId||!sessionData.session?.access_token){setRows([]);setNotice('Аккаунт изменился или сессия завершилась. Запуск остановлен без повторной отправки.');return;}
        const {data,error}=await supabase.functions.invoke('zg27-sandbox-acceptance',{headers:{Authorization:`Bearer ${sessionData.session.access_token}`},body:{run_id:run.run_id,started_at:run.started_at,case_id:CASES[index]}});
        if(!active())return;
        const {data:after,error:afterError}=await supabase.auth.getSession();
        if(!active())return;
        if(afterError||after.session?.user?.id!==actorId){setRows([]);setNotice('Аккаунт изменился. Ответ предыдущего запроса не используется; следующий план не запускается.');return;}
        const passed=!error&&data?.case_id===CASES[index]&&data?.status==='passed'&&data?.test_confirmed===true;
        setRows(previous=>[...previous,{label:LABELS[index],status:passed?'TEST: пройдено':'Остановлено',
          count:Number.isSafeInteger(data?.requests)?data.requests:0,sum:Number.isSafeInteger(data?.sum_minor)?data.sum_minor:0}]);
        if(!passed){setNotice('Проверка остановлена. Повторные запросы не отправляются. Сохраните результат для проверки администратором.');return;}
      }
      setNotice('Все 6 тестовых планов пройдены. Это проверка API без платёжного виджета и 3-D Secure.');
    }catch{if(active())setNotice('Результат неизвестен. Повторный запуск не выполняется. Требуется проверка того же запроса.');}
    finally{if(active())busy.current=false;}
  }
  return <AdminLayout><div className="mx-auto max-w-3xl space-y-4 p-4">
    <h1 className="text-2xl font-semibold">ZG27 — sandbox-проверка оплат</h1>
    <p>Только TEST. Реальные деньги не списываются. Заказы, права доступа и данные клиентов не изменяются.</p>
    <p>Шесть фиксированных планов проверяются последовательно. Интервал договора — 30 дней; только в sandbox запросы выполняются сразу. Проверка не подтверждает работу виджета или 3-D Secure.</p>
    <Button onClick={start} disabled={started}>Запустить 6 TEST-планов</Button>
    {started&&rows.length===0&&!notice&&<p role="status">Этот запуск уже начат. Повторная отправка отключена; проверьте результат исходного запроса.</p>}
    <p role="status">{notice}</p>
    <ul className="space-y-2">{rows.map(row=><li key={row.label} className="rounded border p-3">{row.label}: {row.status}. Запросов: {row.count}; подтверждено: {(row.sum/100).toFixed(2)} BYN.</li>)}</ul>
  </div></AdminLayout>;
}
