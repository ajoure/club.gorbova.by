# Dry-run: нормализация плейсхолдеров (PLACEHOLDERS-NORMALIZATION-2026-05-13)

## Текущее состояние `document_token_registry`

| category         | active | archived |
|------------------|--------|----------|
| customer         | 21     | 0        |
| customer.signer  | 4      | 0        |
| executor         | 16     | 0        |
| legal_details    | 0      | 47 (уже архивированы предыдущей миграцией) |
| deal             | 38     | 0        |
| document         | 2      | 28       |
| ...              |        |          |

## `document_templates.deleted_at` — ОТСУТСТВУЕТ → миграция нужна.

## Резолвер адресов
`_shared/document-render.ts` уже содержит `formatStructuredAddress` и подставляет:
- `executor.address`, `executor.address.full`
- `customer.address`, `customer.address.full`

Address parts (`*.address.street/house/...`) **не подставляются** → нужно добавить и в registry, и в `renderData` резолвера.

## Alias-механизм
`document_token_aliases` существует и активно используется (43 alias-строки). Используем его, без `meta.alias_of`.

---

## Customer (21) — dry-run действий

| token_key | old_label | new_label | action |
|---|---|---|---|
| customer.account | Заказчик: счёт | Заказчик: Расчётный счёт / IBAN | rename_label |
| customer.acts_on_basis | Заказчик: действует на основании (ЮЛ/ИП) | Заказчик: Руководитель действует на основании | rename_label |
| customer.address | Заказчик: адрес | Заказчик: Адрес | rename_label |
| customer.address.full | Заказчик: адрес (полный) | Заказчик: Адрес полный | rename_label |
| customer.bank | Заказчик: банк | Заказчик: Банк | rename_label |
| customer.bank_code | Заказчик: код банка | Заказчик: БИК / код банка | rename_label |
| customer.bank_name | Заказчик: банк (название) | — | soft_deprecate_duplicate (canonical=customer.bank) + alias |
| customer.basis | Заказчик: основание полномочий (ЮЛ/ИП) | — | soft_deprecate_duplicate (canonical=customer.acts_on_basis) + alias |
| customer.client_type | Заказчик: тип клиента | Заказчик: Тип клиента | rename_label |
| customer.director | Заказчик: директор (ЮЛ) | Заказчик: Руководитель ФИО | rename_label |
| customer.director_full_name | Заказчик: ФИО руководителя (ЮЛ) | — | soft_deprecate_duplicate (canonical=customer.director) + alias |
| customer.director_position | Заказчик: должность руководителя (ЮЛ) | Заказчик: Руководитель должность | rename_label |
| customer.director_short | Заказчик: директор, инициалы (ЮЛ) | Заказчик: Руководитель краткое ФИО | rename_label |
| customer.email | Заказчик: email | Заказчик: Email | rename_label |
| customer.legal_address | Заказчик: юридический адрес (ЮЛ/ИП) | — | soft_deprecate_duplicate (canonical=customer.address) + alias |
| customer.name | Заказчик: ФИО / название | Заказчик: ФИО полностью | rename_label |
| customer.passport | Заказчик: паспорт (ФЛ) | Заказчик: Паспорт серия и номер | rename_label |
| customer.personal_number | Заказчик: личный номер (ФЛ) | Заказчик: Личный номер | rename_label |
| customer.phone | Заказчик: телефон | Заказчик: Телефон | rename_label |
| customer.short_name | Заказчик: краткое имя | Заказчик: Краткое ФИО | rename_label |
| customer.unp | Заказчик: УНП (ЮЛ/ИП) | Заказчик: УНП | rename_label |

## Executor (16) — аналогичный pattern

| token_key | new_label |
|---|---|
| executor.account | Исполнитель: Расчётный счёт / IBAN |
| executor.acts_on_basis | Исполнитель: Руководитель действует на основании |
| executor.address | Исполнитель: Адрес |
| executor.address.full | Исполнитель: Адрес полный |
| executor.bank | Исполнитель: Банк |
| executor.bank_code | Исполнитель: БИК / код банка |
| executor.basis | — soft_deprecate (canonical=executor.acts_on_basis) |
| executor.director | Исполнитель: Руководитель ФИО |
| executor.director_full_name | — soft_deprecate (canonical=executor.director) |
| executor.director_position | Исполнитель: Руководитель должность |
| executor.director_short | Исполнитель: Руководитель краткое ФИО |
| executor.email | Исполнитель: Email |
| executor.name | Исполнитель: Полное наименование |
| executor.phone | Исполнитель: Телефон |
| executor.short_name | Исполнитель: Краткое наименование |
| executor.unp | Исполнитель: УНП |

## Address parts — добавить (add_missing_token)

11 customer + 11 executor токенов:
`*.address.street/.house/.building/.apartment/.city/.district/.city_district/.region/.postal_code/.country` (+ `*.address.full` уже есть для обоих).

## Aliases (add_alias) — для backward-compat soft-deprecated токенов
- `{{customer.bank_name}}` → `customer.bank`
- `{{customer.basis}}` → `customer.acts_on_basis`
- `{{customer.director_full_name}}` → `customer.director`
- `{{customer.legal_address}}` → `customer.address`
- `{{executor.basis}}` → `executor.acts_on_basis`
- `{{executor.director_full_name}}` → `executor.director`

Старые `payer.*`, `service.*`, `order.*` aliases уже есть — не трогаем.

## Example_value (заполнить)
~30 customer/executor токенов с пустым `example_value` получат BY-реалистичные значения
(ИП «Горбова Е.А.», УНП 192345678, «ул. Панфилова, д. 2, пом. 49л, г. Минск, 220035, Республика Беларусь»).

---

## Summary

| Действие | Count |
|---|---|
| labels rename (registry) | 31 |
| missing tokens add | 22 |
| aliases add | 6 |
| duplicates soft-deprecate | 6 |
| example_value updates | ~30 |
| migration `document_templates.deleted_at` | yes |
| risky/conflicting fields | нет (все каноники чёткие) |

## STOP-guards (подтверждены)
- `payments_v2`, `orders_v2 schema`, `allocate_document_number`, document scenarios, Contact Center, морфология — НЕ трогаем.
- `document_token_aliases` уже есть — alias-layer без новой колонки.
- Production-шаблоны не удаляются hard-delete.
