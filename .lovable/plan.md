

## План: PATCH 1–6 — Импорт контактов GetCourse

### PATCH 1 — DB Migration (5 полей + UNIQUE index)
SQL из ТЗ без изменений:
- `country`, `city`, `birth_date`, `instagram_url`, `gc_registered_at` — add-only в `profiles`
- `CREATE UNIQUE INDEX idx_profiles_external_id_gc_unique ON profiles (external_id_gc) WHERE external_id_gc IS NOT NULL`
- Безопасно: 0 записей с `external_id_gc`, конфликтов не будет

### PATCH 2 — BUGFIX: getcourse-import-file
В `supabase/functions/getcourse-import-file/index.ts` (строки 160–170):
- `user_id: crypto.randomUUID()` → `user_id: null`
- `status: 'ghost'` оставляем как есть (по рекомендации пользователя — минимальный фикс, не трогать status чтобы не ломать сценарий импорта сделок)
- `profileUserId` (строка 181) — заменить на `newProfile.id` (profile_id), т.к. user_id теперь null

### PATCH 3 — Edge function: import-contacts-gc (новая)
`supabase/functions/import-contacts-gc/index.ts`

**API:** `POST { mode: "dry_run"|"execute", batch_id, rows[], options? }`

**Логика:**
1. Фильтр исключений (7500084@gmail.com, "Сергей Федорчук", "тест")
2. Нормализация: email lower+trim, phone normalizePhone, instagram → ссылка
3. Matching: `external_id_gc` → email → phone → telegram
4. Конфликты: phone↔email mismatch → SKIP, ambiguous → SKIP
5. Dry-run: только отчёт (total, will_create, will_update, will_skip, conflicts[])
6. Execute: INSERT archived (user_id=NULL, is_archived=true, source='getcourse_import') / UPDATE только пустых полей
7. STOP guards: batch_limit (default 500), error_threshold (default 20)
8. Audit: `audit_logs` с `actor_type='system'`, `actor_user_id=NULL`, `actor_label='import-contacts-gc'`

Добавить в `supabase/functions.registry.txt`.

### PATCH 4 — ContactDetailSheet: новые поля
В `src/components/admin/ContactDetailSheet.tsx` — добавить отображение и редактирование:
- Instagram (ссылка, кликабельная)
- Страна, Город
- Дата рождения
- Дата регистрации GC (`gc_registered_at`)

Add-only: добавляем поля в существующую форму, не трогаем остальные.

### PATCH 5 — GetCourseContactsImportDialog + кнопка в ⚙️
Новый файл `src/components/admin/GetCourseContactsImportDialog.tsx` — адаптация паттерна `AmoCRMImportDialog.tsx`:
- Шаги: Upload XLSX/CSV → Auto-detect колонок (по спеке из ТЗ) → Dry-run preview → Execute
- Таблица preview: имя, email, phone, статус (create/update/skip/conflict)
- Блокировка Execute при conflicts > 0 (override чекбоксом)
- Progress bar + итоговый отчёт

Кнопка «Импорт GetCourse» в `AdminContacts.tsx` — в меню ⚙️ (шестерёнка), строка ~1118, перед Telegram Cleanup, под разделителем `hasPermission("admins.manage")`.

### PATCH 6 — config.toml
```toml
[functions.import-contacts-gc]
verify_jwt = false
```

### Порядок реализации
1. PATCH 1 (DB Migration)
2. PATCH 2 (BUGFIX getcourse-import-file — минимальный: только user_id=null)
3. PATCH 3 (Edge function import-contacts-gc)
4. PATCH 4 (ContactDetailSheet — новые поля)
5. PATCH 5 (UI диалог + кнопка)
6. PATCH 6 (Registry + config.toml)

### Что НЕ трогать
- `handle_new_user` — AUTO-CLAIM уже работает
- `AmoCRMImportDialog` — только как образец
- RLS политики, merge-логику
- Существующие edge functions (кроме BUGFIX в PATCH 2)

### Авто-детект колонок (маппинг заголовков)
```text
id|ID|user_id|ID пользователя     → gc_user_id → profiles.external_id_gc
Email|E-mail                       → profiles.email
Телефон|Phone                      → profiles.phone
Имя|First name                     → profiles.first_name
Фамилия|Last name                  → profiles.last_name
ФИО|Full name                      → profiles.full_name (fallback)
tg_id|telegram_id                  → profiles.telegram_user_id
tg_nickname|telegram_username      → profiles.telegram_username
Страна                             → profiles.country
Город                              → profiles.city
Дата рождения                      → profiles.birth_date
Instagram                          → profiles.instagram_url
Дата регистрации                   → profiles.gc_registered_at
```

