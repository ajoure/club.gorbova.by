
PATCH-лист P0.9.3 (System Health: игноры Telegram + UI)
	1.	nightly-system-health: загрузить system_health_ignored_checks (с учётом expires_at) и исключить такие проверки из Telegram-уведомлений.
	2.	nightly-system-health: считать invCode из i.name безопасно (split по :) и фильтровать fail’ы по ignoredKeys.
	3.	nightly-system-health: добавить лог failed/ignored (без PII, без cookie).
	4.	UI словарь (useSystemHealthRuns.ts): для INV-2B добавить urlTemplate, чтобы появилась кнопка “Открыть”.
	5.	UI словарь: добавить missing key INV-2B-WARN (с urlTemplate на ту же страницу).
	6.	DoD: на следующем прогоне nightly Telegram не содержит checks из ignore-листа; в логах nightly есть строка про ignored.
	7.	Guard: не трогаем registry, деплой функций, backfill и прочую “мне кажется, что пропало”.

⸻


[LOVABLE PATCH P0.9.3] System Health: respect ignored checks in Telegram + fix UI links for INV-2B

Жёсткие правила исполнения для Lovable.dev:
- Ничего не ломать и не трогать лишнее. Только точечные правки по списку.
- Add-only где возможно; если замена строки, то строго минимальный diff.
- Dry-run → execute где применимо.
- STOP-guards обязательны (таймауты/лимиты), no-PII в логах.
- DoD только по фактам: UI-скрин + лог/аудит-запись. Без “кажется работает”.

1) FIX: nightly-system-health игнорирует ignored_checks при отправке в Telegram
Файл: supabase/functions/nightly-system-health/index.ts
Проблема: failedChecks формируется без учёта system_health_ignored_checks → Telegram шлёт игнорируемые проверки.

Заменить логику формирования failedChecks.
БЫЛО (примерно строка ~284):
  const failedChecks = invariantsResult.invariants?.filter((i) => !i.passed) || [];

СТАНЕТ (вставить после получения invariantsResult, ДО отправки Telegram):
  // === PATCH P0.9.3: Load ignored checks and filter notifications ===
  const { data: ignoredChecksData, error: ignoredErr } = await supabase
    .from('system_health_ignored_checks')
    .select('check_key')
    .or('expires_at.is.null,expires_at.gt.now()');

  if (ignoredErr) {
    console.warn(`[NIGHTLY] ignored_checks load failed: ${ignoredErr.message}`);
  }

  const ignoredKeys = new Set(
    (ignoredChecksData || []).map((ic: { check_key: string }) => ic.check_key)
  );

  const allFailed = invariantsResult.invariants?.filter((i: any) => !i.passed) || [];

  const failedChecks = allFailed.filter((i: any) => {
    const invCode = String(i?.name || '').split(':')[0].trim(); // e.g. "INV-2B"
    return invCode && !ignoredKeys.has(invCode);
  });

  const ignoredFailedCount = allFailed.length - failedChecks.length;

  console.log(`[NIGHTLY] ${failedChecks.length} failed (${ignoredFailedCount} ignored by user)`);  
  // === END PATCH P0.9.3 ===

Важно:
- Не логировать сами check_key списком.
- Не менять формат invariantsResult, только фильтр нотификаций.

2) UI: INV-2B добавить кнопку “Открыть”
Файл: src/hooks/useSystemHealthRuns.ts
Проблема: INV-2B в словаре без urlTemplate → в UI нет кнопки “Открыть”.

В объекте словаря добавить/исправить:
  "INV-2B": {
    title: "Технические сироты",
    explain: "Технические платежи без привязки (мониторинг)",
    action: "Проверить рост количества",
    urlTemplate: "/admin/payments?classification=orphan_technical",
    category: "payments",
  },

3) UI: добавить отсутствующий ключ INV-2B-WARN
Файл: src/hooks/useSystemHealthRuns.ts
Добавить рядом с INV-2B:
  "INV-2B-WARN": {
    title: "Порог технических сирот",
    explain: "Количество превысило порог (200)",
    action: "Исследовать причину роста",
    urlTemplate: "/admin/payments?classification=orphan_technical",
    category: "system",
  },

DoD (обязательно):
A) Nightly прогон: в логах Edge Function есть строка вида:
   [NIGHTLY] <N> failed (<M> ignored by user)
B) Telegram уведомление: НЕ содержит checks, которые есть в system_health_ignored_checks и не истекли.
C) UI System Health: у INV-2B есть кнопка “Открыть”, ведёт на /admin/payments?classification=orphan_technical
D) UI System Health: INV-2B-WARN отображается без ошибок в консоли.
E) Скриншоты/видео DoD допускаются из основной админ-учётки 7500084@gmail.com.

Не делать:
- НЕ деплоить “недостающие функции”, НЕ менять registry.txt (152/172 это нормально).
- НЕ трогать unrelated RPC/backfill/прочее.

