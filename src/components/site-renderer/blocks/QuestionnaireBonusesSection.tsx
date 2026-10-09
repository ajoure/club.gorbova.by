import { useAuth } from "@/contexts/AuthContext";
import { QuestionnaireTelegramStep } from "./QuestionnaireTelegramStep";
import { Button } from "@/components/ui/button";
import { questionnairePersonalChatUrl } from "@/lib/questionnairePersonalChat";

/** The thank-you page reuses the same authenticated invitation journal as the bot. */
export function QuestionnaireBonusesSection({ content, isPreview }: { content: Record<string, unknown>; isPreview?: boolean }) {
  const { user } = useAuth();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const pageId = typeof content.source_page_id === "string" ? content.source_page_id : "";
  const blockId = typeof content.source_block_id === "string" ? content.source_block_id : "";
  const personalChatUrl = questionnairePersonalChatUrl(content.personal_chat_url);
  return <section className="px-4 py-8"><div className="mx-auto max-w-2xl space-y-4">
    <h2 className="text-2xl font-semibold">Спасибо за заполнение анкеты!</h2>
    <p>Ваши бонусы — доступ в бесплатные Telegram-каналы. Подключите нашего support-бота, чтобы получить персональные приглашения.</p>
    {isPreview ? <p>Персональные ссылки появятся после отправки анкеты и привязки Telegram.</p>
      : !uuid.test(pageId) || !uuid.test(blockId) ? <p role="alert">Бонусы пока не настроены. Обратитесь в поддержку.</p>
      : !user ? <p role="status">Откройте эту страницу в браузере, где вы подтвердили почту и отправили анкету. Персональные приглашения доступны только в вашем аккаунте.</p>
      : <QuestionnaireTelegramStep pageId={pageId} blockId={blockId} />}
    {personalChatUrl && <div className="space-y-3 rounded-lg border p-4">
      <h3 className="text-lg font-semibold">Напишите Катерине Горбовой</h3>
      <p>Откройте личную переписку по настроенной ссылке Telegram.</p>
      <Button asChild className="w-full"><a href={personalChatUrl} target="_blank" rel="noopener noreferrer">Написать Катерине в Telegram</a></Button>
      <p className="text-sm text-muted-foreground">Сообщение подготовлено в Telegram. Нажмите «Отправить», чтобы начать общение.</p>
    </div>}
  </div></section>;
}
