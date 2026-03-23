# Исправь и подтверди скринами  в симуляции:

&nbsp;

# Исправление багов в квест-уроках (по фидбеку Натальи Новиковой)

Три бага, выявленных реальным пользователем:

## Баг 1: При переключении вкладки — скролл прыгает вверх

**Причина**: `useLessonProgressState` при возврате на вкладку вызывает рефетч данных. Хотя `loading` не сбрасывается в `true` при повторном фетче (строка 57: `if (!hasLoadedOnceRef.current)`), сам `setRecord(data)` вызывает ре-рендер `KvestLessonView`, который зависит от `state` в десятках `useMemo`/`useCallback`. Это провоцирует перестройку DOM, и `ScrollToTop` не успевает восстановить позицию.

Дополнительно: `ScrollToTop` использует только 2 вложенных `requestAnimationFrame` для восстановления — этого недостаточно, если React ре-рендер происходит асинхронно после rAF.

**Исправление**:

1. В `useLessonProgressState.tsx` — при background refetch (`hasLoadedOnceRef.current === true`) сравнивать новый `state_json` с текущим по JSON-строке. Если одинаковый — не вызывать `setRecord`, избегая лишних ре-рендеров.
2. В `ScrollToTop.tsx` — усилить восстановление при tab return: добавить 3-й fallback через `setTimeout(300ms)` после двух rAF, чтобы поймать React async ре-рендеры.

## Баг 2: Скачут буквы при вводе в поля таблицы

**Причина**: В `DiagnosticTableBlock` — `updateLocalRow` корректно использует `setLocalRows` (локальное состояние), а коммит в parent идёт через `debouncedCommit(300ms)`. Но когда parent (`KvestLessonView`) получает новые rows через `onRowsChange` → `updateState`, это обновляет `state`, что пересоздаёт `pointARows`/`pointAV2Rows` через `useMemo`, и `DiagnosticTableBlock` получает новый `rows` prop. 

В `useEffect` на строке 244-262:

```ts
useEffect(() => {
  if (rows.length > 0) {
    setLocalRows(rows);  // ← перезаписывает localRows из props!
    initDoneRef.current = true;
    return;
  }
```

Это заменяет `localRows` на props-значение при КАЖДОМ изменении `rows`, сбрасывая курсор.

**Исправление**:
В `DiagnosticTableBlock.tsx` — после инициализации (`initDoneRef.current === true`) НЕ синхронизировать `localRows` из props, если изменение было инициировано пользовательским вводом. Добавить ref-флаг `userEditingRef`, который ставится в `true` при `updateLocalRow` и сбрасывается после коммита. Если `userEditingRef.current === true`, пропускать sync из props.

## Баг 3: Неудобная навигация к клиентам при повторном просмотре видео

**Описание**: Пользователь хочет пересмотреть видео, но для этого нужно: снять галочку "выполнено" → пролистать обратно → посмотреть видео → снова пролистать до нужного клиента. Нет быстрого способа перемещаться по уже заполненным клиентам.

**Исправление**:
В `KvestLessonView.tsx` — для завершённых видео-блоков (`video_unskippable`, `video`) убрать `pointer-events-none` из `isReadOnly` обёртки. Видео должно оставаться интерактивным даже после завершения шага, чтобы пользователь мог пересматривать без сброса прогресса. Также: для `diagnostic_table` блоков, которые уже завершены, убрать `opacity-80` — это создаёт ощущение "неактивности", хотя кнопка "Редактировать" доступна.

## Файлы


| Действие | Файл                                                                 | Что                                                                    |
| -------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Edit     | `src/hooks/useLessonProgressState.tsx`                               | Skip setRecord if state_json unchanged on refetch                      |
| Edit     | `src/components/layout/ScrollToTop.tsx`                              | Add setTimeout fallback for tab-return restore                         |
| Edit     | `src/components/admin/lesson-editor/blocks/DiagnosticTableBlock.tsx` | Guard localRows sync from props during user editing                    |
| Edit     | `src/components/lesson/KvestLessonView.tsx`                          | Keep video blocks interactive when completed; remove excessive opacity |


## Что НЕ меняется

- Edge functions — без изменений
- Billing, auth, admin — без изменений
- SequentialFormBlock — уже имеет правильный паттерн (local state + commit on blur)