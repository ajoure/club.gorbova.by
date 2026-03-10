
# Лендинг «ЗАКРОЙ ГОД» — iOS glass дизайн

## Архитектурные правила (обязательные)

1. **ID-driven architecture**: вся внутренняя логика лендинга и оплаты работает только через `product_id = 73c29914-63a3-4f4f-ac42-9f5287e58696`
2. **slug и product_code** допустимы только как UI/marketing identifiers, без участия в business logic (покупка, доступ, entitlement, order, payment)
3. **Canonical payment flow**: используется только существующий `/pay?product=UUID` → `Pay.tsx` → `PaymentDialog`. Новый payment/order flow не создаётся
4. **UI без бизнес-логики**: лендинг содержит только вызов существующего сценария (`navigate`), не реализует cross-domain действия

## Legacy-исключение: PreregistrationDialog

- `productCode="close_year_2025"` используется **только** для lead capture / группировки заявок в таблице `course_preregistrations`
- Таблица `course_preregistrations` имеет поле `product_code: string` (legacy, не UUID)
- Это **не canonical связь**, а **compatibility layer** для сбора лидов
- `product_code` **не участвует** в покупке, доступе, entitlement, order, payment и другой бизнес-логике
- **TODO (отдельный рефакторинг)**: миграция `course_preregistrations` → добавление `product_id UUID REFERENCES products_v2(id)`. Не входит в текущую задачу, не должна ломать production-логику

## Созданные файлы

| Файл | Назначение |
|---|---|
| `src/pages/CloseYear.tsx` | Страница-контейнер, роут `/close-year` |
| `src/components/close-year/CloseYearHero.tsx` | Hero-секция с золотыми частицами |
| `src/components/close-year/CloseYearResults.tsx` | 7 результатов обучения |
| `src/components/close-year/CloseYearProgram.tsx` | 5 модулей программы |
| `src/components/close-year/CloseYearPricing.tsx` | Тариф «Стандартный» 900 BYN, экспортирует `CLOSE_YEAR_PRODUCT_ID` |

## Изменённые файлы

| Файл | Изменение |
|---|---|
| `src/App.tsx` | Lazy import + роут `/close-year` |
| `src/pages/Learning.tsx` | 5-й продукт в витрине обучения |

## VERIFY (выполнено)

- [x] `/close-year` открывается без ошибок сборки (console logs: no errors)
- [x] `navigate("/pay?product=73c29914-...")` ведёт в существующий production flow (`Pay.tsx` → `products_v2` → `tariffs` → `tariff_offers` → `PaymentDialog`)
- [x] Сборка проходит без ошибок
- [x] В новых файлах нет логики, завязанной на slug/title/product_code для бизнес-операций
- [x] `productCode="close_year_2025"` используется только в `PreregistrationDialog` (lead capture), подтверждено grep-ом
- [x] `CLOSE_YEAR_PRODUCT_ID = "73c29914-63a3-4f4f-ac42-9f5287e58696"` — единственный идентификатор в бизнес-логике

## DoD (лендинг)

- [x] Лендинг `/close-year` создан и доступен
- [x] Дизайн iOS glass с золотыми акцентами
- [x] Покупка через canonical flow `/pay?product=UUID`
- [x] Lead capture через существующий `PreregistrationDialog`
- [x] Нет новой бизнес-логики в UI
- [x] Нет дублирования существующих компонентов
- [ ] Smoke-test на production (требует ручной проверки)

---

# PATCH: payment_link visibility + effective date

## Баг 1: Платежи с `origin=payment_link` не видны в UI

### Корневая причина

`src/hooks/useUnifiedPayments.tsx` строки 209 и 212 — whitelist origin-фильтр не включает `payment_link`.
Запись из `payments_v2` отфильтровывается, вместо неё показывается дубль из `payment_reconcile_queue` без связей (matched_order_id=NULL, matched_profile_id=NULL).

### Dry-run: подтверждение каноничности origin=payment_link

Все 3 записи с `origin=payment_link` в `payments_v2` — канонические, корректно материализованные:

| id | provider_payment_id | status | order_id | profile_id | amount | paid_at | meta_source |
|---|---|---|---|---|---|---|---|
| `15e6c91c` | `21c06d12` | succeeded | `3b294948` ✅ | `f75edd5b` ✅ | 250 BYN | 2026-03-10 01:31 | link_payment_webhook |
| `459f09fb` | `97d1d838` | succeeded | `da6e72e3` ✅ | `ebc0fecc` ✅ | 250 BYN | 2026-03-09 10:48 | link_payment_webhook |
| `59f6a9ce` | `242b43e0` | succeeded | `fa84c0cc` ✅ | `59b6d4df` ✅ | 250 BYN | 2026-02-25 19:02 | — |

Все записи имеют `order_id` и `profile_id`. Это не промежуточный flow — это канонический результат обработки webhook через `PATCH-LINK-LEGACY` handler.

### Правка

**Файл:** `src/hooks/useUnifiedPayments.tsx`
- Строка 209: добавить `"payment_link"` в массив `.in()`
- Строка 212: добавить `origin.eq.payment_link` в `.or()` строку

## Баг 2: Сделка показывает дату создания ссылки вместо даты оплаты

### Корневая причина

`src/components/admin/DealDetailSheet.tsx` отображает `deal.created_at`.
Для pay-by-link заказов `created_at` — момент генерации ссылки (9 марта 14:07), а оплата произошла позже (10 марта 02:31).

### Правка

**Файл:** `src/components/admin/DealDetailSheet.tsx`

Логика вычисления effectiveDate:
1. Из массива `payments` найти latest succeeded payment (явная сортировка по `paid_at` DESC, затем `created_at` DESC)
2. Если найден и есть `paid_at` → показывать `paid_at`
3. Иначе fallback на `deal.created_at`

```typescript
const latestSucceededPayment = payments
  ?.filter(p => p.status === 'succeeded')
  .sort((a, b) => {
    const dateA = new Date(a.paid_at || a.created_at).getTime();
    const dateB = new Date(b.paid_at || b.created_at).getTime();
    return dateB - dateA;
  })[0];

const effectiveDate = latestSucceededPayment?.paid_at || deal.created_at;
```

Решение **не** зависит от `deal.status === 'paid'` — оно определяется по факту наличия succeeded-платежа.

### Важно

- Это исправляет **только отображение даты в UI**
- Никакие поля в БД не создаются и не пересчитываются
- Source of truth остаётся `orders_v2.created_at` и `payments_v2.paid_at`

## STOP-guards

- **НЕ менять** логику дедупликации платежей (processedKeys / merge между payments_v2 и payment_reconcile_queue)
- **НЕ трогать** merge-логику, кроме включения `payment_link` в whitelist
- **НЕ менять** schema БД
- **НЕ создавать** новые таблицы, edge functions, RPC
- **НЕ делать** массовый repair
- **НЕ менять** другие origin-значения

## Итого: 2 файла, 3 правки

| Файл | Строка | Изменение |
|---|---|---|
| `useUnifiedPayments.tsx` | 209 | Добавить `"payment_link"` в массив `.in()` |
| `useUnifiedPayments.tsx` | 212 | Добавить `origin.eq.payment_link` в `.or()` |
| `DealDetailSheet.tsx` | ~472 | effectiveDate = latest succeeded payment's paid_at ?? deal.created_at |

## DoD (PATCH)

- [ ] Платёж Юлии Крыштопик (15e6c91c) появляется в UI как запись из `payments_v2`, а не как дубль из `payment_reconcile_queue`
- [ ] У записи отображаются: контакт, сделка, продукт (через order JOIN)
- [ ] В карточке сделки показывается дата оплаты 10.03, а не дата генерации ссылки 09.03
- [ ] Остальные origin (`bepaid`, `statement_sync`, `subscription`, `manual_adjustment`, `card_verification`) не ломаются
- [ ] Логика дедупликации не затронута
- [ ] Сборка проходит без ошибок
