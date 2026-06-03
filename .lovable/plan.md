да, согласен

План теперь корректный:

- режим Stripe определяется по ключам;
- test checkout доступен только для `pk_test/sk_test`;
- live-ключи можно сохранить и проверить, но live checkout в Фазе 2 не открывается;
- mixed keys блокируются;
- bePaid не трогается;
- Stripe UI приводится к стилю bePaid;
- без миграций и без изменения webhook/refund/runtime.

Можно запускать PATCH.

&nbsp;

План:

1. **Проблема**
  - Текущий код запрещает live-ключи в save/test (`live_mode_disabled` + `mode_mismatch`) — нельзя сохранить и проверить реальный аккаунт.
  - При этом нельзя «развязать» режим платежей от типа ключей: тестовая оплата физически возможна только с `pk_test_/sk_test_`, а боевая — только с `pk_live_/sk_live_`. Stripe не позволяет иначе.
  - UI не отличает «Тестовое подключение» от «Боевого подключения» и не объясняет, почему sandbox-checkout в Фазе 2 невозможен с live-ключами.
  - Ключи в форме исчезают после неуспешной попытки «Сохранить и проверить», карточка показывает `secret_key_missing`.
  - Stripe-карточка визуально не соответствует UX bePaid.
2. **Диагностика**
  - `acquiring-save-connection`:
    - `test_mode=false` → `live_mode_disabled` (блокирует сохранение live).
    - `test_mode=true` требует `pk_test_/sk_test_` → `mode_mismatch` для live-ключей.
  - `acquiring-test-connection`:
    - после успешного `/balance` сравнивает `isTestKey !== conn.test_mode` → `mode_mismatch`.
  - `StripeConnectionDialog`:
    - «Боевой режим» disabled;
    - тексты говорят «режим — это отдельная настройка», что неверно: режим жёстко определяется типом ключа Stripe;
    - secret/webhook state очищается на каждом open.
  - `PaymentsIntegrationsPanel`: Stripe рендерится кастомной карточкой с `dl`-таблицей вместо строкового layout bePaid; webhook URL — отдельной плашкой снизу.
3. **Предлагаемое решение (новая модель режима)**
  - **Тип подключения определяется ТОЛЬКО префиксом ключа**, не отдельной настройкой:
    - `pk_test_` + `sk_test_/rk_test_` → connection_mode = `test`;
    - `pk_live_` + `sk_live_/rk_live_` → connection_mode = `live`;
    - публичный и секретный ключ ДОЛЖНЫ принадлежать одной семье — иначе ошибка `key_family_mismatch`.
  - **Sandbox checkout в Фазе 2 разрешён только при `connection_mode='test'**`. Боевое подключение в Фазе 2 можно сохранить и проверить (`/balance`, `/account`, webhook secret), но кнопка «Тестовая оплата» и сам `stripe-create-checkout` для live-подключения возвращают `sandbox_checkout_requires_test_keys` (HTTP 200 + fallback) с понятным русским сообщением.
  - **UI убирает выбор «Тестовый/Боевой режим»** — режим выводится автоматически по введённым ключам и показывается badge’ем: «Тестовое подключение» или «Боевое подключение».
  - **При вводе `pk_live_/sk_live_**` в форме показывается информационный блок:
  «Подключены боевые ключи Stripe. Проверка аккаунта доступна, но тестовая оплата в Фазе 2 недоступна. Для sandbox-проверки нужны ключи тестового режима Stripe.» + ссылка-подсказка где взять test-ключи (Stripe Dashboard → Developers → API keys → Test mode).
  - **Сохранение ключей**: введённые значения secret/webhook не сбрасываются при ошибке save/test до закрытия диалога.
  - **Stripe-карточка** в `PaymentsIntegrationsPanel` приводится к строковому UX bePaid (статус-точка, alias, badge подключения, «Проверено …», меню действий, раскрываемый webhook URL внутри строки).
4. **Изменяемые компоненты**
  - UI:
    - `src/components/admin/integrations/StripeConnectionDialog.tsx`
    - `src/components/admin/integrations/PaymentsIntegrationsPanel.tsx`
  - Edge functions:
    - `supabase/functions/acquiring-save-connection/index.ts`
    - `supabase/functions/acquiring-test-connection/index.ts`
    - `supabase/functions/stripe-create-checkout/index.ts` — добавить guard «sandbox checkout запрещён для live-подключения в Фазе 2»; других изменений не вносить.
  - DB:
    - **никаких миграций**. `acquiring_connections.test_mode` остаётся и будет автоматически выставляться на сервере по префиксу `secret_key` при сохранении (derived), а не задаваться пользователем.
  - Proof:
    - `.lovable/proofs/stripe_phase_2_mode_derived_from_keys_patch.md`
5. **Что не будет изменено**
  - Не трогать bePaid: `integration_instances`, `bepaid-*`, `create-payment-checkout.ts`.
  - Не трогать `stripe-webhook`, `stripe-get-session`, `stripe-list-events`, refund/idempotency/Vault-слой.
  - Не создавать новые таблицы/RPC/enum/маршруты.
  - Не вставлять и не хранить реальные secret-ключи пользователя; secret/webhook остаются write-only и не возвращаются в браузер.
6. **Dry-run**
  - Поискать использования `live_mode_disabled`, `mode_mismatch` и `test_mode` в edge functions и UI, убедиться, что нет других мест с дублирующими guard’ами.
  - Проверить, что `stripe-create-checkout` сейчас не имеет собственного mode-guard.
  - Проверить, что `acquiring_connections.test_mode` нигде не используется как самостоятельный бизнес-флаг (он будет derived и пишется только сервером).
7. **Execute**
  - `acquiring-save-connection`:
    - удалить `live_mode_disabled` и `mode_mismatch`;
    - оставить prefix-валидаторы Stripe: `pk_(test|live)_`, `sk|rk_(test|live)_`, `whsec_`;
    - добавить `key_family_mismatch`, если public и secret относятся к разным семьям (test vs live);
    - сервер сам выставляет `test_mode = secret_key.startsWith('sk_test_') || rk_test_`; присланное клиентом `test_mode` игнорируется;
    - сохранять `forbidden_redirect_host` guard как есть.
  - `acquiring-test-connection`:
    - убрать сравнение `isTestKey !== conn.test_mode → mode_mismatch`;
    - после `/balance` и `/account` нормализовать `test_mode` в `acquiring_connections` по фактическому secret_key (на случай ручной правки);
    - в `capabilities_snapshot.account` добавить `key_mode: 'test' | 'live'`.
  - `stripe-create-checkout`:
    - перед созданием Checkout Session, если `connection.test_mode === false`, возвращать HTTP 200 `{ ok: false, fallback: true, code: 'sandbox_checkout_requires_test_keys', message: 'Подключены боевые ключи Stripe. Тестовая оплата в Фазе 2 недоступна. Для sandbox-проверки переключите подключение на тестовые ключи Stripe (pk_test_/sk_test_).' }`.
  - `StripeConnectionDialog`:
    - удалить radio «Тестовый/Боевой режим»;
    - добавить вычисляемый «Тип подключения» бейдж: `pk_test_/sk_test_` → «Тестовое подключение», `pk_live_/sk_live_` → «Боевое подключение», иначе «Тип будет определён автоматически после ввода ключей»;
    - при `pk_live_/sk_live_` показать предупреждение: «Подключены боевые ключи Stripe. Проверка аккаунта доступна, но тестовая оплата в Фазе 2 недоступна. Для sandbox-проверки нужны ключи тестового режима Stripe.»;
    - при разных семьях public/secret показать ошибку `key_family_mismatch`: «Публичный и секретный ключи относятся к разным режимам Stripe. Используйте оба ключа одного режима — оба test или оба live.»;
    - убрать формулировки «режим платежей — отдельная настройка»;
    - не очищать введённые secret/webhook при failed save/test до явного закрытия диалога;
    - `translateServerError` обновить под новые коды (`sandbox_checkout_requires_test_keys`, `key_family_mismatch`, удалить `live_mode_disabled`).
  - `PaymentsIntegrationsPanel`:
    - заменить Stripe-карточку на строковый layout в стиле bePaid: цветной индикатор статуса, alias, badge «Тестовое подключение»/«Боевое подключение», «Проверено …», dropdown «Проверить / Настройки / Отключить»;
    - per-row раскрытие webhook URL;
    - для боевого подключения рядом со статусом показывать subtle пояснение: «Sandbox-checkout в Фазе 2 недоступен».
  - Создать proof-файл с Problem / Diagnose / Dry-run / Execute / STOP-guard / DoD / SYSTEM ACTOR proof.
8. **STOP-guards**
  - Остановиться, если найдётся другой checkout/runtime, который читает `test_mode` как guard от реального списания — нужно отдельно согласовать миграцию.
  - Не отключать guard в `stripe-webhook` (webhook может приходить и для live-аккаунта; только sandbox-checkout запрещён).
  - Не записывать secret/webhook значения в audit/console/UI/proof.
  - Не трогать bePaid prefix-логику в той же функции.
9. **DoD**
  - Сохранение и проверка подключения с `pk_live_/sk_live_/whsec_` проходят успешно: статус «Активен», бейдж «Боевое подключение», `secret_key_missing` не показывается.
  - Сохранение и проверка с `pk_test_/sk_test_/whsec_` проходят успешно: бейдж «Тестовое подключение».
  - При `pk_live_` + `sk_test_` (или наоборот) — ошибка `key_family_mismatch` с понятным русским сообщением.
  - Попытка sandbox-checkout по live-подключению возвращает понятное сообщение «нужны test-ключи» и не вызывает Stripe.
  - В диалоге Stripe больше нет переключателя «Тестовый/Боевой режим»; режим выводится по ключам.
  - При неуспешной проверке введённые ключи остаются в форме до явного закрытия диалога.
  - Stripe в `/admin/integrations/payments` визуально оформлен как обычное подключение в стиле bePaid.
  - bePaid визуально и функционально не изменён.
  - Proof создан: `.lovable/proofs/stripe_phase_2_mode_derived_from_keys_patch.md`.
10. **Риски и зависимости**
  - `acquiring_connections.test_mode` становится derived-полем — оно ещё может использоваться в админ-вьюхах. Будет принудительно нормализоваться сервером, поэтому ручная правка перекрывается следующей `save/test`.
  - Текст «Боевое подключение» рядом с активным Stripe-аккаунтом — визуальный сигнал админу; в Фазе 2 реальные платежи через Stripe всё равно не запускаются (только sandbox-проверка `/balance`, `/account`, webhook).
  - Live-checkout (реальное списание) будет включён отдельным согласованием в следующей фазе — этот PATCH не открывает live-checkout.
11. **Требуется дополнительная информация**
  - Не требуется.