

## PATCH CONTACTS-LIST.2 — Серверная пагинация + "Показать ещё" + вкладки + бейджи (DONE)

### Реализовано:
1. **Серверная пагинация**: `useInfiniteQuery` с `PAGE_SIZE=100`, `.range()`, стабильная сортировка `created_at desc, id desc`
2. **Кнопка "Загрузить ещё (N осталось на сервере)"** — загружает следующую страницу из Supabase
3. **Кнопка "Показать ещё (N осталось)"** — показывает больше из уже загруженных (displayLimit)
4. **Total count** — отдельный `select('id', { count: 'exact', head: true })` → "Всего: 8377"
5. **Orders enrichment по profile_id** (не user_id!) — чанками по 500
6. **Вкладки**: Активные → С покупками → Дубли → Без аккаунта → Все (по умолчанию "Все")
7. **Ghost бейдж** — убран (return null)
8. **Imported бейдж** — текст "импорт" строчными
9. **Экспорт**:
   - "Excel — загруженные (N)" / "CSV — загруженные (N)" — только то что видно
   - "Excel — все (8377)" — серверная выгрузка чанками по 1000
10. **Сброс displayLimit** при смене search/filter/tab

### Примечание по "Активные":
Вкладка "Активные" = клиентский фильтр `user_id != null`. При серверной пагинации первые 100 записей могут не содержать контактов с аккаунтом (если последние импорты без user_id). Поэтому по умолчанию выбрана вкладка "Все". Полностью серверные фильтры — отдельная задача (Фаза 2).


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
6. Execute: INSERT imported (user_id=NULL, is_archived=false, source='getcourse_import') / UPDATE только пустых полей
7. STOP guards: batch_limit (default 500), error_threshold (default 20)
8. Audit: `audit_logs` с `actor_type='system'`, `actor_user_id=NULL`, `actor_label='import-contacts-gc'`

### PATCH 5c — Нормализация имён GetCourse (DONE)
В UI (GetCourseContactsImportDialog.tsx) при парсинге строк:
- Функция `normalizeGCName()` в `src/lib/nameUtils.ts`
- Дедупликация токенов (A B A → A B)
- Эвристика порядка: default "Фамилия Имя", swap если t2 выглядит фамилией по суффиксам

### PATCH 5d — Статус `imported` вместо `archived` (DONE)
- Edge function: `status='imported'`, `is_archived=false`
- Триггер `handle_new_user`: `WHERE p.status IN ('archived', 'imported') AND p.user_id IS NULL`
- Бейдж "Импортирован" в AdminContacts.tsx
- Импортированные попадают в таб "Без аккаунта", НЕ в "Архив"

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

