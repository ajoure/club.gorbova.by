import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSitePage } from "@/hooks/useSitePages";
import { sitePageAutomationLink } from "@/lib/sitePageAutomation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function SitePageMessagesSettings({ pageId }: { pageId: string }) {
  const { data: page } = useSitePage(pageId);
  const forms = (Array.isArray(page?.blocks) ? page.blocks : []).filter(block => block.type === "form" && block.content.auth_mode === true && block.content.questionnaire_first === true);
  const { data: templates = [], isPending, isError } = useQuery({
    queryKey: ["site-page-automations", pageId], enabled: !!pageId,
    queryFn: async () => {
      const { data, error } = await supabase.from("broadcast_templates")
        .select("id,name,status,approval_status,channels,metadata")
        .eq("trigger_kind", "site_form_event")
        .contains("metadata", { site_form_condition: { page_id: pageId } }).neq("status", "archived").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  return <Card>
    <CardHeader><CardTitle className="text-base">Автоматические сообщения</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Письмо и сообщение в Telegram после завершения регистрации на вебинар или отправки анкеты. Используются существующие рассылки, кнопки и журнал доставки.</p>
      {!forms.length && <p className="text-sm">Сначала добавьте и сохраните форму с подтверждением почты.</p>}
      {forms.map(form => <div key={form.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
        <span className="min-w-0 flex-1 text-sm">{typeof form.content.title === "string" && form.content.title || (form.content.webinar_registration === true ? "Регистрация на вебинар" : "Анкета")}</span>
        <Button asChild variant="outline" size="sm"><a href={sitePageAutomationLink(pageId, form.id)} target="_blank" rel="noopener noreferrer">Настроить сообщение</a></Button>
      </div>)}
      {isError ? <p role="alert" className="text-sm text-destructive">Не удалось загрузить сообщения. Проверьте доступ к рассылкам и повторите загрузку.</p>
        : isPending ? <p className="text-sm">Загрузка сообщений…</p>
        : !templates.length ? <p className="text-sm text-muted-foreground">Автоматические сообщения пока не настроены.</p>
        : templates.map(template => {
          const metadata = template.metadata as Record<string, unknown> | null;
          const condition = metadata?.site_form_condition as { block_id?: string } | undefined;
          return <div key={template.id} className="space-y-2 rounded-lg border p-3">
            <p className="break-words text-sm font-medium">{template.name}</p>
            <Badge variant="outline">{template.status === "paused" ? "Выключено" : template.status === "draft" ? "Черновик" : template.approval_status === "rejected" ? "Отклонено" : template.approval_status === "approved" ? "Включено" : "Ожидает одобрения"}</Badge>
            <span className="ml-2 text-xs text-muted-foreground">{(template.channels || []).map(channel => channel === "email" ? "Email" : "Telegram").join(" + ")}</span>
            {condition?.block_id && <Button asChild variant="ghost" size="sm"><a href={sitePageAutomationLink(pageId, condition.block_id, template.id)} target="_blank" rel="noopener noreferrer">Редактировать</a></Button>}
          </div>;
        })}
      <Button asChild variant="outline"><a href={sitePageAutomationLink(pageId)} target="_blank" rel="noopener noreferrer">Управление и журнал доставки</a></Button>
      <p className="text-xs text-muted-foreground">Сохранение не запускает отправку. Правило включается после отдельного одобрения в рассылках и действует для новых регистраций. Повторная отправка одному участнику блокируется.</p>
    </CardContent>
  </Card>;
}
