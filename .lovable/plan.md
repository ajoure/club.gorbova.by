# MICRO-PATCH P0.8.1 — Net sum (убрать Math.abs) для Σ в Payments

## Контекст
В /admin/payments добавлены:
- “Показано: matched из scope”
- “Σ matched из Σ scope”
- “Σ выбранных” в batch actions

`payments` уже является scope, т.к. приходит из `useUnifiedPayments(effectiveDateFilter)` (фильтр по периоду применяется внутри хука). `filteredPayments` = matched (после табов/поиска/advanced filters). Это ОК.

## P0 BUG
Суммы сейчас считаются через `Math.abs(amount)`, из-за чего возвраты/рефанды (-amount) становятся положительными и Σ завышается (оборот вместо нетто).

## Требование
Считать Σ как **нетто** (учитывать знак), и в хедере, и в выбранных платежах.

---

## Изменения (минимальный diff, 2 строки)

### 1) PaymentsTabContent.tsx — sumByCurrency(): убрать Math.abs

Файл:
`src/components/admin/payments/PaymentsTabContent.tsx`

Найти:
```ts
const amt = Math.abs(Number(p.amount || 0));

Заменить на:

const amt = Number(p.amount || 0);

P0-guard:
	•	Number() должен получать значение как число/строку; если NaN → трактуем как 0:

const raw = Number(p.amount ?? 0);
const amt = Number.isFinite(raw) ? raw : 0;

(допустимо как улучшение, но не обязательно, если в данных всегда валидные числа)

⸻

2) PaymentsBatchActions.tsx — selectedSum: убрать Math.abs

Файл:
src/components/admin/payments/PaymentsBatchActions.tsx

Найти:

const amt = Math.abs(Number(p.amount || 0));

Заменить на:

const amt = Number(p.amount || 0);

P0-guard (аналогично, по желанию):

const raw = Number(p.amount ?? 0);
const amt = Number.isFinite(raw) ? raw : 0;


⸻

STOP-guards
	•	Не трогать RLS/SQL/миграции.
	•	Не менять логику фильтров/табов/поиска — только агрегация Σ.
	•	Если после патча Σ перестанет совпадать с ожидаемым “оборотом” — НЕ возвращать abs, а сделать отдельный будущий PATCH “Нетто/Оборот toggle”.

⸻

DoD (обязательные факты/скрины)
	1.	Net sum в хедере:

	•	В периоде, где есть +100 BYN и refund -50 BYN → “Σ …” показывает 50.00 BYN, а не 150.00.

	2.	Net sum в выбранных:

	•	Выделить чекбоксами +100 и -50 → в batch bar “Σ 50.00 BYN”.

	3.	Табы/фильтры не сломаны:

	•	Поиск “55.00” + таб “Успешные” → только успешные.
	•	Поиск “55.00” + таб “Ошибки” → только ошибки.

	4.	Scope/Matched не регресснули:

	•	Меняем период “Этот месяц” → “Все периоды”: из X и Σ всего меняются соответствующе.

Deliverables:
	•	2 коммита/правки в 2 файлах
	•	2 UI-скрина: (а) header Σ с refund, (б) batch bar Σ с refund

