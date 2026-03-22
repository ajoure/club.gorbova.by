# PATCH 1 — Аудит `client_legal_details`: разграничение use-case

**Статус:** Read-only аудит. Код не менялся.  
**Дата:** 2026-03-22

---

## 1. Repo-wide search: все вхождения

### `client_legal_details` — 8 файлов

| Файл | Тип использования |
|---|---|
| `src/hooks/useLegalDetails.tsx` | SELECT/INSERT/UPDATE/DELETE — полный CRUD |
| `src/lib/token-resolver.ts` | SELECT по id (для резолвинга токенов) |
| `src/lib/legal-details/fieldMap.ts` | Маппинг колонок (метаданные, не запросы) |
| `src/integrations/supabase/types.ts` | Типы (auto-generated) |
| `supabase/functions/generate-from-template/index.ts` | SELECT по id или is_default |
| `supabase/functions/generate-document-pdf/index.ts` | SELECT по id или is_default |
| `supabase/functions/generate-invoice-act/index.ts` | SELECT по id или is_default |
| `supabase/functions/document-auto-generate/index.ts` | SELECT по id или is_default |

### `client_details_id` — 6 файлов

| Файл | Контекст |
|---|---|
| `supabase/functions/generate-from-template/index.ts` | Входной параметр, fallback на is_default |
| `supabase/functions/generate-document-pdf/index.ts` | Входной параметр, fallback на is_default |
| `supabase/functions/generate-invoice-act/index.ts` | Входной параметр, fallback на is_default |
| `supabase/functions/document-auto-generate/index.ts` | Входной параметр, fallback на is_default |
| `src/hooks/useGeneratedDocuments.tsx` | Тип данных (read) |
| `src/integrations/supabase/types.ts` | Типы + FK constraint |

### `is_default` в контексте `client_legal_details` — 5 мест

| Место | Использование |
|---|---|
| `useLegalDetails.tsx:127` | `legalDetails?.find(d => d.is_default) \|\| legalDetails?.[0]` — fallback на первую запись |
| `useLegalDetails.tsx:139` | `is_default: !legalDetails?.length` — первая запись = default |
| `useLegalDetails.tsx:198-212` | setDefault mutation: unset all → set one |
| `generate-from-template/index.ts:210` | `.eq('is_default', true).maybeSingle()` — fallback если нет client_details_id |
| `generate-document-pdf/index.ts:463` | `.eq('is_default', true).single()` — fallback |
| `generate-invoice-act/index.ts:234` | `.eq('is_default', true).single()` — fallback |
| `document-auto-generate/index.ts:237` | `.eq('is_default', true).maybeSingle()` — fallback |

**Примечание:** `is_default` также используется в 30+ других файлах для **других таблиц** (payment_methods, email_accounts, executors, integrations и т.д.) — это не зависимости `client_legal_details`.

### `leg_unp` — 9 файлов

| Файл | Контекст |
|---|---|
| `src/components/legal-details/LegalEntityDetailsForm.tsx` | Форма ввода + GRP lookup |
| `src/components/legal-details/OrganizationDetailsForm.tsx` | Форма ввода + GRP lookup |
| `src/hooks/useLegalDetails.tsx` | Тип данных |
| `src/hooks/useLegalDetailsFields.ts` | Registry mapping |
| `src/lib/legal-details/fieldMap.ts` | Field map |
| `src/constants/demoLegalDetails.ts` | Демо-данные |
| `supabase/functions/document-auto-generate/index.ts` | Чтение для placeholders |
| `src/integrations/supabase/types.ts` | Типы |
| `src/lib/token-resolver.ts` | Через fieldMap (косвенно) |

### `ent_unp` — 9 файлов

Аналогичное распределение — формы, fieldMap, demo, types, document-auto-generate.

---

## 2. RLS Policies — точный SQL

Таблица `client_legal_details` имеет **5 RLS policies**:

### Policy 1: `Admins can manage all legal details`
```sql
-- cmd: ALL, permissive
-- roles: {public}
-- qual (WHERE):
(EXISTS (
  SELECT 1 FROM user_roles_v2 ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = auth.uid()
    AND r.code = ANY (ARRAY['super_admin', 'admin'])
))
```

### Policy 2: `Users can view own legal details`
```sql
-- cmd: SELECT, permissive
-- qual:
profile_id IN (
  SELECT id FROM profiles WHERE user_id = auth.uid()
)
```

### Policy 3: `Users can insert own legal details`
```sql
-- cmd: INSERT, permissive
-- with_check:
profile_id IN (
  SELECT id FROM profiles WHERE user_id = auth.uid()
)
```

### Policy 4: `Users can update own legal details`
```sql
-- cmd: UPDATE, permissive
-- qual:
profile_id IN (
  SELECT id FROM profiles WHERE user_id = auth.uid()
)
```

### Policy 5: `Users can delete own legal details`
```sql
-- cmd: DELETE, permissive
-- qual:
profile_id IN (
  SELECT id FROM profiles WHERE user_id = auth.uid()
)
```

**Вывод по RLS:**
- Обычный пользователь видит/создаёт/обновляет/удаляет **только свои** записи (по `profile_id`).
- Админы/суперадмины видят и управляют **всеми** записями.
- RLS **не фильтрует** по типу записи, по `is_default`, по назначению — **любая** запись пользователя одинаково доступна.
- При добавлении `purpose`/`status` полей **RLS менять не нужно** — доступ уже ограничен по владельцу.

---

## 3. Fallback-логика: как выбирается запись

### Паттерн во ВСЕХ 4 edge functions (идентичный):

```
1. Если передан client_details_id → SELECT * WHERE id = client_details_id
2. Иначе → SELECT * WHERE profile_id = X AND is_default = true (.maybeSingle() или .single())
3. Если ничего не найдено → clientDetails = null, clientType = 'individual'
```

> **⚠️ УСЛОВИЕ БЕЗОПАСНОСТИ FALLBACK (Правка 4):**
> Вывод «edge functions можно не менять» верен **только если** document-entities **никогда не смогут получить `is_default = true`**.
> Если это условие нарушено — fallback по шагу 2 может вернуть document-entity вместо billing-записи, что **сломает генерацию счёт-актов**.
> Гарантии:
> - `setDefault` mutation обязана фильтровать по `WHERE purpose = 'billing'`
> - UI AI-раздела **не должен** вызывать `setDefault` для document-записей
> - Это **обязательный acceptance-критерий** для PATCH 5

### В useLegalDetails.tsx (hook):

```
- defaultDetails = legalDetails?.find(d => d.is_default) || legalDetails?.[0]
- При создании первой записи: is_default = !legalDetails?.length (первая = default)
- setDefault: unset all WHERE profile_id → set one WHERE id
```

### Что происходит если:

| Сценарий | Результат |
|---|---|
| `is_default` записи нет вообще | Edge functions: `clientDetails = null`, генерация идёт как для физлица без реквизитов. Hook: берёт `legalDetails?.[0]` |
| Несколько записей, одна default | Edge functions берут default. Hook тоже. Всё корректно |
| Несколько записей, ни одна не default | Edge functions: `clientDetails = null`. Hook: берёт первую по дате создания |
| Несколько записей, несколько default | Edge functions: `.single()` может упасть с ошибкой (>1 row). `.maybeSingle()` тоже. **Потенциальный баг** — но setDefault mutation не допускает этого |

---

## 4. UX/Flow Impact: `/settings/legal-details`

### Текущее поведение:
- Показывает **все** записи пользователя (`SELECT * WHERE profile_id = X ORDER BY created_at DESC`)
- **Нет фильтрации** по типу/назначению
- Все записи равноценны, различаются только badge `is_default` = «Основной»
- Пользователь может создавать записи разных типов (физлицо, ИП, юрлицо)
- Любую можно назначить «основной»

### Неявное предположение:
- UI **предполагает**, что все записи — billing-реквизиты
- Нет понятия «эта запись для документов, а не для оплаты»
- Если появятся document-entities, они окажутся в том же списке без визуального различия

### Что сломается если добавить document-entities без DDL-разделения:
- В `/settings/legal-details` появятся «чужие» записи (для AI-документов)
- Пользователь может назначить document-entity как billing default
- Edge functions при fallback на `is_default` могут получить document-entity вместо billing-реквизитов
- Генерация счёт-актов может подставить реквизиты стороннего юрлица

---

## 5. Constraint на `generated_documents.order_id`

```sql
order_id — NOT NULL
FK: FOREIGN KEY (order_id) REFERENCES orders_v2(id) ON DELETE CASCADE
```

**Это означает:**
- Каждый `generated_documents` запись **обязана** иметь `order_id`
- AI-документы (годовое собрание) не связаны с заказами
- Нельзя просто вставить AI-документ в `generated_documents` без order_id
- **Решение выносится в PATCH 10.5** — отдельная диагностика

---

## 6. Таблица вариантов DDL-разграничения

### Вариант 1: Одно поле `purpose TEXT DEFAULT 'billing'`

| Аспект | Оценка |
|---|---|
| Плюсы | Минимальная миграция. Все текущие записи автоматически `billing`. Один фильтр в UI |
| Риски | Одно поле не разделяет active/archive. Нет default для document-entities |
| Влияние на queries | **Нулевое** при `DEFAULT 'billing'`. Edge functions не фильтруют по purpose — они фильтруют по `is_default`. Добавление WHERE purpose='billing' в существующие queries — опциональная доработка |
| Подходит? | **Частично.** Достаточно для MVP, но не покрывает active/archive |

### Вариант 2: Два поля `purpose TEXT DEFAULT 'billing'` + `status TEXT DEFAULT 'active'`

| Аспект | Оценка |
|---|---|
| Плюсы | Полное разделение: назначение + жизненный цикл. Позволяет архивировать без удаления |
| Риски | Сложнее запросы. Нужно решить: default billing + default document — два отдельных `is_default`? |
| Влияние на queries | **Нулевое** при defaults. Существующие записи = `purpose='billing', status='active'`. Текущие queries по `is_default` продолжают работать |
| Подходит? | **Да.** Рекомендуемый вариант |

### Вариант 3: Enum `purpose_enum ('billing', 'document', 'both')`

| Аспект | Оценка |
|---|---|
| Плюсы | Строгая типизация. Нет невалидных значений |
| Риски | `both` создаёт неоднозначность. Enum сложнее мигрировать при добавлении значений. Не решает active/archive |
| Влияние на queries | Аналогично Варианту 1, но тип более строгий |
| Подходит? | **Нет.** Избыточная строгость без выгоды. Enum для 2 значений + `both` = overengineering |

### Вариант 4: Без нового поля — разделение через `client_type` + convention

| Аспект | Оценка |
|---|---|
| Плюсы | Нет миграции вообще |
| Риски | Нет семантического различия. Нельзя отличить billing ИП от document ИП. UX-коллизии неизбежны |
| Подходит? | **Нет** |

---

## 7. Рекомендация

> **СТАТУС (Правка 2):**
> - PATCH 1 **не внедряет** DDL — это read-only аудит
> - PATCH 1 только **рекомендует** Вариант 2
> - Финальное DDL будет применяться **только в PATCH 2** (миграция)
> - До PATCH 2 рекомендация = **гипотеза**, не решение

### Рекомендуемая модель: Вариант 2 — два поля

```sql
ALTER TABLE client_legal_details
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'billing',
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
```

### Обоснование:

1. **Все существующие записи** автоматически получают `purpose='billing', status='active'` — **zero regression**
2. **Edge functions** продолжают работать без изменений — они фильтруют по `is_default`, не по `purpose`
3. **`/settings/legal-details`** может добавить `WHERE purpose='billing'` позже — но даже без этого фильтра показывает то же самое (все текущие записи = billing)
4. **AI-раздел** фильтрует по `purpose='document'` или показывает все с badge
5. **`is_default`** сохраняет текущую семантику для billing. Для document-entities можно добавить `is_default_document BOOLEAN DEFAULT false` или использовать convention (пока не нужно)
6. **`status`** позволяет архивировать без удаления: `status='archived'`

### Что НЕ нужно делать сейчас:
- **Не** добавлять `is_default_document` — пока нет use-case для default document entity
- **Не** менять `is_default` семантику — она остаётся строго для billing
- **Не** добавлять WHERE purpose в edge functions — они получают explicit `client_details_id`, fallback по `is_default` всегда попадёт на billing-запись

### Защита от UX-коллизий:
- AI-раздел (**PATCH 5**): billing-записи = read-only с badge «Платёжные», ссылка «Редактировать в настройках»
- `/settings/legal-details`: добавить `WHERE purpose = 'billing'` чтобы document-entities не появлялись в billing-настройках
- `setDefault` mutation: добавить `WHERE purpose = 'billing'` чтобы нельзя было назначить document-entity основной для billing

---

## 8. Места, которые нельзя сломать

| Место | Почему критично |
|---|---|
| `generate-from-template` fallback на `is_default` | Billing генерация. Default записи должны остаться billing-only |
| `generate-document-pdf` fallback на `is_default` | Аналогично |
| `generate-invoice-act` fallback на `is_default` | Аналогично |
| `document-auto-generate` fallback на `is_default` | Автогенерация при оплате |
| `useLegalDetails.tsx` setDefault mutation | Не должна позволять ставить default на document-entity |
| `/settings/legal-details` — показ списка | Не должна показывать document-entities |
| `token-resolver.ts` — SELECT по id | Безопасен — принимает explicit id, не зависит от purpose |
| FK `generated_documents.client_details_id` | Безопасен — ссылается по id, не по purpose |

---

## 9. Proof: код не менялся

Все данные получены через:
- `code--search_files` (repo-wide search)
- `code--view` (read-only)
- `supabase--read_query` (SELECT only)

**Ни один файл не был модифицирован в рамках PATCH 1.**
