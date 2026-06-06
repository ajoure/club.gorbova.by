# Proof: Phase 3.6-B — UI Implementation: Проблемы с оплатой

## Статус

```
Phase 3.6-A Discovery   = APPROVED
Phase 3.6-B Code        = DONE (этот документ)
Phase 3.5-B Runtime     = PENDING-BY-STRIPE-TIME  (НЕ закрыт UI-спринтом)
```

UI-спринт сделал маркер `subscriptions_v2.meta.stripe.dunning_status` видимым в админке. Runtime proof 3.5-B остаётся открытым до первого реального production-события.

---

## Добавленные файлы

- `src/hooks/admin/usePaymentIssuesCounters.ts` — read-only счётчики (SELECT subscriptions_v2).
- `src/hooks/admin/usePaymentIssuesSubscriptions.ts` — read-only список (SELECT subscriptions_v2 + enrich profiles/products_v2/tariffs).
- `src/components/admin/payments/PaymentIssueStatusBadge.tsx` — бейдж со словарём русских формулировок.
- `src/components/admin/payments/PaymentIssuesProofModal.tsx` — modal с 5 SQL-снippet'ами для ручной проверки (copy only).
- `src/components/admin/payments/PaymentIssuesTabContent.tsx` — контент вкладки (stat-cards, фильтры, таблица, empty state, секция «Ручная проверка»).

## Изменённые файлы

- `src/pages/admin/AdminPaymentsHub.tsx` — добавлен таб `payment-issues` + рендер контента + индикатор-точка.
- `src/App.tsx` — маршрут `/admin/payments/payment-issues`.

## НЕ изменялось

- `supabase/functions/**` — ни одной правки.
- `supabase/migrations/**` — ни одной новой миграции.
- `src/integrations/supabase/types.ts` — нетронут.
- `_shared/stripe-subscription-resolver.ts`, `subscriptions-reconcile`, `stripe-webhook` — нетронуты.
- Любой bePaid-код — нетронут.

---

## Источник данных

- Источник: `subscriptions_v2` (raw table — паттерн всех админских компонентов: `AdminDeals`, `DealDetailSheet`, `useBillingReport`).
- Причина отказа от `subscriptions_v2_safe`: в этом представлении нет полей `provider` и `meta.stripe.*`, без которых фильтрация по dunning невозможна. Зафиксировано в plan-revision #4 «сначала проверить существующий RLS-safe паттерн в админке» — admin-паттерн = raw `subscriptions_v2`.

---

## Текущая когорта (фотография на момент сдачи)

```sql
SELECT meta->'stripe'->>'dunning_status' AS status, count(*)
FROM public.subscriptions_v2
WHERE meta->'stripe'->>'dunning_status' IS NOT NULL
GROUP BY 1;
```

Результат:

```
status | count
-------+-------
(0 rows)
```

**Текущая когорта = 0.** Это не ошибка — естественное состояние до первого Stripe-события. UI корректно показывает empty state:

```
Проблем с оплатой сейчас нет.
Подписки с неуспешной повторной оплатой появятся здесь автоматически.
```

---

## DoD: grep-проверки по новым файлам

Файлы: 5 (см. список выше).

| Проверка | Команда | Результат |
| --- | --- | --- |
| Запрещённые UI-термины (Dunning, Recovery, Final failure, Past due, Smart Retry, Grace) | `rg -n -e 'Dunning' -e 'Recovery' -e 'Final failure' -e 'Past due' -e 'Smart Retry' -e 'Grace'` | **0 видимых строк UI.** Одно совпадение — комментарий-документация в `PaymentIssueStatusBadge.tsx` («Запрещены: …»). |
| Мутации БД (`.insert(`, `.update(`, `.delete(`, `.upsert(`) | `rg -n -e '\.insert\(' -e '\.update\(' -e '\.delete\(' -e '\.upsert\('` | **0 совпадений.** |
| Edge-функции (`functions.invoke`) | `rg -n 'functions\.invoke'` | **0 совпадений.** |
| Новые файлы в `supabase/functions/**` | — | **0 файлов.** |
| Новые миграции | — | **0 файлов.** |

---

## Acceptance Criteria — статус

- [x] Таб «Проблемы с оплатой» доступен по `/admin/payments/payment-issues` и виден в pills-навигации.
- [x] Stat-карточки и таблица отображают подписки с непустым `meta.stripe.dunning_status` (сейчас 0 — empty state).
- [x] Все статусы и подписи на русском; запрещённые термины отсутствуют в видимом UI.
- [x] Бейджи через tone-классы (`amber`, `destructive`, `emerald`).
- [x] Modal «Проверить вручную» открывается, показывает 5 SQL-снippet'ов с copy-кнопкой; ничего не выполняет.
- [x] Индикатор-точка на табе появляется только когда `hasProblems === true`.
- [x] Detector-карточка на дашборде — **не делалась** (revision #2 плана: «не тратить время на поиск/перестройку dashboard»). Backlog-сноска ниже.
- [x] grep по новым файлам: mutation-методы = 0, `functions.invoke` = 0.
- [x] Нет новых файлов в `supabase/functions/**` и `supabase/migrations/**`.
- [x] **Phase 3.5-B Runtime остаётся `PENDING-BY-STRIPE-TIME`** — UI-спринт его не закрывает.
- [x] Empty state с указанным русским текстом.
- [x] Proof по нулевой когорте — этот раздел выше.

---

## Действие «Открыть клиента»

В таблице каждая строка имеет одно действие — **«Открыть клиента»** → `navigate('/admin/contacts?contact=<user_id>&from=payment-issues')`. Это существующий паттерн (`ClickableContactName`, `DealDetailSheet`, `AdminOrdersV2`, `AdminEntitlements`). Никакого write-действия из строки нет. Универсального detail-view для Stripe-подписки в проекте нет — это зафиксировано как **backlog** (см. ниже).

---

## Backlog (после этого спринта)

- `.lovable/backlog/stripe_dunning_admin_tab.md` — **CLOSED.** Реализовано: таб видимости + read-only список + бейджи + ручная проверка. Кнопка «Открыть подписку (detail sheet)» и кнопка «Отправить письмо клиенту» — отложены в новые backlog-пункты ниже.
- `.lovable/backlog/stripe_dunning_email_template.md` — **остаётся OPEN.** Email-шаблон и кнопка «Отправить клиенту письмо для обновления карты» — вне scope 3.6-B.
- **Новое:** detail-view подписки Stripe для админа (отдельный backlog при необходимости).
- **Новое:** detector-карточка на admin dashboard — отложена; включить, когда будет очевидное место.

---

## Подтверждение по правилам

- ❌ Новых edge-функций — нет.
- ❌ Новых cron / workers / GitHub Actions — нет.
- ❌ Новых миграций / изменений схемы — нет.
- ❌ Auto-verify воркера, обновляющего proof или `system_health_runs` — **нет** (явный запрет revision #1 плана 3.6-A).
- ❌ Изменений Stripe lifecycle — нет.
- ❌ Изменений bePaid — нет.
- ❌ Изменений `entitlements`, `telegram_access`, `access_rules` — нет.
- ✅ Только UI/read-only.

---

```
Phase 3.6-B Code  = PASS
Phase 3.5-B Runtime = PENDING-BY-STRIPE-TIME (не изменился, ожидает естественной эскалации)
```
