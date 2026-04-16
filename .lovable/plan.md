# да, согласен, с учетом правок:

&nbsp;

1. **Не тянуть StudentProgressModal как есть, если он жёстко привязан к другому экрану или side-effects.**
  Сначала проверь, можно ли его безопасно переиспользовать напрямую.
  Если он чистый и принимает только props — окей.
  Если внутри есть завязки на роут, локальную страницу, mutation/telemetry, специфичный layout-контекст — вынести общий presentation-layer, а не копировать логику.
2. **Нужно явно разделить lesson и quest-ветки.**
  В текущем плане training-ветка охватывает lesson_answer, lesson_completion, quest_homework, но StudentProgressModal по описанию заточен под lesson_progress_state/lesson_blocks.
  Для quest_homework надо отдельно зафиксировать:
  &nbsp;
  - либо остаётся в текущем generic viewer как fallback;
  - либо есть отдельный существующий viewer, который тоже надо переиспользовать;
  - но нельзя насильно открывать StudentProgressModal, если для quest он не является каноническим экраном.
  &nbsp;
3. **Не убирать training payload из useContactArtifacts.ts полностью, пока не доказано, что он больше нигде не нужен.**
  Лучше так:
  &nbsp;
  - список артефактов остаётся лёгким;
  - для training details payload в списке может быть минимальным;
  - полный контекст грузится по клику;
    Но не делать резкий delete до проверки всех зависимостей.
  &nbsp;
4. **module_id в ContactArtifact — добавить обязательно, но также желательно сохранить lesson_id и user_id как явные поля в типе, а не надеяться на косвенный доступ.**
  Раз detail-viewer будет открываться по этим данным, они должны быть частью контракта артефакта явно и типобезопасно.
5. **Нужен явный lazy-query contract для training details.**
  По клику на training item:
  &nbsp;
  - грузим lesson_progress_state,
  - грузим lesson_blocks,
  - грузим user_lesson_progress,
  - показываем loading state внутри modal/open flow,
  - если чего-то нет — показываем fallback/error state, а не ломаемся.
    Это надо прописать, чтобы не было “по клику тишина”.
  &nbsp;
6. **Нужен fallback для кейса, когда lesson_progress_state отсутствует, а training artifact есть.**
  Такое возможно.
  Например:
  &nbsp;
  - есть user_lesson_progress,
  - но нет полноценного lesson_progress_state.
    Нужно зафиксировать поведение:
  - либо открывать доступный existing viewer только при полном контексте,
  - либо fallback на компактный read-only details block,
  - но не пустой экран и не crash.
  &nbsp;
7. **Для lesson_completion без block responses надо явно описать сценарий.**
  Если по записи есть только completion, но нет интерактивных ответов:
  &nbsp;
  - либо открываем StudentProgressModal, если он умеет работать с пустым blockResponses,
  - либо показываем, что у урока нет подробных интерактивных данных.
    Это должен быть осознанный кейс в плане.
  &nbsp;
8. **Очистку нужно сформулировать мягче: не “удалить сразу”, а “вывести из training detail path”.**
  Сначала переключить training details на existing viewer, потом проверить, что:
  &nbsp;
  - старые функции/мапперы больше нигде не используются,
  - только после этого удалить мёртвый код.
    Иначе можно сломать промежуточные ветки.
  &nbsp;
9. **ArtifactDetailModal лучше явно переименовать по смыслу, если он останется только для site forms.**
  Иначе название будет путать.
  Например, логика:
  &nbsp;
  - SiteFormDetailDialog
  - training → existing StudentProgressModal
    Это не обязательно, но желательно, если rename не заденет много мест.
  &nbsp;
10. **Нужно отдельно проверить совместимость визуального слоя.**
  Если StudentProgressModal открывается поверх карточки контакта, надо убедиться:

&nbsp;

&nbsp;

&nbsp;

- overlay/portal не конфликтует с already open contact sheet,
- z-index корректный,
- scroll locking корректный,
- backdrop не ломает UX.
  Это важно, потому что модалка будет открываться уже из модалки/side sheet.

&nbsp;

&nbsp;

&nbsp;

11. **В DoD добавь proof именно на проблемных кейсах:**

&nbsp;

&nbsp;

&nbsp;

- Тест: В какой роли вы находитесь сейчас → открывается existing viewer, без q1/1a;
- Шаг 2: Анализ и формирование портфеля клиентов → открывается та же таблица, что и в progress screen;
- site_form → по-прежнему открывается form-dialog, а не training viewer.

&nbsp;

&nbsp;

&nbsp;

12. **Добавь негативный DoD:**

&nbsp;

&nbsp;

&nbsp;

- список вкладки не ломается, если detail loading не удался;
- site forms не затронуты;
- фильтры/счётчики/dedup не меняются;
- второй кастомный training viewer больше не используется.

&nbsp;

&nbsp;

&nbsp;

13. **Главный scope guard нужно записать прямо:**

&nbsp;

&nbsp;

&nbsp;

- training details = reuse existing progress UI;
- site forms = separate local dialog;
- никаких новых training renderers, normalizers, resolver chains поверх уже существующего source of truth.

&nbsp;

&nbsp;

&nbsp;

14. **Финальный proof должен показать source-trace:**

&nbsp;

&nbsp;

&nbsp;

- какой training artifact кликнули,
- какой lesson_id/user_id/module_id,
- какой existing component opened,
- что UI совпадает с экраном прогресса по смысловым данным, а не только “примерно похоже”.

&nbsp;

&nbsp;

План: переиспользование StudentProgressModal для training details в карточке контакта

## Проблема

Сейчас по клику на training-артефакт во вкладке «Анкеты и обучение» открывается кастомный `ArtifactDetailModal` с примитивным рендером raw payload. Это даёт «кракозябры» (q1, 1a) вместо человекочитаемых вопросов/ответов. При этом в системе уже существует полноценный `StudentProgressModal`, который корректно отображает все типы блоков: quiz, survey, diagnostic_table, sequential_form, файлы и т.д.

## Принцип

- **Training details** → открывать существующий `StudentProgressModal`, без нового renderer
- **Site forms** → оставить отдельный Dialog с `PayloadSection` (это действительно новая сущность)
- Удалить из training-ветки `ArtifactDetailModal` использование `TrainingMetrics` и `PayloadSection` для training
- Удалить `normalizeTrainingResponse` и `TRAINING_KEY_MAP` из `useContactArtifacts.ts` — они больше не нужны для training

## Что нужно для открытия StudentProgressModal

Компонент принимает:

```text
record: LessonProgressRecord   ← из lesson_progress_state (id, user_id, lesson_id, state_json, completed_at, created_at, updated_at)
lessonBlocks: LessonBlock[]     ← из lesson_blocks (id, block_type, content) по lesson_id
blockResponses: Record<string>  ← из user_lesson_progress сгруппированные по block_id
lessonId: string
lessonTitle: string
moduleId: string
```

Из `ContactArtifact` уже есть: `lesson_id`, `user_id`. Остальное нужно дозагрузить по клику.

## Шаги реализации

### 1. ContactArtifactsTab — разделить обработку клика

- Клик на `site_form` → открывает существующий `ArtifactDetailModal` (только для форм)
- Клик на `lesson_answer` / `lesson_completion` / `quest_homework` → запускает загрузку данных для `StudentProgressModal`

### 2. Добавить хук или inline-загрузку для training detail

По клику на training-артефакт, дозагрузить:

1. `lesson_progress_state` по `(user_id, lesson_id)` → получить `state_json` и record
2. `lesson_blocks` по `lesson_id` → получить блоки с `block_type` и `content`
3. `user_lesson_progress` по `(user_id, lesson_id)` → сгруппировать по `block_id` для `blockResponses`

Это 3 параллельных запроса, выполняемые только по клику (не при загрузке вкладки).

### 3. Открыть StudentProgressModal с правильными props

```text
<StudentProgressModal
  record={loadedRecord}
  lessonBlocks={loadedBlocks}
  open={!!selectedTraining}
  onClose={() => setSelectedTraining(null)}
  blockResponses={groupedResponses}
  lessonId={artifact.lesson_id}
  lessonTitle={artifact.lesson_title}
  moduleId={artifact.module_id}
/>
```

### 4. Очистка

Удалить / вывести из использования:

- `normalizeTrainingResponse()` в `useContactArtifacts.ts`
- `TRAINING_KEY_MAP` в `useContactArtifacts.ts`
- Использование `TrainingMetrics` и `PayloadSection` для training-артефактов в `ArtifactDetailModal`
- В `ArtifactDetailModal` оставить только ветку `site_form`

`ArtifactPayloadRenderer.tsx` — оставить как есть, он используется для site forms.

### 5. Расширить ContactArtifact type

Добавить `module_id?: string` в `ContactArtifact`, заполнять из join chain `training_lessons → training_modules`.

## Файлы, которые будут изменены


| Файл                                                       | Действие                                                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/components/admin/contact/ContactArtifactsTab.tsx`     | Разделить клик: forms → ArtifactDetailModal, training → StudentProgressModal. Добавить lazy-загрузку training context.                       |
| `src/hooks/useContactArtifacts.ts`                         | Убрать `normalizeTrainingResponse`, `TRAINING_KEY_MAP`. Добавить `module_id` в артефакт. Упростить `payload` для training (больше не нужен). |
| `src/components/admin/contact/ArtifactPayloadRenderer.tsx` | Без изменений — используется для site forms                                                                                                  |


## Что НЕ будет изменено

- `StudentProgressModal.tsx` — переиспользуется as-is
- `blockProgressResolver.ts` — переиспользуется as-is
- Фильтры, dedup, lazy loading вкладки
- RLS, миграции, edge functions
- Карточка контакта вне вкладки «Анкеты»

## DoD

1. Клик на training item в карточке контакта открывает `StudentProgressModal`
2. Данные выглядят идентично существующему экрану прогресса ученика
3. Нет второго параллельного training viewer
4. `normalizeTrainingResponse` и `TRAINING_KEY_MAP` удалены
5. Клик на site_form по-прежнему открывает форменный Dialog с читаемым payload
6. Фильтры и список артефактов работают без регрессий