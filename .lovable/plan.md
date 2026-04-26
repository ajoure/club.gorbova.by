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
