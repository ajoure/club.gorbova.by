import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

interface Connection { alias?: string; enabled?: boolean; key_configured?: boolean; status?: string; last_check_at?: string; }
async function request(body: Record<string, unknown>) {
  const {data,error} = await supabase.functions.invoke("instagram-monitor",{body});
  if(error || !data?.ok) throw new Error(data?.message || "Не удалось выполнить действие. Попробуйте позже.");
  return data.result;
}
export function ApifyIntegrationCard() {
  const access=useAdminAccess();
  const canView=access.canAccessResource("integrations","socials","view");
  const canEdit=access.canAccessResource("integrations","socials","edit");
  const cache=useQueryClient();
  const query=useQuery<Connection>({queryKey:["apify-integration"],queryFn:()=>request({action:"integration_status"}),enabled:canView});
  const [alias,setAlias]=useState("Apify — мониторинг Instagram");
  const [token,setToken]=useState("");
  const [enabled,setEnabled]=useState(false);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{if(query.data){setAlias(query.data.alias || "Apify — мониторинг Instagram");setEnabled(query.data.enabled || false);}},[query.data]);
  if(!canView) return null;
  const save=async()=>{
    setBusy(true);
    try {
      await request({action:"integration_save",alias,enabled,...(token.trim()?{api_token:token.trim()}: {})});
      setToken("");
      await cache.invalidateQueries({queryKey:["apify-integration"]});
      await cache.invalidateQueries({queryKey:["instagram-monitor"]});
      toast.success("Настройки Apify сохранены");
    } catch(e){toast.error(e instanceof Error?e.message:"Ошибка сохранения");} finally{setBusy(false);}
  };
  const check=async()=>{
    setBusy(true);
    try{const result=await request({action:"integration_check"});toast[result.success?"success":"error"](result.success?"Ключ Apify работает":"Проверьте API-ключ Apify");await query.refetch();}catch(e){toast.error(e instanceof Error?e.message:"Ошибка проверки");}finally{setBusy(false);}
  };
  return <Card>
    <CardHeader><CardTitle>Apify — мониторинг Instagram</CardTitle><CardDescription>Публичные Reels, видео и комментарии. Настройки подключения и ключ доступны только администраторам с правом изменения интеграций.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {query.isLoading?<p>Загрузка подключения…</p>:query.isError?<p role="alert" className="text-destructive">Не удалось загрузить настройки Apify.</p>:<>
        <p className="text-sm">{query.data?.key_configured?"Ключ сохранён в защищённом хранилище":"Ключ пока не добавлен"}. {query.data?.enabled?"Интеграция включена":"Интеграция выключена"}.</p>
        {query.data?.status==="connected" && <p className="text-sm">Последняя проверка: подключение работает.</p>}
        {canEdit && <>
          <div className="space-y-2"><Label htmlFor="apify-alias">Название подключения</Label><Input id="apify-alias" maxLength={100} value={alias} onChange={e=>setAlias(e.target.value)} disabled={busy}/></div>
          <div className="space-y-2"><Label htmlFor="apify-api-token">API-ключ Apify</Label><Input id="apify-api-token" type="password" autoComplete="new-password" maxLength={2000} value={token} onChange={e=>setToken(e.target.value)} placeholder={query.data?.key_configured?"Оставьте пустым, чтобы сохранить текущий ключ":"Токен из настроек Apify"} disabled={busy}/><p className="text-xs text-muted-foreground">Сохранённый ключ не показывается. Чтобы заменить его, введите новый и сохраните настройки.</p></div>
          <Label className="flex items-center gap-3"><Switch checked={enabled} onCheckedChange={setEnabled} disabled={busy}/>Включить интеграцию</Label>
          <div className="flex flex-wrap gap-2"><Button onClick={save} disabled={busy || !alias.trim()}>Сохранить настройки</Button><Button variant="outline" onClick={check} disabled={busy || !query.data?.key_configured || !!token}>Проверить подключение</Button></div>
        </>}
        <Button variant="outline" asChild><a href="/admin/instagram-monitor">Открыть мониторинг Reels</a></Button>
        <p className="text-xs text-muted-foreground">Пилот: до $0.25 за запуск и $4 за месяц Apify. Выключение останавливает новые задачи; уже начатые запуски проверяются до получения результата. Платный тариф автоматически не подключается. Gemini использует отдельные AI-кредиты платформы.</p>
      </>}
    </CardContent>
  </Card>;
}
