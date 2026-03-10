

## Проблема

После ручного изменения `deal_date` с 10.03 на 09.03, внутри карточки сделки показывается 09.03 (правильно), но в списке сделок внутри контакта — всё ещё 10.03. Причина: не все UI-компоненты переведены на `deal_date`.

## Найденные места, которые всё ещё используют `deal.created_at` вместо `deal_date`

| # | Файл | Строка | Контекст |
|---|---|---|---|
| 1 | `ContactDetailSheet.tsx` | 2826 | Список сделок в карточке контакта — **это то, что видно на скриншоте** |
| 2 | `ContactDealsDialog.tsx` | 206 | Таблица сделок в диалоге привязки (bePaid) |
| 3 | `GrantAccessFromDealDialog.tsx` | 91-92, 106 | Расчёт даты начала доступа из даты сделки |

`AdminDeals.tsx` (строка 880) уже исправлен — использует `deal.deal_date || deal.created_at`.

## Исправления

### 1. `ContactDetailSheet.tsx` — строка 2826

```typescript
// Было:
{format(new Date(deal.created_at), "dd.MM.yy HH:mm")}

// Станет:
{format(new Date(deal.deal_date || deal.created_at), "dd.MM.yy HH:mm")}
```

### 2. `ContactDealsDialog.tsx` — строка 206

```typescript
// Было:
{format(new Date(deal.created_at), "dd.MM.yyyy", { locale: ru })}

// Станет:
{format(new Date(deal.deal_date || deal.created_at), "dd.MM.yyyy", { locale: ru })}
```

### 3. `GrantAccessFromDealDialog.tsx` — строки 91-92, 106

Здесь `deal.created_at` используется для бизнес-логики (расчёт начала доступа). Нужно перевести на `deal.deal_date || deal.created_at`, чтобы ручной override даты сделки влиял и на расчёт периода доступа.

### 4. `ContactDetailSheet.tsx` — строка 420 (сортировка запроса)

Supabase-запрос сделок контакта сортируется по `created_at`. Перевести на `deal_date`:
```typescript
.order("deal_date", { ascending: false })
```

## Что НЕ меняем

- `DealDetailSheet.tsx` — уже корректно (иерархия manual → paid_at → created_at)
- `EditDealDialog.tsx` — уже корректно
- `AdminDeals.tsx` — уже корректно
- Никакой бизнес-логики платежей, дедупликации, edge functions

## Итого: 3 файла, 5 точек правки

