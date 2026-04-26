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