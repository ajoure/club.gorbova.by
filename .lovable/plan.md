# План: релиз PR #331 (CRM Automation placeholder polish), SHA a4b67824

Режим сейчас: PLAN-ONLY / STRICT READ-ONLY. Ничего не изменено, не применено, не развёрнуто, не опубликовано.

## 1. Managed HEAD и сравнение с GitHub SHA

| Проверка | Результат |
|---|---|
| Managed HEAD | `a4b678247c974f27b8c8d92511d395c9147c6df8` |
| Запрошенный GitHub SHA | `a4b678247c974f27b8c8d92511d395c9147c6df8` |
| Различие | **нет**, точное совпадение |
| Коммит | «Merge pull request #331 from ajoure/codex/fix-crm-placeholder-picker», 2026-08-17 13:12:19 +02:00 |

## 2. Состояние дерева и очереди

- `git status --porcelain` — пусто, дерево чистое.
- Незавершённых задач и посторонних правок нет; предыдущий scope (PR #329/#330) закрыт.
- Синхронизация на этот точный SHA безопасна и фактически не требует переноса изменений — workspace уже на нём.

## 3. Состав изменений (backend-скоуп нулевой)

Diff `HEAD~1..HEAD`: 3 файла, +42/−4.

- `src/components/admin/TokenizedRichInput.tsx`
- `src/lib/tokens/tokenRegistry.ts`
- `src/lib/tokens/tokenRegistry.test.ts`

Файлов в `supabase/migrations`, `supabase/functions` и `supabase/config.toml` в диффе **нет**.

## 4. EXECUTE-план (после отдельного одобрения)

1. **Preflight.** Подтвердить HEAD ровно `a4b67824…`, дерево чистое, очередь пуста.
2. **GitHub sync.** Подтверждение parity на точный SHA; правок исходников и коммитов нет.
3. **Build gate.** Прогнать production build и unit-тест `tokenRegistry.test.ts` — обязательный PASS до Publish.
4. **Publish.** Опубликовать frontend этого SHA. Никаких backend-действий.
5. **Post-publish acceptance.** Только проверки `/admin/deals` на опубликованном URL — desktop и mobile viewport.

## 5. Критерии приёмки

Единственные приёмочные проверки — post-publish desktop и mobile проверки `/admin/deals`
(редактор автоматизаций воронки): читаемый контраст, вертикальная прокрутка шторки доходит
до конца, значение условия по продукту — селектор, `[` открывает пикер плейсхолдеров.
Скриншоты без PII.

## 6. Подтверждение нулевого backend-скоупа

- Миграции: **0**. RLS/политики/гранты: **не затрагиваются**.
- Данные (сделки, задачи, платежи, пользователи, подписки, доступы): **не затрагиваются**.
- Секреты и cron (в т.ч. job 507): **не трогаются**.
- Edge Functions: **ни одна не деплоится**.

## 7. Стоп-условия

- HEAD ≠ `a4b67824…`, грязное дерево или непустая очередь → STOP.
- Появление в scope миграции, секрета, cron-, RLS- или function-изменения → STOP.
- Провал build или unit-тестов → STOP без Publish.
- Новый critical security finding → STOP до Publish.

## 8. Вне scope

Правки исходников и коммиты, любые миграции, изменение секретов/cron/RLS/данных, деплой
любых Edge Functions, создание сессий/пользователей, реальные письма, Telegram-сообщения и платежи.
