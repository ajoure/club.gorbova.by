# EXECUTE: deploy 6 Edge Functions + Publish frontend с SHA 8fd0da79b

Файл создан только чтобы разблокировать approve-карточку (Plan mode требует её). Кода он не меняет.

## Пройденные гейты (уже проверено, read-only)
- managed mirror: HEAD `ce97da2c1` поверх целевого `8fd0da79b`; дельта = ровно 3 автогенерируемых файла (`src/integrations/supabase/client.ts`, `previewAuthStorage.ts`, `types.ts`). Payment/UI/function-файлы байт-идентичны exact SHA.
- Shared-зависимости на месте, включая новый `supabase/functions/_shared/admin-section-auth.ts`.
- `src/test/contactPaymentLinksRbacRegression.test.ts` — 7/7 PASS.

## Что будет выполнено после approve
1. Deploy ровно 6 функций из exact SHA: `public-rr-installment-initiate`, `admin-create-payment-link`, `admin-create-public-link`, `admin-invoice-checkout-issue`, `composable-checkout-quote`, `telegram-send-notification`.
2. Read-back статусов/версий и логов (ожидание: `booted`, без 5xx).
3. Safe smoke: OPTIONS-пробы и отрицательные авторизационные запросы (401/403). Реальные ссылки, заказы, счета, платежи, Telegram-сообщения, пользователи и контакты НЕ создаются.
4. Production build и Publish frontend с exact SHA — только если все гейты PASS.

## Не выполняется
SQL/DDL/DML, миграции, RLS/Auth/Storage/config, изменения кода, коммиты, ветки. Provider webhooks не трогаются и не редеплоятся.

## STOP-условия
Расхождение SHA, missing dependency, новый critical/high finding, неясный результат deploy или 5xx в логах — остановка без Publish.
