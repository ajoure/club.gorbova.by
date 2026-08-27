# Отчет о выполнении: PLAN-ONLY REVIEW платёжного scope карточки контакта

Строго read-only. Ноль изменений: без edits, commits, SQL/DDL/DML, deploy, build, Publish.

Managed HEAD = `f2e1b643b` («Work in progress» бота) поверх целевого `f8c1b6213`. Дельта `f8c1b6213..HEAD` = ровно 3 автогенерируемых файла (`src/integrations/supabase/client.ts`, `previewAuthStorage.ts`, `types.ts`). Прикладного кода в дельте нет — ревизия валидна для целевого SHA.

## A. Подтверждение findings

1. **PODTVERŽDENO.** `src/components/admin/AdminPaymentLinkDialog.tsx:1152-1158` шлёт `offer_id`; `supabase/functions/public-rr-installment-initiate/index.ts:66,253,264` читает `tariff_offer_id` и отдаёт 400 `tariff_offer_id_invalid`. RR из карточки контакта не работает всегда, а не иногда.
2. **PODTVERŽDENO.** Функция возвращает `payment_url` (строки 211, 588, 649, 695, 979); UI читает только `redirect_url`/`url` (строка 1160) → даже при исправлении п.1 будет ложная ошибка «RR не вернул redirect_url».
3. **PODTVERŽDENO.** Строки 280-293: `userId` берётся из JWT Bearer. `functions.invoke` подставляет JWT менеджера, поэтому `user_id` заказа, referral-логика (355-378) и `account_user_id` (512) привяжутся к сотруднику, а не к контакту. Это data-integrity/финансовый дефект: заказ и будущий доступ уедут на менеджера.
4. **PODTVERŽDENO.** В `InitiatePayload` нет `adjustment_amount`/`adjustment_reason`. `allocateComposablePayableTotal` в RR применяется только к referral credit. Скидка, показанная админом в диалоге, в RR-сумму не попадёт → расхождение «показали одно, списали другое».
5. **PODTVERŽDENO, рассогласование даже шире.**
   - UI: `ContactDetailSheet.tsx:2592` — кнопка только под `isAdmin()`.
   - `admin-create-payment-link/index.ts:45-52` — `has_permission('entitlements.manage')`, а `public.has_permission` мапит `entitlements` → секция `payments`, action `manage` → фактически требуется **payments:manage**, не edit.
   - `admin-create-public-link/index.ts:107-113` — hard-coded `manager/menedzher/admin/super_admin` через `has_role_v2`.
   - `admin-invoice-checkout-issue/index.ts:90-97` — свой hard-coded список тех же ролей.
   - `composable-checkout-quote/index.ts:32-40` — снова свой hard-coded список (гейт на adjustment).
   - `telegram-send-notification/index.ts:81-88` — `entitlements.manage` (значит комбинированный сценарий «ссылка + Telegram» упадёт на втором шаге у payments:edit-роли).
   - `public-rr-installment-initiate` — admin payment gate отсутствует вовсе.
6. **PODTVERŽDENO косвенно** (в этой сессии POST не выполнялись): все пять функций присутствуют в `supabase/functions/`, `composable-checkout-quote` и `public-rr-installment-initiate` объявлены в `config.toml` с `verify_jwt = false`.
7. **PODTVERŽDENO.** В ходе ревизии выполнялись только `SELECT` к каталогу БД. Заказы, ссылки, оплаты, сообщения не создавались.

**Проверка канонических примитивов (production, project_ref hdjgkjceownmmnrqqtuz):**
- `public.has_admin_section_access(uuid, text, text)` существует, содержит bypass для `super_admin`/`admin` через `has_role_v2`, ранги none/view/edit/manage.
- Секция `payments` существует и активна (`admin_section.code='payments'`, `is_active=true`).
- Нюанс, который надо учесть в реализации: `has_admin_section_access` смотрит только строки с `resource_code IS NULL`, то есть resource-override (`admin_resource`, напр. `manual-payment`) в серверный гейт не попадает. Гейт по секции — корректный минимум; полагаться на resource-override нельзя.

## B. Блокеры (security / data / payment)

- **B1 (критично).** Ownership RR-заказа. Нельзя добавлять admin-mode, пока `user_id` не берётся из проверенного `target_user_id`, а actor не пишется отдельно в meta/audit. Иначе — заказы, entitlements и referral-начисления на менеджера.
- **B2 (критично).** `adjustment_amount` в RR обязан приниматься **только** в admin-mode после проверки `payments:edit`, иначе публичный клиент сможет назначить себе цену. Публичный вызов с `target_user_id` или `adjustment_*` должен получать 403, а не игнорироваться молча.
- **B3 (высокий).** `verify_jwt = false` у `public-rr-installment-initiate` сохраняется (public flow). Значит admin-mode проверяется **вручную в коде**: Bearer обязателен, `auth.getUser` (не только чтение claims), затем `has_admin_section_access(actor,'payments','edit')`. Текущий код читает claims без верификации через getUser — для public-режима допустимо, для admin-режима нет.
- **B4 (средний).** Переход `entitlements.manage` → `payments:edit` — это расширение прав. Для `admin-create-payment-link` и `telegram-send-notification` (user-path) это допустимо по заданию, но `telegram-send-notification` используется и вне платёжного контекста: понижение до `payments:edit` там надо делать точечно, иначе рассылки станут доступнее, чем ожидалось. Рекомендация: в `telegram-send-notification` проверять `communication:edit OR payments:edit`, а не заменять код целиком.
- **B5 (средний).** Не понижать `composable-checkout-quote` до «любого JWT»: гейт на adjustment обязан остаться и стать `payments:edit`.
- **B6.** Тестовых заказов/оплат в проде не создавать; RR upstream создаёт реальный заказ рассрочки — любая RR-проверка в проде запрещена без отдельного разрешения.

## C. Минимальный file-level план реализации

**Frontend**
1. `src/components/admin/ContactDetailSheet.tsx` — заменить `isAdmin()` у кнопки «Ссылка на оплату» на `useAdminAccess().canAccessSection("payments","edit")` (bypass admin/super_admin уже внутри хука). Кнопку «Списать деньги» не трогать.
2. `src/components/admin/AdminPaymentLinkDialog.tsx`
   - `handleInitiateRr`: слать `tariff_offer_id` (вместо `offer_id`), добавить `target_user_id: userId`, `adjustment_amount: composableAdjustment`, `adjustment_reason`; читать `payment_url ?? redirect_url ?? url`; сохранить существующую валидацию «причина обязательна при ненулевой корректировке».
   - Гейт write-кнопок (создать ссылку, публичная ссылка, Telegram-сценарий, RR, счёт) по `canAccessSection("payments","edit")`; при `view` — read-only.

**Backend (Edge Functions)**
3. `supabase/functions/_shared/` — новый хелпер `require-payments-edit.ts`: verify Bearer через `auth.getUser`, затем `has_admin_section_access(actor,'payments','edit')`; типизированные ответы 401/403.
4. `admin-create-payment-link/index.ts` — заменить `has_permission('entitlements.manage')` на хелпер.
5. `admin-create-public-link/index.ts` — заменить hard-coded role list на хелпер (super_admin-bypass для auto-режима на строках 261-262 оставить как есть).
6. `admin-invoice-checkout-issue/index.ts` — заменить hard-coded role list на хелпер.
7. `composable-checkout-quote/index.ts` — `isStaff` → результат хелпера (adjustment-гейт остаётся).
8. `telegram-send-notification/index.ts` — user-path: `communication:edit OR payments:edit` вместо `entitlements.manage`.
9. `public-rr-installment-initiate/index.ts` — добавить admin-mode:
   - `target_user_id` в payload → включает admin-mode;
   - в admin-mode: Bearer обязателен, `getUser`, `payments:edit`, загрузка target-профиля server-side, `userId = target_user_id`, actor в `meta.admin_actor_id` и в audit;
   - `adjustment_amount`/`adjustment_reason` принимаются только в admin-mode: cents-precision, обязательная причина, итог > 0, применение через `allocateComposablePayableTotal`;
   - public caller, приславший `target_user_id` или `adjustment_*`, получает 403 `admin_fields_forbidden`;
   - имя/email/телефон в admin-mode берутся из профиля (не доверять телу запроса).

**Тесты** — см. раздел E.

## D. Migration / RLS / config / deploy impact

- **Миграции: не требуются.** `has_admin_section_access` и секция `payments` уже существуют в проде.
- **RLS: без изменений.** Все writers работают через service role внутри функций.
- **config.toml: без изменений.** `verify_jwt=false` у `public-rr-installment-initiate` и `composable-checkout-quote` сохраняется намеренно; admin-mode проверяется в коде.
- **functions.registry.txt:** уже содержит `admin-create-payment-link`, `admin-create-public-link`, `admin-invoice-checkout-issue`, `telegram-send-notification`. Требуется добавить `composable-checkout-quote` и `public-rr-installment-initiate`, если их там нет (проверить перед merge).
- **Redeploy после merge — ровно 6 функций:** `public-rr-installment-initiate`, `admin-create-payment-link`, `admin-create-public-link`, `admin-invoice-checkout-issue`, `composable-checkout-quote`, `telegram-send-notification`. Плюс любая функция, которая начнёт импортировать новый `_shared/require-payments-edit.ts`.
- Provider webhooks (`bepaid-webhook`, `stripe-webhook`) не затрагиваются и не редеплоятся.

## E. Тестовая матрица и безопасная production-проверка

**Unit / contract (vitest + существующий стиль `src/test/*`):**
1. admin bypass: `admin`/`super_admin` → allow во всех 6 функциях.
2. `payments:edit` → allow write.
3. `payments:view` → 403 на всех write-путях.
4. без доступа → 403.
5. RR admin-mode: `user_id` заказа = `target_user_id`, actor только в meta/audit.
6. RR public-mode с `target_user_id` или `adjustment_*` → 403 `admin_fields_forbidden`.
7. Adjustment parity: total из `composable-checkout-quote` == RR total при одинаковых входных данных; неверная копейка/пустая причина/нулевой или отрицательный итог → 400.
8. Контракт имён: UI шлёт `tariff_offer_id`, читает `payment_url` (тест на regression имени поля).
9. Regression публичного RR: анонимный вызов без `target_user_id` работает как раньше.
10. UI-гейт: `ContactDetailSheet` рендерит кнопку при `payments:edit`, скрывает при `view`/none.

**Production verification без реальной оплаты:**
- OPTIONS-пробы 6 функций (200/204).
- Негативные POST на существующем контакте: `payments:view`-актор → ожидаемый 403 (заказ не создаётся); публичный вызов с `target_user_id` → 403.
- `composable-checkout-quote` с `payments:edit` — read-only котировка, заказ не создаётся: сверка total.
- Read-back счётчиков `orders_v2`, `payment_links`, `entitlements` до/после — дельта 0.
- Логи задеплоенных функций: `booted`, отсутствие 5xx.
- **RR happy-path в проде не выполняется** (создаёт реальный заказ рассрочки) — только после отдельного разрешения и на согласованном тестовом контакте.

## F. Вердикт

**PASS WITH REQUIRED FIXES.**

Архитектура предложена верно и подтверждена фактами кода и production-схемой. Обязательные уточнения перед реализацией:
1. `telegram-send-notification` — не заменять гейт целиком на payments, использовать `communication:edit OR payments:edit` (B4).
2. В RR admin-mode обязательна верификация JWT через `auth.getUser`, а не чтение claims (B3).
3. Публичный caller с admin-полями должен получать явный 403, а не тихое игнорирование (B2).
4. Учесть, что `has_admin_section_access` не видит resource-override — гейт строить только по секции `payments`.
5. Миграции не нужны; после merge redeploy ровно 6 перечисленных функций.
