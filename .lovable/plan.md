План: read-only ревизия PR692 / PR693 / PR694 (ничего не внедрено)

## Сверка консолидированной ревизии Codex PLAN11423 (внесено / не внесено)
1. Dry-run PR694 — внесено. Codex выполнил exact helper: family 3 / 4 receipts, 1356/2034/678; mapOrderToPlan 4/6, status review, remaining NaN, next 2026-11-20T08:40:17Z. Моя трассировка (раздел 3) даёт то же. Ограничение sandbox остаётся: helper я не исполнял, обходов не было, новых harness нет.
2. PR694, новый head `ee48e5eb…` — внесено, дельта проверена. Compare `11209a34…ee48e5eb` = 2 файла: RELEASE.md и `_shared/cb21-release.ts`. В последнем меняется только `CB21_RELEASE_DIGEST` `8d80164c…` → `0afe3e97…`. Четыре CB21 функции (telegram-webhook, telegram-media-worker, sales-runtime-control, sales-runtime-worker) и instagram-monitor installment-модули напрямую не импортируют. Guard: не деплоить их, deploy только 3 финансовых функций. Опубликованный digest не объявлять аттестацией CB21. Ограничение: транзитивный граф импортов я сверил только на прямом уровне; полную проверку подтверждает CI Codex.
3. Порядок 692/693 и smoke — внесено. Порядок: merge 692 → rebase 693 на main → новый exact CI → merge; старый SHA не принимать. Лимит 4096 считается после разбора entities, длина escaped-текста ≠ видимой длине; при ошибке retry=false и черновик сохраняется. HTTP-ссылки в тексте допустимы, кнопки только HTTPS (моё замечание 5 снято). Smoke по фактическим контрактам: `public-checkout` публичный, 401 не ожидать. Только OPTIONS и заведомо invalid read без создания checkout, ссылок и сообщений. Автоматического retry deploy нет.
4. Случай Мацкевич — внесено отдельным разделом 10 (preflight только на чтение).

## 10. Случай Мацкевич: read-only preflight (отдельный scope, не связан с PR692–694)
Факты (живой read-only SQL):
- Заказ `dc6b8419…`: paid, product `2b7bf6d4…` (code `prd_8649986b7c9e`), tariff `ce13a0b5…`, владелец = auth `e296da5b…`.
- Подписка `8e17a0b4…`: active, тот же product/tariff, order = `dc6b8419…`, доступ до 2027-06-25 10:38:44.486+00.
- `entitlement_sources`: source `order` (status active, тот же product/tariff/order, expires 2027-06-25 10:38:59, revoked_at NULL) и отдельно `bonus` (Club, до 2026-09-28).
- `entitlements` у пользователя: cb_2_step и club активны, одна запись expired. По product `2b7bf6d4…` или code `prd_8649986b7c9e` записи нет — это подтверждено.
- Правило `557bc290…`: active, training_content, partial, product `2b7bf6d4…`, tariff `ce13a0b5…`, `b298240c…` в allowed_module_ids. Без entitlement по product bypass в `useMonthGate`/`useModuleMonthGate` не срабатывает, поэтому `/library/01082025` закрыт. Причина подтверждена кодом (useMonthGate ~176–215).
- Масштаб (обезличенно): активных order-источников без активного entitlement — 3, из них по этому product — 1 (этот случай).
- Поправка: мой поиск пропустил штатную `public.recalculate_entitlement_aggregate(uuid,uuid)`. Прежние варианты A/B (ручной INSERT, новый проектор) сняты.

Живая сверка функции (только чтение, без вызова):
- md5(pg_get_functiondef) = `ccb755edbf89e5a07cdf5c8fef494afa` — совпадает. SECURITY DEFINER, search_path = public, pg_temp.
- Execute: authenticated=false, anon=false, service_role=true (плюс postgres и managed executor).
- Что пишет: только `public.entitlements` — UPDATE meta, INSERT … ON CONFLICT (user_id, product_code) DO UPDATE, UPDATE status/expires/meta. Заказы, платежи, подписки, sources, бонусы, Telegram, http/net не трогает. Читает sources, subscriptions_v2, products_v2, profiles.
- Срок: CASE perpetual → NULL, иначе MAX(expires_at) по активным sources и subscriptions. Здесь это 2027-06-25 10:38:59.336016 (ES) > 10:38:44.486 (подписка): берётся канонический максимум, ни один срок не меняется.
- Триггеров на `entitlements` нет (non-internal = 0). Триггеры subscriptions_v2 (включая telegram grant) не срабатывают: функция subscriptions не пишет.

Bounded execute (только после отдельного одобрения Codex):
1. Drift guards (SELECT): заказ dc6… paid, tariff ce13…; ES `67f7b2d3…` active, не revoked, fingerprint `43da201b…`; подписка `8e17…` active, fingerprint `6ca47c18…`; E по product или code `prd_8649986b7c9e` отсутствует; md5 функции `ccb755ed…`; на entitlements 0 триггеров. Любое расхождение → STOP.
2. Снимок (count + md5) прочих E, всех ES и subscriptions пользователя, его payments и Club-записей.
3. Один вызов `select public.recalculate_entitlement_aggregate('e296da5b-…','2b7bf6d4-…')` под service_role. Повторов нет.
4. Ожидаемый результат: status active, profile `3c148831…`, product `2b7bf6d4…`, tariff ce13…, active_sources 1, active_subscriptions 1, perpetual false, expiry 2027-06-25T10:38:59.336016Z. order_id NULL (штатно), provenance в meta.effective_source_ref/type. Иное → STOP и доклад.
5. Read-back: ровно 1 новая E; снимки п.2 неизменны; ES и подписка — те же fingerprints.
6. Ручного INSERT нет, rollback через DELETE нет, новых периодов и августовской сделки нет. Сиротский платёж 250 (Club) не трогать. Остальные 2 случая из 3 не трогать.
7. Проверку открытия `/library/01082025` делает Codex на опубликованной версии, без PII.


## 0. Очередь и чистота — PASS
- HEAD = origin/main = `d299e5f853f72e8e85bba2682529f1fc22d3e338`, рабочее дерево чистое, других задач в Lovable нет.
- Exact heads в managed mirror недоступны (`not our ref`). Diff прочитан из публичного GitHub compare `d299e5f…...<head>` по каждому head:
  - PR692 `7f360042…`: 14 файлов (+500/−39) — frontend, `telegram-admin-chat/{index,messageFormat}.ts`, `system-health-full-check/preflight-manifest.generated.ts`.
  - PR693 `a74af055…`: 17 файлов (+397/−109) — только `src/**`.
  - PR694 `11209a34…`: 13 файлов (+480/−114) — frontend, `_shared/installment-*`, `bepaid-webhook/index.ts`, RELEASE.md.
- Миграций, SQL, RLS и config ни в одном PR нет.

## 1. Пересечения diff
- PR692 и PR693 оба меняют `ContactTelegramChat.tsx` и `TokenizedRichInput.tsx`. Изменения близко друг к другу (ContactTelegramChat ~1802–1828 и ~2317–2363, TokenizedRichInput ~420–510), поэтому конфликт при rebase вероятен. Тестовое слияние в sandbox запрещено, так что факт конфликта не проверен.
- Требование: второй из двух PR rebase на merged main, после чего повторно прогоняются его целевые тесты, tsc и build (CI на новом head).
- PR694 с ними не пересекается.

## 2. Совместимость, схема и RLS существующих чтений
- PR694 читает `orders_v2` (в т.ч. `bepaid_subscription_id`, `meta->>parent_order_id`) и вложенные `payments_v2`, во frontend — `provider_subscriptions` через FK `provider_subscriptions_order_id_fkey`. Все колонки и связь существуют, новых объектов нет.
- Edge-функции читают service-клиентом, как и раньше. Frontend-чтения идут под прежними admin-политиками.
- `installment-repayment-plan.ts` в PR694 получает только необязательное поле типа `updated_at?`, runtime не меняется. Поэтому `bepaid-admin-create-subscription-link`, которая тоже импортирует этот файл, повторно деплоить не нужно.
- PR693 не меняет запросы, только условия их монтирования (enabled/isActive). По умолчанию остальные вызовы сохраняются.

## 3. Dry-run PR694 на трёх сделках (только чтение)
Исполнить exact helper в sandbox нельзя: plan mode блокирует любые записи файлов. Поэтому выполнена построчная трассировка правил `installmentPaymentFamily` по живым минимальным строкам (только ключи lineage/flags и платежи, без PII).
- Семья: root `bee5e08a` (2 платежа) и children `88827d6c`, `6fc67521` (у каждого `parent_order_id` = root). Других потомков нет.
- Identity: user/product/tariff/currency и `bepaid_subscription_id` совпадают у всех трёх, `is_deleted=false`.
- Children: `source=bepaid_rebill`, `payment_flow=bepaid_subscription_charge`, manual_review/refund_candidate/do_not_grant_access не выставлены, `materialized_from_payment_uid` совпадает с bepaid UID собственного платежа.
- Платежи: 4 succeeded по 339, refunded 0, UID 4 различных, user/currency совпадают.
- Итог трассировки: 3 сделки и 4 платежа = 1356 BYN, итоговое `effective_total_byn` = 2034, арифметический остаток 678 (это 4 из 6 платежей).
- Root `manual_review=true`, поэтому `loadInstallmentRepaymentContext` бросает `installment_agreement_requires_review`: взыскание и новая ссылка заблокированы, оплаты видны. Значения 1950/594 не подтверждаются.
- Следующий платёж: ровно одна активная `provider_subscriptions`, next = `2026-11-20 08:40:17+00`. Кэшированный Aug22 и дату 2028 не использовать.
- Ограничение: helper не исполнялся. Codex должен прогнать exact-тест/скрипт helper на этих же строках (ожидание 4/6, 1356; блокировка manual_review).

## 4. Производительность
- PR693: снижает число запросов на закрытых и скрытых поверхностях. Измеренный baseline (80 запросов за 20 секунд) — не обещание.
- PR694: дополнительно BFS по `meta->>parent_order_id` до 1001 строки (лимит, fail-closed) и вложенные платежи. По JSON-пути индекса может не быть. Нагрузка низкая (единицы строк на семью), но это действие пользователя или webhook, а не массовый проход. Проверку индекса оставить follow-up, без миграции.
- PR692: нагрузку не меняет.

## 5. Риски и безопасность PR692 (новое сообщение и reply_markup)
- Кнопки: только HTTPS, без username/password, не больше 5, строгий text/url. Если у Business-пути есть кнопки, он отклоняется (путь прежний). parse_mode HTML только при opt-in `contact_markdown_v1`, всё прочее экранируется (`escapeHtml`, глубина 8).
- Замечание: ссылки внутри текста (bare и markdown) допускают `http:`, а не только `https:`. Credentials отсекаются и там. Это осознанное или нет — решение Codex, некритично.
- Риск: после экранирования текст может превысить лимит Telegram в 4096 символов. Нужно проверить, что ошибка не порождает retry (retry=false заявлен).
- Manifest system-health меняет только digest; `system-health-full-check` не деплоить.

## 6. Очерёдность (после CI PASS каждого exact head)
1. Merge PR694. Сверить merged SHA и tree, затем deploy по одной с health после каждой: `bepaid-webhook` → `admin-create-public-link` → `public-checkout`.
2. Merge PR692. Сверить SHA и tree, затем deploy `telegram-admin-chat` и health.
3. Rebase PR693 на main (если есть конфликт — повторный CI), merge, сверка.
4. Один frontend Publish итогового main SHA после всех PASS. Codex делает доказательства на опубликованной версии (ПК и mobile).

## 7. Безопасный runtime smoke (без отправок и платежей)
- Каждая функция: OPTIONS 2xx и неавторизованный POST 401/403. Проверить, что версия задеплоена.
- `bepaid-webhook`: только запрос без подписи → отказ. Никаких replay/provider sync.
- `admin-create-public-link` / `public-checkout`: только read-path ошибки валидации (invalid_order_id), реальные ссылки не создавать.
- `telegram-admin-chat`: только запрос без авторизации или с некорректным `message_format` → 400. Реальная отправка запрещена.
- Read-back трёх сделок: строки и флаги без изменений, `manual_review` остаётся true.

## 8. Откат
- Функции: повторный deploy предыдущего merged SHA (`d299e5f…`) для тех же имён.
- Frontend: Publish предыдущей версии.
- Данные не меняются, отката данных нет.

## 9. STOP-guards
- SHA/tree не совпадает, CI не PASS или конфликт rebase без повторного CI → STOP.
- Любой deploy или health неуспешен → STOP, без повторов вне согласованного одного retry.
- Изменились строки или флаги трёх сделок, появился refund/foreign payment → STOP.
- Не делать: миграции, снятие флагов, webhook/provider sync, реальные charge/сообщения, `system-health-full-check`, cron, полный scanner, пилот PR689.
