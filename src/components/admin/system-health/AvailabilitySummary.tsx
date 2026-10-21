import { Card, CardContent } from "@/components/ui/card";
import { availabilityView } from "@/lib/system-health/availability";

export function AvailabilitySummary({ report }: { report: Record<string, unknown> | undefined }) {
  const view = availabilityView(report);
  if (!view) return null;
  const knownMissing = Array.isArray(report?.known_p0_missing) ? report.known_p0_missing.length : 0;
  return <Card data-testid="availability-summary"><CardContent className="p-4 space-y-2">
    <h2 className="font-semibold">Доступность серверных функций</h2>
    <p className="text-sm">Проверено {view.checked} из {view.total}. Успешных проверок OPTIONS: {view.healthy}.</p>
    {!view.complete && <p className="text-sm text-amber-700 dark:text-amber-300">
      Проверка не завершена. Нажмите «Запустить проверку», чтобы пройти все порции.</p>}
    {(view.rateLimited > 0 || view.unknown > 0 || view.errors > 0) && <p className="text-sm">
      Лимит запросов: {view.rateLimited}. Не проверены или недоступны для проверки: {view.unknown}. Ошибки: {view.errors}.
    </p>}
    {view.sourceUnavailable > 0 && <p className="text-sm text-amber-700 dark:text-amber-300">
      Не отправляли запросы к {view.sourceUnavailable} функциям: в GitHub нет проверяемого обработчика OPTIONS. Нужна проверка исходников; повторный запуск это не исправит.
    </p>}
    {knownMissing > 0 && <p className="text-sm text-destructive">Подтверждена недоступность критичных функций: {knownMissing}. Результат сохраняется до свежей успешной проверки.</p>}
    <p className="text-xs text-muted-foreground">OPTIONS проверяет доступность и CORS. Работу платежей, писем и других сценариев подтверждают отдельные проверки.</p>
  </CardContent></Card>;
}
