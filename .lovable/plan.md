# PLAN-ONLY / STRICT READ-ONLY — GitHub main SHA ee77ea75 (PR #344, /cb UI)

Изменений не вносилось: код не редактировался, коммиты/миграции не создавались, SQL-записи, RLS, данные, секреты, cron, деплой функций и Publish не выполнялись.

## VERDICT: PASS

## 1) SHA и паритет

- Managed HEAD = `ee77ea754cc3a00f5d76a58ea795843980a2ae0a` — «fix(cb): normalize tariff and payment button layout (#344)». Точное совпадение с указанным origin/main SHA.
- `git status --porcelain` пусто → полный byte-identical паритет с этим SHA.

## 2) Состав PR #344 (frontend-only)

```text
 src/pages/CbNativePreview.tsx                              |   3 +-
 src/pages/cb-native/__tests__/tariffAccessMatrix.test.tsx  | 115 ++++++++++
 src/pages/cb-native/__tests__/tariffPublicContract.test.ts |  24 ++-
 src/pages/cb-native/sections/CbNativeTariffCard.tsx        |  85 +++++----
 src/pages/cb-native/tariffPublicContract.ts                |  38 ++--
 5 files changed, 213 insertions(+), 52 deletions(-)
```

- Миграций в PR нет; `supabase/migrations/` без новых файлов относительно применённого состояния.
- Edge Functions не затронуты → deploy не требуется.
- Данные (tariffs / tariff_offers / prices / payment methods / document_params / access rules) не затрагиваются: изменения — только рендер и сортировка на клиенте.

## 3) Соответствие scope

- Порядок тарифов: `sortCbTariffsForDisplay` → Бухгалтер (0) → Главный бухгалтер (1) → Бизнес-леди (2), по идентичности тарифа, не по порядку БД.
- Порядок кнопок: `offerSemanticOrder` → 100% картой (0) → банковская рассрочка (1) → 2 платежа / internal_installment (2) → счёт ЮЛ / invoice (3). Совпадает с требуемым каноном.
- Стиль кнопки: `CbNativeTariffCard.tsx:252` читает исключительно `offer.meta.site_button_variant`; slot/position hardcode для стиля отсутствует (slot используется только как fallback сортировки, не как источник внешнего вида).

## 4) EXECUTE PLAN (frontend-only)

1. **Preflight.** Read-back managed HEAD = `ee77ea754cc3a00f5d76a58ea795843980a2ae0a`, дерево чистое (допустимы только `.lovable/` plan-markdown). Иначе — STOP.
2. **Gates (read-only).** `tsgo --noEmit` без ошибок; `vitest run src/pages/cb-native/__tests__` — PASS; `npm run build` — успешно.
3. **Security.** `get_scan_results`: 0 нерешённых critical findings в scope.
4. **Publish.** Только frontend, ровно на этом SHA. Отчёт: публичный URL + effective SHA.
5. **QA (без реальных транзакций).** Открыть `https://gorbova.by/cb` desktop 1280 и mobile 390: порядок карточек Бухгалтер → Главный бухгалтер → Бизнес-леди; в каждой карточке ровно 4 кнопки в порядке 100% картой → банк → 2 платежа → юрлицо; стили соответствуют `site_button_variant`; текст не обрезан и не перекрывается. Диалоги оплаты не отправляются: проверка останавливается до submit. Реальные payment/order/contact/message не создаются.

Не выполняются: миграции, изменения RLS/GRANT, изменения данных и метаданных офферов, секреты, cron, деплой Edge Functions, Storage, отправка писем/Telegram.

## Hard stop conditions

- HEAD ≠ `ee77ea75…` или грязное дерево (кроме `.lovable`) — STOP.
- Ошибка typecheck/тестов/build — STOP без Publish.
- Новый critical security finding — STOP.
- Любое требование backend/data-изменения в этом scope — STOP и отдельный approve.

## ИТОГ: PLAN PASS — ожидаю «EXECUTE APPROVED».
