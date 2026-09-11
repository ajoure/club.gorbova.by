import { Button } from "@/components/ui/button";

export function TelegramSenderNotice({ loading, failed, onRetry }: {
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <div role={failed ? "alert" : "status"} className="mb-2 flex flex-wrap items-center gap-2 rounded-md border p-2 text-xs">
      <p className="min-w-0 flex-1">
        {loading ? "Загружаем отправителя Telegram…" : failed
          ? "Не удалось загрузить отправителя Telegram. Текст сообщения сохранён в поле ввода."
          : "Нет доступного отправителя Telegram. Обновите список; если он останется пустым, обратитесь к администратору."}
      </p>
      <Button type="button" variant="outline" size="sm" disabled={loading} onClick={onRetry}>
        Обновить отправителей
      </Button>
    </div>
  );
}
