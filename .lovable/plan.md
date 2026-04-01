

# План: Подключение формы конструктора сайтов к CRM (финальная версия)

---

## Правки к предыдущей версии

### 1. RLS: явное ограничение доступа к submissions

Вместо открытого `SELECT FOR authenticated` — RLS policy с проверкой `has_role_v2(auth.uid(), 'admin')` или `has_role_v2(auth.uid(), 'super_admin')`. Анонимные пользователи не имеют ни INSERT, ни SELECT — всё через service_role в edge function.

### 2. Нормализация телефона: каноническая логика без RU-хардкода

В кодовой базе уже установлен канонический паттерн: `phone.replace(/[^\d+]/g, '')` + поиск по **последним 9 цифрам** (`.slice(-9)`). Используется в `import-contacts-gc`, `detect-duplicates`, `amocrm-contacts-import`, `bepaid-helpers`. Этот паттерн:
- **география-агностичный** — работает для +375 (BY), +7 (RU), +48 (PL) и любых других
- не требует хардкода `8→+7`
- уже проверен в production

Фиксируем для `site-form-submit`:

```typescript
function normalizePhone(phone: string): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.length < 9) return null;
  return cleaned;
}

// Поиск в profiles — по последним 9 цифрам:
.ilike('phone', `%${normalizePhone(value).slice(-9)}`)
```

Убираем из плана `8XXXXXXXXXX → +7XXXXXXXXXX`. Dry-run проверка: `+375291234567` и `8029-123-45-67` — оба должны найти один профиль.

---

## Итоговый scope (без изменений от предыдущей версии)

### Шаг 1: SQL миграция — `site_form_submissions`

- `public_id` через trigger `next_public_id('site_form_submission')`
- `workspace_id` NOT NULL, заполняется из `site_pages.workspace_id` в edge function
- `created_by`/`updated_by` nullable (задокументировано как допустимое исключение для анонимных форм)
- RLS:
  - **Нет** anon INSERT/SELECT
  - SELECT: `has_role_v2(auth.uid(), 'admin') OR has_role_v2(auth.uid(), 'super_admin')`
  - UPDATE: то же самое

### Шаг 2: Edge function `site-form-submit`

Поток без изменений: валидация → INSERT submission → domain_event → CRM resolve (normalize → deduplicate по last-9-digits / email / telegram → create or link profile) → domain_execution → audit_log.

Нормализация:
- Email: `trim().toLowerCase()`
- Phone: `replace(/[^\d+]/g, '')`, поиск по `.slice(-9)`, отброс если `< 9` цифр
- Telegram: trim, lowercase, убрать `@`, `t.me/`, `https://t.me/`

Ambiguous match → `domain_executions` status=failed, profile_id не линкуется.

### Шаг 3: FormBlockEditor — маппинг полей

Без изменений: select «Привязка к карточке» для каждого поля.

### Шаг 4: FormSection — активная форма

Без изменений: убрать disabled, добавить state/validation/submit, принимать `pageId`.

### Шаг 5: SitePageRenderer — прокинуть pageId

Без изменений.

---

## Файлы

| Файл | Действие |
|---|---|
| SQL миграция | `site_form_submissions` + RLS с `has_role_v2` |
| `supabase/functions/site-form-submit/index.ts` | Новая edge function |
| `FormSection.tsx` | Активная форма |
| `FormBlockEditor.tsx` | Маппинг полей |
| `SitePageRenderer.tsx` | Прокинуть `pageId` |

## Verify checklist

1. Submission создаётся с `public_id` и `workspace_id`
2. Domain event + execution записываются
3. Профиль создаётся при новом email
4. Дедупликация по телефону: `+375291234567` и `80291234567` → один профиль
5. Дедупликация по telegram: `@user` и `https://t.me/user` → один профиль
6. Повторная отправка — нет дубликатов
7. Ambiguous → failed execution, profile_id = NULL
8. Анонимный SELECT к таблице → denied
9. Формы без mapping → submission без профиля

