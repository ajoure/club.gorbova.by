# Stage 5.0.3 — Аудит контракта наименования ЮЛ

Цель: до любой правки доказать, что canonical billing formatter существует, package-резолвер его уже использует, и локализовать реальные источники багов пользователя.

---

## 1. Реестр полей (fields_registry)

| public_id | entity_type | key | label | archived_at | options |
|---|---|---|---|---|---|
| FLD-000010 | legal_details | `legal_details.leg_org_form` | Форма собственности | NULL | `deprecated_at=2026-05-10`, `replaced_by=user_requisites\|customer`, `deprecated_reason=requisites_v2_stage_e` |
| FLD-000011 | legal_details | `legal_details.leg_name` | Название организации | NULL | то же |
| FLD-000103 | executor | `executor.name` | Исполнитель: Название / ФИО по типу плательщика | NULL | `scope=platform_executor` |
| FLD-000104 | executor | `executor.short_name` | Исполнитель: Краткое название / ФИО по типу плательщика | NULL | `scope=platform_executor` |
| FLD-000343 | customer_leg | `customer.leg.org_form` | Заказчик ЮЛ: Форма собственности | NULL | typed_customer |
| FLD-000345 | customer_leg | `customer.leg.short_name` | Заказчик ЮЛ: Краткое название | NULL | typed_customer |

Корректировка по сравнению с прошлым обсуждением: **FLD-000103 / 000104 — это `executor.*`, а не `customer.*`**. Для `customer` `short_name` это `FLD-000114` / `FLD-000345`. На последующие выводы это не влияет — обе ветки идут через один helper.

---

## 2. Canonical billing formatter — найден, не дублирован

`supabase/functions/_shared/typed-tokens-resolver.ts:54` — `canonicalizeLegalEntity(rawOrgForm, rawName, rawFullName)` возвращает:

```ts
{ org_form: string; name: string; short_name: string; full_name: string }
```

- `org_form` — короткая форма (`ЗАО`, `ООО`, `ИП`, `ОДО`, …), нормализуется из `rawOrgForm` или из первого слова `source`, либо из полной русской формы через `ORG_FORM_FULL_TO_SHORT`.
- `name` — чистое имя без формы и без любых кавычек (`«»"'„‟""'` срезаются дважды).
- `short_name` — `ЗАО «АЖУР инкам»` (для ИП: `ИП Иванов И.И.`).
- `full_name` — `Закрытое акционерное общество «АЖУР инкам»`.

Helper **идемпотентен** (см. примеры в комментарии `:43-:52`): вход `ООО "Ромашка"` или `ООО «Ромашка»` или `(ООО, Ромашка)` → один и тот же результат, никаких двойных кавычек, никакого `ЗАО «ЗАО …»`.

Использование в billing: `typed-tokens-resolver.ts:300, :382` для `customer.leg.*` и `executor.leg.*`.

---

## 3. Package formatter — уже переиспользует billing helper

`supabase/functions/_shared/packageFieldFormatter.ts:30-45`:

```ts
import { canonicalizeLegalEntity, ... } from "./typed-tokens-resolver.ts";

function ulCanon(row: any) {
  return canonicalizeLegalEntity(
    row?.leg_org_form,
    row?.leg_name,
    row?.leg_short_name || row?.leg_full_name,
  );
}
```

И весь `UL_HANDLERS` (`:47-:74`):
- `package.ul.name` → `ulCanon(r).name`
- `package.ul.short_name` → `ulCanon(r).short_name`
- `package.ul.full_name` → `ulCanon(r).full_name`
- `package.ul.org_form` → `ulCanon(r).org_form`
- `package.ul.director_short_name` → `fullNameToInitials(…)` (тот же shared helper)

**Никакой второй реализации нормализации имён в package-ветке нет.** Все четыре package-токена дают идентичный billing-результат.

---

## 4. Модификатор `format=long` уже реализован

- `supabase/functions/canonical-document-generate-strict/index.ts:1152, :1268` — `format=long` валиден ТОЛЬКО для `*.leg.org_form` и `package.*.org_form`; на `*.short_name` и других — no-op (документировано в коде).
- `supabase/functions/_shared/ru-inflection.ts:405` — таблица расширения коротких форм (`ЗАО → Закрытое акционерное общество`, и т.д.).
- `supabase/functions/_shared/placeholderClassifier.test.ts:46-72` — позитивные/негативные тесты `format=long` для `package.ul.FLD-000010` и негатив для `field:FLD-…`.
- `src/utils/packagePlaceholderCatalog.ts:451, :489` — copy-token UI добавляет `|format=long` только для `package.*.org_form`.

Итог: токен `{{package.ul.FLD-000010|format=long}}` → `Закрытое акционерное общество` уже работает. **Дополнительная реализация не нужна.**

---

## 5. Frontend-каталог — корректность tech_key и реальный визуальный баг

`src/utils/packagePlaceholderCatalog.ts:185-195`:

```
ready("package_ul", "Краткое название",     "FLD-000345", "FLD-000011", ..., "package.ul.short_name", "ООО «Тестовая Компания»")
ready("package_ul", "Название",             "FLD-000342", "FLD-000011", ..., "package.ul.name",       "Тестовая Компания")
ready("package_ul", "Форма собственности",  "FLD-000343", "FLD-000010", ..., "package.ul.org_form",   "ООО")
```

Сигнатура `ready(group, title, fld, legacy_fld, source_table, source_col, tech_key, example)`.

Resolver использует **tech_key** (`package.ul.short_name|name|org_form`) — он корректен и даёт канонические значения через `canonicalizeLegalEntity`.

**Реальный визуальный баг, на который жалуется пользователь:**
- В UI-таблице «Плейсхолдеры для Word» видно две строки с одинаковым `FLD-000011` в одной из колонок (`legacy_fld`). Это legacy-колонка, оставленная для обратной совместимости старых шаблонов. Resolver её не читает.
- В колонке «Пример» демо-значения не совпадают с реальным контрактом: `ООО «Тестовая Компания»` / `Тестовая Компания` / `ООО` — корректно по структуре, но клиент ожидает увидеть **точно те строки, которые попадут в DOCX** на его реквизитах.

---

## 6. Backend-каталог `findByPackageToken` — приоритет lookup при коллизии

`supabase/functions/_shared/packagePlaceholderCatalog.ts:95-101`:

```
// Sprint 3L: short_name резолвится первым для FLD-000011 lookup
ready("package_ul", "FLD-000011", "client_legal_details", "leg_name", "package.ul.short_name"),
ready("package_ul", "FLD-000011", "client_legal_details", "leg_name", "package.ul.name"),
ready("package_ul", "FLD-000010", "client_legal_details", "leg_org_form", "package.ul.org_form"),
```

`findByPackageToken('package.ul.FLD-000011')` → берёт **первый** match → `package.ul.short_name` → `ЗАО «АЖУР инкам»`.

Это и есть корень бага «`ЗАО / «ЗАО «АЖУР инкам»»`» в шапке приказа:

> Шаблон «Приказ №1» содержит соседние токены `{{package.ul.FLD-000010}} «{{package.ul.FLD-000011}}»` — автор шаблона ожидал `ЗАО / «АЖУР инкам»`, но resolver Sprint 3L отдаёт `FLD-000011 → short_name`, поэтому получается `ЗАО / «ЗАО «АЖУР инкам»»`. Двойная подстановка формы собственности и двойные кавычки — это **семантическая коллизия каталога**, а не баг нормализации.

Аналогично для развёрнутой формы: пользователь установил «Развёрнуто» в Word-форме (visual hint), но в шаблоне стоит голый `{{package.ul.FLD-000010}}`, без `|format=long`. Модификатор не приклеивается автоматически — backend не знает про UI-выбор.

---

## 7. Где править — варианты без новой логики

Все варианты исключительно add-only / lookup-priority:

**Вариант A (рекомендуемый, не трогает шаблон):**
В backend-каталоге `packagePlaceholderCatalog.ts:99-100` **поменять порядок**:
```
ready("package_ul", "FLD-000011", ..., "package.ul.name"),        // ← первым
ready("package_ul", "FLD-000345", ..., "package.ul.short_name"),  // ← как отдельный FLD
```
Тогда `FLD-000011 → name` (чистое), а short_name доступен только через `FLD-000345`. Шапка `«{{package.ul.FLD-000011}}»` → `«АЖУР инкам»`. Двойная подстановка исчезает.

Риск: уже выпущенные шаблоны, где `FLD-000011` подразумевался как short_name, потеряют форму собственности. Проверка: query по `document_template_versions` на токен `package.ul.FLD-000011`. Если таких шаблонов ≤ 1 (только «Приказ №1») — переключение безопасно.

**Вариант B:** оставить backend lookup как есть, **переписать «Приказ №1»** на `{{package.ul.FLD-000011}}` одиночным (даст `ЗАО «АЖУР инкам»`) или на `{{package.ul.FLD-000010|format=long}} «{{package.ul.FLD-000345}}»`. Минимальное изменение шаблона, без бэкенда.

**Вариант C (для развёрнутой формы):** добавить в шаблон `|format=long` к `FLD-000010` — это покрывает кейс «пользователь хочет „Закрытое акционерное общество"» без новой логики.

---

## 8. Колонка «Пример» — финальный канон для frontend-каталога

После применения A/B каталог должен показывать клиенту:

```
Краткое название (FLD-000345 / package.ul.short_name)        → ЗАО «АЖУР инкам»
Название         (FLD-000011 / package.ul.name)              → АЖУР инкам
Форма собственности, кратко   (FLD-000010 / package.ul.org_form)              → ЗАО
Форма собственности, развёрнуто (FLD-000010|format=long / package.ul.org_form|format=long) → Закрытое акционерное общество
Полное наименование (нет одиночного FLD, сборка `{{org_form|format=long}} «{{name}}»`)    → Закрытое акционерное общество «АЖУР инкам»
```

Запрещённые выводы (проверочные негативы для resolver-тестов): `«ЗАО»`, `ЗАО «ЗАО «АЖУР инкам»»`, `«ЗАО «АЖУР инкам»»`, `ЗАО / «ЗАО «АЖУР инкам»»`.

---

## 9. Чего НЕ делаем

- Не пишем второй helper нормализации — `canonicalizeLegalEntity` уже идемпотентный single source of truth.
- Не меняем `typed-tokens-resolver.ts` / `packageFieldFormatter.ts`.
- Не мигрируем шаблон DOCX на `FLD-000103/000104` (это `executor`, не `customer/ul`).
- Не «чиним визуально» — все правки только в lookup-приоритете каталога и/или в шаблоне, по согласованию.

---

## 10. Следующий шаг (требует решения пользователя)

Перед кодом нужно выбрать:

1. **Вариант A** (правка backend lookup-приоритета `FLD-000011 → name`) — затрагивает все существующие шаблоны с этим токеном; нужен SQL-аудит шаблонов перед применением.
2. **Вариант B** (правка только шаблона «Приказ №1») — локальное, не задевает других клиентов.
3. **Комбинированный**: A + добавить `|format=long` к `FLD-000010` в «Приказе №1».

После выбора — single commit с правками + регресс-тестами resolver + перегенерация baseline DOCX.
