# PATCH-DPIRA-METADATA-MERGE-V1 — Proof

**Дата:** 2026-06-21
**Статус:** PASS
**Контекст:** mini-patch, разблокирующий Stage E.1a (custom assignment fields).
Сработала STOP-condition #1 плана E.1a — RPC
`save_session_document_atomic` перезаписывал `metadata` целиком на каждом
сохранении анкеты документа, что делало невозможным хранение
`metadata.custom.*` и `metadata.position_gender`.

## 1. Что изменилось

### 1.1 RPC `public.save_session_document_atomic`

Migration: `20260621*_dpira_metadata_merge_v1.sql`.

- Сигнатура не изменилась (5 параметров: `_session_id`, `_package_template_item_id`, `_field_values jsonb`, `_role_assignments jsonb`, `_expected_template_version_id default null`).
- `SECURITY DEFINER`, `SET search_path TO 'public'` — без изменений.
- Права/GRANT/RLS — без изменений.
- Логика role-assignments loop:
  - Перед UPDATE читаем `metadata` существующей активной строки в `v_cur_meta` (NULL, если строки нет).
  - Собираем `v_merged_meta = COALESCE(v_cur_meta, '{}'::jsonb)` (с guard на `jsonb_typeof != 'object'`).
  - Контракт `position`:
    - ключ `position` отсутствует в input (`NOT (v_item ? 'position')`) → `v_merged_meta` не трогается.
    - ключ есть, значение пустое/`null` → `v_merged_meta := v_merged_meta - 'position'`.
    - ключ есть, значение непустое → `v_merged_meta := jsonb_set(v_merged_meta, '{position}', to_jsonb(v_pos), true)`.
  - UPDATE: `metadata = v_merged_meta`.
  - INSERT (новая строка) — `metadata = v_merged_meta` (для новой строки = `{}` или `{position:…}`).
  - `ON CONFLICT DO UPDATE SET metadata = EXCLUDED.metadata` — безопасно, потому что `EXCLUDED.metadata = v_merged_meta` уже учитывает существующий `metadata`.
- В `audit_logs.meta` добавлен маркер `"metadata_merge_patch":"dpira_metadata_merge_v1"`.

### 1.2 `src/hooks/useDocumentItemRoleAssignments.ts`

Legacy replace-save теперь:
- Снимает `prevByKey` snapshot активных строк ДО архивации.
- Расширяет `ItemAssignmentInput` полями `position_gender?: string | null` и `custom?: Record<string,string>`.
- Применяет контракт `position`/`position_gender` (`undefined` = не менять, `"" / null` = очистить, non-empty = записать).
- `custom`: при `undefined` сохраняет prev custom; при наличии — мержит новые поверх prev (через `mergeAssignmentMetadataWithCustom`).
- Никаких прочих верхнеуровневых ключей не теряет.

## 2. Test fixture

Сессия `6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53`, документ `febd1821-fba8-4290-babf-99c59c27f2f4`.
Роль «Участник» (`ln-000015`, id `c8fc4200-75c0-4c24-8eea-112c4e468aeb`) — 3 назначения.
Роль «Ревизор» (`ln-000014`, id `40b6dd45-7a56-4146-82c3-dec6529120fd`) — 1 назначение.

Seed (через `UPDATE`, имитирующий заранее заполненные ключи `custom` / `position_gender`):

```
77540e62 → {"position":"старый председатель","position_gender":"м","custom":{"votes":"10","share_percent":"33.3"}}
0c458f06 → {"position":"секретарь","custom":{"votes":"5"}}
44d5ce98 → {"position":"делегат","position_gender":"ж","custom":{"votes":"1"}}
c4c8caa1 → {"position":"ревизор"}    -- regression-контрольная строка
```

Все вызовы RPC ниже выполнены в `DO $$ ... $$` с эмуляцией auth:
`set_config('request.jwt.claims', '{"sub":"05cd3754-...","role":"authenticated"}', true)` +
`set_config('role','authenticated',true)`. Owner сессии — пользователь `05cd3754-d589-4d90-97d1-89ba2bee610b`.

## 3. Scenario A — bug before / fixed after

**До патча:** RPC писал `metadata = jsonb_build_object('position', v_pos)` —
любой `custom` или `position_gender` исчезали при первом же сохранении анкеты.

**После патча:** input для 3 строк роли «Участник» содержит только `position` (без `custom`).

Input:
```
position(9f6a...) = "председатель"
position(77aa...) = "секретарь"
position(2640...) = "делегат"
```

Результат (SQL после вызова):
```
77540e62 → {"position":"председатель","position_gender":"м","custom":{"votes":"10","share_percent":"33.3"}}
0c458f06 → {"position":"секретарь",                       "custom":{"votes":"5"}}
44d5ce98 → {"position":"делегат","position_gender":"ж",   "custom":{"votes":"1"}}
c4c8caa1 → {"position":"ревизор"}
```

`custom.votes`, `custom.share_percent`, `position_gender` сохранены. `position` обновился для строки `77540e62` («старый председатель» → «председатель»). **PASS**.

## 4. Scenario B — clear position

Input для строки `9f6a...` (77540e62):
```
position = ""
```

Результат:
```
77540e62 → {"position_gender":"м","custom":{"votes":"10","share_percent":"33.3"}}
```

Ключ `position` удалён, `position_gender` и `custom` сохранены. **PASS**.

## 5. Scenario C — update position

Input для строки `9f6a...` (77540e62):
```
position = "директор"
```

Результат:
```
77540e62 → {"position":"директор","position_gender":"м","custom":{"votes":"10","share_percent":"33.3"}}
```

`position` записан, `position_gender` и `custom.*` сохранены. **PASS**.

## 6. Scenario D — regression (без custom, чистый position)

Строка `c4c8caa1` (Ревизор → 26402449) во всех трёх вызовах:
- Input: `position = "ревизор"` (всегда).
- Результат каждый раз: `metadata = {"position":"ревизор"}` — ровно тот же объект, что был до патча.

Дополнительно: все три RPC-вызова отработали без exception, `is_active=true` для всех 4 ожидаемых записей, soft-archive не сработал по ним (стабильный `id`). **PASS**.

## 7. Что НЕ делалось в этом patch

- Сигнатура RPC не менялась.
- Permissions / GRANT / RLS не менялись.
- Никаких новых SECURITY DEFINER функций; security-linter показал baseline проекта (152 предупреждения), все они касаются ранее существовавших функций. Новых проблем не внесено.
- `canonical-document-generate-strict`, `ai-generate-document-package`, Gotenberg, billing resolver — не тронуты.
- UI custom fields editor, classifier `package_role_custom_field`, `resolveLnCustomToken` и каталог плейсхолдеров — НЕ реализованы (это E.1a).
- `_role_assignments` payload по-прежнему принимает только `role_catalog_id` / `person_id` / `position` / `sort_order`; ключ `custom` в RPC не вводился.

## 8. Cleanup

Test fixture оставлен в БД (custom-значения seed'нуты на 3 ассайнментах роли «Участник»). Это пригодится в proof E.1a — не нужно повторно сеять.

## 9. Итог

**PATCH-DPIRA-METADATA-MERGE-V1 — PASS.**

STOP-condition закрыт: повторное сохранение анкеты документа больше не уничтожает `metadata.custom` / `metadata.position_gender` / другие верхнеуровневые ключи. Можно возвращаться к Stage E.1a после явного подтверждения PASS.
