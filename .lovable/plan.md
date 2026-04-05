# да, согласен, с учетом правок:

&nbsp;

1. Seed для live_events_testing сделать **idempotent** по той же схеме, что и для live_events: только POINT A + AUTO-CURRENT, обе active, без лишних версий и без архивирования существующих записей.
2. В meta для live_events_testing явно указать:
  &nbsp;
  - domain_key: "live_events_testing"
  - doc_type: "testing_guide"
  - source_file: "docs/[live-events-v2-testing-guide.md](http://live-events-v2-testing-guide.md)"
  - managed_by
  - seed_version
  &nbsp;
3. В systemDocsRegistry.ts для нового домена не ставить конфликтующий sortOrder. Проверить соседние домены и выбрать следующий свободный порядок, чтобы вкладка не прыгала и не ломала сортировку.
4. В help-popup CTA сделать не просто ссылками в тексте, а **двумя отдельными кнопками/карточками** с коротким пояснением:
  &nbsp;
  - «Техническая документация» — для разработчиков
  - «Инструкция для тестировщика» — для сотрудника
    Чтобы роли были визуально разделены.
  &nbsp;
5. В live_events tech-doc добавить ссылку на testing guide **только как навигационный блок внизу**, без дублирования всего текста testing guide внутрь техдока.
6. Для proof обязательно показать SQL не только по наличию строк, но и по content_len > 0 для обоих доменов:
  &nbsp;
  - live_events
  - live_events_testing
  &nbsp;
7. В proof UI проверить именно оба адреса:
  &nbsp;
  - /admin/docs?domain=live_events&mode=manual
  - /admin/docs?domain=live_events_testing&mode=manual
  &nbsp;
8. Ссылки из help-popup вести сразу на /admin/docs, не на старый /admin/system-docs.
9. Ничего не менять в логике эфиров, cron, уведомлений, access, replay и incident guardrails. Это строго документационный PATCH.
10. Следующим отдельным PATCH потом заменить placeholders на реальные скриншоты со стрелками и подписями, без смешивания с текущим seed/doc PATCH.

&nbsp;

&nbsp;

План: Домен `live_events_testing` + два CTA в help-popup

## Контекст

- `admin_docs` для `live_events` — 2 записи (POINT A + AUTO-CURRENT), работает.
- `live_events_testing` — 0 записей, домен не зарегистрирован.
- Файл `docs/live-events-v2-testing-guide.md` существует (208 строк), контент готов.
- В help-popup сейчас одна общая ссылка на техдок, нет отдельного CTA для тест-гайда.

## Что нужно сделать

### 1. Зарегистрировать домен `live_events_testing`

**Файл**: `src/lib/systemDocsRegistry.ts`

Добавить в `SYSTEM_DOC_DOMAINS`:

```ts
{
  key: "live_events_testing",
  title: "Live Events v2 — Тестирование",
  sortOrder: 8,
  exportFileName: "live-events-v2-testing.md",
}
```

### 2. Засеять контент в `admin_docs`

**Действие**: INSERT (через insert tool) двух idempotent записей с `section_key = 'live_events_testing'`:

- **POINT A** (manual, status=active) — содержимое `docs/live-events-v2-testing-guide.md`
- **AUTO-CURRENT** (managed_by=system, status=active) — то же содержимое

Meta аналогично `live_events`: `domain_key`, `source`, `managed_by`, `title`, `source_file`.

### 3. Обновить help-popup — два раздельных CTA

**Файл**: `src/components/admin/live/LiveEventsHelpDialog.tsx`

Заменить текущий нижний блок (строки 178-196) на два отдельных CTA-блока:

1. **📋 Инструкция для тестировщика** → `/admin/docs?domain=live_events_testing&mode=manual`
2. **📚 Техническая документация** → `/admin/docs?domain=live_events`

Визуально: две карточки/кнопки рядом, разделённые, с иконками.

### 4. В tech-doc добавить ссылку на тест-гайд

**Действие**: UPDATE записей `live_events` в `admin_docs` — в конец `content_text` добавить раздел со ссылкой на `/admin/docs?domain=live_events_testing&mode=manual`.

### 5. Proof

- SQL: `SELECT section_key, version_label, status, managed_by FROM admin_docs WHERE section_key IN ('live_events', 'live_events_testing')`
- Визуально: help-popup с двумя CTA, `/admin/docs?domain=live_events_testing` с контентом.

## Файлы для изменения


| Файл                                                 | Действие                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `src/lib/systemDocsRegistry.ts`                      | Добавить домен `live_events_testing`                         |
| `src/components/admin/live/LiveEventsHelpDialog.tsx` | Два CTA внизу popup                                          |
| `admin_docs` (БД)                                    | INSERT 2 записи для `live_events_testing`                    |
| `admin_docs` (БД)                                    | UPDATE 2 записи `live_events` — добавить ссылку на тест-гайд |


## Что НЕ меняется

Логика эфиров, cron, уведомления, access, replay — без изменений. Только документация.

## DoD

- `admin_docs WHERE section_key='live_events_testing'` → 2 записи
- `/admin/docs?domain=live_events_testing&mode=manual` показывает контент
- Help-popup содержит 2 раздельных CTA (техдок + тест-гайд)
- Tech-doc содержит ссылку на тест-гайд