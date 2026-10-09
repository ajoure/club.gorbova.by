import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function QuestionnaireBonusesBlockEditor({ content, onChange }: {
  content: Record<string, unknown>; onChange: (content: Record<string, unknown>) => void;
}) {
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Страница «Спасибо» показывает персональные Telegram-приглашения из той же анкеты. Общие ссылки на каналы сюда не вставляются.</p>
    <Label>Страница исходной анкеты
      <Input value={typeof content.source_page_id === "string" ? content.source_page_id : ""}
        onChange={event => onChange({ ...content, source_page_id: event.target.value.trim() })} placeholder="UUID страницы" />
    </Label>
    <Label>Блок исходной анкеты
      <Input value={typeof content.source_block_id === "string" ? content.source_block_id : ""}
        onChange={event => onChange({ ...content, source_block_id: event.target.value.trim() })} placeholder="UUID блока формы" />
    </Label>
    <Label>Личная переписка Катерины
      <Input value={typeof content.personal_chat_url === "string" ? content.personal_chat_url : ""}
        onChange={event => onChange({ ...content, personal_chat_url: event.target.value.trim() })} placeholder="https://t.me/m/..." />
    </Label>
    <p className="text-sm text-muted-foreground">Используйте готовую ссылку Telegram Business с настроенным сообщением. Это вторая кнопка, отдельно от персонального приглашения в канал.</p>
  </div>;
}
