да, согласен, с учетом правок:

## 1. План правильный

Phase 9-B можно выполнять в этом scope: **минимальная видимость / reporting**, без lifecycle, repair, миграций и новых функций.

---

## 2. Главная правка: не хардкодить значения `provider_choice_source`

В плане есть маппинг:

```text
button → По настройке кнопки
admin / override → Admin override
customer → Клиент выбирает

```

Но ранее фактические значения были:

```text
auto | explicit

```

Поэтому нужно заменить на безопасную логику:

```md
Отображать способ создания ссылки по комбинации полей:

- provider_choice_source='auto' → «По настройке кнопки»
- provider_choice_source='explicit' + provider_mode='fixed' → «Admin override»
- provider_choice_source='explicit' + provider_mode='customer_choice' → «Клиент выбирает»

Не вводить новые значения `button/admin/customer`, если их нет в БД.

```

---

## 3. `provider_choice_source` не тянуть через новый RPC

Добавить:

```md
Если `provider_choice_source` лежит только в `payment_links.meta` и текущий RPC/view не отдаёт его в UI, не расширять RPC/view в Phase 9-B.

В этом случае:
- зафиксировать gap в proof;
- показать только доступные поля;
- вынести расширение RPC/view в Phase 9-C / отдельный approve.

```

---

## 4. Stripe invoice fields — использовать fallback по ключам

В разных местах могли встречаться разные ключи:

```text
invoice_id
stripe_invoice_id
subscription_id
stripe_subscription_id

```

Добавить:

```md
Для Stripe invoice visibility использовать фактические ключи из `payments_v2.meta.stripe`.

Если встречаются оба варианта:
- `stripe_invoice_id` / `invoice_id`;
- `stripe_subscription_id` / `subscription_id`;

показывать доступное значение, но не переписывать meta и не нормализовать данные в Phase 9-B.

```

---

## 5. Provider events statuses — не хардкодить `skipped_duplicate`

Добавить:

```md
В `StripeEventsTab` использовать фактические `processing_status` из данных.

Не хардкодить только `skipped_duplicate`, если в таблице фактически используются `skipped`, `duplicate`, `manual_review`, `failed` или другие значения.

В UI показать все non-success statuses, найденные в data.

```

---

## 6. Orders — не делать новые join/RPC

Добавить:

```md
Если `AdminOrdersV2` не получает Stripe invoice/payment fields из текущих данных, не добавлять новый RPC/join в Phase 9-B.

Тогда:
- показать только provider/currency/payment_link_id/payment_flow, если они уже доступны;
- Stripe invoice/subscription visibility оставить в Payments;
- gap по Orders вынести в proof.

```

---

## 7. Перед Execute нужен короткий Diagnose-result

Добавить между Diagnose и Execute:

```md
После Шага 0 дать короткий internal plan/update в proof:
- какие файлы реально будут изменены;
- какие поля реально доступны без RPC/view/migration;
- какие пункты будут deferred;
- подтвердить, что нет STOP-условий.

Только после этого Execute.

```

---

## 8. Итоговый ответ Lovable

```md
План принят с правками.

Уточнения перед выполнением:

1. Не хардкодить `provider_choice_source` как `button/admin/customer`, если таких значений нет в БД.
   Использовать фактическую модель:
   - `auto` → «По настройке кнопки»;
   - `explicit + fixed` → «Admin override»;
   - `explicit + customer_choice` → «Клиент выбирает».

2. Если `provider_choice_source` не отдаётся текущим RPC/view в UI — не расширять RPC/view в Phase 9-B. Зафиксировать gap и вынести в Phase 9-C.

3. Для Stripe invoice/subscription fields использовать фактические ключи из `payments_v2.meta.stripe`: `invoice_id` / `stripe_invoice_id`, `subscription_id` / `stripe_subscription_id`. Ничего не нормализовать в БД.

4. В provider events не хардкодить `skipped_duplicate`; отображать фактические non-success statuses из данных.

5. В Orders не добавлять новые joins/RPC. Если нужных Stripe-полей нет в текущем payload — показать только доступные поля, остальное deferred.

6. После Diagnose зафиксировать в proof:
   - доступные поля;
   - финальный список файлов;
   - deferred gaps;
   - отсутствие STOP-условий.

7. Phase 9-B остаётся только visibility/reporting:
   - без миграций;
   - без новых RPC;
   - без новых Edge Functions;
   - без repair/retry/regrant/reconcile/backfill;
   - без изменений checkout/webhook/grant/Telegram.

После этого можно выполнять Phase 9-B.

```

## 9. Контроль следующего отчёта

Принимать Phase 9-B PASS только если:

- есть provider badge в Payments;
- provider filter работает;
- Stripe invoice/PDF видны там, где данные доступны;
- bePaid receipt не сломан;
- payment links показывают доступные provider/payment fields;
- failed/manual_review/skipped provider events видны;
- нет изменений в `supabase/functions/`, `supabase/migrations/`, lifecycle-файлах;
- все недоступные поля честно отмечены как deferred, а не закрыты фиктивно.
- &nbsp;
- План: Phase 9-B — Minimal Admin Visibility / Reporting

## Цель

Дать админу видимость по bePaid / Stripe в существующих экранах: provider, currency, receipt/invoice/PDF, способ создания ссылки, состояние provider events. Никакого изменения lifecycle, миграций, repair-кнопок.

## Scope (строго)

Разрешено: правки UI-компонентов, hooks, использование уже существующих RPC/view-полей, новые badges/filters/колонки/линки.
Запрещено: миграции, новые edge functions, новые RPC, изменения checkout/webhook/access/grant/Telegram/reconcile, любые repair/retry/regrant/backfill/cleanup actions, новый unified subscriptions module.

## Этапы (Diagnose → Plan → Dry run → Execute → Verify)

### Шаг 0. Diagnose (read-only, 1 проход)

Перед правками подтвердить по фактическому коду/данным:

- путь `provider_choice_source` в `payment_links.meta` и реально ли он попадает в `usePaymentLinks` / RPC `get_admin_payment_links_v1`;
- наличие `payments_v2.meta.stripe.{hosted_invoice_url, invoice_pdf, invoice_id, subscription_id}` и `receipt_url`;
- название action `payment_link.payment_type_promoted_recurring` (или его отсутствие) в `admin-create-public-link`;
- использует ли `PaymentsTable.tsx` уже поле `provider`/валюту;
- что отдаёт `stripe-list-events` (поля account_code, processing_status, processing_error).
Если для нужного поля требуется миграция/новый RPC/изменение view — STOP, отдельный approve. Никаких миграций в Phase 9-B.

### Шаг 1. Payments table — provider/currency/документы

Файлы: `src/components/admin/payments/PaymentsTable.tsx`, `PaymentsFilters.tsx`, `PaymentsTabContent.tsx`, при необходимости `ReceiptStatusBadge.tsx` (только расширение, не лом).

- Колонка/бейдж Provider: `bePaid` / `Stripe` из `payments_v2.provider`.
- Колонка Currency: `BYN / EUR / USD / PLN` без пересчёта.
- Документы (одна ячейка «Документы»):
  - bePaid: `receipt_url` → «Чек»;
  - Stripe one-time: `receipt_url` → «Stripe receipt»;
  - Stripe subscription: `meta.stripe.hosted_invoice_url` → «Invoice», `meta.stripe.invoice_pdf` → «PDF»;
  - иначе — «Документ ещё не получен».
- Provider filter: если уже есть — только проверить и не дублировать; если значения не покрывают Stripe/bePaid — поправить в UI/hook без миграций.

### Шаг 2. Orders — минимальная visibility

Файлы: `src/pages/admin/AdminOrdersV2.tsx` и связанные строковые/детальные компоненты, без нового lifecycle.

- В строке заказа/деталях показать: provider, currency, `payment_link_id` (если есть), `payment_flow` (если есть), Stripe `invoice_id` / `subscription_id` из связанного `payments_v2.meta.stripe`.
- Никаких новых действий и репэйров.

### Шаг 3. Payment links — provider/способ создания/тип

Файлы: `src/components/admin/payments/links/LinksTabContent.tsx`, `LinkDetailsDrawer.tsx`, `LinkStatusBadge.tsx` (только дополнение), `src/hooks/usePaymentLinks.ts` (только маппинг, если поле уже отдаётся RPC).

- В строке/драйвере показать: `provider`, `provider_mode`, `provider_choice_source` (из JSON-path подтверждённого в Шаге 0), `payment_type`, `account_code`, `profile_code`, `business_stream`, валюту, offer/tariff/контакт.
- Отображение `provider_choice_source`:
  - `button` → «По настройке кнопки»;
  - `admin` / override → «Admin override»;
  - `customer` → «Клиент выбирает».
- Badge/warning «Разовая админская оплата по рекуррентному тарифу» — по данным самой ссылки: `provider_choice_source='admin'` (или эквивалент) + recurring offer + `payment_type='one_time'`. Audit-action — только как дополнительный proof, не как условие отображения.
- Если `provider_choice_source` фактически не доходит до клиента — зафиксировать в proof и не показывать поле в Phase 9-B (без миграции/расширения RPC). Не вводить новые БД-поля.

### Шаг 4. Provider events / diagnostics (read-only)

Файлы: `src/components/admin/integrations/StripeEventsTab.tsx`, `src/components/admin/payments/DiagnosticsTabContent.tsx`.

- В `StripeEventsTab` добавить сводку (client-side по уже загружаемым событиям): count `failed`, `manual_review`, `skipped_duplicate`; фильтр по `processing_status` и `account_code`; показывать `processing_error` в drawer/раскрытии строки.
- В `DiagnosticsTabContent` — короткий read-only блок «Provider events health» с цифрами (по `provider_events`, через уже существующую функцию `stripe-list-events`; если данных недостаточно — отметить в proof как deferred, без нового RPC).
- Никаких retry/repair кнопок.

### Шаг 5. Subscriptions visibility (минимум)

Без нового unified-модуля.

- В payment details и order details показывать `meta.stripe.subscription_id`, если присутствует.
- В StripeEventsTab фильтр/видимость subscription-related event_type (через уже доступные данные).
- Полноценный unified subscriptions tab — backlog / Phase 9-C.

### Шаг 6. Audit (минимум)

- Никакого drill-down.
- Допустимо: 1–2 последних релевантных audit-записи в драйвере платежа/ссылки, ТОЛЬКО если они уже доступны без нового RPC. Иначе — в proof пометить deferred.

## Proof

Создать `.lovable/proofs/phase_9_admin_visibility_v1.md` c:

- diff summary и списком изменённых файлов;
- скриншоты: Payments+provider badge; Stripe payment c invoice/PDF; bePaid payment с receipt; Link details с provider_choice_source/payment_type; Diagnostics/StripeEvents с failed/manual_review/skipped;
- SQL-семплы строк, подтверждающие поля (read-only `supabase--read_query`);
- freeze-confirmation: webhooks / grant-access / Telegram / reconcile / migrations — untouched; no repair actions.

## Gates (DoD)

P9-1 provider badge в Payments; P9-2 provider filter работает; P9-3 Stripe receipt/invoice/PDF видны; P9-4 bePaid receipt не сломан; P9-5 links показывают provider_mode/provider_choice_source/payment_type; P9-6 explicit one_time на recurring виден как admin override; P9-7 failed/manual_review/skipped видны; P9-8 Stripe subscription_id виден в payment/order details; P9-9 нет repair/retry/reconcile/backfill; P9-10 freeze соблюдён.

## Технические заметки

- Источники данных строго существующие: `payments_v2`, `orders_v2`, `payment_links` + RPC `get_admin_payment_links_v1`, `provider_events` (через `stripe-list-events`).
- Если в ходе Diagnose обнаружится, что какое-то поле требует расширения RPC/view/миграции — выносим пункт в backlog Phase 9-C, в Phase 9-B этого пункта НЕ делаем.
- Все новые лейблы/бейджи — через существующий design system (`Badge`, токены), без хардкода цветов.
- Никаких изменений в `supabase/functions/`, `supabase/migrations/`, `src/integrations/supabase/client.ts`.

## Ожидаемые зоны изменений

- `src/components/admin/payments/PaymentsTable.tsx`
- `src/components/admin/payments/PaymentsFilters.tsx` (опц.)
- `src/components/admin/payments/PaymentsTabContent.tsx` (опц., только проброс)
- `src/components/admin/payments/links/LinksTabContent.tsx`
- `src/components/admin/payments/links/LinkDetailsDrawer.tsx`
- `src/components/admin/integrations/StripeEventsTab.tsx`
- `src/components/admin/payments/DiagnosticsTabContent.tsx`
- `src/pages/admin/AdminOrdersV2.tsx` (+ дочерние строковые компоненты заказа)
- `.lovable/proofs/phase_9_admin_visibility_v1.md` (новый)

Фактический список финализируется после Шага 0 Diagnose и фиксируется в proof.