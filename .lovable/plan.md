дополни план следующей информацией:

1. **Явно указать найденную корневую проблему**
  - payment-method-verify-recurring отключена и возвращает 410;
  - UI всё ещё показывает/порождает сценарий «перепроверки»;
  - из-за этого пользователь видит техническую ошибку или вечный pending.
2. **Добавить точный список файлов для проверки**
3. **Убрать принудительную формулировку в PaymentDialog.tsx**  
Заменить:  
Для активации пробного периода необходимо привязать банковскую карту  
на:  
Для пробного периода можно добровольно привязать карту, чтобы после окончания пробного периода удобно продолжить оплату подписки. Оплата и доступ не зависят от обязательного сохранения карты.  
Если бизнес-логика trial реально требует карту для будущего автосписания — писать честно:
4. **Добавить отдельный блок “карта не обязательна”**  
Проверить все registration/onboarding/payment screens и зафиксировать:
  - карта не требуется для регистрации;
  - карта не требуется для входа;
  - карта не требуется для обычной оплаты без сохранения;
  - карта нужна только добровольно для удобства или подписки/автопродления, если пользователь выбирает такой сценарий.
5. **Кнопку “Перепроверить” убрать или сделать disabled**  
Если recurring verification отключён:
  - не вызывать payment-method-verify-recurring;
  - не создавать payment_method_verification_jobs;
  - не ставить карту в verification_status='pending'.
6. Вместо кнопки показать:
7. **Проверить существующие pending jobs**  
Перед изменениями выполнить dry-run:  
SELECT verification_status, count(*)
8. FROM payment_methods
9. GROUP BY verification_status;
10. &nbsp;
11. SELECT status, count(*)
12. FROM payment_method_verification_jobs
13. GROUP BY status;  
Если есть старые pending без рабочего обработчика — отдельный safe patch:
  - не удалять;
  - пометить как canceled/unsupported;
  - добавить meta/reason;
  - audit_logs обязателен.
14. **Зеленые бейджи по картам**  
Добавить состояния:  
Карта привязана
15. Основная карта
16. Можно использовать для оплаты
17. Можно использовать для подписки
18. Требуется 3D-Secure
19. Проверка недоступна  
Зеленый бейдж — только если карта реально usable.
20. **Ошибки Edge Functions**  
В PaymentMethods.tsx и PaymentDialog.tsx нельзя показывать:  
Edge Function returned a non-2xx status code  
Нужно извлекать нормальное сообщение из body/error payload через normalizeEdgeFunctionError.
21. **3D Secure**  
Не открывать 3DS/checkout в маленьком modal/drawer/iframe.  
Для мобильного:
  - full-page redirect;
  - после возврата — статус оплаты;
  - не пытаться визуально “втиснуть” bank checkout.
22. **STOP-guards**  
Запретить в этом патче:

- менять orders_v2;
- менять payments_v2;
- менять entitlements;
- удалять карты;
- менять bePaid webhook;
- делать карту обязательной;
- отключать оплату без сохранения карты.

11. **DoD**  
Добавить proof:

- grep не находит обязательных формулировок про карту;

- регистрация проходит без карты;

- обычная оплата без сохранения карты доступна;

- привязанная карта показывает зеленый бейдж;

- основная карта отображается;

- “Перепроверить” не вызывает 410-функцию;

- pending jobs больше не создаются;

- edge errors нормализованы;

- 3DS mobile-safe;

- финальный отчет: changed files + diff-summary + screenshots/proof.

Готовый блок для Lovable:

Дополни план обязательными правками:

&nbsp;

1. Зафиксировать root cause: `payment-method-verify-recurring` отключена и возвращает 410, но UI всё ещё показывает сценарий “Перепроверить” / создаёт verification jobs.

&nbsp;

2. Проверить и изменить файлы:

- `src/components/payment/PaymentDialog.tsx`

- `src/pages/settings/PaymentMethods.tsx`

- `src/utils/normalizeEdgeFunctionError.ts`

- `src/components/onboarding/WelcomeOnboardingModal.tsx`

- `src/components/auth/InlineAuthForm.tsx`

- `supabase/functions/payment-method-verify-recurring/index.ts`

- `supabase/functions/bepaid-create-subscription/index.ts`

- `supabase/functions/create-subscription-checkout/index.ts`

&nbsp;

3. Убрать принудительные формулировки о карте. Карта не обязательна для регистрации, входа и обычной оплаты. Карта — добровольная опция для удобства будущих оплат / подписок / автосписаний, если пользователь выбирает такой сценарий.

&nbsp;

4. В `PaymentDialog.tsx` заменить текст “Для активации пробного периода необходимо привязать банковскую карту” на добровольную формулировку без давления.

&nbsp;

5. Если recurring verification отключён:

- убрать активную кнопку “Перепроверить”;

- не вызывать `payment-method-verify-recurring`;

- не создавать `payment_method_verification_jobs`;

- не переводить карту в вечный `pending`.

&nbsp;

6. Перед изменениями выполнить dry-run по старым pending jobs:

```sql

SELECT verification_status, count(*)

FROM payment_methods

GROUP BY verification_status;

&nbsp;

SELECT status, count(*)

FROM payment_method_verification_jobs

GROUP BY status;

7. Если есть старые pending jobs без рабочего обработчика — отдельный safe patch: не удалять, а пометить canceled/unsupported с meta/reason и audit_logs.
8. Добавить зеленые бейджи:

- “Карта привязана”
- “Основная карта”
- “Можно использовать для оплаты”
- “Можно использовать для подписки”
- “Требуется 3D-Secure”
- “Проверка недоступна”

9. Починить обработку ошибок edge-функций: вместо “Edge Function returned a non-2xx status code” показывать понятную причину из body/error payload через normalizeEdgeFunctionError.
10. Для 3D Secure использовать mobile-safe/full-page redirect, не открывать checkout в маленьком modal/drawer/iframe.
11. STOP-guards:

- не менять orders_v2;
- не менять payments_v2;
- не менять entitlements;
- не удалять карты;
- не менять bePaid webhook;
- не делать карту обязательной;
- не отключать оплату без сохранения карты.

12. DoD:

- grep не находит обязательных формулировок про карту;
- регистрация проходит без карты;
- обычная оплата без сохранения карты доступна;
- привязанная карта показывает зеленый бейдж;
- основная карта отображается;
- “Перепроверить” не вызывает 410-функцию;
- pending jobs больше не создаются;
- edge errors нормализованы;
- 3DS mobile-safe;
- финальный отчет содержит changed files, diff-summary и proof по каждому платёжному сценарию.

&nbsp;

План: Аудит и исправление платёжных потоков (с расширенным UX-патчем по добровольной привязке карты)

## Чек-лист всех платёжных путей (что проверено)


| #   | Точка входа                                                          | Edge-функция                                                        | Текущий статус                                                                                                                               | Действие                                          |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 1   | `/pay/:token` (публичная ссылка)                                     | `public-checkout` (GET+POST) → `_shared/create-payment-checkout.ts` | ✅ Работает                                                                                                                                   | Не трогаем                                        |
| 2   | `/pay?product=…` → `PaymentDialog`                                   | `bepaid-create-token` / `bepaid-create-subscription-checkout`       | ⚠️ В диалоге фраза «необходимо привязать банковскую карту»                                                                                   | Заменить формулировку                             |
| 3   | `OrderPayment.tsx` (повтор оплаты)                                   | `bepaid-create-token`                                               | ✅                                                                                                                                            | Не трогаем                                        |
| 4   | `/settings/payment-methods` → «Привязать карту»                      | `payment-methods-tokenize`                                          | ✅ Корректно (tokenization, amount=0)                                                                                                         | Не трогаем серверную часть                        |
| 5   | `/settings/payment-methods` → «Подключить bePaid» / «Изменить карту» | `bepaid-create-subscription`                                        | ⚠️ 4xx/409 → пользователь видит «Edge Function returned a non-2xx status code»                                                               | Парсить тело ошибки + нормализовать               |
| 6   | `/settings/payment-methods` → «Отменить подписку»                    | `bepaid-cancel-subscriptions`                                       | ✅                                                                                                                                            | Только нормализация ошибок                        |
| 7   | `/settings/payment-methods` → «Перепроверить» карту                  | `payment-method-verify-recurring`                                   | ❌ Функция возвращает HTTP 410 (MIT-режим выведен 2026-04-23). UI создаёт job в БД, который никем не обрабатывается. Карта вечно в `pending`. | **Полностью убрать кнопку и логику создания job** |
| 8   | `/settings/payment-methods` → «Отвязать карту»                       | прямой UPDATE `payment_methods.status='revoked'`                    | ✅                                                                                                                                            | Не трогаем                                        |
| 9   | Регистрация / `InlineAuthForm`                                       | —                                                                   | ✅ Карту не требует                                                                                                                           | Не трогаем                                        |
| 10  | Онбординг / `WelcomeOnboardingModal`                                 | —                                                                   | ✅ Карту не требует                                                                                                                           | Не трогаем                                        |
| 11  | Webhook bePaid                                                       | `bepaid-webhook`                                                    | ✅                                                                                                                                            | **STOP-guard: НЕ трогаем**                        |


## Корневые причины

### A. «Edge Function returned a non-2xx status code»

`supabase.functions.invoke()` при HTTP 4xx/5xx выкидывает `FunctionsHttpError` с сырым сообщением, а `data` становится `null`. Поэтому проверки `data?.error.includes('409')` в `handleCreateProviderSubscription` никогда не срабатывают. Утилита `normalizeEdgeFunctionError` сейчас прячет всё за фразой «Функция временно недоступна», теряя реальную причину.

### B. Кнопка «Перепроверить» бесполезна

Edge-функция намеренно возвращает HTTP 410 (см. `payment-method-verify-recurring/index.ts` строки 197–223). UI создаёт `payment_method_verification_jobs` и ставит карту в `verification_status='pending'` навсегда. Job не обрабатывается. Пользователь видит «Проверяем карту…» бесконечно.

### C. Алярмистские бейджи «Не для автоплатежей»

Для legacy-карт со статусом `rejected` отображается красный бейдж и пугающее предупреждение. Это **неверно**: разовая оплата с этой же карты прекрасно проходит через bePaid-checkout с 3DS. Бейджи MIT-режима больше не отражают реальность системы.

### D. Принудительная формулировка про карту

В `PaymentDialog.tsx:1121` написано: *«Для активации пробного периода необходимо привязать банковскую карту»* — нарушает принцип добровольности.

### E. 3D-Secure окно

3DS уже открывается через full-page `window.location.href = redirect_url` (не в iframe). Обрезание — особенность hosted-checkout bePaid на стороне банка-эквайера. Решить полностью на нашей стороне нельзя. Можем только убедиться, что нигде не обернули checkout в drawer/modal/iframe (проверил — нет, везде full-page redirect).

## Изменения

### 1. `src/utils/normalizeEdgeFunctionError.ts` — улучшение нормализации

Расширить сигнатуру: `normalizeEdgeFunctionError(error, fallbackData?)`.

- Сначала пытаться достать `error.context.body` (Supabase JS v2.95+ кладёт сырой Response туда) — распарсить JSON, взять `error`/`message`/`details`.
- Если есть `fallbackData?.error` — использовать его.
- Маппинг частых кодов → русские тексты:
  - `Already has active provider subscription` → «У вас уже есть активная подписка bePaid. Проверьте её статус ниже или отмените, чтобы создать новую.»
  - `MISSING_EXPLICIT_CHOICE` → «Действие требует подтверждения. Обновите страницу.»
  - `BEPAID_CREDS_MISSING` → «Платёжная система временно недоступна. Попробуйте через минуту.»
  - `identity_required` → «Не удалось подтвердить аккаунт. Войдите или укажите email.»
  - `Could not determine subscription amount` → «Не удалось определить сумму подписки. Свяжитесь с поддержкой.»
  - `Access denied` → «Действие не разрешено для вашего аккаунта.»
  - HTTP 410 / `disabled: true` → «Эта операция временно отключена.»
- Только если ничего не извлеклось — fallback «Функция временно недоступна. Попробуйте через 10 секунд.»

### 2. `src/pages/settings/PaymentMethods.tsx` — главный рефактор

**Удалить:**

- Кнопку «Перепроверить» (строки ~797–812) и мутацию `reverifyMutation` (строки 442–487).
- Поллинг `useEffect` для `pollingCardId` + state `pollingCardId` (строки 57–58, 158–197).
- Все legacy-бейджи на основе `verification_status`: `pending`/`verified`/`verified_refund_pending`/`rejected`/`rejected_3ds_required`/`failed` (строки 731–787).
- Жёлтый блок-предупреждение «⚠️ Оплата этой картой может требовать 3D-Secure» (строки 862–869).
- Старые пугающие тосты «Проверяем для автоплатежей…» / «Карта не подходит для автоплатежей» (строки 144, 147, 183, 187).

**Заменить на новый UX:**

- На каждой привязанной карте по умолчанию показывать зелёные бейджи:
  - 🟢 **«Карта привязана»** (всегда, если status='active' и не expired)
  - 🟢 **«Можно использовать для оплаты»** (всегда)
  - 🟢 **«Основная карта»** (если `is_default`)
  - 🟢 **«Готова для подписок»** — показывать **только** если `verification_status === 'verified'` или `'verified_refund_pending'` (явный позитивный сигнал). Для всех остальных статусов — **не показываем никаких красных/жёлтых бейджей**, просто опускаем «Готова для подписок».
- Под списком карт добавить нейтральную инфо-плашку: *«Привязка карты — добровольная опция для удобства будущих оплат. Вы всегда можете оплачивать без сохранения карты. Если карта потребует 3D-Secure при подписке, мы предложим оплатить заново.»*
- Заголовок страницы оставить, описание сделать мягче: *«Сохранённые карты для удобной оплаты. Привязка карты не обязательна.»*

**Корректная обработка ошибок:**

- В `handleCreateProviderSubscription`, `handleChangeProviderCard`, `cancelProviderSubMutation.onError`, `deleteMutation.onError`, `setDefaultMutation.onError`, `handleAddCard` catch:
  ```ts
  } catch (error: any) {
    toast.error(normalizeEdgeFunctionError(error, error?.context?.body));
  }
  ```
- Удалить кустарные проверки `msg.includes('409')` — теперь делает `normalizeEdgeFunctionError`.

### 3. `src/components/payment/PaymentDialog.tsx`

Заменить строку 1121 *«Для активации пробного периода необходимо привязать банковскую карту»* на:
*«Для активации пробного периода понадобится карта — она будет использована для автоматического продления после окончания триала. Без триала можно оплатить полную стоимость сразу.»*

Также пробежаться по всем сопроводительным текстам в этом файле и убрать любые «обязательно/нужно/необходимо привязать» — заменить на нейтральные формулировки.

### 4. `src/components/admin/cards/CardVerificationControl.tsx` (админ-панель)

Это admin-only тулза для ручного запуска проверки карт. Так как функция возвращает 410 — добавить плашку:
*«⚠️ MIT-проверка карт отключена с 2026-04-23. Этот инструмент сейчас не выполняет действий. Для автопродления используйте `provider_managed` (bePaid SBS) подписки.»*
Кнопку оставить (для будущего восстановления), но пометить «Disabled by config».

### 5. `supabase/functions/payment-method-verify-recurring/index.ts` (defensive cleanup)

Перед `return jsonResponse(..., 410)` добавить (если в payload есть `cleanup_jobs: true`):

- UPDATE `payment_method_verification_jobs SET status='cancelled', error='mit_disabled' WHERE status IN ('pending','rate_limited')`
- UPDATE `payment_methods SET verification_status=NULL WHERE verification_status='pending'`

Это разовая защита — если кто-то всё-таки создаст job в обход (старый клиент в кэше), он не зависнет.

**Не меняем** базовое 410-поведение (оно намеренное, согласовано). Только добавляем опциональный cleanup-хук.

### 6. Проверить отсутствие принудительных формулировок в других местах

- `WelcomeOnboardingModal.tsx` — карту не требует ✅
- `InlineAuthForm.tsx` — карту не требует ✅
- Регистрация (`/auth`) — карту не требует ✅

## STOP-guards (НЕ трогаем)

- ❌ `orders_v2`, `payments_v2`, `entitlements`, `subscriptions_v2` — без миграций.
- ❌ `bepaid-webhook` и любая webhook-логика — без правок.
- ❌ Существующие платёжные ссылки `/pay/:token`, `/pay?product=…` — UX и контракты не меняются.
- ❌ Удаление чужих карт пользователей — нет.
- ❌ Контракт `payment-method-verify-recurring` (410-ответ) сохраняется.
- ❌ RLS-политики не меняем.
- ❌ Никаких изменений в обязательности оплаты — оплата без сохранения карты остаётся доступной (через `bepaid-create-token`).

## DoD — критерии готовности

1. ✅ Регистрация / онбординг не требуют привязки карты (уже так, подтверждено аудитом).
2. ✅ В ЛК карта описана как добровольная опция (новый текст).
3. ✅ Привязанная карта имеет зелёные бейджи: «Карта привязана», «Можно использовать для оплаты», «Основная карта», «Готова для подписок» (только если действительно verified).
4. ✅ Основная карта по-прежнему отображается отдельно (бейдж `Star + «Основная»`).
5. ✅ Кнопка «Перепроверить» удалена; функция 410 не вызывается из UI.
6. ✅ Новые `payment_method_verification_jobs` из UI не создаются.
7. ✅ Ошибки edge-функций показываются понятным русским текстом через расширенный `normalizeEdgeFunctionError`.
8. ✅ 3DS открывается full-page redirect (уже так, не в iframe/modal).
9. ✅ Оплата без сохранения карты остаётся доступной (через checkout по ссылкам и `Pay.tsx`).
10. ✅ Финальный отчёт включает diff-summary по файлам и proof-скриншоты:
  - `/settings/payment-methods` без «Перепроверить» и с зелёными бейджами;
    - тост ошибки с человеко-читаемым текстом (симуляция дубликата подписки);
    - `PaymentDialog` без формулировки «необходимо привязать».

## Файлы к изменению


| Файл                                                          | Тип правки                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/utils/normalizeEdgeFunctionError.ts`                     | Расширение сигнатуры + маппинг ошибок                                                      |
| `src/pages/settings/PaymentMethods.tsx`                       | Удаление reverify UX, новые зелёные бейджи, нормализация ошибок, добровольная формулировка |
| `src/components/payment/PaymentDialog.tsx`                    | Замена принудительной формулировки про триал                                               |
| `src/components/admin/cards/CardVerificationControl.tsx`      | Disabled-плашка для админа                                                                 |
| `supabase/functions/payment-method-verify-recurring/index.ts` | Опциональный cleanup-хук (не меняет 410-поведение)                                         |


## Файлы НЕ трогаем

- `supabase/functions/public-checkout/*`, `bepaid-create-subscription/*`, `bepaid-cancel-subscriptions/*`, `bepaid-webhook/*`, `payment-methods-tokenize/*`, `_shared/create-payment-checkout.ts` — серверная логика оплаты корректна.
- `src/pages/PublicPayPage.tsx`, `src/pages/Pay.tsx`, `src/pages/OrderPayment.tsx` — пользовательские потоки оплаты работают.
- БД-миграции не требуются.