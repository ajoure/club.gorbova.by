import {useQuery} from "@tanstack/react-query";
import {supabase} from "@/integrations/supabase/client";
import {Label} from "@/components/ui/label";
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from "@/components/ui/select";
type Condition={page_id:string;block_id:string};
export function WebinarRegistrationAudienceFilter({value,onChange}:{value?:Condition;onChange:(value?:Condition)=>void}){
 const {data:forms=[],isError}=useQuery({queryKey:["broadcast-webinar-registration-forms"],queryFn:async()=>{
  const {data,error}=await supabase.from("site_pages").select("id,title,slug,blocks").eq("status","published").order("title");
  if(error)throw error;
  return (data||[]).flatMap(page=>(Array.isArray(page.blocks)?page.blocks:[]).flatMap(raw=>{
   if(!raw||typeof raw!=="object"||Array.isArray(raw))return [];
   const block=raw as Record<string,any>;
   return block.type==="form"&&typeof block.id==="string"&&block.content?.webinar_registration===true&&block.content?.auth_mode===true?[{page_id:page.id,block_id:block.id,title:page.title||page.slug}]:[];
  }));
 }});
 const key=value?`${value.page_id}:${value.block_id}`:"none";
 return <div className="space-y-2"><Label htmlFor="broadcast-webinar-registration">Зарегистрировались на вебинар</Label>
  <Select value={key} onValueChange={key=>onChange(forms.find(f=>`${f.page_id}:${f.block_id}`===key))}>
   <SelectTrigger id="broadcast-webinar-registration"><SelectValue placeholder="Выберите вебинар"/></SelectTrigger>
   <SelectContent><SelectItem value="none">Без условия по регистрации</SelectItem>{value&&!forms.some(f=>`${f.page_id}:${f.block_id}`===key)&&<SelectItem value={key}>Сохранённая регистрация вебинара</SelectItem>}{forms.map(f=><SelectItem key={`${f.page_id}:${f.block_id}`} value={`${f.page_id}:${f.block_id}`}>{f.title}</SelectItem>)}</SelectContent>
  </Select>
  {value&&<p className="text-xs text-muted-foreground">Только завершённые регистрации. Остальные условия дополнительно сужают аудиторию.</p>}
  {isError&&<p role="alert" className="text-xs text-destructive">Не удалось загрузить список вебинаров. Сохранённый фильтр не снят.</p>}
 </div>;
}
