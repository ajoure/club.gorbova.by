# да, согласен, с учетом правок:

&nbsp;

1. **Разделить 3 deliverable не только логически, но и физически по местам хранения**:
  &nbsp;
  - **user-help**: только UI-слой страницы /admin/live-events, не через AdminSystemDocs;
  - **tech-doc**: отдельная запись/домен в AdminSystemDocs;
  - **test guide**: отдельный markdown-документ в docs + при необходимости отдельная запись в AdminSystemDocs, но не смешивать с архитектурной статьёй.
    Это нужно явно зафиксировать в плане, чтобы подрядчик не сделал одну общую статью и не переиспользовал её везде.
  &nbsp;
2. **Для user-help не делать зависимость от внешней документации**:
  &nbsp;
  - popup справки должен работать автономно, даже если AdminSystemDocs временно пуст или недоступен;
  - контент user-help должен храниться в отдельном structured help-config внутри фронта или локального help-модуля;
  - в popup можно дать ссылку «Открыть техдок», но только как дополнительное действие для продвинутого пользователя.
  &nbsp;
3. **Добавить отдельный PATCH на иллюстрации/скриншоты**:
  сейчас в плане сказано “можно со скринами”, но это слишком мягко.
  Нужно зафиксировать:
  &nbsp;
  - либо реальные скриншоты текущего интерфейса;
  - либо annotated placeholders с обязательной последующей заменой на реальные;
  - минимум 5 визуальных блоков:
    &nbsp;
    1. создание эфира,
    2. создание источника,
    3. OBS-блок,
    4. доступы,
    5. уведомления,
    6. запуск/завершение.
      Иначе подрядчик может сделать просто текстовую модалку без наглядности.
    &nbsp;
  &nbsp;
4. **В PATCH A явно указать UX-формат modal/drawer**:
  не оставлять выбор полностью свободным.
  Предлагаю зафиксировать:
  &nbsp;
  - desktop: Dialog / side-panel c max-w-4xl, scrollable;
  - mobile: Drawer;
  - внутри — левое оглавление или accordion, чтобы справкой было удобно пользоваться во время работы.
    Иначе могут сделать неудобное узкое окно.
  &nbsp;
5. **Добавить в user-help обязательный раздел “Быстрая памятка”**:
  в самом верху popup:
  &nbsp;
  - 5–7 коротких шагов;
  - “если нужно быстро провести эфир — делайте так”.
    Это важно, потому что длинную инструкцию сотрудники читать не будут.
  &nbsp;
6. **В help-popup добавить 2 режима контента**:
  &nbsp;
  - “Кратко”
  - “Подробно”
    Либо через tabs, либо через collapsible sections.
    Это сильно повысит практическую ценность справки и не перегрузит пользователя.
  &nbsp;
7. **В tech-doc добавить не только описание, но и operational safeguards**:
  отдельным разделом:
  &nbsp;
  - live_notification_config
  - kill-switch
  - proof_mode
  - production_approved
  - test_allowlist
  - incident correction flow
  - какие entrypoints разрешены / запрещены
    Это обязательно, потому что по этой функции уже был инцидент, и техдок без этого будет неполной.
  &nbsp;
8. **В tech-doc добавить раздел “Runtime dependencies / внешние зависимости”**:
  отдельно перечислить:
  &nbsp;
  - Kinescope
  - Telegram bot / telegram_clubs / telegram_bots
  - email sending function
  - pg_cron
  - realtime
  - auth/session dependencies
    Чтобы разработчик сразу видел, от чего зависит вся функция.
  &nbsp;
9. **В test guide добавить чёткое разделение safe-proof и forbidden actions**:
  отдельно блоками:
  &nbsp;
  - что сотруднику разрешено делать;
  - что запрещено делать;
  - какие эфиры нельзя использовать;
  - что делать только на test audience;
  - что нельзя запускать без подтверждения.
    Это нужно выделить визуально как красный warning-блок.
  &nbsp;
10. **В test guide добавить обязательный шаблон отчёта сотрудника**:
  чтобы после теста он возвращал не произвольный текст, а структуру:

&nbsp;

&nbsp;

&nbsp;

- какой эфир тестировал;
- какие каналы тестировал;
- какие шаги прошёл;
- что сработало;
- что не сработало;
- скриншоты;
- ссылки/ID логов.
  Иначе результат тестирования будет размытым.

&nbsp;

&nbsp;

&nbsp;

11. **В PATCH B зафиксировать способ попадания tech-doc в AdminSystemDocs**:
  не просто “создать markdown”.
  Нужно явно потребовать:

&nbsp;

&nbsp;

&nbsp;

- зарегистрировать домен live_events;
- обеспечить seed/import статьи в системную документацию;
- убедиться, что статья реально открывается в UI AdminSystemDocs, а не просто лежит файлом в репозитории.

&nbsp;

&nbsp;

&nbsp;

12. **Добавить отдельный DoD для user-help**:

&nbsp;

&nbsp;

&nbsp;

- кнопка видна на странице;
- popup открывается;
- есть минимум 6 разделов;
- есть визуальные подсказки;
- есть быстрый сценарий;
- help не ломает текущую страницу эфиров и не мешает форме/диалогам.

&nbsp;

&nbsp;

&nbsp;

13. **Добавить отдельный DoD для tech-doc**:

&nbsp;

&nbsp;

&nbsp;

- домен live_events зарегистрирован;
- статья открывается в AdminSystemDocs;
- описаны таблицы, edge functions, access logic, notifications, guardrails, replay, deferred;
- указан список файлов/сущностей, которые нельзя ломать.

&nbsp;

&nbsp;

&nbsp;

14. **Добавить отдельный DoD для test guide**:

&nbsp;

&nbsp;

&nbsp;

- существует как отдельный документ;
- содержит safe-only сценарий;
- содержит запреты;
- содержит шаблон итогового отчёта;
- не предполагает использование реальных клиентов.

&nbsp;

&nbsp;

&nbsp;

15. **Порядок выполнения уточнить**:
  лучше так:

&nbsp;

&nbsp;

&nbsp;

- сначала **tech-doc + test guide**,
- затем **user-help popup**,
- затем финальная связка и proof.
  Потому что контент user-help должен опираться на уже собранную и зафиксированную документационную базу.

&nbsp;

&nbsp;

В остальном план правильный: user-help отдельно, tech-doc отдельно, test guide отдельно.

&nbsp;

План: Live Events v2 — пользовательская справка + техдокументация + тест-гайд

## Контекст

Нужно создать три изолированных документальных слоя:

1. **User-help** — визуальная справка прямо в админке эфиров (modal/drawer)
2. **Tech-doc** — техническая документация в системе `AdminSystemDocs` (домен `live_events`)
3. **Test guide** — инструкция по тестированию для сотрудника (файл в `docs/`)

Существующая инфраструктура: `systemDocsRegistry.ts` уже содержит доменную систему (`admin_docs` таблица), `AdminSystemDocs.tsx` — готовый viewer. Домен `live_events` пока не зарегистрирован.

На странице `AdminLiveEvents.tsx` (строка 800-812) уже есть заголовок с кнопкой «Создать эфир» — рядом добавится кнопка справки.

---

## PATCH A — User-help modal в AdminLiveEvents

### Файлы


| Файл                                                 | Действие                                                |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `src/components/admin/live/LiveEventsHelpDialog.tsx` | Создать — компонент modal/drawer со справкой            |
| `src/components/admin/live/liveEventsHelpContent.ts` | Создать — structured data для разделов справки          |
| `src/pages/admin/AdminLiveEvents.tsx`                | Добавить кнопку `?` рядом с заголовком + state + import |


### Реализация

**Кнопка** — иконка `HelpCircle` (уже импортирована) рядом с «Создать эфир» или рядом с заголовком «Эфиры». По клику открывает `LiveEventsHelpDialog`.

**Dialog** — `Drawer` (снизу на мобильных) или `Dialog` с `max-w-3xl`, scrollable. Внутри:

- 7 разделов (accordion или tabs):
  1. Что такое эфиры (live_stream vs recorded_webinar)
  2. Как создать живой эфир (пошагово, 10 шагов)
  3. Как работать с OBS (RTMP, stream key, инструкция для ведущего)
  4. Как работают доступы (product/tariff rules)
  5. Как работают уведомления (шаблон, каналы, offsets)
  6. Как провести эфир (запуск → завершение → replay)
  7. Если что-то не работает (missing/broken, sync, recreate, detach)

**Визуальное оформление**:

- Крупные заголовки, нумерованные шаги
- Цветные callout-блоки: «Важно» (amber), «Ошибка» (red), «Совет» (blue)
- Иконки для каждого раздела
- Простой русский язык, без технического жаргона

**Контент хранится** в `liveEventsHelpContent.ts` как structured array — не hardcode JSX в огромном блоке.

---

## PATCH B — Техническая документация (SystemDocs домен)

### Файлы


| Файл                                  | Действие                                            |
| ------------------------------------- | --------------------------------------------------- |
| `src/lib/systemDocsRegistry.ts`       | Добавить домен `live_events` в `SYSTEM_DOC_DOMAINS` |
| `docs/live-events-v2-architecture.md` | Создать — полная техническая документация           |


### Контент tech-doc

Markdown-документ с разделами:

1. **Архитектура** — таблицы: `live_events`, `live_event_access_rules`, `live_event_comments`, `live_event_questions`, `live_event_notification_log`, `live_notification_config`, `broadcast_templates`
2. **Edge functions** — `kinescope-api`, `live-resolve`, `live-events-list`, `live-event-notifications-cron`, `live-event-send-correction`
3. **Access logic** — canonical RPC `user_has_live_event_access`, admin bypass, product/tariff/entitlement checks
4. **Notification logic** — `metadata.notification_settings`, cron dispatch, guardrails (kill-switch, dry_run, proof_mode, test_allowlist, production_approved), template-channel compatibility
5. **Live source lifecycle** — create → sync → recreate → detach, `provider_source_status`, replay transition
6. **UI structure** — AdminLiveEvents, /live, /live/:slug, control panel
7. **Known limitations / deferred** — token picker bug, deferred features
8. **Что нельзя ломать** — recorded_webinar flow, /live/:slug, replay, comments/questions, canonical access, incident guardrails

Этот документ также будет seed-контентом для домена `live_events` в `admin_docs`.

---

## PATCH C — Инструкция по тестированию

### Файлы


| Файл                                   | Действие                            |
| -------------------------------------- | ----------------------------------- |
| `docs/live-events-v2-testing-guide.md` | Создать — инструкция для сотрудника |


### Контент

Пошаговая инструкция на русском:

1. Как создать тестовый эфир
2. Как настроить тестовую аудиторию (только test_allowlist)
3. Как проверить доступ
4. Как проверить notifications в safe-mode (dry_run → approve → allowlist-send)
5. Как проверить /live и /live/:slug
6. Как проверить comments/questions
7. Что приложить по итогам теста
8. **Явное ограничение**: только админы/сотрудники/согласованные аккаунты, не реальные клиенты, не боевой эфир

---

## PATCH D — Связка справки со страницей

Уже покрыто PATCH A: кнопка на странице эфиров открывает user-help modal. Tech-doc доступен отдельно через AdminSystemDocs (`/admin/system-docs?domain=live_events`).

---

## Что не будет изменено

- Логика эфиров (PATCH 1-8 baseline)
- recorded_webinar flow
- /live/:slug
- comments/questions
- guardrails / kill-switch
- notification cron logic

## Порядок выполнения

1. PATCH B — tech-doc + регистрация домена (основа для контента)
2. PATCH C — test guide
3. PATCH A — user-help компонент + контент + кнопка в AdminLiveEvents

## DoD

- На странице эфиров есть кнопка справки
- Кнопка открывает пользовательскую инструкцию (не техдок)
- Инструкция написана простым языком с визуальными подсказками
- Техническая документация обновлена отдельно в SystemDocs
- Есть отдельная инструкция по тестированию
- В отчёте указано: где user-help, где tech-doc, где test guide, какие файлы изменены