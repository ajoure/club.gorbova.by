# Stripe Phase 2 — Mode Derived From Keys + bePaid-Style UX Patch

## Problem
- Сервер блокировал live-ключи Stripe: `live_mode_disabled` + `mode_mismatch` в `acquiring-save-connection` и `acquiring-test-connection`.
- UI делал вид, что «режим Stripe» — отдельная настройка, независимая от ключей. Это неверно: в Stripe режим всегда привязан к семье ключа (`pk_test_/sk_test_` vs `pk_live_/sk_live_`).
- При неуспешном save введённые secret/webhook очищались, и следующая проверка падала с `secret_key_missing`.
- Stripe-карточка визуально отличалась от bePaid (dl-таблица + отдельная плашка webhook).

## Diagnose
- `acquiring-save-connection`: `validatePrefixes` возвращал `live_mode_disabled` при `test_mode=false` и `mode_mismatch` при несовпадении префикса с `test_mode`.
- `acquiring-test-connection`: после `/balance` сравнивал `isTestKey !== conn.test_mode` → `mode_mismatch`.
- `StripeConnectionDialog`: radio «test/live» с disabled live, тексты о «независимом режиме», state ключей не переживал ошибку save.
- `PaymentsIntegrationsPanel`: рендерил Stripe собственной grid-карточкой; bePaid использовал `IntegrationInstanceList`.
- `stripe-create-checkout`: возвращал HTTP 400 `phase_2_test_mode_only` для live-подключения — это блокировало корректное сохранение/проверку реального аккаунта.

## Dry-run
- `live_mode_disabled` и `mode_mismatch` использовались только в `acquiring-save-connection` и `acquiring-test-connection`.
- `acquiring_connections.test_mode` читается в `stripe-create-checkout` как guard sandbox-checkout — нужный нам сигнал; в остальных edge-функциях не критичен.
- `stripe-create-checkout` единственная точка, открывающая checkout по Stripe в Фазе 2; других обходных путей нет.
- bePaid prefix-логика не затронута.

## Execute
- **`supabase/functions/acquiring-save-connection/index.ts`**
  - Удалены `live_mode_disabled` и `mode_mismatch`.
  - Оставлены prefix-валидаторы `pk_(test|live)_`, `(sk|rk)_(test|live)_`, `whsec_`.
  - Добавлен `key_family_mismatch`, если publishable и secret относятся к разным семьям.
  - Сервер сам выставляет `test_mode = secret_key.startsWith('sk_test_'|'rk_test_')`. Если secret_key не передан в текущем submit, читает уже сохранённый из Vault для существующего подключения; иначе — выводит из publishable_key.
  - `forbidden_redirect_host` оставлен.
  - Ответ содержит `connection_mode: 'test' | 'live'`.
- **`supabase/functions/acquiring-test-connection/index.ts`**
  - Удалён блок `isTestKey !== conn.test_mode → mode_mismatch`.
  - После успешной проверки `/balance` + `/account` нормализуется `test_mode` в строке `acquiring_connections` по реальному ключу.
  - В `capabilities_snapshot.account` добавлено `key_mode: 'test' | 'live'`.
- **`supabase/functions/stripe-create-checkout/index.ts`**
  - Вместо HTTP 400 `phase_2_test_mode_only` возвращается HTTP 200 `{ ok:false, fallback:true, code:'sandbox_checkout_requires_test_keys', message: '...' }` — это позволяет live-аккаунт сохранять и проверять, не открывая реальное списание.
- **`src/components/admin/integrations/StripeConnectionDialog.tsx`**
  - Удалён radio «Тестовый/Боевой режим».
  - Добавлен derived-бейдж «Тестовое подключение» / «Боевое подключение» / «Будет определён по ключам».
  - При live-ключах показывается info-блок: «Подключены боевые ключи Stripe. Проверка аккаунта доступна, но тестовая оплата в Фазе 2 недоступна. Для sandbox-проверки нужны ключи тестового режима Stripe.»
  - При смешанных семьях ключей показывается ошибка `key_family_mismatch`, кнопка save заблокирована.
  - `translateServerError` обновлён под новые коды; `live_mode_disabled` удалён.
  - При неуспешном save введённые secret/webhook **не сбрасываются** до явного закрытия диалога — фикс `secret_key_missing` race-loop.
- **`src/components/admin/integrations/PaymentsIntegrationsPanel.tsx`**
  - Stripe-подключение рендерится в стиле bePaid: цветной кружок-статус, alias + status badge + mode badge + (опц.) «По умолчанию», «Проверено …», `last_error` строкой ниже, dropdown «Проверить / Настройки / Отключить», webhook URL разворачивается per-row.
  - Для боевых подключений в Фазе 2 рядом со статусом показывается «Sandbox-checkout в Фазе 2 недоступен».

## STOP-guards
- bePaid pipeline, `integration_instances`, `bepaid-*`, `create-payment-checkout.ts` не тронуты.
- `stripe-webhook`, `stripe-get-session`, `stripe-list-events`, Vault-слой не тронуты.
- Никаких миграций / новых таблиц / RPC / enum / маршрутов.
- Secret-значения не пишутся в audit/console/UI/proof. В лог `validation failed` идут только префиксы (8/8/6 символов) — никогда не полное значение.
- Live-checkout по-прежнему запрещён в Фазе 2.

## DoD
- [x] `pk_live_/sk_live_/whsec_` теперь можно сохранить и пройти проверку — статус становится `active`, бейдж «Боевое подключение».
- [x] `pk_test_/sk_test_/whsec_` сохраняется и проверяется как «Тестовое подключение».
- [x] Смешанные семьи (pk_live + sk_test или наоборот) → ошибка `key_family_mismatch` с понятным русским сообщением, save заблокирован.
- [x] Попытка sandbox-checkout по live-подключению → HTTP 200 с `code: sandbox_checkout_requires_test_keys` и русским объяснением; реальный платёж не создаётся.
- [x] В диалоге Stripe нет radio «Тестовый/Боевой режим» — режим определяется по ключам и подсвечивается бейджем.
- [x] При неуспешной проверке введённые ключи остаются в форме до явного закрытия диалога.
- [x] Stripe в `/admin/integrations/payments` визуально оформлен как bePaid (строки, цветной индикатор, dropdown, раскрываемый webhook URL).
- [x] bePaid визуально и функционально не изменён.

## SYSTEM ACTOR proof
- Изменения только в коде (UI + edge functions). Миграций / DB-записей / `audit_logs` не требуется — `test_mode` нормализуется самой edge-функцией при следующем save/test.
- Свежие save/test от super_admin будут логироваться существующим audit-каналом edge-функций без изменений.
