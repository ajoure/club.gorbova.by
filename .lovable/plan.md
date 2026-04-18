да, согласен, с учетом правок:

1. Во всех новых элементах UI вкладки «Ссылки» и связанных окон зафиксируй жёсткое правило:  
**все заголовки, колонки, кнопки, фильтры, статусы, drawer/modal, тултипы, пустые состояния, ошибки, подтверждения действий, toast-сообщения и action labels — только на русском языке.**
2. Это правило нужно явно включить в DoD отдельным пунктом:
  - **вкладка, таблица, фильтры, drawer, модалки create/edit/invalidate/details — полностью на русском языке; английских технических labels в UI не остаётся.**
3. В discovery добавь отдельную проверку:
  - нет ли в переиспользуемых компонентах из Payments английских строк, которые автоматически протянутся в новую вкладку «Ссылки»;
  - если есть, локализовать их в рамках этого же спринта.
4. В docs/PAYMENT_LINKS_[AUDIT.md](http://AUDIT.md) отдельно зафиксируй:
  - какие названия колонок приняты в русском варианте;
  - какие статусы ссылки показываются пользователю и как именно называются по-русски.
5. В safe-edit / invalidate flow все confirm-диалоги тоже только на русском:
  - например: «Сделать ссылку недействительной», «Изменить ссылку», «Скопировать ссылку», «Открыть ссылку», «Лимит использований», «Истекает», «Использовано», «Получатель», «Кто создал».
6. В details drawer не выводить английские внутренние названия вроде:
  - payment_type
  - offer_id
  - current_uses
  - created_by
7. Только русские подписи, а технические id — при необходимости как вторичная справочная строка.
8. В verdict discovery добавь отдельную строку:
  - **UI локализация новой вкладки выполнена полностью / не полностью**, чтобы это было видно сразу, а не потерялось внутри общего отчёта.
9. Если будет enriched view / RPC / safe update edge functions, их внутренние имена могут оставаться техническими, но наружный UI и все пользовательские сообщения — только русский.

Остальной план нормальный: логика вкладки, reuse канонических фильтров и таблицы, единый журнал ссылок, add-only интеграция и audit всех каналов сформулированы правильно. Главная дополнительная правка — зафиксировать полную русификацию всей новой вкладки и всех связанных окон как обязательное требование спринта.

&nbsp;

&nbsp;

# План: вкладка «Ссылки» в разделе «Платежи» + audit путей создания ссылок

## Проблема

Нужен единый журнал всех ссылок на оплату внутри раздела «Платежи» с переиспользованием UI-паттернов вкладки «Платежи», без создания новых payment-path и без второго writer'а. Параллельно — audit всех путей создания ссылок и явный verdict «всё ли идёт через канон».

## Часть 1. Discovery (read-only, до любых правок)

Прохожу строго до execute и фиксирую в отчёте.

### D1. Каналы создания ссылок

Поиск в коде по edge functions и UI:

- `admin-create-payment-link` — direct admin checkout (orders_v2 + bePaid + redirect_url).
- `admin-create-public-link` — canonical writer `payment_links` row.
- `public-checkout` POST — materialize order по `/pay/:token` (downstream через `_shared/create-payment-checkout.ts`).
- Кнопки на сайте / тарифные блоки → `_shared/create-payment-checkout.ts` (canonical one-time).
- Подписочный checkout → bePaid subscription path.
- Возможные legacy/hidden пути: поиск по `from('payment_links').insert`, `payment_link_id`, `url_token`, `link:order:` в edge functions, `crm_payment_*`, `manual link` в админ-UI карточек контактов и сделок.

### D2. Source of truth по ссылкам

Подтверждаю, что `payment_links` — единственная таблица со схемой:
`id, url_token, product_id, tariff_id, offer_id, user_id, created_by, amount, currency, payment_type, status, max_uses, current_uses, expires_at, description, created_at, updated_at`.

Проверяю наличие view (`payment_links_v` / view-обогащение product/tariff names, derived `is_invalid`, `is_exhausted`, `is_expired`, `last_order_*`, `paid_orders_count`).

### D3. Downstream связи

- `payment_links` → `orders_v2` через `meta->>'payment_link_id'`.
- `orders_v2` → `products_v2` / `tariffs` / `tariff_offers`.
- `subscriptions_v2` для подписочных оплат.
- `entitlements`, `access_rules` через `grant-access-for-order`.
- `audit_logs`: `public_checkout.created`, `public_checkout.link_consumed`, `payment_link.created`.
- CRM: routing через `pipeline_stages` + `stage_on_success`/`stage_on_failed` (как в обычном checkout).
- Telegram side-effects через canonical `grant-access-for-order` → `telegram-grant-access`.

### D4. Materialize order — где

- direct admin checkout — внутри `admin-create-payment-link`.
- public `/pay/:token` — внутри `public-checkout` POST → `_shared/create-payment-checkout.ts`.
- кнопки сайта — `_shared/create-payment-checkout.ts`.
- подписочный — внутри bePaid subscription flow.

Подтверждаю, что webhook (`bepaid-webhook`) — единственный terminal applier (paid + stage + grant + consume).

### D5. UI-слой для переиспользования (вкладка «Платежи»)

Читаю:

- `src/components/admin/payments/PaymentsTabContent.tsx`
- `src/components/admin/payments/DatePeriodSelector.tsx` + `src/components/ui/period-selector.tsx`
- toolbar/filters/badges/pagination внутри Payments
- хуки запросов платежей (фильтры, server-side, диапазон дат)
- любые `useReconcileQueue` / `usePayments*`

Цель — взять канонический `Toolbar + Filters + Calendar + Search + Table-shell + Badges + Pagination` и не рисовать новое.

### D6. Существующий диалог создания публичной ссылки

Поиск UI, который уже вызывает `admin-create-public-link` (вероятно есть в админке продуктов/тарифов или в payments hub). Если есть — переиспользую его в новой вкладке. Если нет — выношу его как `CreatePublicLinkDialog` из ближайшего вызова без логики-дубля.

### D7. STOP-guard

Если discovery покажет, что:

- есть параллельный writer в `payment_links` помимо `admin-create-public-link`;
- есть канал, который НЕ проходит через `bepaid-webhook` для terminal apply;
- есть путь, который НЕ материализует order через `_shared/create-payment-checkout.ts`;

→ останавливаюсь, фиксирую расхождения отдельным блоком и не строю UI поверх неканоничной модели до согласования.

## Часть 2. Архитектура вкладки «Ссылки»

### Маршрут и навигация

- В `AdminPaymentsHub.tsx` добавляю **add-only** новую вкладку:
`{ id: "links", label: "Ссылки", icon: Link2, path: "/admin/payments/links" }`.
- Подключаю `<LinksTabContent />`.
- Регистрирую route в роутере, аналогично существующим вкладкам hub'а.
- Существующие вкладки и поведение не трогаю.

### Компоненты (новые, минимально)

- `src/components/admin/payments/links/LinksTabContent.tsx` — оркестратор: тулбар + фильтры + таблица + пагинация.
- `src/components/admin/payments/links/LinksToolbar.tsx` — переиспользует `PeriodSelector`, `Input` поиск, `Button` «Создать ссылку», тот же визуальный язык, что и Payments toolbar.
- `src/components/admin/payments/links/LinksFilters.tsx` — popover с link-specific фильтрами.
- `src/components/admin/payments/links/LinksTable.tsx` — `Table` shell из `@/components/ui/table`, badges из существующей библиотеки.
- `src/components/admin/payments/links/LinkRowActions.tsx` — Copy / Open / Invalidate / Details.
- `src/components/admin/payments/links/LinkDetailsDrawer.tsx` — read-only детали + связанные orders.
- `src/components/admin/payments/links/CreatePublicLinkDialog.tsx` — переиспользует существующий, если есть; иначе обёртка над `admin-create-public-link` (без второго writer).
- `src/hooks/usePaymentLinks.ts` — единый query-хук с фильтрами, диапазоном дат, поиском, server-side pagination.

### Канонические переиспользуемые элементы

- `PeriodSelector` (тот же, что в Payments).
- `Table/TableHeader/TableBody/TableRow/TableHead/TableCell` из `src/components/ui/table.tsx`.
- `CopyableIdChip` для token/id.
- `Badge` / status-color helpers из существующей библиотеки.
- `normalizeEdgeFunctionError` для всех action-ошибок.
- `AdminLayout` через hub.

## Часть 3. Колонки таблицы (source vs derived)


| #   | Колонка              | Источник                                     | Source / Derived |
| --- | -------------------- | -------------------------------------------- | ---------------- |
| 1   | Дата создания        | `payment_links.created_at`                   | source           |
| 2   | Статус               | `status` + derived `is_expired/is_exhausted` | mixed            |
| 3   | Тип оплаты           | `payment_type`                               | source           |
| 4   | Token                | `url_token`                                  | source           |
| 5   | Продукт              | join `products_v2.title`                     | derived          |
| 6   | Тариф                | join `tariffs.title`                         | derived          |
| 7   | Offer                | join `tariff_offers.title`                   | derived          |
| 8   | Сумма                | `amount`                                     | source           |
| 9   | Валюта               | `currency`                                   | source           |
| 10  | Получатель           | `user_id` → `profiles`                       | derived          |
| 11  | Создал               | `created_by` → `profiles`                    | derived          |
| 12  | Лимит                | `max_uses`                                   | source           |
| 13  | Использовано         | `current_uses`                               | source           |
| 14  | Истекает             | `expires_at`                                 | source           |
| 15  | Признак валидности   | derived (`is_invalid`)                       | derived          |
| 16  | Связанных order      | count `orders_v2.meta->>payment_link_id`     | derived          |
| 17  | Есть успешная оплата | exists `paid`                                | derived          |
| 18  | Описание             | `description`                                | source           |


Derived поля считаются **в одном query-слое** через RPC `admin_list_payment_links` или supabase view `payment_links_enriched_v` — без дублирования логики на клиенте.

### Решение по derived-слою

Если view/RPC уже существует — переиспользую. Если нет — создаю **read-only** view `payment_links_enriched_v` (миграция, без новых таблиц), которая джоинит `products_v2/tariffs/tariff_offers/profiles` и считает `paid_orders_count`, `last_order_id`, `is_expired`, `is_exhausted`, `is_invalid`. RLS — admin/super_admin only через has_role.

## Часть 4. Фильтры

Переиспользую из Payments:

- календарь (`PeriodSelector`)
- search input
- pagination
- сортировка по `created_at`

Link-specific (popover):

- статус: активные / недействительные / истёкшие / исчерпанные
- тип: разовые / подписочные
- привязка: с `user_id` / без `user_id`
- успешные оплаты: есть / нет
- created_by: admin / system
- по продукту / тарифу / offer (selects)

Все фильтры — server-side через `usePaymentLinks.ts`.

## Часть 5. Действия по строке

1. **Копировать** — `copyToClipboard("https://<origin>/pay/<token>")`.
2. **Открыть** — `window.open` нового таба.
3. **Сделать недействительной (soft)** — UPDATE `status='invalidated'` + audit `payment_link.invalidated`. Через новую edge function `admin-invalidate-payment-link` (тонкий writer-only, без mutate downstream). Никакого физического DELETE.
4. **Редактировать** — только безопасные поля: `description`, `max_uses` (только если новое значение ≥ `current_uses`), `expires_at` (только в будущее). Через `admin-update-payment-link` edge function. Нельзя менять `amount/product_id/tariff_id/offer_id/user_id`.
5. **Детали** — drawer с read-only summary + список связанных orders (links to existing payments view).

## Часть 6. Кнопка «Создать ссылку»

- Использует **только** `admin-create-public-link` (canonical writer).
- Если уже есть `CreatePublicLinkDialog` — переиспользую без правок.
- Если нет — создаю минимальный диалог: product → tariff → offer (опц.) → amount → payment_type → max_uses → expires_at → description.
- Без `user_id` по умолчанию = публичная ссылка для любого плательщика.
- НЕ создаёт orders_v2, НЕ дёргает bePaid — это инвариант writer'а.

## Часть 7. Привязка к продуктам/CRM/доступам/Telegram

Discovery подтверждает (и я фиксирую в отчёте), что downstream идентичен для всех каналов:

```text
link / button → public-checkout POST → _shared/create-payment-checkout.ts
                                       → orders_v2 (pending) + bePaid checkout
                                       → bePaid pays
                                       → bepaid-webhook (terminal):
                                           - orders_v2.status='paid'
                                           - stage_on_success → CRM deal
                                           - grant-access-for-order → entitlements/access_rules
                                           - telegram-grant-access (если применимо)
                                           - consumePaymentLinkForOrder → current_uses++
```

То есть offer/tariff settings (stage_on_success/failed, access_rules) применяются единообразно, через canonical webhook.

## Часть 8. Audit всех путей создания ссылок

Финальная mapping-таблица в отчёте:


| Канал                   | Writer                               | Таблица                      | Materialize order       | Webhook terminal | CRM | Access | Telegram | Расхождения |
| ----------------------- | ------------------------------------ | ---------------------------- | ----------------------- | ---------------- | --- | ------ | -------- | ----------- |
| Admin direct checkout   | `admin-create-payment-link`          | orders_v2                    | сразу                   | bepaid-webhook   | да  | да     | да       | нет         |
| Public link writer      | `admin-create-public-link`           | payment_links                | позже через /pay/:token | bepaid-webhook   | да  | да     | да       | нет         |
| Public /pay/:token POST | `public-checkout`                    | orders_v2                    | сразу                   | bepaid-webhook   | да  | да     | да       | нет         |
| Site CTA / тарифы       | `_shared/create-payment-checkout.ts` | orders_v2                    | сразу                   | bepaid-webhook   | да  | да     | да       | нет         |
| Subscription checkout   | bePaid subscription flow             | subscriptions_v2 + orders_v2 | сразу                   | bepaid-webhook   | да  | да     | да       | нет         |


Verdict готовлю по факту discovery: подтверждаю «да, все каналы ведут в один canonical downstream» либо честно перечисляю расхождения.

## Часть 9. Изменяемые компоненты

### Новые

- `src/components/admin/payments/links/*` (6 файлов).
- `src/hooks/usePaymentLinks.ts`.
- `supabase/functions/admin-invalidate-payment-link/index.ts` (тонкий, soft-update + audit).
- `supabase/functions/admin-update-payment-link/index.ts` (тонкий, только safe-поля + audit).
- (опц.) Миграция: view `payment_links_enriched_v` + RLS только admin/super_admin.

### Add-only правки

- `src/pages/admin/AdminPaymentsHub.tsx` — добавление вкладки `links` в массив `tabs` и подключение `LinksTabContent`.
- Роутер — добавление пути `/admin/payments/links`.

### Документация

- `docs/PAYMENT_LINKS_AUDIT.md` — полный audit + mapping каналов + verdict.
- Memory update: добавить пункт о вкладке «Ссылки» как канонической точке UI-управления `payment_links`.

## Часть 10. Что НЕ меняется (явно)

- `supabase/functions/public-checkout/index.ts`
- `supabase/functions/bepaid-webhook/index.ts`
- `supabase/functions/_shared/consume-payment-link.ts`
- `supabase/functions/_shared/create-payment-checkout.ts`
- `supabase/functions/admin-create-public-link/index.ts`
- `supabase/functions/admin-create-payment-link/index.ts`
- `supabase/functions/grant-access-for-order/*`
- Существующая вкладка «Платежи», её фильтры, тулбар, таблица.
- Любая логика CRM routing / Telegram / entitlements.
- Никаких новых payment-path. Никакого второго writer'а.

## Dry-run перед execute

1. Прочитать реальные файлы Payments-вкладки и подтвердить переиспользуемые компоненты (`PaymentsTabContent`, фильтры, query-хуки).
2. Подтвердить отсутствие/наличие готового `CreatePublicLinkDialog`.
3. Подтвердить отсутствие/наличие готового view/RPC для enriched payment_links.
4. SELECT из `payment_links` LIMIT 5 + проверка распределения статусов и каналов `created_by`.
5. SELECT count orders_v2 с `meta->>'payment_link_id' IS NOT NULL` — оценить нагрузку join'а.

## Execute (после approve)

1. Discovery-отчёт фиксирую первым (обязательно).
2. Создаю view (если нужно) + два thin edge functions (invalidate, update).
3. Создаю компоненты вкладки + хук.
4. Add-only регистрирую вкладку в hub + роуте.
5. Reuse существующего dialog'а или минимальная обёртка.
6. UI proof: скриншот вкладки, фильтры, действия.
7. SQL/logic proof: примеры строк, демонстрация derived полей, audit-запись после invalidate.

## STOP-guards

- Любая попытка mutate `current_uses`, `amount`, `product_id`, `tariff_id`, `offer_id`, `user_id` через update edge function — блокирована server-side.
- Если `max_uses` редактируется и новое значение `< current_uses` — 400.
- Любой DELETE из `payment_links` — запрещён UI и edge function.
- Если в discovery всплывёт второй writer/второй terminal-path — STOP, фиксирую и не строю UI до согласования.

## DoD

1. Новая вкладка «Ссылки» внутри `/admin/payments/links`, доступна из hub.
2. Таблица показывает ссылки **всех типов**, источник — `payment_links` (+ enriched view).
3. Переиспользованы Payments toolbar/calendar/search/table/badges/pagination.
4. Кнопка «Создать ссылку» работает через `admin-create-public-link`. Без `user_id` создаётся публичная ссылка для любого плательщика.
5. Row actions: copy / open / invalidate (soft) / edit safe-поля / details.
6. Есть документ `docs/PAYMENT_LINKS_AUDIT.md` с mapping каналов и verdict.
7. В отчёте: discovery findings, изменённые файлы, переиспользованные компоненты, доказательство «новый payment-path не создан», diff-summary, UI/SQL proof.
8. Никаких изменений в canonical webhook / consume / create-payment-checkout / writers.
9. Memory обновлена.

## Риски и зависимости

- Если в Payments-вкладке нет универсального data-table компонента — переиспользую через копирование разметки/классов и только общих UI-примитивов из `@/components/ui/*`, без логического дубля.
- Если enriched-view создавать нельзя — fallback на client-side join через два запроса в одном хуке (без N+1).
- Edit-функция намеренно ограничена тремя полями, чтобы не создавать риск рассинхрона с downstream.