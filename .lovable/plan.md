# да, согласен, с учетом правок:

&nbsp;

1. Добавь явный query param для режима просмотра:  

  - ?domain=...&mode=manual|auto&version=...
  - иначе deep-link по version будет неоднозначным между ручными версиями и AUTO-CURRENT.
2. &nbsp;
3. В логике activate для manual-версий явно исключи auto-дорожку:  

  - архивировать только записи этого section_key,
  - только manual-версии,
  - AUTO-CURRENT никогда не должен попадать под manual activate/archive.
4. &nbsp;
5. Для AUTO-CURRENT зафиксируй жёсткий lookup/upsert-контракт:  

  - одна системная запись на section_key,
  - поиск по section_key + version_label='AUTO-CURRENT' + meta.managed_by='system',
  - если найдено больше одной — STOP, не обновлять молча, а вынести в repair.
6. &nbsp;
7. В DoD добавь отдельный proof для обоих сценариев обновления:  

  - ручной запуск Обновить сейчас;
  - ночной запуск через cron;
  - в обоих случаях показать реальную запись в audit_logs и обновление AUTO-CURRENT.
8. &nbsp;
9. Добавь в preset /admin/products-v2/docs, что он открывается сразу в:  

  - domain=products_sales
  - mode=manual по умолчанию,
  - с быстрым переключением в AUTO-CURRENT, чтобы не было ощущения двух разных страниц.
10. &nbsp;

&nbsp;

&nbsp;

После этих правок план можно отдавать в реализацию.

&nbsp;

План: Единый системный реестр документации с ночным автообновлением (финальная версия)

## Разрешение противоречия: manual vs AUTO-CURRENT

**Решение:** AUTO-CURRENT НЕ участвует в статусной модели active/draft/archived. Это отдельная дорожка, определяемая через `version_label = 'AUTO-CURRENT'` и `meta->>'managed_by' = 'system'`. Поле `status` у AUTO-CURRENT всегда `'active'`, но в UI manual и auto версии **разделены на два режима просмотра**.

Правило "одна active на section_key" применяется **только к manual-версиям**. AUTO-CURRENT — параллельная системная запись, не конфликтует с manual active.

---

## UI: разделение manual / auto

На `/admin/docs` для каждого домена — два режима (segmented control или toggle):


| Режим              | Что показывает                                           | Действия                                        |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------- |
| **Ручные версии**  | POINT A, B, C… Version selector, create/activate/archive | Copy, Download, New version, Activate           |
| **Автообновление** | AUTO-CURRENT snapshot                                    | Copy, Download, timestamp последнего обновления |


`/admin/products-v2/docs` — preset-обёртка, показывает тот же двухрежимный viewer для `products_sales`.

---

## Actor-type контракт


| Операция                        | actor_type | actor_user_id | actor_label                   |
| ------------------------------- | ---------- | ------------- | ----------------------------- |
| Nightly refresh                 | `system`   | `NULL`        | `system_docs_nightly_refresh` |
| Manual refresh                  | `admin`    | `auth.uid()`  | `admin_system_docs`           |
| Create/activate/archive version | `admin`    | `auth.uid()`  | `admin_system_docs`           |
| Seed                            | `admin`    | `auth.uid()`  | `admin_system_docs_seed`      |


---

## Seed-логика (уточнённая)

**Для products_sales** (уже есть manual-версии):

- НЕ создаёт POINT A
- Существующий POINT C active не трогается
- При первом seed/refresh создаётся только AUTO-CURRENT, если его ещё нет

**Для пустых доменов** (sites_pages_forms, trainings_access и т.д.):

- Создаётся manual baseline POINT A (`status = 'active'`)
- AUTO-CURRENT НЕ создаётся seed'ом — появляется после первого nightly или manual refresh

**Idempotency:** seed проверяет существующие записи, повторный запуск ничего не дублирует.

---

## Источники данных nightly refresh (фиксированный набор)


| Источник                                           | Что берём                           |
| -------------------------------------------------- | ----------------------------------- |
| `audit_logs`                                       | Записи за 24h для блока "Изменения" |
| `domain_events` / `domain_executions`              | Системные события за 24h            |
| `products_v2`, `tariffs`, `tariff_offers`          | Текущее состояние продуктов         |
| `orders_v2`                                        | Статистика сделок                   |
| `access_rules`, `entitlements`, `subscriptions_v2` | Правила доступа                     |
| `training_modules`, `training_lessons`             | Тренинги                            |
| `site_pages`, `site_form_submissions`              | Сайты и формы                       |
| `user_roles`, `role_permissions`                   | Роли                                |
| Реестр EF из `functions.registry.txt`              | Edge functions                      |
| pg_cron `cron.job`                                 | Cron jobs                           |


---

## STOP-guard: размер документа (стратегия при >100KB)

При превышении 100KB для любого документа:

1. НЕ падать молча
2. Сохранить summary-версию (первые N секций + "... truncated, full version exceeds 100KB")
3. В `meta` добавить `"truncated": true, "full_size_bytes": N`
4. Audit: `system_docs.nightly_refresh_completed` с `"warnings": ["truncated:platform_master"]`
5. В UI показать предупреждение "Документ усечён"

---

## Cron runbook

Регистрация cron — через SQL INSERT (не миграция). В platform_master и в документации по механизму:

- SQL для регистрации job
- SQL для проверки: `SELECT * FROM cron.job WHERE jobname = 'system-docs-nightly-refresh'`
- SQL для переустановки: `SELECT cron.unschedule('system-docs-nightly-refresh')` → повторный schedule
- SQL для отключения: `SELECT cron.unschedule('system-docs-nightly-refresh')`

---

## Раздел в platform_master: "Как устроена документация"

Обязательная секция:

- Хранилище: `admin_docs`, единственный SoT
- Manual-версии: POINT A/B/C, управляются через UI, active/draft/archived
- AUTO-CURRENT: системная версия, обновляется nightly/manual refresh, `meta.managed_by='system'`
- Главный входной артефакт: `platform_master` AUTO-CURRENT — копировать и давать как контекст для новых задач
- Nightly refresh: 03:00 Europe/London, EF `system-docs-nightly-refresh`, idempotent по batch_key
- Как использовать: открыть `/admin/docs` → Platform Master → AUTO-CURRENT → Copy

---

## Затрагиваемые файлы


| Файл                                                      | Действие                                        |
| --------------------------------------------------------- | ----------------------------------------------- |
| `src/lib/systemDocsRegistry.ts`                           | Создать — реестр доменов + типы + meta контракт |
| `src/hooks/useSystemDocs.ts`                              | Создать — shared hook (manual + auto режимы)    |
| `src/components/admin/SystemDocViewer.tsx`                | Создать — shared viewer с manual/auto toggle    |
| `src/pages/admin/AdminSystemDocs.tsx`                     | Создать — hub с tabs + deep-link + auto-status  |
| `src/pages/admin/AdminProductsDocs.tsx`                   | Refactor → preset-обёртка                       |
| `src/App.tsx`                                             | Добавить route `/admin/docs`                    |
| `src/components/layout/AdminLayout.tsx`                   | routeToTitle                                    |
| `src/components/layout/AdminSidebar.tsx`                  | Пункт меню (super_admin only)                   |
| `supabase/functions/system-docs-nightly-refresh/index.ts` | Создать — nightly EF                            |
| pg_cron (INSERT)                                          | Cron job hourly → EF                            |


---

## DoD (полный)

**Архитектурная целостность:**

- Нет второго storage кроме `admin_docs`
- Нет второго viewer кроме shared `SystemDocViewer`
- `AdminProductsDocs` — только preset-обёртка (0 собственной логики)
- `/admin/docs` — единый hub, не параллельный модуль

**UI и навигация:**

- Пункт меню только для super_admin
- `/admin/docs` с tabs по доменам, deep-link `?domain=...&version=...`
- Два режима просмотра: ручные версии / AUTO-CURRENT
- Copy/download возвращают raw `content_text` без потери `===` и структуры

**Версионирование:**

- Manual: одна active на section_key, транзакционный activate
- AUTO-CURRENT: определяется через `version_label` + `meta.managed_by`, не конфликтует с manual active
- Seed idempotent: не создаёт POINT A для products_sales, не дублирует

**Автообновление:**

- Nightly EF запускается в 03:00 Europe/London
- Один запуск в сутки (batch_key idempotency)
- AUTO-CURRENT содержит блок "Изменения за 24 часа"
- Ручные версии НЕ перетираются
- В UI: last run / status / next run
- Кнопка ручного запуска (тот же pipeline)
- При >100KB: truncation + warning, не silent fail

**Audit и actor-type:**

- Nightly: `actor_type='system'`, `actor_user_id=NULL`, `actor_label='system_docs_nightly_refresh'`
- Manual: `actor_type='admin'`, `actor_user_id=auth.uid()`
- SYSTEM ACTOR proof: после первого запуска в audit_logs реальная запись с корректным actor
- Все операции логируются: created/activated/archived/copied/downloaded/seed/refresh

**Содержимое:**

- Master-файл пригоден как единый входной артефакт
- Open tails содержит все незакрытые хвосты
- platform_master содержит раздел "Как устроена документация"
- Auto-refresh не ломает формат manual-документов
- Cron runbook задокументирован в platform_master

**Безопасность:**

- RLS не ослаблен — super_admin only