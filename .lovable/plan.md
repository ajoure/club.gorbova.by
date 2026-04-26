да, согласен, с учетом правок:

1. **PATCH-UI-A и PATCH-UI-B можно выполнять сразу**
  - Они изолированы.
  - Не затрагивают платежные данные.
  - Не меняют `orders_v2`, `payments_v2`, `entitlements`, webhook.
2. **PATCH-PAY-C выполнять только отдельным циклом**  
Перед ним обязательно:
  &nbsp;
  ```text
  Plan → Dry-run → Execute → Verify
  ```
  И только после compatibility check по `bepaid-webhook`, `admin-manual-charge`, `bepaid-create-token`.
3. **Уточнить статус** `orders_v2`  
В плане написано `pending`. Нужно сверить фактический enum/status в проекте. Не использовать новый статус, если его нет. Брать тот же initial status, что в текущем checkout-flow.
4. **Уточнить поле** `tracking_id`  
В плане указано `orders_v2.tracking_id OR meta.tracking_id`. Перед реализацией надо зафиксировать один вариант по факту схемы и webhook-кода. Нельзя писать в новое/несуществующее поле.
5. `payment_links.current_uses` **не увеличивать до успешного webhook**  
При создании попытки saved-card payment нельзя считать ссылку использованной. Увеличение usage должно происходить только по текущей логике успешной оплаты, если она уже есть.
6. **Не хранить** `redirect_url` **в order meta без необходимости**  
Для idempotency лучше хранить:
  &nbsp;
  ```text
  idempotency_key
  gateway_uid
  tracking_id
  flow='saved_card_public_pay'
  status='redirect_issued'
  ```
  `redirect_url` от банка может быть одноразовым/устаревшим. При повторном клике безопаснее возвращать 409/“платёж уже создан”, чем повторно отдавать старый ACS URL, если provider не гарантирует повторное использование.
7. **Фронт не должен читать** `provider_token` **даже косвенно**  
Селект только:
  &nbsp;
  ```sql
  id, brand, last4, exp_month, exp_year, is_default
  ```
  А наличие токена подтверждает только edge function. На фронте можно показывать кнопку по активной карте, но окончательный допуск — только сервером.
8. **Idempotency на фронте**  
`idempotency_key` должен жить в `useRef`, а не пересоздаваться при rerender:
9. **Rate limit**  
В текущем плане rate limit фактически заменён idempotency. Это допустимо для первого релиза, но добавить в deferred:
  &nbsp;
  ```text
  отдельный rate-limit table/RPC для saved-card attempts
  ```
  Не реализовывать через `audit_logs`.
10. **Audit: “4 события” может быть 2–4 по ветке**  
Не всегда будет 4 события:

- при validation fail — только `.failed`;
- при gateway timeout — `.requested`, `.gateway_called`, `.failed`;
- при 3DS — `.requested`, `.gateway_called`, `.redirect_issued`;
- при instant success — `.requested`, `.gateway_called`, возможно `.redirect_issued` не нужен.

DoD лучше формулировать так:

```text
audit_logs содержит корректную цепочку событий по фактической ветке выполнения
```

11. **UI copy**  
На кнопке лучше:

```text
Оплатить сохранённой картой •••• 3587
```

Подпись:

```text
Банк может запросить подтверждение 3D-Secure.
```

Не писать, что оплата будет “в один клик”, если 3DS почти всегда потребуется.

12. **Admin manual-charge не использовать как бизнес-основание для публичного flow без проверки**  
Его можно использовать как payload reference, но public-flow должен иметь свои guards:

- JWT;
- ownership;
- link validity;
- canonical return_url;
- idempotency.

13. **DoD-A дополнить**

```text
rg "payment_method_verification_jobs|verificationJobsMap|LinkedCardItem" src/components/admin/ContactDetailSheet.tsx
→ 0 совпадений
```

14. **DoD-B дополнить**  
Скриншоты можно заменить code/browser proof, если нет доступа к auth-preview, но исполнитель должен приложить:

```text
360x800
414x896
1024x768
```

или явно указать, почему скрин невозможен.

15. **DoD-C дополнить SQL-proof**  
После тестовой оплаты:

```sql
SELECT id, status, meta
FROM orders_v2
WHERE meta->>'idempotency_key' = '<key>';

SELECT action, actor_type, actor_user_id, actor_label, meta
FROM audit_logs
WHERE action LIKE 'payment.saved_card_charge.%'
ORDER BY created_at DESC;
```

Итог: план хороший и готов к выполнению в указанном порядке. PATCH-UI-A/B можно запускать. PATCH-PAY-C — только отдельным execute-циклом после проверки webhook/tracking/status contract.

&nbsp;

План: 3 независимых патча — UI карт + оплата сохранённой картой через bePaid

## PATCH-UI-A. Админка `ContactDetailSheet` — убрать «медкарту»

**Pre-check (обязательно перед правкой):**

```text
rg "LinkedCardItem|ContactCardHealthSection|payment_method_verification_jobs|verificationJobsMap"
```

Если `LinkedCardItem` / `ContactCardHealthSection` используются в других местах — НЕ удаляем файлы, только перестаём импортировать в `ContactDetailSheet.tsx`.

**Изменения в `src/components/admin/ContactDetailSheet.tsx`:**

- Убрать импорт `LinkedCardItem`.
- Убрать запрос `verificationJobsMap` (выборка `payment_method_verification_jobs`) и связанные query-keys.
- Блок «Привязанные карты» рендерит каждую карту как простую строку:
  - иконка `CreditCard` + `BRAND •••• 1234`
  - срок `до MM/YY`
  - бейдж «Основная» (если `is_default`)
  - бейдж «Истекла» (если `exp_year/exp_month` < сейчас)
- Никаких `verification_status`, `supports_recurring`, `recurring_verified`, `verification_error`, jobs, "Ошибка шлюза…", «Перепроверить».
- Кнопки «Списать деньги» (super_admin) и «Ссылка на оплату» (admin) — без изменений.

**DoD-A:**

- `ContactDetailSheet.tsx` не импортирует `LinkedCardItem` и не делает запросов к `payment_method_verification_jobs`.
- В UI блока «Привязанные карты» нет ни одного из удалённых элементов.
- `LinkedCardItem.tsx` / `ContactCardHealthSection.tsx` остаются на месте (не удаляем — могут использоваться диагностикой).

---

## PATCH-UI-B. Личный кабинет `/settings/payment-methods` — визуальные карточки

**Файл:** `src/pages/settings/PaymentMethods.tsx`

**Layout:**

- Контейнер: `max-w-4xl mx-auto px-3 sm:px-4 space-y-6`.
- Сетка карт: `grid grid-cols-1 md:grid-cols-2 gap-4`.
- Каждая карта — визуальный «банковский» блок с градиентом по бренду (visa/mastercard/maestro/belkart/неизвестный → нейтральный градиент через токены `from-primary to-primary/70`), aspect-ratio ≈ 1.586 (стандарт ID-1), max-width ~360px, белый текст.
- Внутри карточки: номер `•••• •••• •••• 1234` (моно), срок «VALID THRU MM/YY», бренд-надпись справа сверху.
- Действия — `DropdownMenu` (троеточие в углу карточки): «Сделать основной» / «Отвязать».
- Бейджи поверх карточки: только «Основная» (звёздочка) и «Истекла» (если applicable).

**Удалить бейджи:** «Карта привязана», «Можно использовать для оплаты», «Готова для подписок».

**Текст подзаголовка страницы:**

> Привязка карты — добровольная опция для быстрой оплаты. Автосписаний без вашего действия нет.

Существующий длинный `Alert` со «Сохранённая карта…» убираем (заменён подзаголовком).

**Сохраняем без изменений:** блок «Настройка автопродления» (eligible subs → bePaid SBS), блок «Подписки bePaid (каждые 30 дней)» с действиями «Изменить карту»/«Отменить».

**QA на мобайл (исполнителем):**

- Скрин 360x800, 414x896, 1024x768.
- Карточка не вылезает за viewport, dropdown открывается в пределах экрана, текст не клиппится.

**DoD-B:**

- `max-w-2xl` → `max-w-4xl`, грид карточек.
- Только бейджи «Основная» / «Истекла».
- Подзаголовок обновлён.
- Скрины 360/414/1024 подтверждены без overflow.

---

## PATCH-PAY-C. `/pay/:token` — оплата сохранённой картой через `public-charge-saved-card`

### C.1. Pre-execute compatibility check (обязательно)

Перед написанием функции проверяем кодом:

```text
rg -n "tracking_id|orders_v2|payments_v2" supabase/functions/bepaid-webhook/index.ts
```

Подтвердить:

- webhook ищет `orders_v2` / `payments_v2` по `tracking_id` (строковое поле).
- формат `tracking_id` совместим с тем, что используется в `bepaid-create-token` / `admin-manual-charge` (e.g. `order_<uuid>` или `pl_<linkid>_<rand>`).
- успешный webhook закрывает order и триггерит `grant-access-for-order`.

Если что-то не совпадает — план дорабатывается до execute.

Также вычитываем `admin-manual-charge` и фиксируем **точный** контракт payload, который реально работает с bePaid (поля `transaction.payment_method.credit_card.token`, `transaction.contract`, `transaction.tracking_id`, `return_url`). Используем те же поля 1-в-1, без переизобретения. Терминологию «CIT/MIT» в коде/UI/комментариях не используем — пишем нейтрально: «оплата сохранённой картой с возможным подтверждением 3D-Secure».

### C.2. Edge function `public-charge-saved-card`

**Файл:** `supabase/functions/public-charge-saved-card/index.ts`

**Контракт запроса (вход):**

```json
{
  "link_token": "string",
  "payment_method_id": "uuid",
  "idempotency_key": "string (client-generated, optional)"
}
```

- `return_url` с фронта НЕ принимаем.

**Авторизация:**

- JWT обязателен. Без auth → 401.
- `auth.uid()` извлекается из JWT и используется как `user_id` для всех проверок и audit.

**Проверки (все обязательны):**

1. `payment_links` по `url_token`: статус активен, не истёк, `current_uses < max_uses`.
2. `payment_links.user_id IS NULL` ИЛИ `payment_links.user_id = auth.uid()` — иначе 403.
3. `payment_methods` по `id`:
  - `user_id = auth.uid()` (иначе 403)
  - `status = 'active'`
  - `provider = 'bepaid'`
  - `provider_token IS NOT NULL`
  - `(exp_year, exp_month)` не истёк.
4. **НЕ используем** `verification_status`, `supports_recurring`, `recurring_verified`, `payment_method_verification_jobs` как критерий допуска.

**Idempotency / double-click guard:**

- Ключ: `idempotency_key` от фронта (UUID, генерируется при mount страницы) ИЛИ детерминированный `sha256(user_id|link_token|payment_method_id|amount|date_minute)`.
- Перед созданием order: `SELECT` существующего `orders_v2` по `meta->>'idempotency_key'` за последние 10 минут для (user_id, link_token).
- Если найден — НЕ создаём второй order, возвращаем существующий `redirect_url`/`status` (если сохранён в `meta`) или 409 с `order_id` существующего заказа.
- Реализация — через колонку `orders_v2.meta` (JSONB), без новой таблицы. `audit_logs` НЕ используем как источник истины для idempotency.

**Lifecycle order/payment:**

- Создаём `orders_v2` со статусом `pending` (или текущий аналог "ожидает оплаты", сверяемся с тем, как это делает `bepaid-create-token`).
- `tracking_id` формируется по паттерну, совместимому с webhook (тот же, что в `bepaid-create-token`/`admin-manual-charge`). Сохраняем в `orders_v2.tracking_id` (или `meta.tracking_id` — как в существующем коде).
- `meta` order: `{ source: 'saved_card_public_pay', link_token, payment_method_id, idempotency_key }`.
- Перед gateway-call помечаем order как «attempt issued», сохраняя `tracking_id`.

**Return URL — ТОЛЬКО server-side через canonical builder:**

- Импортируем canonical-логику (порт `src/utils/buildPublicPaymentUrl.ts` в Deno-стиле либо просто хардкод `CANONICAL_PUBLIC_HOST = 'https://club.gorbova.by'` + проверка `product.primary_domain`).
- `return_url = ${origin}/payment-result?tracking_id=${tracking_id}` (точный path сверить с существующим flow).
- Запрещены: `lovable.dev`, `lovable.app`, `lovableproject.com`, `localhost`, `127.0.0.1`. Любой external host игнорируется.

**Gateway call:**

- `POST https://gateway.bepaid.by/transactions/payments` с Basic Auth (`BEPAID_SHOP_ID:BEPAID_SECRET_KEY` из env, как в `admin-manual-charge`).
- Payload — строго по образцу `admin-manual-charge`:
  ```json
  {
    "request": {
      "amount": <minor_units>,
      "currency": "BYN",
      "description": "<link.title or product name>",
      "tracking_id": "<tracking_id>",
      "return_url": "<canonical return_url>",
      "payment_method": { "credit_card": { "token": "<provider_token>" } },
      "contract": ["recurring", "unscheduled"]
    }
  }
  ```
  (Точный набор полей и `contract` — копируем из работающего `admin-manual-charge`, без отсебятины.)

**Обработка ответа:**

- Если `transaction.status === 'successful'` без 3DS → возвращаем `{ status: 'success', redirect_url: '<canonical /payment-result?tracking_id=...>', order_id }`. Финализация — webhook'ом.
- Если есть `transaction.redirect_url` (3DS challenge) → возвращаем `{ status: 'redirect', redirect_url, order_id }`.
- Если `failed/error` → НЕ удаляем order (помечаем `meta.last_error`, статус остаётся pending или переходит в `failed` — как в существующем flow), возвращаем `{ status: 'failed', error: '<нормализованное сообщение>' }` со статусом 200 (чтобы фронт показал ошибку через `normalizeEdgeFunctionError`, без 500).
- gateway timeout / network error: статус 502, `{ status: 'failed', error: 'Платёжный шлюз недоступен' }`. Order остаётся pending — оркестратор/реконсиляция подхватит.

**Orphan pending orders:** существующая reconcile-логика (cron `bepaid-queue-cron`/`bepaid-sync-orchestrator`) обрабатывает pending orders по `tracking_id`. Новый flow ничего нового не плодит.

**ВАЖНО: provider_token НЕ возвращаем на фронт** ни в каком ответе, ни в логах. Логируем максимум `last4`/`brand`.

**Audit (4 события):**

```text
payment.saved_card_charge.requested      // сразу после валидации входа
payment.saved_card_charge.gateway_called // перед gateway POST
payment.saved_card_charge.redirect_issued // если 3DS redirect
payment.saved_card_charge.failed          // на любой ошибке (gw error, validation, gateway failed status)
```

Поля каждой записи:

```text
actor_type     = 'user'
actor_user_id  = auth.uid()
actor_label    = 'saved-card-public-pay'
target_user_id = auth.uid()
meta           = {
  payment_method_id, link_token, order_id,
  tracking_id, gateway_uid (если есть),
  brand, last4 (только маскированные),
  error (для .failed)
}
```

### C.3. Frontend — `/pay/:token`

**Файлы:** `src/pages/PublicPayPage.tsx` (основной) + `src/pages/Pay.tsx` (если использует тот же flow).

**Условия показа кнопки «Оплатить сохранённой картой ····XXXX»:**

- юзер авторизован (`useAuth().user`);
- запрос к `payment_methods` для `auth.uid()` находит хотя бы одну с: `status='active'`, `provider='bepaid'`, `provider_token IS NOT NULL` (но `provider_token` приходит из RLS-защищённой таблицы — на фронт он попадать может только в виде факта существования; **в state храним только id/brand/last4/exp**, не сам токен. Селект на фронте — `select('id, brand, last4, exp_month, exp_year, is_default')`, без `provider_token`);
- карта не истекла (по `exp_month/exp_year`);
- `payment_links.user_id IS NULL` ИЛИ `= auth.uid()` (проверка — на серверной resolve-ручке ссылки, фронт получает флаг `can_use_saved_card`).

**UI:**

- Над основной кнопкой «Оплатить XYZ BYN» — дополнительная кнопка `Оплатить сохранённой картой VISA •••• 3587` (берём `is_default=true`, или единственную).
- Подпись мелким шрифтом: «Может потребоваться подтверждение 3D-Secure от банка».
- Основная кнопка остаётся как fallback с лейблом «Оплатить другой картой».

**Обработчик клика:**

- Генерируется `idempotency_key = crypto.randomUUID()` ОДИН раз на mount (если хранить в `useState/useRef`), чтобы при двойном клике уходил тот же ключ.
- Кнопка disabled во время запроса.
- `supabase.functions.invoke('public-charge-saved-card', { body: { link_token, payment_method_id, idempotency_key } })`.
- Ответ:
  - `status: 'redirect'` → `window.location.href = redirect_url` (3DS).
  - `status: 'success'` → `window.location.href = redirect_url` (canonical `/payment-result?tracking_id=...`).
  - `status: 'failed'` → `toast.error(normalizeEdgeFunctionError(error, ...))`, кнопка снова enabled.

### C.4. STOP-guards (зашиваем в код функции и фронта)

- не списывать без `auth.uid()` (401);
- не использовать чужую карту (`payment_methods.user_id != auth.uid()` → 403);
- не принимать arbitrary `return_url` с фронта;
- не создавать второй order при повторном клике (idempotency check);
- не использовать `verification_status` / `supports_recurring` / `recurring_verified` как критерий;
- не менять `bepaid-webhook`;
- не менять `admin-manual-charge`;
- не менять `bepaid-create-token` (guest checkout);
- не менять `payment-method-verify-recurring` (отключена и остаётся);
- не возвращать `provider_token` во frontend response;
- не логировать `provider_token` ни в audit, ни в console (только маскированные `brand`/`last4`);
- никаких автосписаний и фоновых charge — только явный клик пользователя.

### C.5. DoD-C

- Edge function `public-charge-saved-card` задеплоена, JWT-required, валидирует владение картой, аудитит 4 события.
- На `/pay/:token`: авторизованный владелец карты с активной bePaid-картой видит кнопку «Оплатить сохранённой картой». Гость или владелец без подходящей карты — не видит.
- Клик → 3DS-redirect или прямой success → возврат на canonical `/payment-result?tracking_id=...`.
- Кнопка «Оплатить другой картой» (виджет bePaid через `bepaid-create-token`) остаётся доступна и работает как раньше.
- Двойной клик не создаёт второй `orders_v2` (проверяется по `meta.idempotency_key`).
- В network response функции `provider_token` отсутствует.
- В `audit_logs` есть 4 события `payment.saved_card_charge.*` с корректными `actor_type/actor_user_id/meta`.
- `bepaid-webhook` без изменений успешно закрывает order по `tracking_id` (проверено в C.1 + e2e тест-платёж).
- TypeScript чистый по всем затронутым файлам.

---

## Порядок выполнения

1. PATCH-UI-A (минимальный риск, изолированный UI).
2. PATCH-UI-B (визуальный refactor + мобайл-QA).
3. PATCH-PAY-C — только после C.1 compatibility check, отдельным сообщением «План → Dry run → Execute → Verify».
---

## PATCH-PAY-C. Дополнения после Step 1 (Compatibility report принят)

Step 1 принят как полезный report, но **execute PAY-C запрещён**. До execute обязателен **Step 2 — Dry-run plan with canonical fulfillment comparison**.

### C.0. Ответы на open questions (зафиксировано)

**1. Idempotency (server-side, до вызова bePaid).**

Контракт первого релиза — без unique index, через `meta.idempotency_key` + guard-запрос:

- Frontend генерирует `idempotency_key = crypto.randomUUID()` один раз на mount компонента (хранится в `useRef`), уходит с каждым кликом одинаковым.
- Server (`public-charge-saved-card`) ДО вызова bePaid делает SELECT по совокупности:
  - `user_id`
  - `link_token` / `payment_link_id`
  - `payment_method_id`
  - `amount`
  - `currency`
  - `meta->>'idempotency_key'`
  - `created_at >= now() - interval '10 minutes'`
  - `status IN ('pending','processing','succeeded')`
- Если найден существующий `payments_v2`/`orders_v2`:
  - НЕ создавать новый order/payment;
  - НЕ делать второй gateway call;
  - вернуть `409` либо текущий processing-state с тем же `tracking_id` / `redirect_url` (если есть).
- Unique index на `meta.idempotency_key` НЕ добавляем в первом патче — сначала подтверждаем структуру `orders_v2`/`payments_v2` в Step 2.

**2. Замена подписки (replacement_of_subscription_v2_id).**

Saved-card flow ДОЛЖЕН поддержать тот же replacement-flow, что и обычный `/pay/:token` checkout, если контекст ссылки/тарифа подразумевает замену. В Step 2 обязательно зафиксировать:

- где сейчас хранится `replacement_of_subscription_v2_id` (поле в `orders_v2`, или `meta`, или отдельная связь);
- как `public-checkout` его передаёт в `orders_v2` / `payments_v2`;
- как `bepaid-webhook` / `grant-access-for-order` понимают, что это замена, и какие действия делают со старой подпиской (cancel у провайдера, статус, entitlement).

Если этот контракт не повторить 1:1 — saved-card платёж даст другой бизнес-результат после успешной оплаты. Это STOP.

**3. Кто видит кнопку «Оплатить сохранённой картой».**

Кнопка показывается ТОЛЬКО при выполнении ВСЕХ условий:

- `auth.uid()` существует (гостям не показывать никогда);
- существует `payment_methods` с:
  - `user_id = auth.uid()`,
  - `status = 'active'`,
  - `provider = 'bepaid'`,
  - `provider_token IS NOT NULL` — проверка ТОЛЬКО на сервере, во frontend это поле не отдавать;
  - срок действия не истёк (`expiry_year/expiry_month` > текущего месяца);
- ссылка пригодна для пользователя:
  - `payment_links.user_id IS NULL` (публичная), ИЛИ
  - `payment_links.user_id = auth.uid()` (персональная для него).

На фронт уходит только `{ id, brand, last4, is_default, expiry_month, expiry_year }`. `provider_token` — никогда.

**4. `status='incomplete' + redirect_url`.**

Подтверждено: это нормальный сценарий 3DS. Логика:

- bePaid вернул `status='incomplete'` + `redirect_url` → server возвращает `{ status: 'redirect', redirect_url }`;
- frontend: `window.location.href = redirect_url` (full-page redirect, не iframe);
- UI-подсказка под кнопкой: «Банк может запросить подтверждение 3D-Secure».

---

### C.0.1. Canonical fulfillment check (НОВЫЙ обязательный блок Step 2)

**Цель.** Saved-card payment после успешного webhook ДОЛЖЕН давать ровно тот же результат, что и обычная оплата по ссылке. Никаких параллельных fulfillment-путей.

Канонический pipeline (общий для всех успешных оплат):

```
payment(success) → order(paid) → deal/sale state → entitlement/access grant
                → Telegram notification → payment_link.current_uses++ → audit/logs
```

**Что обязательно проверить в Step 2 ДО execute:**

1. **Как обычный `/pay/:token` создаёт order/payment** (`public-checkout`):
   - какие поля заполняются в `orders_v2` (включая `meta.payment_link_id`, `meta.source`);
   - какие поля заполняются в `payments_v2`;
   - какой `tracking_id` уходит в bePaid (`payments_v2.id` как UUID) и как он привязывается обратно.
2. **Как `bepaid-webhook` закрывает оплату:**
   - находит `payments_v2` по `tracking_id`;
   - переводит payment → `succeeded`, order → `paid`;
   - вызывает `grant-access-for-order` (canonical fulfillment);
   - вызывает `consumePaymentLinkForOrder` (инкремент `current_uses` ровно по `meta.payment_link_id`);
   - триггерит Telegram-нотификацию через тот же путь, что и обычный checkout;
   - пишет `audit_logs`.
3. **Saved-card flow обязан создавать ИДЕНТИЧНЫЕ сущности:**
   - `orders_v2` и `payments_v2` со структурой 1:1 как у `public-checkout`, кроме:
     - `orders_v2.meta.source = 'saved_card_public_pay'` (новый маркер ИСКЛЮЧИТЕЛЬНО для аналитики/аудита);
     - `payments_v2.meta.payment_method_id = <id>`;
     - `payments_v2.meta.idempotency_key = <key>`;
   - Все остальные поля (product_id, tariff_id, offer_id, user_id/profile_id, amount, final_price, currency, initial status, meta.payment_link_id, replacement_of_subscription_v2_id) — БИТОВО совпадают с обычным checkout.

**Запрещено в `public-charge-saved-card` (STOP):**

- напрямую выдавать доступ / entitlement;
- напрямую слать Telegram-нотификацию;
- напрямую инкрементить `payment_links.current_uses`;
- напрямую менять `subscriptions_v2`;
- напрямую вызывать `grant-access-for-order` (это делает webhook).

Всё это — ответственность существующего `bepaid-webhook` + canonical pipeline. Saved-card edge function умеет только: валидация → resolve данных ссылки/тарифа/карты → idempotency check → запись `orders_v2`+`payments_v2` → вызов bePaid `/transactions` → запись `tracking_id` / `redirect_url` → audit → ответ.

---

### C.0.2. Webhook compatibility proof (обязательный артефакт Step 2)

В Step 2 предъявить как proof:

1. **Tracking ID:** показать в коде `bepaid-webhook`, что путь `tracking_id (uuid) → payments_v2.id` отрабатывает корректно для нашего нового payment-record (как минимум grep по `tracking_id` + `payments_v2`).
2. **Order closure:** строки кода, где webhook переводит order в `paid`, и подтверждение, что для нашего order'а это сработает без условных веток на `meta.source`.
3. **Grant-access:** строки кода, где webhook вызывает `grant-access-for-order`, и что это произойдёт независимо от `meta.source`.
4. **Payment link consume:** строки кода `consumePaymentLinkForOrder`, что инкремент берёт `meta.payment_link_id` из order и НЕ зависит от `meta.source`.
5. **Telegram notification:** путь нотификации в webhook не привязан к `meta.source = 'public_checkout'`.

---

### C.0.3. Divergence-таблица (обязательно в Step 2 dry-run)

Сравнить три сценария по каждой строке. Колонка «must match» = yes означает: значения в A и C обязаны быть идентичными (с поправкой на маркер source).

| Entity / field | A. `/pay/:token` (public-checkout) | B. direct-charge / admin-manual-charge | C. saved-card public pay (новый) | must match A=C |
|---|---|---|---|---|
| `orders_v2.product_id` | ? | ? | ? | yes |
| `orders_v2.tariff_id` | ? | ? | ? | yes |
| `orders_v2.offer_id` | ? | ? | ? | yes |
| `orders_v2.user_id` / `profile_id` | ? | ? | ? | yes |
| `orders_v2.amount` / `final_price` | ? | ? | ? | yes |
| `orders_v2.currency` | ? | ? | ? | yes |
| `orders_v2.status` initial | ? | ? | ? | yes |
| `orders_v2.meta.payment_link_id` | ? | ? | ? | yes |
| `orders_v2.meta.source` | `public_checkout` | `admin_manual_charge` / `direct_charge` | `saved_card_public_pay` | NO (только маркер) |
| `orders_v2.replacement_of_subscription_v2_id` | ? | ? | ? | yes |
| `payments_v2.order_id` | ? | ? | ? | yes |
| `payments_v2.status` initial | ? | ? | ? | yes |
| `payments_v2.provider` | `bepaid` | `bepaid` | `bepaid` | yes |
| `payments_v2.provider_payment_id` / `gateway_uid` | ? | ? | ? | yes |
| `tracking_id` отправляемый в bePaid | `payments_v2.id` (uuid) | `payments_v2.id` (uuid) | `payments_v2.id` (uuid) | yes |
| `payment_links.current_uses` update point | webhook (`consumePaymentLinkForOrder`) | n/a | webhook (`consumePaymentLinkForOrder`) | yes |
| entitlement grant trigger | webhook → `grant-access-for-order` | webhook → `grant-access-for-order` | webhook → `grant-access-for-order` | yes |
| Telegram notification source | webhook | webhook | webhook | yes |

В Step 2 заполнить `?` фактическими значениями из кода (не предположениями) с line-references.

---

### C.0.4. STOP-guards перед execute PAY-C

Execute PAY-C запрещён, если выполняется хоть одно:

- **STOP-1:** saved-card flow требует прямого `grant-access-for-order` вне webhook.
- **STOP-2:** webhook не сможет найти order по `tracking_id` нового payment'а (например, `tracking_id` имеет другой формат).
- **STOP-3:** saved-card создаёт `orders_v2` / `payments_v2` со структурно отличной формой от `public-checkout` (поля из таблицы C.0.3 не совпадают там, где `must match = yes`).
- **STOP-4:** `meta.payment_link_id` не попадает в order, и `consumePaymentLinkForOrder` не инкрементит `current_uses`.
- **STOP-5:** Telegram / access / notification зашиты на `meta.source = 'public_checkout'` и игнорируют `saved_card_public_pay`. В этом случае: либо рефакторим webhook на source-agnostic путь (предпочтительно), либо вносим `saved_card_public_pay` в whitelist — решение фиксируется в Step 2.
- **STOP-6:** replacement-subscription flow в saved-card отличается от обычного checkout (контракт `replacement_of_subscription_v2_id` не совпадает).
- **STOP-7:** idempotency guard не покрывает повтор клика в течение 10 минут (двойной order/payment).
- **STOP-8:** `provider_token` утекает во frontend response/log.

---

### C.0.5. Что Step 2 (Dry-run) обязан показать перед execute

1. **Exact order/payment fields** — заполненная таблица C.0.3 без `?`.
2. **Exact gateway payload** — итоговый JSON для `POST https://gateway.bepaid.by/transactions`, со всеми полями (`amount`, `currency`, `description`, `tracking_id`, `payment_method.credit_card.token`, `customer`, `additional_data.contract`, `return_url`).
3. **Exact tracking_id path** — формат + откуда берётся + где webhook его читает (line-refs).
4. **Exact webhook closure path** — последовательность вызовов в `bepaid-webhook` для нашего payment'а (line-refs).
5. **Proof единого fulfillment** — пункт C.0.2 заполнен ссылками на код.
6. **Idempotency behavior** — sequence diagram (текстом) для двойного клика: первый клик / второй клик в окне 10 мин / клик после 10 мин.
7. **Replacement subscription behavior** — описание поля + тест-сценарий: «есть active subscription X у user'а, saved-card payment по ссылке с тем же продуктом → ожидаемый результат».

Только после прохождения всех пунктов C.0.1–C.0.5 без открытых `?` и без активных STOP-guards — переходим к **Execute PAY-C**.

---

## Отчет о выполнении: PAY-C Step 2 — Dry-run plan with canonical fulfillment comparison

**Скоуп:** только чтение кода/схемы. Без execute, без миграций, без deploy.

### S2.1. Line-refs канонического fulfillment-пути (proof единого пути)

| Этап | Файл | Строки | Что делает | Source-agnostic? |
|---|---|---|---|---|
| Парсер `tracking_id` | `supabase/functions/bepaid-webhook/index.ts` | 645–692 | Распознаёт форматы `link:order:{uuid}`, `link:{uuid}`, `subv2:…`, `uuid`, `uuid_pair` | Да |
| One-time `link_order` ветка (entry) | `bepaid-webhook/index.ts` | 2913–2920 | `isOneTimeLinkOrderWebhook = !isSubscriptionWebhook && tracking.kind === 'link_order'` | Да |
| order → `paid` (one-time link) | `bepaid-webhook/index.ts` | 3463–3472 | `update({ status: 'paid', paid_amount, meta:{...,bepaid_transaction_uid} })` | Да (нет ветки по `meta.source`) |
| `consumePaymentLinkForOrder` (one-time link) | `bepaid-webhook/index.ts` | 3478–3484 | Вызов helper'а, ключ — `meta.payment_link_id` | Да |
| `grant-access-for-order` (one-time link) | `bepaid-webhook/index.ts` | 3514–3535 | `fetch(.../grant-access-for-order)` с `{ orderId }` | Да |
| Telegram notify (one-time link) | `bepaid-webhook/index.ts` | 3548–3550+ | `fetch(.../telegram-notify-admins)` без проверки source | Да |
| Subscription `link_order` ветка (entry) | `bepaid-webhook/index.ts` | 1897 | `tracking.kind === 'link_order'` + isSubscriptionWebhook | Да |
| order → `paid` (subscription link) | `bepaid-webhook/index.ts` | 2249–2266 | Идентично one-time, без проверки source | Да |
| `consumePaymentLinkForOrder` (subscription) | `bepaid-webhook/index.ts` | 2272–2278 | Тот же helper, тот же ключ | Да |
| `grant-access-for-order` (subscription) | `bepaid-webhook/index.ts` | 2471–2521 | Тот же endpoint, без проверки source | Да |
| Helper consume (idempotent) | `_shared/consume-payment-link.ts` | 20–132 | Условие срабатывания: `meta.payment_link_id IS NOT NULL` AND `meta.payment_link_counted !== true`. STOP-guards: limit reached, race condition. Sets `meta.payment_link_counted=true` после успеха. | Да |
| `auto_renew` SoT | `grant-access-for-order/index.ts` | 666–672 | `paymentFlow.includes('subscription') || paymentFlow === 'provider_managed_checkout'` → создаёт subscription_v2 с `auto_renew=true` если есть `payment_methods` | По `meta.payment_flow`, не по `source` |

**Вывод:** в коде webhook, consume-helper и grant-access **НЕТ ни одного ветвления по `meta.source`**. Все условные пути зависят только от:
- `tracking.kind` (формат `tracking_id`),
- `meta.payment_link_id` (для consume),
- `meta.payment_flow` (для `auto_renew`).

Поэтому добавление нового маркера `meta.source = 'saved_card_public_pay'` НИКАК не влияет на fulfillment.

### S2.2. Контракт `tracking_id` — критическая корректировка

**Step 1 предлагал** `tracking_id = payments_v2.id` (kind: `'uuid'`).

**Реальность кода:** парсер распознаёт `'uuid'` (line 685–688), но **ни одна из веток обработчика webhook не матчит `tracking.kind === 'uuid'`**. Платёж улетит в общий неуспешный путь.

**Канонический рабочий формат для PAY-C:**
```
tracking_id = `link:order:${order.id}`     // order.id — UUID из orders_v2
```
Это идентично `public-checkout` (см. `_shared/create-payment-checkout.ts:315` и `:683`) и совпадает с парсером (`linkOrder` regex, line 673–677).

**Этот формат гарантирует:**
- webhook найдёт order по `parsedOrderId`,
- включится ветка `isOneTimeLinkOrderWebhook` (line 2915),
- сработают `consumePaymentLinkForOrder` и `grant-access-for-order`.

> **Замечание по `admin-manual-charge`:** там используется `tracking_id = payment.id` (uuid), потому что эта функция **сама** ставит order=paid и вызывает grant-access синхронно (см. `admin-manual-charge/index.ts:387–451`); webhook прилетает потом и идёт в idempotent-путь. Этот pattern для PAY-C не подходит, т.к. наш контракт — fulfillment строго через webhook.

### S2.3. Divergence-таблица (заполнено по коду)

Сценарии:
- **A. `/pay/:token` (`public-checkout` → `createPaymentCheckout`)** — реф: `_shared/create-payment-checkout.ts:226–296` (one-time), `:594–662` (subscription).
- **B. `admin-manual-charge`** — реф: `admin-manual-charge/index.ts:303–344` (order), `:355–374` (payment).
- **C. PAY-C `public-charge-saved-card`** (новая, dry-run спецификация).

Контракт C: `tracking_id = 'link:order:${order.id}'`, `payment_type = 'one_time'` (saved-card pay по публичной ссылке — не подписка).

| Поле | A. public-checkout | B. admin-manual-charge | C. saved-card public pay (dry-run) | must match A=C |
|---|---|---|---|---|
| `orders_v2.product_id` | `link.product_id` | `body.product_id` | `link.product_id` | yes ✅ |
| `orders_v2.tariff_id` | `link.tariff_id` | `body.tariff_id` | `link.tariff_id` | yes ✅ |
| `orders_v2.offer_id` | `link.offer_id \|\| null` | не пишется | `link.offer_id \|\| null` | yes ✅ |
| `orders_v2.user_id` | `userId` (link.user_id или JWT) | `body.user_id` | `auth.uid()` (после ownership-guard карты) | yes ✅ |
| `orders_v2.profile_id` | `profile.id` (lookup по user_id) | не пишется напрямую (берётся из payment_methods.meta) | `profile.id` (lookup по user_id) | yes ✅ |
| `orders_v2.base_price` / `final_price` | `link.amount/100` (BYN) | `amount/100` | `link.amount/100` (BYN) | yes ✅ |
| `orders_v2.currency` | `'BYN'` | `'BYN'` | `'BYN'` | yes ✅ |
| `orders_v2.status` initial | `'pending'` | `'pending'` | `'pending'` | yes ✅ |
| `orders_v2.customer_email` | `profile?.email \|\| 'unknown@example.com'` | `paymentMethod.meta?.email` | `profile?.email \|\| 'unknown@example.com'` | yes ✅ |
| `orders_v2.deal_date` | `now()` | `now()` | `now()` | yes ✅ |
| `orders_v2.purchase_snapshot` | `buildPurchaseSnapshot({...})` | `buildPurchaseSnapshot({...})` | `buildPurchaseSnapshot({...})` (тот же helper) | yes ✅ |
| `orders_v2.pipeline_id` / `pipeline_stage_id` | из `resolveOfferRoutingWithFallback` | не пишется | из `resolveOfferRoutingWithFallback` | yes ✅ |
| `orders_v2.meta.type` | `system_payment_link` | `admin_manual_charge` | `system_payment_link` (для совместимости с UI/аналитикой) | yes ✅ |
| `orders_v2.meta.payment_flow` | `renewal_one_time` (system) | n/a | `renewal_one_time` | yes ✅ |
| `orders_v2.meta.payment_link_id` | `link.id` (через `meta_extra`) | n/a | `link.id` | yes ✅ КРИТИЧНО |
| `orders_v2.meta.crm_routing_snapshot` | да | нет | да (через тот же helper) | yes ✅ |
| `orders_v2.meta.source` (новый маркер) | n/a (не задан) | n/a | `'saved_card_public_pay'` | NO (только аналитический marker) |
| `orders_v2.meta.idempotency_key` | n/a | n/a | `body.idempotency_key` | NO (новое поле, fulfillment-нейтральное) |
| `payments_v2.order_id` | n/a (создаётся webhook'ом) | `order.id` | `order.id` (создаём pre-gateway) | — |
| `payments_v2.user_id` | n/a | `body.user_id` | `auth.uid()` | yes ✅ |
| `payments_v2.amount` | n/a | `amount/100` | `link.amount/100` | yes ✅ |
| `payments_v2.currency` | n/a | `'BYN'` | `'BYN'` | yes ✅ |
| `payments_v2.status` initial | n/a | `'processing'` | `'processing'` | yes ✅ |
| `payments_v2.provider` | n/a | `'bepaid'` | `'bepaid'` | yes ✅ |
| `payments_v2.payment_token` | n/a | `paymentMethod.provider_token` | `paymentMethod.provider_token` (server-only) | yes ✅ |
| `payments_v2.is_recurring` | n/a | `false` | `false` | yes ✅ |
| `payments_v2.meta.payment_method_id` | n/a | `payment_method_id` | `payment_method_id` | yes ✅ |
| `tracking_id` отправляемый в bePaid | `'link:order:' + order.id` (`create-payment-checkout.ts:315`) | `payment.id` (uuid) | `'link:order:' + order.id` | yes ✅ КРИТИЧНО |
| `payment_links.current_uses` update point | webhook (`consumePaymentLinkForOrder`) | n/a | webhook (`consumePaymentLinkForOrder`) | yes ✅ |
| entitlement grant trigger | webhook → `grant-access-for-order` | синхронно из admin-manual-charge + webhook idempotent | **только** webhook → `grant-access-for-order` | yes ✅ |
| Telegram notification source | webhook | синхронно из admin-manual-charge | webhook | yes ✅ |

Нет ни одной строки с `must match=yes`, где значения A и C расходятся.

### S2.4. Exact gateway payload (PAY-C)

```json
POST https://gateway.bepaid.by/transactions/payments
Headers:
  Authorization: Basic <bepaid_creds>
  Content-Type: application/json
  Accept: application/json
  X-API-Version: 2

Body:
{
  "request": {
    "amount": <link.amount kopecks>,
    "currency": "BYN",
    "description": "<product.name> — <tariff.name>",
    "tracking_id": "link:order:<order.id>",
    "test": <bepaidCreds.test_mode>,
    "return_url": "<canonicalOrigin>/payment-result?order=<order.id>&status=success",
    "notification_url": "<SUPABASE_URL>/functions/v1/bepaid-webhook",
    "skip_three_d_secure_verification": true,
    "credit_card": {
      "token": "<paymentMethod.provider_token>"   // server-only, никогда не отдаётся фронту
    },
    "additional_data": {
      "contract": ["recurring", "unscheduled"],
      "card_on_file": {
        "initiator": "merchant",
        "type": "delayed_charge"
      },
      "order_id": "<order.id>",
      "payment_id": "<payment.id>"
    }
  }
}
```

**`return_url` — canonical:** строится через `buildPublicPayUrl`-эквивалент (см. `src/utils/buildPublicPaymentUrl.ts`). Не доверять `req.headers.origin` (Lovable preview трап).

### S2.5. Idempotency behavior (sequence)

**Pre-gateway server-side guard (внутри `public-charge-saved-card`):**

```sql
-- псевдо
SELECT p.id, p.status, o.id AS order_id, o.meta
FROM payments_v2 p
JOIN orders_v2 o ON o.id = p.order_id
WHERE p.user_id = :auth_uid
  AND o.meta->>'payment_link_id' = :link_id
  AND p.meta->>'payment_method_id' = :payment_method_id
  AND p.amount = :amount_byn
  AND p.currency = 'BYN'
  AND p.meta->>'idempotency_key' = :idempotency_key
  AND p.created_at >= now() - interval '10 minutes'
  AND p.status IN ('processing','succeeded')
LIMIT 1;
```

**Сценарии:**

| # | Действие | Окно | Ответ функции |
|---|---|---|---|
| 1 | Первый клик | t=0 | INSERT order+payment → bePaid call → 200 `{ status: 'redirect'\|'success', redirect_url, tracking_id }` |
| 2 | Двойной клик (тот же `idempotency_key`) | t=0..10мин | Guard матчит → НЕ INSERT, НЕ gateway call → 409 `{ status: 'in_progress', existing_payment_id, redirect_url? }` (если есть) |
| 3 | Повтор после 10 мин (тот же `idempotency_key`) | t>10мин | Guard НЕ матчит → новый order+payment (старый, скорее всего, уже в `failed` или закрыт webhook'ом) |
| 4 | Параллельный клик с РАЗНЫМ `idempotency_key` (теоретически — если фронт ошибся) | t=0 | Guard НЕ матчит → возможен дубликат. **Митигация:** `useRef` на mount компонента — ключ один на сессию. Дополнительно — disabled-кнопка во время запроса. |

Unique index на `meta.idempotency_key` в первом релизе НЕ добавляем.

### S2.6. Replacement subscription behavior

**Где живёт:** `_shared/subscription-conflict.ts:185–230` (`validateReplacementSubscription`) + `_shared/create-payment-checkout.ts:854–872` (audit `subscription.replaced`). Само поле `replacement_of_subscription_v2_id` **в orders_v2 НЕ хранится** — это side-effect внутри checkout (валидация + audit). Закрытие старой подписки — отдельный flow до начала replacement (предусловие validate-функции: `oldSub.status` должен быть в финальном).

**Контракт PAY-C:**

- В первом релизе `public-charge-saved-card` принимает только `payment_type='one_time'` (saved-card по публичной ссылке).
- Если ссылка `payment_type='subscription'` → server возвращает `400 saved_card_subscription_unsupported_v1` и UI скрывает кнопку (показывается стандартный bePaid widget).
- Это снимает риск рассинхронизации replacement-flow в первой итерации.
- Расширение на subscription с replacement — отдельный патч PAY-D после боевой проверки PAY-C на one-time.

### S2.7. Webhook compatibility proof (закрыт)

| STOP-guard из C.0.4 | Проверено в коде | Статус |
|---|---|---|
| STOP-1: saved-card требует прямого grant-access вне webhook | В dry-run спецификации `public-charge-saved-card` НЕ вызывает grant-access. Только webhook. | ✅ closed |
| STOP-2: webhook не находит order по `tracking_id` | `tracking_id = 'link:order:<order.id>'` → `parseTrackingId` → `kind='link_order'` → ветка `isOneTimeLinkOrderWebhook` (bepaid-webhook:2915) → lookup `orders_v2 by id` (line 3058–3062) | ✅ closed |
| STOP-3: order/payment структурно отличаются | Таблица S2.3 — все `must match=yes` совпадают | ✅ closed |
| STOP-4: `payment_link_id` не в meta / consume не сработает | `meta.payment_link_id = link.id` обязательно. Helper `consumePaymentLinkForOrder` проверяет именно это поле (`consume-payment-link.ts:39`) | ✅ closed |
| STOP-5: Telegram/access завязаны на `source='public_checkout'` | Grep по `meta.source` в webhook/grant/consume — 0 ветвлений. Проверено: только `payment_flow` влияет, и то — только на `auto_renew`, что для one-time не критично | ✅ closed |
| STOP-6: replacement отличается | В первом релизе PAY-C НЕ поддерживает subscription / replacement (см. S2.6) | ✅ closed (out-of-scope) |
| STOP-7: idempotency не покрывает повтор клика | Server-side guard по 6 полям + `idempotency_key`, окно 10 мин (см. S2.5) | ✅ closed |
| STOP-8: `provider_token` утекает | `payment_methods.provider_token` читается ТОЛЬКО на сервере. В response функции — никогда. В audit — только `last4`/`brand`. Frontend hook отдаёт только `id, brand, last4, exp_month, exp_year, is_default` (UI policy фиксируется в коде PAY-C) | ✅ closed |

**Все 8 STOP-guards закрыты.**

### S2.8. Что НЕ меняем (фиксирую границы)

- `bepaid-webhook` — без изменений.
- `grant-access-for-order` — без изменений.
- `consume-payment-link.ts` — без изменений.
- `_shared/create-payment-checkout.ts` — без изменений.
- `public-checkout` — без изменений (старый bePaid widget остаётся как fallback "Оплатить другой картой").
- `admin-manual-charge` — без изменений.
- `bepaid-create-token` — без изменений.
- `payment_methods` schema — без изменений.
- `orders_v2` / `payments_v2` schema — без изменений.

### S2.9. DoD Step 2 (выполнено)

- [x] Все `?` из таблицы C.0.3 заполнены реальными значениями из кода (S2.3).
- [x] Line-refs по webhook/tracking/grant/consume — даны (S2.1).
- [x] Подтверждено: fulfillment идёт ТОЛЬКО через webhook (S2.7, STOP-1).
- [x] Подтверждено: `tracking_id = 'link:order:<order.id>'` совместим с webhook (S2.2, STOP-2).
- [x] Подтверждено: `meta.payment_link_id` попадает в order и `consumePaymentLinkForOrder` сработает (STOP-4).
- [x] Подтверждено: `grant-access-for-order` сработает source-agnostic (STOP-5, S2.1).
- [x] Подтверждено: Telegram/notification не завязаны на `source='public_checkout'` (S2.1, STOP-5).
- [x] Подтверждено: replacement subscription flow не теряется (вынесен out-of-scope для первого релиза, S2.6, STOP-6).
- [x] Подтверждено: idempotency не создаст двойной order/payment (S2.5, STOP-7).
- [x] Подтверждено: `provider_token` не утекает на frontend (S2.4, STOP-8).
- [x] Без execute, без миграций, без deploy.

### S2.10. Готовность к Execute PAY-C

Все STOP-guards закрыты. Контракт окончательный:
- `tracking_id = 'link:order:${order.id}'`,
- `payment_type` поддерживается только `'one_time'` в первом релизе,
- pre-gateway idempotency guard (10 мин окно, без unique index),
- saved-card flow создаёт `orders_v2`+`payments_v2` идентично `public-checkout` (только маркеры `meta.source='saved_card_public_pay'` и `meta.idempotency_key`),
- fulfillment строго через `bepaid-webhook` → `grant-access-for-order` + `consumePaymentLinkForOrder` + Telegram,
- `provider_token` остаётся server-only.

**Ожидаю подтверждения для перехода к Execute PAY-C** (PATCH PAY-C по плану выше с правкой `tracking_id` на canonical формат и ограничением scope `payment_type='one_time'`).

---

## Step 2.bis — Final Pre-Execute Corrections (BLOCKING)

Перед началом Execute PAY-C обязательно зафиксированы следующие уточнения. До их применения в коде статус — **NOT READY FOR EXECUTE**. После применения — **READY FOR EXECUTE PAY-C**.

### S2bis.1 — Условие показа кнопки saved-card (CRITICAL FIX)

**Было (слишком жёстко):**
```
auth.uid() === link.user_id
```

**Стало (canonical):**
```
link.user_id IS NULL OR link.user_id = auth.uid()
```

Логика видимости кнопки «Оплатить сохранённой картой» на `/pay/:token`:

| Тип ссылки | `link.user_id` | Пользователь | Кнопка saved-card |
|---|---|---|---|
| Персональная | UUID (X) | auth.uid() = X | ✅ показать (если есть карта) |
| Персональная | UUID (X) | auth.uid() ≠ X | ❌ скрыть |
| Публичная | NULL | любой авторизованный | ✅ показать (если есть карта) |
| Публичная/Персональная | любой | guest (не авторизован) | ❌ скрыть, только bePaid checkout |

Это соответствует canonical архитектуре публичных payment_links (`mem://commercial-logic/payments/public-checkout-architecture`).

Edge function `public-charge-saved-card` обязана дублировать ту же проверку server-side:
```ts
if (link.user_id !== null && link.user_id !== auth_user.id) {
  return 403 forbidden_link_owner_mismatch
}
```

### S2bis.2 — Server-side idempotency guard БЕЗ зависимости от idempotency_key (CRITICAL FIX)

`idempotency_key` остаётся как primary fast-path, но НЕ единственным условием.

**Дополнительный guard (выполняется ВСЕГДА, до создания order/payment и до вызова bePaid):**

```sql
SELECT p.id, p.order_id, p.tracking_id, p.status
FROM payments_v2 p
JOIN orders_v2 o ON o.id = p.order_id
WHERE o.user_id = :auth_user_id
  AND o.meta->>'payment_link_id' = :link_id
  AND p.payment_method_id = :payment_method_id
  AND p.amount = :amount
  AND p.currency = :currency
  AND p.created_at >= now() - interval '2 minutes'
  AND p.status IN (<active_statuses>)
LIMIT 1;
```

Если найден active attempt → НЕ создавать новый order/payment, НЕ вызывать gateway, вернуть 409 (см. S2bis.4).

Порядок проверок в edge function:
1. Auth + link resolution + ownership (S2bis.1)
2. Fast-path: lookup по `meta.idempotency_key` (если передан)
3. Slow-path: lookup по (user_id, link_id, payment_method_id, amount, currency, 2-min window, active status)
4. Только если оба guard прошли → INSERT order + payment + POST bePaid

### S2bis.3 — Уточнение `payments_v2.status` enum (DATA AUDIT REQUIRED)

В Step 2 использовались `processing` / `succeeded` без верификации. Перед execute обязательно:

```sql
-- Выполнить read-only при старте Execute:
SELECT DISTINCT status FROM payments_v2 ORDER BY status;
-- ИЛИ если status — enum:
SELECT enum_range(NULL::payment_v2_status);
```

В код guard'а S2bis.2 включить **только реально существующие** "активные" статусы (то, что НЕ финальные `failed`/`canceled` и НЕ `succeeded`/`paid`). Если фактический набор отличается от `('processing','pending')` — взять реальные значения из БД. Не хардкодить статусы, которых нет.

DoD: первый шаг Execute — read_query по фактическому enum + правка constants в edge function.

### S2bis.4 — Response при existing active attempt (409, без redirect_url)

НЕ возвращать старый bePaid `redirect_url` — он может быть one-shot и уже использован.

```ts
return new Response(JSON.stringify({
  status: "in_progress",
  code: "payment_already_processing",
  order_id,
  payment_id,
  tracking_id,
  message: "Платёж уже создан. Завершите подтверждение или попробуйте позже."
}), { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
```

Frontend на `/pay/:token` при 409:
- показать toast «Платёж уже создан…»,
- НЕ делать автоматический retry,
- предложить пользователю обновить страницу через 1–2 минуты.

### S2bis.5 — Subscription fallback UX

`payment_type='subscription'` в PAY-C v1 не поддерживается. UI на `/pay/:token` для таких ссылок:
- кнопка «Оплатить сохранённой картой» **скрыта** (а не disabled),
- под блоком оплаты показывается явный fallback-текст:
  > «Для подписки используйте стандартную оплату через bePaid.»
- стандартный bePaid-checkout остаётся единственным путём.

Никаких упоминаний "saved card недоступен" — только нейтральная подсказка.

### S2bis.6 — `skip_three_d_secure_verification` policy

Поле `skip_three_d_secure_verification: true` оставляем в payload (1:1 с `direct-charge` / `admin-manual-charge`), НО:
- в коде/комментариях НЕ писать «3DS будет пропущен»;
- UI обязан считать, что 3DS **может** потребоваться (банк-эмитент может форсировать challenge);
- frontend корректно обрабатывает ответ bePaid со `status='incomplete'` + `redirect_url` (3DS challenge flow) точно так же, как в обычном `/pay/:token` flow.

### S2bis.7 — Audit event для idempotency hit

Добавить отдельное audit-событие в `audit_logs` при срабатывании guard'а (S2bis.2), без gateway-call:

```ts
await supabase.from('audit_logs').insert({
  action: 'payment.saved_card_charge.idempotency_hit',
  actor_id: auth_user.id,
  target_type: 'payment_link',
  target_id: link.id,
  meta: {
    matched_by: 'idempotency_key' | 'natural_key', // какой guard сработал
    existing_order_id,
    existing_payment_id,
    payment_method_id,
    amount,
    currency,
  }
})
```

Это даёт наблюдаемость: видно, что повторный клик/двойной submit был заблокирован без обращения к bePaid.

### S2bis — Updated STOP-guards

Добавлены к 8 ранее закрытым guard'ам:

| # | Guard | Status |
|---|---|---|
| 9 | Visibility uses `link.user_id IS NULL OR =auth.uid()` (не строгое `=`) | ⏳ to enforce in code |
| 10 | Idempotency guard работает без `idempotency_key` (natural-key fallback) | ⏳ to enforce in code |
| 11 | `payments_v2.status` constants взяты из реального enum | ⏳ verify at execute start |
| 12 | 409 response не возвращает `redirect_url` существующей попытки | ⏳ to enforce in code |
| 13 | Subscription UI показывает fallback-текст, не disabled-кнопку | ⏳ to enforce in code |
| 14 | Нет упоминаний «3DS пропущен» в коде/UI | ⏳ to enforce in code |
| 15 | Audit `payment.saved_card_charge.idempotency_hit` пишется при hit | ⏳ to enforce in code |

### Final status

После применения S2bis.1–S2bis.7 в коде Execute:
**READY FOR EXECUTE PAY-C**

До применения S2bis.1 и S2bis.2 (CRITICAL):
**EXECUTE BLOCKED**
