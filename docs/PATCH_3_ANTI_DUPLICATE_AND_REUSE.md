# PATCH 3 — Anti-duplicate + reuse GRP/Google flows

## Статус: ВЫПОЛНЕН

---

## 1. Reuse proof

### Импортируются as-is (1:1), не расширяются, не дублируются:

| Компонент | Файл | Использование |
|---|---|---|
| `useGrpLookup` | `src/hooks/useGrpLookup.ts` | GRP lookup через edge function — вызывается orchestration-слоем |
| `GrpConfirmDialog` | `src/components/legal-details/GrpConfirmDialog.tsx` | Diff-preview перед autofill — для refresh существующей карточки |
| `GrpAutofillService` | `src/lib/legal-entities/GrpAutofillService.ts` | Парсинг org form, classify entity kind, build diff |
| `StructuredAddressBlock` | UI-компонент | Отображение/редактирование адреса — reused в формах |
| `AddressNormalizationService` | `src/lib/address/AddressNormalizationService.ts` | Нормализация адреса в CanonicalAddressPayload |
| `GooglePlacesAdapter` | Адаптер | Google autocomplete flow — reused через StructuredAddressBlock |
| `normalizeAndValidateUnp` | `src/lib/legal-entities/normalizeUnp.ts` | Нормализация УНП перед запросом в useEntityDuplicateCheck |

### Новые файлы (add-only):

| Файл | Назначение |
|---|---|
| `src/hooks/useEntityDuplicateCheck.ts` | Orchestration-only hook для проверки дублей юрлиц/ИП |
| `src/hooks/usePersonDuplicateCheck.ts` | Hook для проверки дублей физлиц |
| `src/components/ai-requisites/DuplicateWarningDialog.tsx` | Единый UI для отображения дублей |
| `docs/PATCH_3_ANTI_DUPLICATE_AND_REUSE.md` | Данный отчет |

### НЕ создаются намеренно:

- Новый lookup-flow (reuse useGrpLookup)
- Новый confirm dialog (reuse GrpConfirmDialog)
- Новый address pipeline (reuse StructuredAddressBlock + AddressNormalizationService)
- Новый edge function

---

## 2. Entity duplicate logic

### Query rules

```sql
SELECT id, profile_id, client_type, status, purpose, leg_unp, ent_unp,
       leg_name, ent_name, leg_org_form, created_at, updated_at
FROM client_legal_details
WHERE profile_id = :profileId
AND (leg_unp = :normalizedUnp OR ent_unp = :normalizedUnp)
```

- Ищет среди **всех** записей владельца (active + archived)
- **Без LIMIT** — возвращает все совпадения
- УНП нормализуется через `normalizeAndValidateUnp` перед запросом

### Normalization rules

- УНП: `trim → strip non-digits → validate 9 digits` (reuse `normalizeAndValidateUnp`)
- Невалидный УНП → `no_match` без запроса к БД

### Match priority rules (детерминистическая сортировка)

1. `active` перед `archived` (по status)
2. `billing` перед `document` (по purpose)
3. Newest first (по updated_at DESC)

### Статусы и поведение

| Статус | Условие | UI-поведение |
|---|---|---|
| `no_match` | 0 записей | Разрешить создание |
| `active_match` | 1 active запись | Блокировать создание, предложить открыть |
| `archived_match` | 1 archived запись | Блокировать создание, показать badge «Архив», предложить открыть |
| `multiple_matches` | >1 записей | Блокировать создание, показать список всех кандидатов |

### Важно

- При `archived_match` НЕ предлагается "Восстановить из архива" (restore-flow не реализован в PATCH 3)
- Действие — "Открыть существующую" + "Отмена"

---

## 3. Person duplicate logic

### Query rules

Три уровня проверки, выполняются последовательно (stop on first match):

**Tier 1 — Exact по personal_number:**
```sql
SELECT ... FROM legal_details_persons
WHERE profile_id = :profileId
AND personal_number = :trimmed_personal_number
```

**Tier 2 — Exact по passport_series + passport_number:**
```sql
SELECT ... FROM legal_details_persons
WHERE profile_id = :profileId
AND passport_series = :trimmed_passport_series
AND passport_number = :trimmed_passport_number
```

**Tier 3 — Probable по full_name + birth_date:**
```sql
SELECT ... FROM legal_details_persons
WHERE profile_id = :profileId
AND full_name ILIKE :normalized_full_name
AND birth_date = :exact_birth_date
```

### Normalization rules

| Поле | Нормализация |
|---|---|
| `personal_number` | `trim()` |
| `passport_series` | `trim()` |
| `passport_number` | `trim()` |
| `full_name` | `trim() → collapse multiple spaces → case-insensitive (ILIKE)` |
| `birth_date` | exact match (ISO format, no normalization) |

### Match priority rules

- Возвращаются **все** кандидаты, не только первый
- `excludePersonId` поддерживается для edit-сценариев

### Статусы и UI-поведение

| matchType | Условие | UI |
|---|---|---|
| `exact` (1 кандидат) | Совпадение по personal_number или passport | Блокировать, предложить открыть |
| `exact` (>1 кандидатов) | Множественные совпадения | Блокировать, показать список |
| `probable` (любое кол-во) | Совпадение по ФИО + дата рождения | Warning, разрешить осознанно продолжить |
| `none` | Нет совпадений | Разрешить создание |

---

## 4. DuplicateWarningDialog

### Архитектура

- Единый компонент для entity и person сценариев
- Работает с `candidates[]` (поддержка множественных совпадений)
- Построен на существующем `AlertDialog` из UI library

### Сценарии

| Тип + Match | Кнопки | Блокировка создания |
|---|---|---|
| Entity exact (1) | «Открыть» + «Отмена» | Да |
| Entity exact (>1) | «Открыть» (для каждого) + «Отмена» | Да |
| Entity archived (1) | «Открыть» + «Отмена» | Да |
| Person exact (1) | «Открыть» + «Отмена» | Да |
| Person exact (>1) | «Открыть» (для каждого) + «Отмена» | Да |
| Person probable (любое) | «Открыть» + «Создать новую» + «Отмена» | Нет (warning) |

### Важно

- НЕТ кнопки "Восстановить из архива"
- Archived записи отображаются с badge «Архив»
- Каждый кандидат имеет свою кнопку «Открыть»

---

## 5. Scope boundary — что НЕ менялось

- `grp-lookup` edge function — не менялась
- `useGrpLookup.ts` — не менялся
- `GrpConfirmDialog.tsx` — не менялся
- `GrpAutofillService.ts` — не менялся
- `AddressNormalizationService.ts` — не менялся
- `useLegalDetails.tsx` — не менялся
- `setDefault` — не трогался
- billing edge functions — не менялись
- `/settings/legal-details` — не менялся
- Существующие RLS policies — не менялись
- Существующие indexes — не менялись

---

## 6. Контрактный proof

### Hooks не создают и не обновляют сущности

- `useEntityDuplicateCheck`: только `SELECT` к `client_legal_details`, возвращает match result
- `usePersonDuplicateCheck`: только `SELECT` к `legal_details_persons`, возвращает match result
- Orchestration создания/обновления остается вне этих hooks
- `DuplicateWarningDialog`: только UI-отображение, никаких мутаций

### Proof файлы

| Файл | Операция |
|---|---|
| `src/hooks/useEntityDuplicateCheck.ts` | Создан |
| `src/hooks/usePersonDuplicateCheck.ts` | Создан |
| `src/components/ai-requisites/DuplicateWarningDialog.tsx` | Создан |
| `docs/PATCH_3_ANTI_DUPLICATE_AND_REUSE.md` | Создан |

---

## 7. DoD

- [x] Повторный УНП не создает дубль (hook возвращает match)
- [x] Multiple matches для entity обработаны (статус `multiple_matches`)
- [x] Multiple exact matches для person обработаны (все кандидаты возвращаются)
- [x] Архивные записи участвуют в duplicate detection
- [x] Archived entity — create-flow блокируется при найденном дубле
- [x] Физлица: exact/probable/no match работает
- [x] Единый DuplicateWarningDialog для обоих сценариев
- [x] DuplicateWarningDialog работает с candidates[] (не single candidate)
- [x] useGrpLookup / GrpConfirmDialog reused 1:1
- [x] setDefault и billing не тронуты
- [x] Hooks только читают, не создают/обновляют
- [x] Reuse proof в документации
- [x] Query/normalization/priority rules зафиксированы
- [x] Нет новых lookup/autofill/address pipelines
