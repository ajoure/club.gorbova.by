Согласен. Выполнить план. Проверить в режиме симуляции и подтвердить исправления скринами.

&nbsp;

## Что нашёл (discovery)

### Баг A: «Создать ссылку» из вкладки «Ссылки» падает

По скриншоту видно: открывается `CreatePublicLinkDialog`, заполнены продукт/тариф/сумма 900 BYN, нажатие на «Создать ссылку» приводит к ошибке (toast скрыт за «Approval needed»).

В коде `CreatePublicLinkDialog.tsx` — **двойная конвертация суммы**:

- `useEffect`: `setAmount(String(Number(effectiveOffer.amount)))` (offer.amount уже в BYN — ок)
- но при сабмите: `amount: Math.round(amt * 100)` — отправляет в writer **копейки**, хотя весь остальной канон (включая `AdminPaymentLinkDialog` и writer `admin-create-public-link`) ожидает **BYN**.
- Дополнительно: writer `admin-create-public-link` валидирует `offer_id`/`tariff_id` строго; если что-то из них null/неправильное — 400.

Нужно:

1. Убрать `* 100` — отправлять `amt` (BYN), как делает `AdminPaymentLinkDialog`.
2. Подтвердить контракт writer'а (прочитать `supabase/functions/admin-create-public-link/index.ts`) — что `amount` действительно ожидается в BYN, и что 400-ответ корректно прокидывается в UI.
3. Прочитать актуальные edge function logs `admin-create-public-link` для подтверждения причины 400/500.

### Баг B: таблица «Ссылки» по-прежнему пустая

После последней миграции (LATERAL + index) проверим SQL-фактом:

- `SELECT count(*) FROM payment_links_enriched_v` под admin → должен быть 13.
- Если view возвращает строки в SQL, но UI пуст — значит проблема не в БД, а в клиенте: например, RLS под `authenticated` JWT не пропускает (admin-роль проверяется по `has_role(auth.uid(),'admin')`, но текущий пользователь в preview может не иметь роли).
- Проверим: `SELECT has_role(auth.uid(),'admin')` для текущего пользователя preview через `supabase--read_query` нельзя (нет JWT-контекста), поэтому посмотрим `user_roles` для текущего auth-пользователя preview и сетевой ответ от PostgREST в `usePaymentLinks`.

Если view всё ещё в timeout — упростим запрос дальше (например, временно уберём `last_order_id` через subquery, оставим только counts). Если RLS блокирует — проблема была всегда, и не в этом спринте, но зафиксируем для пользователя.

### Баг C (из прошлого сообщения, остаётся в плане)

- В `AdminPaymentLinkDialog` нет кнопки «Создать ссылку» без отправки в Telegram → нужен выбор: «Создать ссылку» (всегда) и «Создать и отправить в Telegram» (если Telegram привязан).
- URL генерится на preview-домене → проверю writer и решу, нужно ли фиксить canonical base URL.

## План фикса

### Фикс 1 — `CreatePublicLinkDialog.tsx` (баг A)

- Убрать `* 100`, отправлять `amount: amt` (BYN) — синхронизация с `AdminPaymentLinkDialog` и каноническим контрактом writer'а.
- Убрать дубликат «Сумма (BYN)» — оставить как есть, но без множителя.
- Улучшить отображение ошибки writer'а через `normalizeEdgeFunctionError` (как в остальных диалогах).

### Фикс 2 — диагностика таблицы «Ссылки» (баг B)

- Прочитать `supabase/functions/admin-create-public-link/index.ts` — подтвердить контракт `amount`.
- Через `supabase--read_query`: `SELECT count(*) FROM payment_links` и `SELECT count(*) FROM payment_links_enriched_v` — убедиться, что view отдаёт строки на SQL-уровне.
- Через `supabase--analytics_query`: посмотреть последние ошибки PostgREST/postgres logs на `payment_links_enriched_v`.
- Через `supabase--curl_edge_functions` или `supabase--read_query`: проверить, нет ли блокировки RLS-уровня (роль `admin` у текущего preview-пользователя).
- По результатам — либо ещё одна узкая правка view, либо вердикт «view ок, а у preview-пользователя нет admin-роли» (тогда покажу как починить роль).

### Фикс 3 — `AdminPaymentLinkDialog.tsx` (баг C, из предыдущего плана)

- На первом экране две кнопки:
  - Telegram привязан → primary «Создать и отправить в Telegram», secondary «Создать ссылку».
  - Telegram не привязан → одна кнопка «Создать ссылку».
- Если Telegram-отправка упала, ссылка всё равно сохраняется и показывается на success-экране (toast: «Ссылка создана, но отправка в Telegram не удалась»).
- Success-экран без изменений: «Скопировать», «Открыть», «Отправить в Telegram» (если привязан).

### Фикс 4 — canonical base URL (баг про lovable.dev в ссылке)

- Прочитать writer и решить:
  - если URL берётся из `req.headers.origin` → preview-домен в preview ожидаем, в production будет prod-домен ⇒ оставляю как есть, фиксирую в отчёте.
  - если зашит неправильно → правлю через ENV `PUBLIC_SITE_URL` или конфиг.

## Файлы

**Изменю:**

- `src/components/admin/payments/links/CreatePublicLinkDialog.tsx` — убрать `* 100`, использовать `normalizeEdgeFunctionError`.
- `src/components/admin/AdminPaymentLinkDialog.tsx` — две кнопки, fallback при сбое Telegram.
- (возможно) `supabase/functions/admin-create-public-link/index.ts` — только если URL формируется неправильно для prod.
- (возможно) ещё одна миграция view — только если SQL-проверка покажет, что view всё ещё в timeout.

**НЕ трогаю:** writers логику создания записей, telegram-send-notification, RLS на `payment_links`/`orders_v2`, `usePaymentLinks.ts` (контракт колонок сохраняется), webhook, consume, grant-access.

## DoD

1. Из вкладки «Ссылки» одной кнопкой создаётся публичная ссылка на 900 BYN, без ошибки, и сразу появляется в таблице.
2. Таблица показывает все 13 исторических ссылок + только что созданную.
3. Из карточки контакта есть выбор: «Создать ссылку» (без Telegram) и «Создать и отправить в Telegram» (если привязан).
4. Сбой Telegram не теряет уже созданную ссылку.
5. По домену в URL: либо подтверждено, что preview-домен ожидаем для preview, либо зафиксирован canonical prod-URL.
6. Никакого нового payment-path, нового writer'а, дубля Telegram-логики, изменений RLS.