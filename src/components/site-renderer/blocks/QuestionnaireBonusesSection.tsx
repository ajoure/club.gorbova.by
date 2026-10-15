import { Button } from "@/components/ui/button";
import { questionnairePersonalChatUrl } from "@/lib/questionnairePersonalChat";

/** Shared perpetual channel links are maintained in page settings, separately from broadcasts. */
export function QuestionnaireBonusesSection({ content }: { content: Record<string, unknown>; isPreview?: boolean }) {
  const channelUrl = typeof content.channel_url === "string" && /^https:\/\/t\.me\/(\+|joinchat\/)[A-Za-z0-9_-]+$/.test(content.channel_url) ? content.channel_url : null;
  const channelTitle = typeof content.channel_title === "string" && content.channel_title.trim() ? content.channel_title : "Бесплатный Telegram-канал";
  const personalChatUrl = questionnairePersonalChatUrl(content.personal_chat_url);
  return <section className="questionnaire-bonuses px-4 py-8"><div className="questionnaire-bonuses__inner mx-auto max-w-2xl">
    <div className="questionnaire-bonuses__intro space-y-4">
    <h2 className="text-2xl font-semibold">Спасибо за заполнение анкеты!</h2>
    <p>Присоединяйтесь к бесплатному Telegram-каналу и напишите Катерине.</p>
    </div>
    <div className="questionnaire-bonuses__actions space-y-4">
    <div className="questionnaire-bonuses__action space-y-3 rounded-lg border p-4">
      <h3 className="text-lg font-semibold">{channelTitle}</h3>
      {channelUrl ? <Button asChild className="w-full"><a href={channelUrl} target="_blank" rel="noopener noreferrer">Вступить в бесплатный канал</a></Button>
        : <p role="alert">Ссылка на канал пока не настроена. Обратитесь в поддержку.</p>}
    </div>
    {personalChatUrl && <div className="questionnaire-bonuses__action space-y-3 rounded-lg border p-4">
      <h3 className="text-lg font-semibold">Напишите Катерине Горбовой</h3>
      <Button asChild variant="outline" className="w-full"><a href={personalChatUrl} target="_blank" rel="noopener noreferrer">Получить бонус от Катерины</a></Button>
    </div>}
    </div>
  </div></section>;
}
