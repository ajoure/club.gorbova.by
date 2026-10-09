import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { SiteFormEventCondition } from "@/lib/siteFormEventCondition";

export function SiteFormEventSettings({ value, onChange }: { value: SiteFormEventCondition; onChange: (value: SiteFormEventCondition) => void }) {
  const { data: pages = [], isPending, isError } = useQuery({
    queryKey: ["broadcast-site-form-pages"],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_pages").select("id,title,slug,blocks").eq("status", "published").order("title");
      if (error) throw error;
      return data || [];
    },
  });
  const page = pages.find(p => p.id === value.page_id);
  const forms = (Array.isArray(page?.blocks) ? page.blocks : []).flatMap(block => {
    if (!block || typeof block !== "object" || Array.isArray(block) || block.type !== "form" || typeof block.id !== "string") return [];
    const content = block.content;
    if (!content || typeof content !== "object" || Array.isArray(content) || content.auth_mode !== true) return [];
    return [{ id: block.id, title: typeof content.title === "string" && content.title ? content.title : "Анкета", enabled: content.questionnaire_first === true }];
  });
  return <div className="space-y-3 rounded-lg border p-3">
    <Label htmlFor="broadcast-site-form-event">Когда отправлять</Label>
    <Select value={value.event} onValueChange={event => onChange({ ...value, event: event as SiteFormEventCondition["event"], delay_minutes: event === "email_confirmed_incomplete" ? 60 : undefined })}>
      <SelectTrigger id="broadcast-site-form-event"><SelectValue /></SelectTrigger>
      <SelectContent><SelectItem value="submitted">Анкета сохранена</SelectItem><SelectItem value="email_confirmed_incomplete">Почта подтверждена, анкета не отправлена</SelectItem></SelectContent>
    </Select>
    {value.event === "email_confirmed_incomplete" ? <div className="space-y-2">
      <Label htmlFor="broadcast-site-form-delay">Подождать после подтверждения почты (минут)</Label>
      <Input id="broadcast-site-form-delay" type="number" min={15} max={10080} value={value.delay_minutes ?? 60} onChange={e => onChange({ ...value, delay_minutes: Number(e.target.value) })} />
      <p className="text-sm">Напоминание отменяется после отправки анкеты. Только email, один раз на человека и форму.</p>
    </div> : <p className="text-sm">После сохранения анкеты — один раз на человека и форму. Telegram ждёт привязки бота.</p>}
    <Label htmlFor="broadcast-site-form-page">Страница анкеты</Label>
    <Select value={value.page_id || undefined} onValueChange={page_id => onChange({ ...value, page_id, block_id: "" })}>
      <SelectTrigger id="broadcast-site-form-page"><SelectValue placeholder={isPending ? "Загрузка…" : "Выберите страницу"} /></SelectTrigger>
      <SelectContent>{pages.map(p => <SelectItem key={p.id} value={p.id}>{p.title || p.slug}</SelectItem>)}</SelectContent>
    </Select>
    <Label htmlFor="broadcast-site-form-block">Форма на странице</Label>
    <Select value={value.block_id || undefined} onValueChange={block_id => onChange({ ...value, block_id })} disabled={!page}>
      <SelectTrigger id="broadcast-site-form-block"><SelectValue placeholder="Выберите форму" /></SelectTrigger>
      <SelectContent>{forms.map(f => <SelectItem key={f.id} value={f.id}>{f.title}{f.enabled ? "" : " — режим анкеты ещё выключен"}</SelectItem>)}</SelectContent>
    </Select>
    {isError && <p role="alert" className="text-sm text-destructive">Не удалось загрузить страницы. Попробуйте открыть настройки ещё раз.</p>}
  </div>;
}
