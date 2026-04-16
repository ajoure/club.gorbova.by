# да, согласен, с учетом правок:

&nbsp;

1. Вкладку лучше делать как **Phase 1: read-only aggregation без новых таблиц**, а не как окончательное архитектурное решение “навсегда”.
  По discovery это действительно самый быстрый и безопасный путь. Но в плане нужно явно написать:
  &nbsp;
  - сейчас делаем **read-only unified view на клиенте**;
  - если позже объём данных вырастет, отдельный projection/read-model можно вынести в follow-up.
  &nbsp;
2. Нужно чётко зафиксировать **гранулярность артефакта**.
  Сейчас это не до конца определено. Для user_lesson_progress важно решить:
  &nbsp;
  - одна запись = один ответ по lesson_block
  - или одна запись = один агрегированный lesson attempt
    Иначе можно либо потерять ответы, либо задублировать уроки.
    Для Phase 1 рекомендую:
  - site_form_submission = 1 артефакт
  - user_lesson_progress = 1 артефакт на запись ответа
  - lesson_progress показывать только если по уроку нет ни одного user_lesson_progress
  - lesson_progress_state в список не выводить как отдельный артефакт, а использовать только как технический источник/обогащение при необходимости
  &nbsp;
3. Нужно явно зафиксировать **dedup policy** между user_lesson_progress и lesson_progress.
  Сейчас ты это описал общо. Нужен точный rule:
  &nbsp;
  - если по lesson_id есть хотя бы один содержательный user_lesson_progress, то отдельный lesson_progress в списке не показываем;
  - если lesson_progress есть, а ответов нет — показываем как “прохождение урока” без payload.
  &nbsp;
4. lesson_progress_state сейчас лучше вынести в **deferred list**.
  По discovery это техническое состояние, а не самостоятельный пользовательский артефакт.
  Не надо пытаться сразу красиво визуализировать state_json, если это не блокирует основной scope.
5. support_tickets с category='training_feedback' тоже лучше вынести в **deferred list / after-sprint follow-up**.
  Это полезный источник, но он уже граничит с коммуникациями, а не с основной задачей “анкеты и обучение”.
  Основной scope лучше закрыть сначала на:
  &nbsp;
  - site_form_submissions
  - user_lesson_progress
  - lesson_progress
  - quest_user_progress
  &nbsp;
6. Для site_form_submissions нужно явно описать, откуда берётся **человекочитаемый title/subtitle**.
  Недостаточно “Анкета + page title из metadata”, потому что page title может не лежать в metadata.
  Добавь точный источник:
  &nbsp;
  - брать page_id из submission;
  - при возможности подтягивать site_pages.title/slug;
  - fallback: “Анкета сайта”.
  &nbsp;
7. Для training data нужно явно описать цепочку join’ов и fallback-логику названий.
  Например:
  &nbsp;
  - user_lesson_progress.lesson_block_id -> lesson_blocks -> training_lessons -> training_modules -> products_v2
  - если какой-то join не найден, запись всё равно не теряем, а показываем fallback title вроде “Ответ по уроку”.
  &nbsp;
8. Нужно явно определить **source_type enum** для Phase 1 и не расширять его лишним.
  Рекомендую зафиксировать минимальный набор:
  &nbsp;
  - site_form
  - lesson_answer
  - lesson_completion
  - quest_homework
    Всё остальное — потом. Не надо сразу добавлять слишком общий список из 10 типов, которых ещё нет в UI.
  &nbsp;
9. payload и summary нужно разделить в UI-слое явно.
  В ContactArtifact лучше сделать:
  &nbsp;
  - summary — компактные поля для списка
  - payload — полный сырой JSON для деталей
    Это уже у тебя есть по смыслу, но лучше закрепить как обязательный контракт, чтобы список не пытался рендерить полный payload.
  &nbsp;
10. Для UI лучше использовать **drawer/modal деталей**, а не inline expansion внутри длинного списка.
  В карточке контакта и так большой ContactDetailSheet на 3850 строк; inline раскрытия быстро сделают вкладку громоздкой.
  Рекомендую:

&nbsp;

&nbsp;

&nbsp;

- список карточек/строк
- кнопка Открыть
- справа drawer или modal с полными деталями payload

&nbsp;

&nbsp;

&nbsp;

11. Нужно сделать вкладку **лениво загружаемой**, а не тянуть все запросы всегда.
  Поскольку ContactDetailSheet уже очень большой, добавь правило:

&nbsp;

&nbsp;

&nbsp;

- загрузка артефактов начинается только при открытии вкладки artifacts
- без лишней нагрузки на открытие карточки контакта

&nbsp;

&nbsp;

&nbsp;

12. В useContactArtifacts(profileId, userId) нужно явно предусмотреть **branch matrix**:

&nbsp;

&nbsp;

&nbsp;

- есть profileId, но нет userId
- есть userId, но нет profileId
- есть оба
- нет ничего
  И не падать в этих кейсах. Это важно для старых/неполных контактов.

&nbsp;

&nbsp;

&nbsp;

13. Нужна явная сортировка и secondary ordering.
  Просто “отсортированный по дате массив” недостаточно.
  Добавь:

&nbsp;

&nbsp;

&nbsp;

- primary: submitted_at / created_at DESC
- secondary: source_type, id
  чтобы порядок был детерминированным.

&nbsp;

&nbsp;

&nbsp;

14. Нужен явный contract для фильтров вкладки.
  Минимально:

&nbsp;

&nbsp;

&nbsp;

- Все
- Анкеты
- Обучение
  Но внутри “Обучение” не смешивать всё без структуры. Добавь в plan:
- badge/type label на каждой записи
- product badge
- lesson/module label если есть
- status badge

&nbsp;

&nbsp;

&nbsp;

15. Нужно отдельно описать пустые/битые payload-сценарии.
  Например:

&nbsp;

&nbsp;

&nbsp;

- form_data = {}
- response = null
- homework_response = null
- названия урока/продукта не найдены
  Такие записи не должны ломать вкладку; нужен fallback render.

&nbsp;

&nbsp;

&nbsp;

16. В DoD не хватает machine-checkable пунктов.
  Добавь:

&nbsp;

&nbsp;

&nbsp;

- для контакта с profile_id отображаются site_form_submissions
- для контакта с user_id отображаются training records
- смешанный контакт с profile_id + user_id показывает оба типа записей
- записи открываются без ошибок
- существующие вкладки карточки контакта не ломаются
- вкладка не загружается до её открытия

&nbsp;

&nbsp;

&nbsp;

17. Поскольку ContactDetailSheet уже очень большой, в плане нужно прямо закрепить **вынос новой вкладки в отдельный компонент** и минимум изменений в родительском файле.
  То есть:

&nbsp;

&nbsp;

&nbsp;

- новый ContactArtifactsTab.tsx
- новый useContactArtifacts.ts
- в ContactDetailSheet.tsx только wiring/import/tab trigger/tab content

&nbsp;

&nbsp;

&nbsp;

18. Добавь **deferred list** сразу, чтобы не раздувать текущий спринт:

&nbsp;

&nbsp;

&nbsp;

- support_tickets/training_feedback
- lesson_progress_state как отдельная визуализация
- глобальный unified projection/table, если позже понадобится
- расширенные фильтры/поиск/экспорт
  Это не блокирует основной scope и должно уйти в follow-up, а не в текущую реализацию.

&nbsp;

&nbsp;

План: Вкладка «Анкеты и обучение» в карточке контакта

## Discovery — найденные источники данных

### Таблицы с пользовательскими артефактами


| Таблица                                          | Привязка                | Payload                           | Записей | Что хранит                               |
| ------------------------------------------------ | ----------------------- | --------------------------------- | ------- | ---------------------------------------- |
| `site_form_submissions`                          | `profile_id`            | `form_data`, `metadata`           | 15      | Анкеты с сайта, предзаписи               |
| `user_lesson_progress`                           | `user_id`               | `response`, `score`, `is_correct` | 64      | Ответы по блокам уроков (тесты, задания) |
| `lesson_progress`                                | `user_id`               | —                                 | 124     | Факт прохождения урока (completion)      |
| `lesson_progress_state`                          | `user_id`               | `state_json`                      | 63      | Состояние прохождения урока              |
| `quest_user_progress`                            | `user_id`               | `homework_response`               | 0       | Домашние задания квестов                 |
| `support_tickets` (category=`training_feedback`) | `profile_id`, `user_id` | описание                          | —       | Обратная связь по урокам                 |


### Связи для обогащения

- `training_lessons` → `training_modules` (module_id) → `products_v2` (product_id) — цепочка урок → модуль → продукт
- `quest_lessons` → квесты (quest_id)
- `lesson_blocks` — для названий блоков в user_lesson_progress

### Contact объект

- `contact.id` = `profiles.id` — для `site_form_submissions.profile_id`
- `contact.user_id` = `auth.users.id` — для всех `*_progress.user_id`

### Существующая UI-структура

- `ContactDetailSheet.tsx` — 3850 строк, 11 вкладок
- Паттерн: каждая вкладка — `TabsContent` внутри общего scroll-контейнера
- Есть импорты выделенных компонентов-вкладок (ContactPaymentsTab, ContactLoyaltyTab и т.д.)

## Архитектурное решение

### Почему НЕ создаём новую таблицу / read-model

1. Данных мало (суммарно ~250 записей) — объединение на клиенте тривиально
2. Источники уже содержат все нужные payload — дублировать в projection не нужно
3. Данные нужны read-only для одного контакта — нагрузки нет
4. Add-only подход — без миграций, без новых сущностей

### Подход: клиентская projection через React Query

Один хук `useContactArtifacts(profileId, userId)` делает параллельные запросы в существующие таблицы и собирает unified список артефактов с единой типизацией:

```text
type ContactArtifact = {
  id: string
  source_type: 'site_form' | 'lesson_answer' | 'lesson_completion' | 'homework'
  source_id: string
  title: string
  subtitle: string | null
  product_id: string | null
  product_title: string | null
  training_title: string | null
  lesson_title: string | null
  submitted_at: string
  status: 'completed' | 'in_progress' | 'new'
  score: number | null
  max_score: number | null
  payload: Record<string, unknown>  // полный payload для деталей
}
```

### Источники → артефакты

1. **site_form_submissions** (по `profile_id`) → `source_type: 'site_form'`
  - title = "Анкета" + page title из metadata
  - payload = form_data
  - product из metadata.product_id
2. **user_lesson_progress** (по `user_id`) → `source_type: 'lesson_answer'`
  - title = lesson_title (JOIN training_lessons)
  - subtitle = module_title (JOIN training_modules)
  - product_id из training_modules
  - payload = response
  - score/max_score из записи
3. **lesson_progress** (по `user_id`) → `source_type: 'lesson_completion'`
  - title = lesson_title
  - status = completed
  - Дедуплицируется с user_lesson_progress (если есть и то и то по одному lesson_id — показываем только lesson_answer)
4. **quest_user_progress** (по `user_id`) → `source_type: 'homework'`
  - payload = homework_response

## Что будет создано

### 1. Хук `src/hooks/useContactArtifacts.ts`

- Принимает `profileId` и `userId`
- 3-4 параллельных React Query запроса
- Собирает единый отсортированный по дате массив `ContactArtifact[]`
- Кэширование через React Query

### 2. Компонент `src/components/admin/contact/ContactArtifactsTab.tsx`

- Вкладка «Анкеты и обучение»
- Фильтры: Все / Анкеты / Обучение
- Список артефактов в виде карточек:
  - иконка типа, title, subtitle
  - продукт, дата, статус/score
  - кнопка «Детали»
- Раскрывающийся блок деталей: полный payload (form_data, response и т.д.)

### 3. Интеграция в `ContactDetailSheet.tsx`

- Новый `TabsTrigger value="artifacts"` — «Анкеты и обучение» (с иконкой BookOpen + FileText)
- Новый `TabsContent value="artifacts"` — рендерит `ContactArtifactsTab`
- Бейдж с количеством записей

## Что НЕ меняется

- Никаких миграций / новых таблиц
- Никаких edge functions
- Существующие вкладки не трогаются
- RLS не меняется — все запросы идут от admin через существующие политики
- Профиль/контакт не модифицируется

## DoD

- Вкладка видна в карточке контакта
- Анкеты с сайта отображаются с полными полями form_data
- Ответы по урокам отображаются с score и lesson/module/product привязкой
- Прохождения уроков без ответов тоже видны
- Фильтр Все/Анкеты/Обучение работает
- Детали раскрываются и показывают полный payload
- Пустое состояние для контактов без артефактов
- Не ломает существующие вкладки