План: read-only ревизия PR692 / PR693 / PR694 (ничего не внедрено)

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
