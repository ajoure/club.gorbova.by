import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { questionnaireAttributionLabel } from "@/lib/questionnaireAttributionLabels";
interface StatsRow {
  attribution: Record<string,string>; visits:number; visitors:number; questionnaires:number;
  contacts:number; new_accounts:number; existing_accounts:number; unclassified_accounts:number;
}
function date(daysAgo=0){return new Date(Date.now()+3*3600000-daysAgo*86400000).toISOString().slice(0,10);}
export function QuestionnaireStatsTab(){
 const access=useAdminAccess();
 const allowed=access.canAccessResource("forms-hub","site");
 const [pageId,setPageId]=useState("");const [from,setFrom]=useState(()=>date(30));const [to,setTo]=useState(()=>date());
 const pages=useQuery({queryKey:["questionnaire-stats-pages"],enabled:allowed,queryFn:async()=>{
  const {data,error}=await supabase.from("site_pages").select("id,title,slug,blocks").order("title");
  if(error)throw error;
  return (data||[]).filter(page=>Array.isArray(page.blocks)&&page.blocks.some(block=>block&&typeof block==="object"&&!Array.isArray(block)&&block.type==="form"&&block.content&&typeof block.content==="object"&&!Array.isArray(block.content)&&block.content.questionnaire_first===true));
 }});
 const selected=pageId||pages.data?.[0]?.id||"";
 const start=new Date(`${from}T00:00:00+03:00`);const finish=new Date(`${to}T00:00:00+03:00`);finish.setTime(finish.getTime()+86400000);
 const valid=Number.isFinite(start.getTime())&&Number.isFinite(finish.getTime())&&finish>start&&finish.getTime()-start.getTime()<=366*86400000;
 const stats=useQuery({queryKey:["questionnaire-funnel",selected,from,to],enabled:allowed&&!!selected&&valid,queryFn:async()=>{
  const {data,error}=await supabase.rpc("site_questionnaire_funnel_stats" as never,{p_page_id:selected,p_from:start.toISOString(),p_to:finish.toISOString()} as never);
  if(error)throw error;return (data||[]) as unknown as StatsRow[];
 }});
 if(!allowed)return <p role="alert">Нет доступа к статистике анкет.</p>;
 const rows=stats.data||[];const unknown=rows.reduce((n,row)=>n+Number(row.unclassified_accounts||0),0);
 return <div className="space-y-4 py-4">
  <h2 className="text-xl font-semibold">Анкета предзаписи</h2>
  <p className="text-sm text-muted-foreground">Переходы, заполнения и регистрации по первому источнику. Период — по времени Минска.</p>
  <div className="grid gap-3 sm:grid-cols-3">
   <div className="min-w-0 space-y-1"><Label htmlFor="questionnaire-stats-page">Анкета</Label>
    <Select value={selected||undefined} onValueChange={setPageId}><SelectTrigger id="questionnaire-stats-page"><SelectValue placeholder="Выберите анкету" /></SelectTrigger><SelectContent>{pages.data?.map(page=><SelectItem key={page.id} value={page.id}>{page.title||page.slug}</SelectItem>)}</SelectContent></Select>
   </div>
   <div className="space-y-1"><Label htmlFor="questionnaire-stats-from">С даты</Label><Input id="questionnaire-stats-from" type="date" value={from} onChange={e=>setFrom(e.target.value)} /></div>
   <div className="space-y-1"><Label htmlFor="questionnaire-stats-to">По дату</Label><Input id="questionnaire-stats-to" type="date" value={to} onChange={e=>setTo(e.target.value)} /></div>
  </div>
  {!valid&&<p role="alert">Выберите корректный период не длиннее 366 дней.</p>}
  {(pages.isError||stats.isError)&&<div role="alert"><p>Не удалось загрузить статистику. Нулевые показатели не подставляются.</p><Button variant="outline" onClick={()=>{void pages.refetch();void stats.refetch();}}>Повторить</Button></div>}
  {(pages.isLoading||stats.isFetching)&&<p role="status">Загрузка статистики…</p>}
  {!pages.isLoading&&!pages.isError&&!selected&&<p>Нет анкет с включённым режимом предзаписи.</p>}
  {selected&&valid&&!stats.isFetching&&!stats.isError&&rows.length===0&&<p>За выбранный период переходов и заполнений пока нет.</p>}
  {unknown>0&&<p role="status">Для {unknown} контактов результат регистрации ещё не установлен. Они не считаются автоматически новыми клиентами.</p>}
  {rows.length>0&&valid&&!stats.isError&&<div className="max-w-full overflow-x-auto rounded-lg border"><table className="w-full text-sm"><thead><tr>{["Источник","Канал","Кампания","Размещение","Запрос","Переходы","Посетители","Анкеты","Контакты","Новые аккаунты","Существующие"].map(label=><th key={label} className="whitespace-nowrap p-3 text-left">{label}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={index} className="border-t">
   {[row.attribution.utm_source||row.attribution.src||"Без метки",row.attribution.utm_medium,row.attribution.utm_campaign,row.attribution.utm_content,row.attribution.utm_term].map((value,i)=><td key={i} title={value||undefined} className="min-w-28 max-w-64 break-words p-3">{questionnaireAttributionLabel(value)}</td>)}
   {[row.visits,row.visitors,row.questionnaires,row.contacts,row.new_accounts,row.existing_accounts].map((value,i)=><td key={i} className="p-3">{Number(value||0)}</td>)}
  </tr>)}</tbody></table></div>}
 </div>;
}
