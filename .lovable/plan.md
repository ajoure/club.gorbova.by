да, согласен, с учетом правок:

&nbsp;

1. TrainingDetailBridge нужно не просто починить точечно, а убрать дублирование загрузчика. Сейчас у нас уже есть канонический загрузчик training detail в карточке контакта. Для hub-а нужен тот же shared helper / тот же контракт, а не вторая почти такая же реализация. Иначе снова получим расхождение.  
Правка: вынести единый loadTrainingDetailContext(userId, lessonId) в shared helper и использовать его и в ContactArtifactsTab, и в FormsDetailOpener.
2. По has_account правка должна быть шире, чем просто !!meta.user_id. Это исправит только часть записей. Канонически:  

  - если есть meta.user_id → true
  - иначе, если есть profile_id, нужно батчем дорезолвить profiles.user_id
  - has_account = Boolean(meta.user_id || profile.user_id)
3.   
Иначе старые/legacy записи снова будут показаны неверно.
4. В FormsDetailOpener использовать только:  

  - таблицу lesson_blocks
  - поле content
5.   
Любые training_lesson_blocks, config, as any убрать полностью. Никаких обходов типов.
6. Fallback при отсутствии lesson_progress_state нужен, но не “молча показать что-то”. Правильно так:  

  - если есть lesson_blocks и/или user_lesson_progress → синтезировать минимальный LessonProgressRecord и открыть existing StudentProgressModal
  - если нет ни state, ни blocks, ни responses → показать явный error state в модалке/диалоге, а не тихо закрывать окно
7. &nbsp;
8. Нужно добавить proof, что hub training details теперь реально открываются на живых кейсах:  

  - quiz / survey
  - diagnostic_table
  - case без lesson_progress_state, но с user_lesson_progress
9.   
И отдельно показать, что это визуально тот же existing StudentProgressModal, без второго viewer.
10. Для useFormsHubData зафиксировать не только комментарий, но и явный technical note в отчёте:  

  - текущая версия = MVP
  - client-side merge
  - limit(500) на источник
  - серверная пагинация / total counts / server filtering идут отдельным следующим PATCH  
  Без этого нельзя выдавать раздел как финально завершённый аналитический домен.
11. &nbsp;
12. Redirect-часть не трогать, она уже подтверждена. В этом PATCH не распыляться на маршруты, только:  

  - fix training detail bridge
  - fix canonical has_account
  - fix shared loader / fallback
  - дать proof
13. &nbsp;

&nbsp;

&nbsp;

Копируемый блок для [lovable.dev](http://lovable.dev):

Дополни текущий PATCH следующими правками:

&nbsp;

1. Не делать второй отдельный загрузчик training details. Вынести единый shared helper `loadTrainingDetailContext(userId, lessonId)` и использовать его и в `ContactArtifactsTab`, и в `FormsDetailOpener`. Никаких параллельных реализаций.

&nbsp;

2. В `FormsDetailOpener` использовать только канонический source:

- таблица `lesson_blocks`

- поле `content`

Полностью убрать `training_lesson_blocks`, `config`, `as any`.

&nbsp;

3. Исправить `has_account` в `useFormsHubData` канонически:

- `true`, если есть `meta.user_id`

- иначе батчем дорезолвить `profiles.user_id` по `profile_id`

- итог: `has_account = Boolean(meta.user_id || resolvedProfile.user_id)`

Нельзя определять аккаунт по одному `profile_id`.

&nbsp;

4. Fallback для training detail:

- если `lesson_progress_state` нет, но есть `lesson_blocks` и/или `user_lesson_progress`, синтезировать минимальный `LessonProgressRecord` и всё равно открыть existing `StudentProgressModal`

- если нет ни state, ни blocks, ни responses, показывать явный error state, а не молча закрывать окно

&nbsp;

5. Нужен proof на реальных кейсах:

- training detail из hub открывается через existing `StudentProgressModal`

- quiz/survey

- diagnostic_table

- fallback без `lesson_progress_state`

- `has_account` корректно работает на auth-linked и profile-only записях

&nbsp;

6. В отчёте явно пометить текущий раздел как MVP:

- client-side merge

- `limit(500)` по источникам

- серверная пагинация / total counts / server filtering идут отдельным следующим PATCH

&nbsp;

7. Redirects не менять — они уже подтверждены. Этот PATCH только на корректность данных и единый source of truth.

&nbsp;

# План: добивающий PATCH для раздела «Анкеты и данные»

## Диагностика

### Баг 1: Неправильная таблица в TrainingDetailBridge

`FormsDetailOpener.tsx` строка 60 использует `training_lesson_blocks` (несуществующая таблица, cast `as any` скрывает ошибку). Каноническая таблица — `lesson_blocks`. В `ContactArtifactsTab.tsx` (строка 65) уже правильно используется `lesson_blocks`. Это означает, что training details из hub-а сейчас **не работают** — блоки не загружаются.

### Баг 2: Неправильное определение `has_account`

Для site_form строка 81: `has_account: !!f.profile_id`. Но `profile_id` — это наличие профиля, а не аккаунта. Корректно: использовать `meta.user_id` (уже извлекается в строке 74).

### Баг 3: Поля блоков не совпадают с контрактом

`FormsDetailOpener.tsx` запрашивает `config` и маппит его в `content` (строка 89), а `ContactArtifactsTab.tsx` запрашивает `content` напрямую. Каноническая колонка в `lesson_blocks` — `content`.

## Шаги

### 1. Исправить TrainingDetailBridge — таблица и поля

В `FormsDetailOpener.tsx`:

- Заменить `training_lesson_blocks as any` → `lesson_blocks`
- Заменить `.select("id, block_type, config, sort_order")` → `.select("id, block_type, content")`
- Убрать маппинг `content: b.config` → `content: b.content`
- Привести в полное соответствие с `ContactArtifactsTab.tsx` `loadTrainingDetail`

### 2. Исправить `has_account` для site_form

В `useFormsHubData.ts` строка 81:

- Заменить `has_account: !!f.profile_id` → `has_account: !!meta.user_id`

### 3. Добавить fallback если нет lesson_progress_state

Сейчас при `!state` (строка 72) bridge молча закрывается. Вместо этого — создать минимальный `record` (как в `ContactArtifactsTab.tsx` строки 95-107) и всё равно показать модалку с блоками/ответами.

### 4. Пометить реализацию как MVP

Добавить комментарий в `useFormsHubData.ts` — `// MVP: client-side merge, limit(500). TODO: server pagination`

## Файлы


| Файл                                               | Изменения                        |
| -------------------------------------------------- | -------------------------------- |
| `src/components/admin/forms/FormsDetailOpener.tsx` | Fix table name, fields, fallback |
| `src/hooks/useFormsHubData.ts`                     | Fix has_account, add MVP comment |


## DoD

1. Training details открываются из hub через `lesson_blocks` (каноническая таблица)
2. `has_account` определяется через `user_id`, не через `profile_id`
3. Fallback при отсутствии `lesson_progress_state` — модалка всё равно открывается
4. Контракт данных совпадает с `ContactArtifactsTab.tsx` `loadTrainingDetail`
5. Redirects уже работают (проверено: `/admin/payments/preorders` и `/admin/preregistrations`)