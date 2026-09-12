import {useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';

type Fact = {id:string;title?:string;text:string;scope?:'curriculum'|'background';source_id:string;source_revision:string;source_sha256:string;module_id?:string;binding_block_id?:string};
type Source = {id:string;title:string;source_revision:string;source_sha256:string;ready:boolean;targets:{block_id:string;module_id:string;title:string;open_now:boolean;in_product:boolean}[]};
type Snapshot = {facts:Fact[];knowledge_version:string;facts_sha256:string;product_id:string;sources:Source[];versions:{id:string;created_at:string;facts_count:number;approval_scope:string}[]};
type Preview = {valid:boolean;facts_sha256:string;added:number;changed:number;removed:number;unchanged:number;errors:{fact_id:string;reason:string}[];applied?:boolean;noop?:boolean};
const reasons:Record<string,string>={module_not_in_product:'Модуль не включён действующими правилами продукта',source_unavailable_or_stale:'Источник изменён или недоступен',source_binding_stale:'Изменилась привязка видео',source_gap_unresolved:'Источник требует проверки пропусков',target_video_not_verified:'Видео не совпадает с источником',target_outside_curriculum:'Урок не относится к программе',target_reference_required:'Выберите урок программы',invalid_summary_text:'Проверьте описание: до 600 символов, без ссылок и контактных данных',invalid_or_duplicate_id:'Повторяющаяся или некорректная карточка',invalid_source_reference:'Не указан проверенный источник',invalid_title:'Проверьте название темы'};

export function SalesKnowledgeEditor({userId,businessAccountId,editable}:{userId:string;businessAccountId:string;editable:boolean}) {
  const [data,setData]=useState<Snapshot|null>(null),[facts,setFacts]=useState<Fact[]>([]),[preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[approved,setApproved]=useState(false);
  const [expanded,setExpanded]=useState<string|null>(null);
  async function invoke<T>(action:string,extra:Record<string,unknown>={}):Promise<T>{
    const {data,error}=await supabase.functions.invoke('sales-runtime-control',{body:{action,user_id:userId,business_account_id:businessAccountId,...extra}});
    if(error||data?.error)throw Error(data?.message||'Не удалось выполнить операцию. Обновите базу перед повторной попыткой.');
    return data as T;
  }
  async function run(work:()=>Promise<void>){setBusy(true);setError('');try{await work()}catch(e){setPreview(null);setApproved(false);setError(e instanceof Error?e.message:'Операция не выполнена')}finally{setBusy(false)}}
  async function load(){const d=await invoke<Snapshot>('knowledge_status');setData(d);setFacts(d.facts);setPreview(null);setApproved(false);setExpanded(null)}
  function change(next:Fact[]){setFacts(next);setPreview(null);setApproved(false);setNotice('')}
  function update(index:number,patch:Partial<Fact>){change(facts.map((f,i)=>i===index?{...f,...patch}:f))}
  function targetFor(f:Fact,source:Source){
    const targets=source.targets.filter(t=>t.in_product);
    const target=targets.find(t=>t.block_id===f.binding_block_id)??(targets.length===1?targets[0]:undefined);
    return target?{module_id:target.module_id,binding_block_id:target.block_id,scope:'curriculum' as const}:{module_id:undefined,binding_block_id:undefined,scope:'background' as const};
  }
  async function importFile(file:File){
    if(!data||file.size>250000)throw Error('Выберите пакет описаний размером до 250 КБ.');
    const packet=JSON.parse(await file.text());
    if(packet.target_product_id!==data.product_id||!Array.isArray(packet.facts)||packet.facts.length>100)throw Error('Пакет не соответствует продукту или содержит больше 100 карточек.');
    const next=packet.facts.map((f:any)=>{
      const source=data.sources.find(s=>s.id===f.source_id);
      if(!source||typeof f.id!=='string'||typeof f.text!=='string')throw Error('В пакете есть неизвестный источник или некорректная карточка.');
      const draft:Fact={id:f.id,title:f.title,text:f.text,source_id:f.source_id,source_revision:f.source_revision,source_sha256:f.source_sha256,
        binding_block_id:f.binding_block_id??f.existing_target_reference?.binding_block_id};
      return {...draft,...targetFor(draft,source)};
    });
    change(next);setNotice('Пакет загружен в черновик. Проверьте описания и связи перед сохранением.');
  }
  async function check(){
    if(!data)return;
    setApproved(false);
    const p=await invoke<Preview>('knowledge_preview',{facts,expected_knowledge_version:data.knowledge_version,expected_facts_sha:data.facts_sha256});setPreview(p);
  }
  async function save(){
    if(!data||!preview?.valid||!approved)return;
    const result=await invoke<Preview>('knowledge_apply',{facts,expected_knowledge_version:data.knowledge_version,expected_facts_sha:data.facts_sha256,approved_facts_sha:preview.facts_sha256});
    if(!result.valid){setPreview(result);setApproved(false);return;}
    await load();setNotice(result.noop?'Изменений нет.':'Версия сохранена. Автопродажи остаются выключенными.');
  }
  if(!data)return <div className="border-t pt-3 space-y-2">
    <p className="text-sm font-medium">База знаний продавца</p>
    <p className="text-xs text-muted-foreground">Краткие описания тем и результатов обучения с проверяемыми источниками.</p>
    <Button size="sm" variant="outline" disabled={busy} onClick={()=>run(load)}>Открыть базу знаний</Button>
    {error&&<p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
  return <section className="border-t pt-3 space-y-3 min-w-0" aria-label="База знаний продавца">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">База знаний: {facts.length} описаний</h3>
      <Button size="sm" variant="ghost" disabled={busy} onClick={()=>{setData(null);setPreview(null)}}>Закрыть редактор</Button></div>
    <p className="text-xs text-muted-foreground">Описывайте содержание и результаты, без решений заданий, цен, обещаний дохода и данных клиентов. Стоимость и доступы берутся из настроек продукта.</p>
    {!editable&&<p role="status" className="text-xs">Для изменений выключите автопродажи и поставьте диалог на паузу.</p>}
    <div className="flex flex-wrap gap-2 items-center">
      <Button size="sm" variant="outline" disabled={busy} onClick={()=>run(load)}>Обновить без сохранения</Button>
      <label className="text-xs block min-w-0">Загрузить подготовленный пакет
        <Input aria-label="Пакет описаний" type="file" accept="application/json,.json" disabled={!editable||busy} className="max-w-full text-xs"
          onChange={e=>{const file=e.target.files?.[0];if(file)run(()=>importFile(file));e.target.value=''}}/>
      </label>
    </div>
    <div className="space-y-2">
      {facts.map((f,index)=>{const source=data.sources.find(s=>s.id===f.source_id),target=source?.targets.find(t=>t.block_id===f.binding_block_id);
        const title=f.title||target?.title||source?.title||'Описание темы';
        const before=data.facts.find(old=>old.id===f.id);
        return <div key={f.id+'-'+index} className="rounded-md border p-3 min-w-0 space-y-2">
          <button className="w-full text-left text-sm font-medium break-words" aria-expanded={expanded===f.id} onClick={()=>setExpanded(expanded===f.id?null:f.id)}>{title}</button>
          <p className="text-xs text-muted-foreground break-words">{f.scope==='background'?'Исторический материал для понимания контекста; не обещание состава курса':target?.in_product?'В составе продаваемого продукта':target?'Не включено действующими правилами продукта':'Нужна проверка связи с программой'}{target&&!target.open_now?' · Урок сейчас закрыт':''}</p>
          {expanded===f.id&&<div className="space-y-2">
            <label className="block text-xs">Название темы<Input aria-label={`Название темы ${index+1}`} value={f.title??''} maxLength={120} disabled={!editable||busy} onChange={e=>update(index,{title:e.target.value})}/></label>
            <label className="block text-xs">Источник<select aria-label={`Источник ${index+1}`} value={f.source_id} disabled={!editable||busy} className="block mt-1 w-full min-w-0 rounded border bg-background p-2"
              onChange={e=>{const s=data.sources.find(s=>s.id===e.target.value)!;update(index,{source_id:s.id,source_revision:s.source_revision,source_sha256:s.source_sha256,...targetFor({...f,binding_block_id:undefined},s)})}}>
              {data.sources.map(s=><option key={s.id} value={s.id} disabled={!s.ready}>{s.title}{!s.ready?' — требует проверки':''}</option>)}</select></label>
            <label className="block text-xs">Связь с программой<select aria-label={`Связь с программой ${index+1}`} value={f.scope==='background'?'background':f.binding_block_id??''} disabled={!editable||busy} className="block mt-1 w-full min-w-0 rounded border bg-background p-2"
              onChange={e=>{const t=source?.targets.find(t=>t.block_id===e.target.value);update(index,t?{scope:'curriculum',module_id:t.module_id,binding_block_id:t.block_id}:{scope:'background',module_id:undefined,binding_block_id:undefined})}}>
              <option value="background">Только исторический контекст</option>{!target&&f.scope!=='background'&&<option value="">Выберите связь</option>}
              {source?.targets.map(t=><option key={t.block_id} value={t.block_id} disabled={!t.in_product}>{t.title}{!t.in_product?' — не включено в продукт':''}</option>)}</select></label>
            {before&&before.text!==f.text&&<details className="text-xs"><summary>Прежнее описание</summary><p className="mt-1 whitespace-pre-wrap break-words">{before.text}</p></details>}
            <label className="block text-xs">Описание для консультации<Textarea aria-label={`Описание ${index+1}`} rows={5} value={f.text} maxLength={600} disabled={!editable||busy} onChange={e=>update(index,{text:e.target.value})}/></label>
            <p className="text-xs text-muted-foreground">{f.text.length}/600 символов</p>
            <Button size="sm" variant="outline" disabled={!editable||busy} onClick={()=>change(facts.filter((_,i)=>i!==index))}>Убрать описание</Button>
          </div>}
        </div>;
      })}
    </div>
    <Button size="sm" variant="outline" disabled={!editable||busy||facts.length>=100||!data.sources.some(s=>s.ready)} onClick={()=>{
      const s=data.sources.find(s=>s.ready)!;const f:Fact={id:'topic-'+crypto.randomUUID(),title:'Новая тема',text:'',source_id:s.id,source_revision:s.source_revision,source_sha256:s.source_sha256,scope:'background'};
      change([...facts,f]);setExpanded(f.id);
    }}>Добавить описание</Button>
    {!!data.versions.length&&<label className="block text-xs">Взять прежнюю версию в черновик<select aria-label="История базы знаний" value="" disabled={!editable||busy} className="block mt-1 w-full min-w-0 rounded border bg-background p-2" onChange={e=>{const version_id=e.target.value;if(version_id)run(async()=>{const v=await invoke<{facts:Fact[]}>('knowledge_version',{version_id});change(v.facts);setNotice('Прежняя версия загружена в черновик. Источники будут проверены заново.')})}}>
      <option value="">Выберите сохранённую версию</option>{data.versions.map(v=><option key={v.id} value={v.id}>{new Date(v.created_at).toLocaleString('ru-RU')} · {v.facts_count} описаний{v.approval_scope==='legacy_snapshot'?' · исходная версия':''}</option>)}</select></label>}
    <Button size="sm" variant="outline" disabled={!editable||busy} onClick={()=>run(check)}>Проверить изменения</Button>
    {preview&&<div role="status" className="text-xs space-y-2">
      {preview.valid?<p>Проверено. Добавлено: {preview.added}; изменено: {preview.changed}; удалено: {preview.removed}; без изменений: {preview.unchanged}.</p>:<ul className="list-disc pl-4">{preview.errors.map((e,i)=><li key={i}>{facts.find(f=>f.id===e.fact_id)?.title||'Описание'}: {reasons[e.reason]||'Проверка не пройдена'}</li>)}</ul>}
      {preview.valid&&<><label className="flex items-start gap-2"><input type="checkbox" checked={approved} disabled={!editable||busy} onChange={e=>setApproved(e.target.checked)}/>Подтверждаю эти описания и их связь с источниками. Решений заданий и неподтверждённых обещаний нет.</label>
        <Button size="sm" disabled={!editable||busy||!approved} onClick={()=>run(save)}>Сохранить проверенную версию</Button></>}
    </div>}
    {error&&<p role="alert" className="text-xs text-destructive break-words">{error}</p>}
    {notice&&<p role="status" className="text-xs break-words">{notice}</p>}
  </section>;
}
