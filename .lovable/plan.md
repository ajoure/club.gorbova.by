# да, согласен, с учетом правок:

&nbsp;

1. add-only: явно допиши в план, что новый tab-switch P0 добавляется к уже существующему PATCH по route-navigation и не отменяет его. Ничего из ранее утвержденного ScrollToTop / ProtectedRoute / DoD по PUSH/POP не удалять и не переписывать без отдельного mapping старый пункт -> новый пункт.
2. в ФАЗЕ 1 добавь отдельный обязательный trace для browser restore / bfcache:  

  - pageshow
  - pagehide
  - event.persisted
  - performance.getEntriesByType('navigation')  
  И явно зафиксируй, что это третий независимый сценарий, не смешивается ни с route-navigation, ни с tab-switch.
3. &nbsp;
4. в ФАЗЕ 1 добавь обязательный proof не только по useLessonProgressState, но и по реальному DOM collapse:  

  - лог document.documentElement.scrollHeight
  - лог высоты контейнера квеста
  - момент появления/скрытия loader  
  Нужно доказать, что scroll теряется именно из-за transient loading/collapse, а не из-за другого вызова scroll API.
5. &nbsp;
6. в ФАЗЕ 2 для useLessonProgressState допиши жесткое правило:  

  - при background refetch на tab return запрещено очищать уже загруженный record/state
  - запрещено показывать loading-placeholder/spinner поверх уже отрисованного квеста
  - разрешён только silent refresh поверх существующего DOM  
  Это ключевой критерий, иначе scroll снова будет падать.
7. &nbsp;
8. в KvestLessonView допиши отдельный guard:  

  - если refetch пришёл с тем же lessonId и тем же currentStepIndex, никаких setCurrentStepIndex, goToStep, scrollToBlock, scrollIntoView
  - transient null/undefined state во время refetch не должен влиять на UI state вообще
9. &nbsp;
10. P1 visibilitychange-restore оформи как страховочный слой, а не как основное исправление:  

  - сначала доказать и закрыть P0 root cause
  - только потом оставлять visibility restore как backup-guard  
  Иначе подрядчик снова может “замазать” симптом, не убрав причину.
11. &nbsp;
12. в STOP-guard добавь:  

  - запрещено закрывать PATCH только code-review выводом
  - без видео + trace + before/after proof на одном и том же маршруте PATCH не считается выполненным
13. &nbsp;
14. в DoD добавь отдельный пункт:  

  - при tab return DOM не должен схлопываться: scrollHeight и высота контента не падают до loader-state после возврата во вкладку
15. &nbsp;
16. в финальный статус добавь явную формулировку:  

  - route-navigation bug = отдельный PATCH, status “implementation present, proof missing”
  - tab-switch bug = отдельный PATCH, status “root cause unconfirmed until trace”
  - bfcache/browser restore = отдельный PATCH, status “diagnostic pending”  
  Чтобы подрядчик не попытался закрыть всё одним отчётом.
17. &nbsp;
18. допиши обязательный набор маршрутов для proof:

&nbsp;

&nbsp;

&nbsp;

- длинный квест /library/…/test-…
- переход между шагами внутри квеста
- уход на другую вкладку на 5–10 секунд
- возврат
- back/forward
- hard refresh  
Все пруфы делать на одном и том же маршруте до/после фикса.

&nbsp;

&nbsp;

Дополненный план: три отдельных бага скролла

## Статус по сценариям


| Сценарий                                | Статус PATCH                             | Статус proof                     |
| --------------------------------------- | ---------------------------------------- | -------------------------------- |
| Route navigation (PUSH/POP)             | Исправлен (ScrollToTop + ProtectedRoute) | **Не доказан** — нет видео/trace |
| **Tab switch (visibilitychange/focus)** | **НЕ ИСПРАВЛЕН**                         | Нет                              |
| Browser restore (pageshow/bfcache)      | Не исследован                            | Нет                              |


Это **три отдельных бага**. Смешивать запрещено.

---

## ADD-ONLY MAPPING


| Старый PATCH                                          | Статус                       | Где в плане                |
| ----------------------------------------------------- | ---------------------------- | -------------------------- |
| ScrollToTop: MutationObserver + sessionStorage        | Остаётся без изменений       | Покрывает route-navigation |
| ProtectedRoute: hasInitialized + React Query isBanned | Остаётся без изменений       | Покрывает route-navigation |
| **Новый PATCH: tab-switch P0**                        | Добавляется отдельным блоком | Ниже                       |


Общий DoD **расширяется**, не заменяется.

---

## ФАЗА 1: Диагностика tab-switch (обязательна до любого патча)

### Рабочая гипотеза P0 (требует event trace proof)

Цепочка по коду:

```text
1. visibilitychange → "visible"
2. Supabase JS client → TOKEN_REFRESHED
3. AuthContext (line 62-63): setUser(session?.user) — НОВЫЙ объект User
4. useLessonProgressState (line 70): fetchState зависит от [lessonId, user]
   → user — новая ссылка → useCallback пересоздаётся → useEffect (line 72-74) перезапускается
5. fetchState (line 51): setLoading(true) → DOM сжимается (контент скрыт/спиннер)
6. scroll сбрасывается на 0
7. fetchState завершается → setLoading(false) → контент возвращается
8. scroll уже потерян
```

**Доказательства из кода:**

- `AuthContext.tsx:62-63` — `setUser(session?.user)` на КАЖДЫЙ event, включая TOKEN_REFRESHED. Новый объект каждый раз.
- `useLessonProgressState.tsx:70` — `[lessonId, user]` — зависимость от **объекта**, не от `user.id`
- `useLessonProgressState.tsx:51` — `setLoading(true)` при каждом fetch — DOM коллапсирует

### Вторая гипотеза P0: авто-scroll к текущему блоку

- `KvestLessonView.tsx:81-85` — sync effect по `state?.currentStepIndex`. Если при re-fetch `state` кратковременно станет `null`, `currentStepIndex` может сброситься.
- `scrollToBlock` (line 284-291) защищён `userNavigatedRef`, но `setCurrentStepIndex` (line 83) — нет.

### Обязательный event trace (dry-run)

Единый timeline с timestamps для сценария «уход на вкладку → возврат»:


| #   | Событие                              | Что логировать                               |
| --- | ------------------------------------ | -------------------------------------------- |
| 1   | `visibilitychange`                   | `visibilityState`, `scrollY`, `scrollHeight` |
| 2   | `focus` / `blur`                     | `scrollY`                                    |
| 3   | `onAuthStateChange`                  | event type, `user.id` (изменился ли?)        |
| 4   | AuthContext render                   | `user?.id`, loading                          |
| 5   | ProtectedRoute render                | user?.id, isInitializing, isBannedLoading    |
| 6   | `useLessonProgressState.fetchState`  | вызов, `loading` transition (true→false)     |
| 7   | KvestLessonView render               | `currentStepIndex` before/after              |
| 8   | `window.scrollTo` / `scrollIntoView` | caller, target                               |
| 9   | `setCurrentStepIndex`                | new value, caller                            |


### Обязательная проверка identity churn

- Меняется ли `user.id` при TOKEN_REFRESHED? (Нет — только ссылка на объект)
- Пересоздаётся ли `fetchState` из-за object reference? (Да — `useCallback([..., user])`)
- Становится ли `state` / `loading` transient-null/true? (Да — `setLoading(true)` в line 51)

### Обязательный grep proof


| Паттерн                | Файлы с риском для tab-switch                                            |
| ---------------------- | ------------------------------------------------------------------------ |
| `window.scrollTo(`     | ScrollToTop — нет (pathname не меняется)                                 |
| `scrollIntoView(`      | KvestLessonView:289 — защищён `userNavigatedRef`                         |
| `setCurrentStepIndex`  | KvestLessonView:83 — **РИСК** при transient null                         |
| `refetchOnWindowFocus` | Глобально `false`, но `useLessonProgressState` не использует React Query |


---

## ФАЗА 2: Исправление (после подтверждения диагностики)

### P0: Устранить reset/loading/remount на tab return

**Файл: `src/hooks/useLessonProgressState.tsx**`

- Заменить зависимость `fetchState` с `[lessonId, user]` на `[lessonId, user?.id]`
- НЕ вызывать `setLoading(true)` если `record` уже существует (background refresh)
- Это минимальный фикс, не требующий миграции на React Query

**Файл: `src/components/lesson/KvestLessonView.tsx**`

- Защитить sync effect (line 81-85): если `state` стал `null` кратковременно — не обнулять `currentStepIndex`

### P1: Tab-return scroll restore guard

**Файл: `src/components/layout/ScrollToTop.tsx**`

- При `visibilitychange → hidden`: запомнить `scrollY` в переменную
- При `visibilitychange → visible`: через `requestAnimationFrame` восстановить
- Это страховка на случай, если какой-то компонент всё же дёрнет scroll

### P2: Миграция useLessonProgressState на React Query (опционально)

Только если P0 не решает проблему полностью. Не тащить как обязательную первую меру.

---

## STOP-guard

Запрещено до наличия event trace:

- Удалять старый scroll patch
- Объявлять старую причину ложной
- Переписывать весь scroll subsystem
- Только минимальный доказанный фикс по подтверждённой точке сброса

---

## DoD (расширенный, add-only)

**Из предыдущего плана (сохранено):**

- Scroll restoration работает при route POP
- PUSH сбрасывает scroll в 0
- Повторные визиты не показывают init spinner
- Первый холодный старт не сломан
- Banned redirect не сломан
- Logout/login не ломает навигацию

**Добавлено для tab-switch:**

- Event trace приложен — доказано, кто сбрасывает scroll при tab switch
- При возврате во вкладку: нет spinner
- При возврате во вкладку: нет прыжка scroll в начало
- При возврате во вкладку: нет смены текущего шага квеста
- 3-5 быстрых переключений вкладок — стабильно
- Видео до фикса + видео после фикса
- Event trace до фикса + event trace после фикса
- Конкретные маршруты тестирования перечислены
- Chrome desktop проверен
- Mobile Safari проверен (если доступен)

**Негативный сценарий (обязательный):**

1. Открыть квест, прокрутить в середину/низ
2. Уйти на другую вкладку на 5-10 секунд
3. Вернуться
4. ✅ Scroll на месте
5. ✅ Нет spinner
6. ✅ Текущий шаг квеста не изменился

---

## Proof requirements

- Видео до/после фикса
- Event trace до/после фикса
- Сравнение «воспроизводилось → не воспроизводится» на тех же шагах
- Без сравнения до/после PATCH не считается закрытым

## Финальный статус


| Что                                                    | Статус                                              |
| ------------------------------------------------------ | --------------------------------------------------- |
| Route-navigation scroll (ScrollToTop + ProtectedRoute) | Исправлено, **не доказано** (нет proof)             |
| Tab-switch scroll reset                                | **Гипотеза P0** — identity churn + setLoading(true) |
| Tab-switch auto-scroll                                 | **Гипотеза P0** — transient null в sync effect      |
| Browser restore / bfcache                              | **Не исследован**                                   |
