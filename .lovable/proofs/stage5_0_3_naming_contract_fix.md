# Stage 5.0.3 — Variant A: канонический контракт наименования ЮЛ (исправление)

Дата: 2026-06-18. Вариант: **A** — правка платформенного lookup-приоритета. Шаблоны и helper-нормализация не тронуты.

---

## 1. SQL-аудит активных шаблонов с `package.ul.FLD-000011`

Запрос:
```sql
SELECT dt.name, dtv.version_number, dtv.is_current, dtv.detected_tokens
FROM document_template_versions dtv
JOIN document_templates dt ON dt.id = dtv.template_id
WHERE dtv.detected_tokens::text LIKE '%package.ul.FLD-000011%'
  AND dtv.is_current;
```

Результат (3 активных шаблона):

| Шаблон | v | Соседство токенов | Совместимость с Variant A (FLD-000011 → name) |
|---|---|---|---|
| 1. Приказ о проведении годового общего собрания участников ООО | 2 (current) | `package.ul.FLD-000010\|format=long`, рядом `package.ul.FLD-000011` | ✅ полностью корректно: «Закрытое акционерное общество "АЖУР инкам"» (отдельные токены org_form + name) |
| Шаблон — Положение об организации идеологической работы | 3 (current) | `package.ul.FLD-000011`, `package.ul.FLD-000013`, `package.ul.FLD-000014\|format=signature_short` | ✅ имя без формы — каноничный кейс для тела документа |
| Шаблон — Приказ об организации идеологической работы | 6 (current) | `package.ul.FLD-000011`, `package.ul.FLD-000013`, `package.ul.FLD-000014\|format=signature_short` | ✅ имя без формы — каноничный кейс |

Шаблонов, где `FLD-000011` сознательно использовался как «полное название с формой» (без рядом стоящего `FLD-000010`) — **не обнаружено**. Все три активных шаблона авторства пользователя и совместимы с Variant A. Шаблонов с `package.ul.FLD-000345` в активных версиях нет (только billing-шаблон `Шаблон. Счёт-акт` использует `{{field:FLD-000345}}`, не затрагивается).

`fields_registry`: `FLD-000011 = legal_details.leg_name` (active), `FLD-000345 = customer.leg.short_name` (active), `FLD-000010 = legal_details.leg_org_form` (active). Используем как канон.

---

## 2. Изменения (минимальный diff, без новой логики)

### Backend (mirror) — `supabase/functions/_shared/packagePlaceholderCatalog.ts`

`PACKAGE_UL` lookup-priority изменён (порядок строк = порядок резолва):

```diff
- ready("package_ul", "FLD-000011", ..., "leg_name", "package.ul.short_name"),
- ready("package_ul", "FLD-000011", ..., "leg_name", "package.ul.name"),
+ ready("package_ul", "FLD-000011", ..., "leg_name", "package.ul.name"),
+ ready("package_ul", "FLD-000345", ..., "leg_name", "package.ul.short_name"),
  ready("package_ul", "FLD-000010", ..., "leg_org_form", "package.ul.org_form"),
```

После правки `findByPackageToken('package.ul.FLD-000011')` → `tech_key=package.ul.name` → `ulCanon(r).name` (чистое имя). `findByPackageToken('package.ul.FLD-000345')` → `tech_key=package.ul.short_name` → `ulCanon(r).short_name` (краткое наименование).

### Frontend SOT — `src/utils/packagePlaceholderCatalog.ts`

Каталог `PACKAGE_UL` обновлён в той же раскладке:
- «Название (без формы собственности)» — `FLD-000011` → `package.ul.name`, пример `АЖУР инкам`.
- «Краткое наименование» — `FLD-000345` → `package.ul.short_name`, пример `ЗАО «АЖУР инкам»`.
- «Форма собственности (кратко)» — `FLD-000010` → `package.ul.org_form`, пример `ЗАО`. Развёрнутая форма доступна через UI-модификатор `format=long` (`supportsLongFormat=true` для org_form, уже работает) → `{{package.ul.FLD-000010|format=long}}` → `Закрытое акционерное общество`.

### Tests — `src/utils/packagePlaceholderCatalog.test.ts`

Обновлены три assertion'а, связанных с `tech_key=package.ul.short_name` (теперь привязан к `FLD-000345`):
- `buildPackagePlaceholderToken(ulShort,…)` → `{{package.ul.FLD-000345…}}`.
- Тест «обычное текстовое package-поле игнорирует format=short» ожидает `{{package.ul.FLD-000345}}`.

---

## 3. Чего НЕ менялось (явный лог)

- `supabase/functions/_shared/typed-tokens-resolver.ts` — `canonicalizeLegalEntity` идемпотентен и переиспользуется как был.
- `supabase/functions/_shared/packageFieldFormatter.ts` — `ulCanon` / `UL_HANDLERS` без правок; короткое/длинное имя строится тем же helper'ом.
- Шаблоны DOCX («Приказ №1», «Положение об идеологической работе», «Приказ об организации идеологической работы») и их плейсхолдеры — не тронуты по требованию пользователя.
- `fields_registry`, `document_token_registry` — без миграций.
- `FLD-000103/000104` (executor) — не привязываются к customer/ul.

---

## 4. Regression proof (ожидаемые результаты)

Условные данные `client_legal_details`: `leg_org_form='ЗАО'`, `leg_name='АЖУР инкам'`, `leg_full_name='Закрытое акционерное общество "АЖУР инкам"'`.

### Package-контекст (после правки)

| Токен в шаблоне | Резолвер → tech_key | Ожидаемая строка |
|---|---|---|
| `{{package.ul.FLD-000011}}` | `package.ul.name` | `АЖУР инкам` |
| `{{package.ul.FLD-000345}}` | `package.ul.short_name` | `ЗАО «АЖУР инкам»` |
| `{{package.ul.FLD-000010}}` | `package.ul.org_form` | `ЗАО` |
| `{{package.ul.FLD-000010\|format=long}}` | `package.ul.org_form` + ru-inflection long | `Закрытое акционерное общество` |
| `{{package.ul.FLD-000010\|format=long}} «{{package.ul.FLD-000011}}»` (как в «Приказе №1») | composite | `Закрытое акционерное общество «АЖУР инкам»` |

Запрещённые выводы (negative): `«ЗАО»`, `ЗАО «ЗАО «АЖУР инкам»»`, `«ЗАО «АЖУР инкам»»`, `ЗАО / «ЗАО «АЖУР инкам»»`. Двойная подстановка формы собственности невозможна, потому что `FLD-000011` больше не возвращает `short_name`.

### Billing-контекст (без изменений — изоляция)

`{{field:FLD-000345}}` в шаблоне `Шаблон. Счёт-акт на услуги ЮЛ - Исполнитель` v3 продолжает резолвиться через `typed-tokens-resolver.ts → canonicalizeLegalEntity → short_name`. Lookup в package-каталоге billing-веткой не используется. Регресс billing отсутствует.

### Идемпотентность helper'а (документировано в audit §2 предыдущего proof)

`canonicalizeLegalEntity` дважды срезает `«»"'„‟""'`, дедуплицирует org_form, поэтому ввод `ЗАО "АЖУР инкам"`, `(ЗАО, АЖУР инкам)`, `ЗАО «АЖУР инкам»` → один и тот же `{org_form: 'ЗАО', name: 'АЖУР инкам', short_name: 'ЗАО «АЖУР инкам»', full_name: 'Закрытое акционерное общество «АЖУР инкам»'}`. Двойных кавычек на выходе нет.

---

## 5. Что увидит пользователь в таблице «Плейсхолдеры для Word»

После деплоя в группе **Пакет: ЮЛ** (раздел в `/admin/documents` → каталог):

| Название | FLD-ID | Пример | Токен для копирования |
|---|---|---|---|
| Название (без формы собственности) | `FLD-000011` | `АЖУР инкам` | `{{package.ul.FLD-000011}}` |
| Краткое наименование | `FLD-000345` | `ЗАО «АЖУР инкам»` | `{{package.ul.FLD-000345}}` |
| Форма собственности (кратко) | `FLD-000010` | `ЗАО` | `{{package.ul.FLD-000010}}` |
| Форма собственности (развёрнуто) — тот же FLD-000010, выбирается в колонке «Настройки» → format=long | `FLD-000010` | `Закрытое акционерное общество` | `{{package.ul.FLD-000010\|format=long}}` |

(Развёрнутая форма не отдельная строка, а модификатор `format=long`, который уже поддерживается каталогом и `RowSettingsCell` — `supportsLongFormat=true` для `org_form`.)
