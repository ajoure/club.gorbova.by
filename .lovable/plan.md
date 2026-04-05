# да, согласен, с учетом правок:

&nbsp;

1. **PATCH 1 — seed в admin_docs делать add-only и idempotent**
  &nbsp;
  - Не просто INSERT, а upsert/insert ... where not exists, чтобы повторный seed не создавал дублей.
  - Явно сохранить оба режима:
    &nbsp;
    - manual baseline для вкладки «Ручные версии»,
    - system auto-current для вкладки «Автообновление».
    &nbsp;
  - В meta добавить:
    &nbsp;
    - domain: "live_events"
    - doc_type: "architecture"
    - source_file: "docs/[live-events-v2-architecture.md](http://live-events-v2-architecture.md)"
    - seed_version
    &nbsp;
  - После seed нужен proof SQL:
    &nbsp;
    - count(*) по section_key='live_events'
    - список строк с slug/version/status/managed_by.
    &nbsp;
  &nbsp;
2. **PATCH 1 — не ограничиваться только section_key='live_events'**
  &nbsp;
  - Проверить, как именно текущий AdminSystemDocs фильтрует домен:
    &nbsp;
    - по section_key,
    - по domain,
    - по slug,
    - по mode.
    &nbsp;
  - Seed должен попадать именно в ту выборку, которую реально читает UI, иначе снова будет пустой экран при наличии строк в БД.
  &nbsp;
3. **PATCH 2 — test guide всё же связать с системой**
  &nbsp;
  - Отдельный новый домен заводить не нужно.
  - Но в tech-doc обязательно добавить явный раздел:
    &nbsp;
    - где лежит docs/[live-events-v2-testing-guide.md](http://live-events-v2-testing-guide.md),
    - кто его использует,
    - что это не developer-doc, а инструкция для тестировщика.
    &nbsp;
  - Плюс в help-popup добавить короткую ссылку/CTA:
    &nbsp;
    - «Инструкция по тестированию — у ответственного сотрудника / в техдокументации».
    &nbsp;
  &nbsp;
4. **PATCH 3 — placeholders пометить как временные**
  &nbsp;
  - В каждом визуальном блоке явно показать бейдж:
    &nbsp;
    - Временная схема
    - или Скрин будет добавлен позже.
    &nbsp;
  - Иначе пользователь может воспринять placeholder как реальный интерфейсный скрин.
  - Для каждого placeholder добавить короткую подпись:
    &nbsp;
    - что именно должен увидеть пользователь на этом месте страницы.
    &nbsp;
  &nbsp;
5. **PATCH 3 — покрыть не 6, а 7 обязательных зон**
  Добавить ещё отдельный визуальный блок:
  &nbsp;
  - **Страница /live/:slug для пользователя**
    Чтобы справка покрывала не только админку, но и конечный результат для зрителя.
  &nbsp;
6. **Proof сделать отдельным обязательным PATCH**
  После внедрения нужен отдельный proof-пакет:
  &nbsp;
  - скрин заполненной вкладки Live Events v2 в AdminDocs в режиме manual;
  - скрин в режиме auto;
  - скрин help-popup с placeholder-блоками;
  - скрин перехода по ссылке из help-popup в непустой tech-doc;
  - SQL proof по строкам admin_docs.
  &nbsp;
7. **Rollback / safety**
  &nbsp;
  - Seed не должен затрагивать существующие документы других доменов.
  - Если запись для live_events уже существует, обновлять только целевые поля контента, без удаления истории и без замены чужих manual versions.
  &nbsp;
8. **Финальный DoD уточнить**
  Считать задачу закрытой только если одновременно выполнено:
  &nbsp;
  - в БД есть строки для live_events,
  - UI AdminDocs реально показывает текст, а не пустое состояние,
  - help-popup содержит визуальные блоки,
  - ссылка из help-popup ведёт на заполненную документацию,
  - есть proof по всем четырём пунктам.
  &nbsp;

&nbsp;

&nbsp;

В остальном план правильный: сначала seed и публикация контента в AdminDocs, затем визуальная добивка user-help, затем proof.

&nbsp;

План: Добивка документации Live Events v2

## Диагноз


| Слой                      | Статус                                                             | Проблема                                               |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| User-help popup           | Работает                                                           | Нет визуальных блоков (скрины/placeholders)            |
| Tech-doc в AdminDocs      | Домен зарегистрирован, **контент = 0 строк**                       | `admin_docs` WHERE `section_key='live_events'` — пусто |
| Test guide                | Файл `docs/live-events-v2-testing-guide.md` существует (175 строк) | Не подтверждено в AdminDocs                            |
| Ссылка из help → tech-doc | Ссылка есть в коде                                                 | Ведёт на пустую вкладку                                |


---

## PATCH 1 — Seed tech-doc в admin_docs

**Действие**: SQL-миграция — INSERT двух записей в `admin_docs` с `section_key = 'live_events'`:

1. **POINT A** (manual, status=active) — содержимое `docs/live-events-v2-architecture.md` (полный текст ~9 KB)
2. **AUTO-CURRENT** (managed_by=system, status=active) — то же содержимое как auto-snapshot

Паттерн полностью совпадает с существующими доменами (например `platform_master` имеет и POINT B active, и AUTO-CURRENT active).

**Meta** для POINT A: `{ "source": "manual", "managed_by": "manual", "title": "Live Events v2 — Архитектура" }`  
**Meta** для AUTO-CURRENT: `{ "source": "seed", "managed_by": "system", "title": "Live Events v2 — Архитектура" }`

**Файл**: одна SQL-миграция.

---

## PATCH 2 — Seed test guide в admin_docs (опционально)

Test guide уже существует как файл в репо. Дополнительно можно добавить его как отдельную запись в `admin_docs` (например `section_key = 'live_events_testing'`), но это **не** было в исходном требовании — test guide должен жить отдельным файлом.

**Решение**: НЕ добавлять отдельный домен. Test guide остаётся в `docs/`. В tech-doc (POINT A) добавить ссылку на test guide.

---

## PATCH 3 — Визуальные placeholders в user-help

В `liveEventsHelpContent.ts` добавить в каждый раздел поле `illustration` с annotated placeholder:

```ts
interface HelpSection {
  // ...existing
  illustration?: {
    alt: string;
    placeholder: true; // пометка на замену реальным скрином
    description: string; // что должно быть на скрине
  };
}
```

В `LiveEventsHelpDialog.tsx` — рендерить placeholder-блок (серый прямоугольник с описанием) для 6 обязательных визуальных зон:

1. Создание эфира — форма создания
2. Создание источника — блок Kinescope
3. OBS — поля RTMP/StreamKey
4. Доступы — таблица access rules
5. Уведомления — настройки notification_settings
6. Запуск/завершение — кнопки управления

---

## Порядок выполнения

1. PATCH 1 — миграция seed tech-doc → контент появляется в AdminDocs
2. PATCH 3 — визуальные placeholders в user-help
3. Proof — скриншоты: tech-doc в AdminDocs, help-popup с placeholders, ссылка из help на tech-doc

## Файлы для изменения


| Файл                                                     | Действие                           |
| -------------------------------------------------------- | ---------------------------------- |
| `supabase/migrations/2026XXXX_seed_live_events_docs.sql` | Создать — INSERT в admin_docs      |
| `src/components/admin/live/liveEventsHelpContent.ts`     | Добавить illustration placeholders |
| `src/components/admin/live/LiveEventsHelpDialog.tsx`     | Рендер placeholder-блоков          |


## DoD

- `admin_docs` WHERE `section_key='live_events'` возвращает >= 2 строки (POINT A + AUTO-CURRENT)
- В AdminSystemDocs вкладка Live Events v2 показывает реальный контент
- Help-popup содержит 6 визуальных placeholder-блоков
- Ссылка из help-popup на tech-doc ведёт на заполненную страницу