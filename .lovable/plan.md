
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

## DoD

- [x] Лендинг `/close-year` создан и доступен
- [x] Дизайн iOS glass с золотыми акцентами
- [x] Покупка через canonical flow `/pay?product=UUID`
- [x] Lead capture через существующий `PreregistrationDialog`
- [x] Нет новой бизнес-логики в UI
- [x] Нет дублирования существующих компонентов
- [ ] Smoke-test на production (требует ручной проверки)
