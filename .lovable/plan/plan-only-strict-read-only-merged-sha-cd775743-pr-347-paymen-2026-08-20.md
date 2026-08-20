# PLAN-ONLY / STRICT READ-ONLY — merged SHA cd775743 (PR #347, payment method label в module checkout)

Изменений не вносилось: код не редактировался, коммиты не создавались, миграции не применялись, SQL-записи, RLS, данные, секреты, cron, deploy функций и Publish не выполнялись.

## VERDICT: PASS — frontend-only, готово к Publish

## 1) SHA и паритет

- Managed HEAD = `cd7757439497dcb089780e8928a085f6c1b99439` — «fix(cb21): show configured payment method in module checkout (#347)». Точное совпадение с указанным merged SHA (не просто паритет — буквально тот же коммит).
- `git status --porcelain` пусто → дерево чистое, managed `.lovable` артефактов сверх коммита нет.
- `git diff --name-only cd775743 HEAD` пусто.

## 2) Scope — только frontend, backend не затронут

Коммит меняет ровно 4 файла, все в `src/`:

| Файл | Изменение |
|---|---|
| `src/components/payment/ComposableCheckoutDialog.tsx` | новый обязательный prop `paymentMethodLabel: string`; хардкод `paymentMethodLabel="Одной оплатой"` в `OrderSummary` заменён на проброшенное значение (строка 179) |
| `src/components/landing/UniversalPricingSection.tsx` | передаёт `paymentMethodLabel={selectedOffer.offer.button_label}` |
| `src/pages/SitePageBySlug.tsx` | передаёт `paymentMethodLabel={resolved.offer.button_label}` |
| `src/components/payment/ComposableCheckoutDialog.test.tsx` | покрытие: label из оффера отображается; primary-item в quote |

- Миграций в коммите нет; `supabase/functions/**` не затронут; `supabase/config.toml` не менялся.
- Нет SQL, нет data writes, нет изменений RLS/GRANT/секретов/cron.
- Строка «Одной оплатой» в кодовой базе больше не встречается (`rg` — 0 совпадений).
- Оба публичных входа в composable-checkout (`/cb` через `SitePageBySlug` и лендинговый `UniversalPricingSection`) прокинуты; третий вызов `OrderSummary` — `InvoiceCheckoutDialog` с собственным корректным лейблом «Счёт на юрлицо / ИП», он вне scope и не менялся.

## 3) Gates (выполнены read-only)

| Проверка | Результат |
|---|---|
| `npx tsgo --noEmit` | PASS, 0 ошибок |
| `bunx vitest run src/components/payment/ComposableCheckoutDialog.test.tsx` | PASS 2/2 |
| `npm run build` (production) | PASS, `✓ built in 45.17s`, только предупреждение о размере чанков |
| Security scan | новых critical findings нет; статус — только `warn`/`info`, все предсуществующие и вне scope PR #347 |

## 4) Причина статуса «Build unsuccessful»

Воспроизвести не удалось — статус не подтверждается фактами:

- Локальная production-сборка на этом SHA завершается успешно (exit 0), в выводе нет ни одной строки `error`/`failed`.
- Предыдущий build-лог (`/tmp/build.log`, 21:10 UTC, до синка PR #347) также завершается `✓ built`, ошибок не содержит.
- Dev-сервер отвечает `HTTP 200`; в консоли превью только React-warning `Function components cannot be given refs` (`TariffCard` / `UniversalPricingSection`) — предсуществующее предупреждение, не ошибка сборки и не регрессия PR #347.

Вывод: это устаревший (stale) индикатор от build-прогона, стартовавшего до/во время синхронизации коммита `cd775743`, а не реальная ошибка компиляции. Никаких исправлений не требуется и не вносилось. Повторный Publish на этом SHA обнулит статус.

## 5) EXACT EXECUTE / PUBLISH PLAN (frontend-only)

1. **Preflight.** Подтвердить managed HEAD = `cd7757439497dcb089780e8928a085f6c1b99439`, `git status --porcelain` пусто (допустим только managed `.lovable/` plan-коммит). Любое расхождение — STOP.
2. **Gates.** Повторить `npx tsgo --noEmit`, `bunx vitest run src/components/payment/ComposableCheckoutDialog.test.tsx`, `npm run build`. Любая ошибка — STOP.
3. **Security.** `get_scan_results`: при появлении нового critical finding — STOP.
4. **Publish.** Только frontend, ровно на этом SHA. Ни миграций, ни deploy Edge Functions, ни data writes.
5. **Read-back.** Effective managed SHA, публичный URL, статус custom domains.
6. **Acceptance (без транзакций).** `https://gorbova.by/cb`, desktop 1280 и mobile 390: открыть модуль-чекаут из кнопок «Оплатить 100% картой», «Оплатить в 2 платежа», «Рассрочка банка» — в блоке «Способ оплаты» отображается текст соответствующей кнопки оффера, а не «Одной оплатой». Проверка останавливается до submit — реальные payment/order/contact/message не создаются.

## Hard stop conditions

- HEAD ≠ `cd775743…` или грязное дерево (кроме managed `.lovable`) — STOP.
- Любая ошибка typecheck / теста / build — STOP.
- Новый critical security finding — STOP.
- Любая попытка backend-изменения (migration, function deploy, data write) — вне scope, STOP.

## ИТОГ: PLAN PASS — ожидаю «EXECUTE APPROVED».
