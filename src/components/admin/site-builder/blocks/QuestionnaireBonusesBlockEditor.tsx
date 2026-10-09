import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { questionnairePersonalChatUrl } from "@/lib/questionnairePersonalChat";

export function QuestionnaireBonusesBlockEditor({ content, onChange }: {
  content: Record<string, unknown>; onChange: (content: Record<string, unknown>) => void;
}) {
  const { data: pages = [], isPending, isError } = useQuery({
    queryKey: ["broadcast-site-form-pages"],
    queryFn: async () => {
      const { data, error } = await supabase.from("site_pages").select("id,title,slug,blocks").eq("status", "published").order("title");
      if (error) throw error;
      return data || [];
    },
  });
  const pageId = typeof content.source_page_id === "string" ? content.source_page_id : "";
  const blockId = typeof content.source_block_id === "string" ? content.source_block_id : "";
  const personalChatUrl = typeof content.personal_chat_url === "string" ? content.personal_chat_url : "";
  const page = pages.find(candidate => candidate.id === pageId);
  const forms = (Array.isArray(page?.blocks) ? page.blocks : []).flatMap(block => {
    if (!block || typeof block !== "object" || Array.isArray(block) || block.type !== "form" || typeof block.id !== "string") return [];
    const settings = block.content;
    if (!settings || typeof settings !== "object" || Array.isArray(settings) || settings.auth_mode !== true) return [];
    return [{ id: block.id, title: typeof settings.title === "string" && settings.title ? settings.title : "Анкета" }];
  });
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Страница «Спасибо» использует общую бессрочную ссылку на бесплатный канал. Для рассылок настройте другую ссылку в шаблоне рассылки.</p>
    <Label htmlFor="questionnaire-bonuses-page">Страница исходной анкеты</Label>
    <Select value={pageId || undefined} onValueChange={source_page_id => onChange({ ...content, source_page_id, source_block_id: "" })}>
      <SelectTrigger id="questionnaire-bonuses-page"><SelectValue placeholder={isPending ? "Загрузка…" : "Выберите страницу"} /></SelectTrigger>
      <SelectContent>{pages.map(candidate => <SelectItem key={candidate.id} value={candidate.id}>{candidate.title || candidate.slug}</SelectItem>)}</SelectContent>
    </Select>
    <Label htmlFor="questionnaire-bonuses-form">Анкета на странице</Label>
    <Select value={blockId || undefined} onValueChange={source_block_id => onChange({ ...content, source_block_id })} disabled={!page}>
      <SelectTrigger id="questionnaire-bonuses-form"><SelectValue placeholder="Выберите анкету" /></SelectTrigger>
      <SelectContent>{forms.map(form => <SelectItem key={form.id} value={form.id}>{form.title}</SelectItem>)}</SelectContent>
    </Select>
    {isError && <p role="alert" className="text-sm text-destructive">Не удалось загрузить страницы. Откройте настройки ещё раз.</p>}
    <Label htmlFor="questionnaire-bonuses-channel-title">Название бесплатного канала</Label>
    <Input id="questionnaire-bonuses-channel-title" value={typeof content.channel_title === "string" ? content.channel_title : ""}
      onChange={event => onChange({ ...content, channel_title: event.target.value })} />
    <Label htmlFor="questionnaire-bonuses-channel-url">Ссылка на канал для страницы «Спасибо»</Label>
    <Input id="questionnaire-bonuses-channel-url" value={typeof content.channel_url === "string" ? content.channel_url : ""}
      onChange={event => onChange({ ...content, channel_url: event.target.value.trim() })} placeholder="https://t.me/+…" />
    <Label htmlFor="questionnaire-bonuses-personal-chat">Личная переписка Катерины</Label>
    <Input id="questionnaire-bonuses-personal-chat" value={personalChatUrl}
      onChange={event => onChange({ ...content, personal_chat_url: event.target.value.trim() })} placeholder="https://t.me/m/..." />
    {personalChatUrl && !questionnairePersonalChatUrl(personalChatUrl) && <p role="alert" className="text-sm text-destructive">Нужна ссылка Telegram Business вида https://t.me/m/…</p>}
    <p className="text-sm text-muted-foreground">Используйте готовую ссылку Telegram Business с настроенным сообщением. Это отдельная кнопка личной переписки, не приглашение в канал. Текст сообщения меняется в настройках этой ссылки в Telegram.</p>
  </div>;
}
