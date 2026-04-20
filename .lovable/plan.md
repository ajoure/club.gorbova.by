## да, согласен, с учетом правок:

1. Сначала править **локально** `LiveEvent.tsx`, а `AuthContext.tsx` не трогать, если не будет доказано, что без этого баг не закрывается.  
Глобальный auth-контекст слишком широкий по blast radius. Предпочтительный порядок:
  - `sessionRef` / `accessTokenRef` внутри `LiveEvent.tsx`;
  - убрать зависимость эффекта от объекта `session` и от `startHeartbeat`;
  - silent refresh без `setState("loading")`, если уже есть валидный live-source;
  - только если этого недостаточно, отдельно и доказуемо трогать `AuthContext`.
2. В отчёте отдельно зафиксировать, **какой именно механизм вызывает перерисовку** при возврате:
  &nbsp;
  &nbsp;
  - `TOKEN_REFRESHED`,
  - `focus`,
  - `visibilitychange`,
  - reconnect realtime,
  - poll `live-resolve`.  
  Нужен не общий вывод, а точный факт из console/network.
3. Для `LiveEvent.tsx` требую жёсткое правило:
  - Loader показывать **только на самом первом cold start**, когда `data == null`;
  - при любом последующем refresh/repoll/focus/return **не размонтировать player**;
  - обновление resolver делать фоново, add-only, без сброса room UI.
4. Нужен proof не только “ушёл/вернулся”, но и **двух отдельных сценариев**:
  - вкладка в фоне 30–60 сек → возврат;
  - переход на другую страницу сайта и обратно через back/forward.  
  По обоим нужен отдельный вердикт.
5. Если live к моменту проверки уже остановится, подрядчик должен всё равно сам сделать максимум без меня:
  - проверить отсутствие full-loading/remount на replay-состоянии;
  - проверить network/console при `TOKEN_REFRESHED`;
  - подготовить весь фикс и все доказательства, кроме финального live-screen proof.
6. В следующем отчёте дать отдельной таблицей:
  - root cause,
  - что изменено,
  - какой именно proof получен,
  - статус по каждому багу: `fixed / partially fixed / blocked`.  
  Отдельно для:
  - background return reload,
  - blank screen,
  - button sync,
  - back/forward navigation.
7. Ничего не менять в `live-resolve`, `access-core`, `notifications`, `replay`, `recorded_webinar`, если в discovery не появятся новые факты. Сейчас этот follow-up должен быть максимально узким и клиентским.

&nbsp;

&nbsp;

План: устранить перезагрузку live-room при возврате на вкладку

### Корневая причина (доказана из кода + network-логов)

Эффект в `src/pages/LiveEvent.tsx` (строка 116) имеет deps `[slug, session, startHeartbeat]`. Когда вкладка уходит в background и пользователь возвращается, Supabase Auth **автоматически рефрешит JWT** (`TOKEN_REFRESHED` event). В `src/contexts/AuthContext.tsx` (строка 95) вызывается `setSession(currentSession)` с **новой ссылкой** на объект Session → effect перезапускается → срабатывает `resolve(false)` → `**setState("loading")` (строка 131) полностью размонтирует комнату** (плеер, чат, CTA, вкладки) → новая загрузка с нуля.

Дополнительно: `startHeartbeat` через `useCallback` зависит от `session` → тоже пересоздаётся при рефреше токена → дублирующий триггер.

### Что меняю (add-only, минимально)

#### 1. `src/pages/LiveEvent.tsx` — стабилизация effect deps + защита от full-loading

**Изменение А.** Использовать `session?.access_token` (примитив) вместо `session` (объект-ссылка) в deps. При TOKEN_REFRESHED новый токен будет использован для следующего запроса, но effect не перезапустится сам — он стабилен по slug.

```ts
// было:
}, [slug, session, startHeartbeat]);

// станет:
const accessToken = session?.access_token;
}, [slug, accessToken]);  // startHeartbeat выносим из deps
```

Аналогично для `startHeartbeat` — убрать `session` из его deps, читать актуальный token через `ref`.

**Изменение B.** Защита от full-remount: если уже есть валидный `data` с активным live-источником — **не показывать Loader**. Добавить условие:

```ts
if (state === "loading" && data?.resolved_source?.resolved_source_kind === "kinescope_live_embed") {
  // тихо обновляем в фоне, плеер остаётся смонтированным
  // не возвращаем Loader, продолжаем рендерить текущее состояние
}
```

Конкретнее: ввести `isInitialLoad = state === "loading" && !data`. Loader показывать только при `isInitialLoad`. Все последующие `setState("loading")` из `resolve(false)` — заменить на silent re-resolve без сброса state, если уже `data` валидна.

**Изменение C.** Использовать `sessionRef` (через `useRef`) для актуального токена внутри `resolve`/`ping`, чтобы effect не зависел от меняющейся ссылки `session`.

#### 2. `src/contexts/AuthContext.tsx` — guard от лишних setSession при TOKEN_REFRESHED

Add-only: если `currentSession?.access_token === session?.access_token` — не вызывать `setSession` (избежать создания новой ссылки на тот же логический session). Это снижает blast-radius для всех экранов, не только live-room.

```ts
setSession(prev => {
  if (prev?.access_token === currentSession?.access_token &&
      prev?.refresh_token === currentSession?.refresh_token) {
    return prev; // та же ссылка → React не триггерит ре-рендер
  }
  return currentSession;
});
```

Это **не ломает** auth-flow: при реальном изменении токена ссылка обновится; при рефреше с тем же токеном (бывает) — ничего лишнего.

#### 3. Ничего больше не трогаю

- Не трогаю `LiveEmbedPlayer`, `LiveEventComments`, `useVisibilityPolling`, `live-resolve` edge function.
- Не трогаю access-core, notifications, replay, recorded_webinar, kill-switch, proof_mode.
- Не меняю поведение для других багов (button sync, navigation) — они отдельной итерации.

### Runtime proof, который соберу сам после деплоя

#### UI proof

1. `/live/testovyy-vebinar-200416` — скрин с live-видео.
2. Уйти на другую вкладку (через preview можно эмулировать через `document.visibilityState='hidden'` в DevTools или просто открыть другую страницу sandbox в новой вкладке).
3. Через 60 секунд вернуться — скрин: видео продолжается, чат не перезагружен, нет Loader2.

#### Network proof

- `browser--list_network_requests` до/после фокуса. Должно: НЕ появляться лишних `live-resolve` сразу при возврате (только плановый poll каждые 12s).
- При TOKEN_REFRESHED не должно быть всплеска запросов с `loading` сбросом.

#### Console proof

- `[live-resolve]` debug-логи: между уходом и возвратом интервал = 12s × N (количество прошедших циклов), без всплеска.
- `[AuthContext] onAuthStateChange: event=TOKEN_REFRESHED` — присутствует, но не вызывает повторный mount LiveEvent.

#### SQL proof

Не требуется — баг чисто клиентский (state management).

### Финальный отчёт — таблица


| Баг                      | Root cause                                                                      | Файл                               | Чем доказано                                                                                         | Статус                                                        |
| ------------------------ | ------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Background return reload | session-ref change при TOKEN_REFRESHED + setState("loading") размонтирует плеер | `LiveEvent.tsx`, `AuthContext.tsx` | UI скрин «вкладка→назад» с тем же видео + network без всплеска + console TOKEN_REFRESHED без remount | будет `fixed` после UI-proof                                  |
| Blank screen             | embed URL (прошлая итерация)                                                    | —                                  | —                                                                                                    | `fixed`                                                       |
| Button desync            | save-downgrade (прошлая итерация)                                               | —                                  | —                                                                                                    | `partially fixed` (нужен runtime UI-proof save во время live) |
| Navigation back/forward  | cleanup (прошлая итерация)                                                      | —                                  | —                                                                                                    | `partially fixed` (нужен runtime UI-proof)                    |


### Ограничения / правила

- Add-only.
- Не давать `fixed` без UI-proof background→return сценария.
- Не размонтировать плеер при тихом обновлении.
- Если после фикса видео всё равно перезагружается → искать причину в Realtime/Kinescope, а не в state.

### Что нужно от Сергея

- Если live ещё активен — оставить OBS на 3–5 минут для финального UI-proof background→return.
- Если поток уже остановлен — короткое окно 3 минуты на повторный live для финального скрина.
- Всё остальное (код, network, console) собираю сам.