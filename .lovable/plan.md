## да, согласен, с учетом правок:

1. Не фиксируй как установленный факт формулировку «последний PATCH записал `platform_status='draft'`», пока не будет доказан **точный writer**. В отчёте и в discovery называй это так: **«подозрение на write-path downgrade статуса»**. Обязательно покажи:
  - какой именно код/edge-function/client patch пишет `platform_status/status`;
  - старое значение → новое значение;
  - timestamp;
  - actor/source;
  - связь с конкретным action (`enable_live_event`, `sync_live_event`, save form, autosync и т.д.).
2. В SQL proof добавь отдельный блок **timeline статуса** по одному эфиру:
  &nbsp;
  &nbsp;
  - `platform_status`
  - `status`
  - `updated_at`
  - `last_provider_sync_at`
  - `metadata.provider.current.stream_status`  
  Это нужно в хронологии до live / во время live / после stop, а не только один текущий snapshot.
3. В discovery по коду ищи не только `platform_status`, но и любые массовые `.update(...)`, где в payload уходит весь `formData`/`eventData`. Нужен отдельный вывод:
  - где статус пишется намеренно;
  - где он может улетать побочно вместе с остальными полями формы.  
  Это важно, потому что downgrade может идти не из `kinescope-api`, а из клиентского save/edit path.
4. Для bug №1 раздели две возможные причины и докажи, какая из них реальная:
  - resolver возвращает не тот branch;
  - renderer/player в комнате не монтирует live branch, даже если resolver вернул корректный live source.  
  В отчёте нужен явный verdict по обоим слоям отдельно.
5. Для bug №2 по кнопке в карточке проверь и зафиксируй **query keys фактически используемого хука**. В отчёте покажи:
  - каким queryKey загружается список;
  - каким queryKey загружается карточка;
  - какие invalidate/refetch вызываются после lifecycle action.  
  Без этого нельзя считать фикс доказанным.
6. Для bug №3 по навигации нужен отдельный proof, а не побочный вывод. Проверь и приложи:
  - воспроизведение шага назад/вперёд;
  - есть ли pending interval/subscription/fetch после unmount;
  - есть ли ошибки в console при уходе со страницы;
  - исчезает ли проблема после фикса cleanup.  
  Итоговый статус по навигации не связывай автоматически с blank screen, пока нет прямого proof.
7. В runtime proof по комнате добавь обязательный контроль:
  - сколько player/iframe инстансов реально в DOM;
  - какой `src` у iframe;
  - меняется ли branch после polling без reload.  
  Это критично для исключения двойного mount / неверного embed URL.
8. Если подтвердится downgrade статуса, делай минимальный фикс с защитой от понижения:
  - sync-path не должен понижать `platform_status` из `live` обратно в `draft/scheduled`, если provider уже `on-air`;
  - form save не должен отправлять `platform_status/status`, если пользователь не менял lifecycle action.  
  Это оформить как **surgical hardening**, без затрагивания replay/recorded/access/notifications.
9. В следующем отчёте хочу видеть не только proof, но и короткую таблицу:
  - root cause;
  - файл/функция;
  - что изменено;
  - чем доказано;
  - статус по багу (`fixed / partially fixed / blocked`).
10. Если live уже остановится до снятия proof, не закрывай баг по косвенным данным. Тогда делай всё автономное сейчас, а для финального UI proof запроси короткое повторное окно live на 3–5 минут и отдельно пометь это как единственный remaining blocker.

&nbsp;

Итог: план правильный, двигайся по нему. Главный акцент — сначала доказать точный writer статуса и разделить resolver/render/navigation на независимые слои, потом уже давать фикс и verdict.

&nbsp;

Цель

Закрыть требование подрядчика: дать **доказуемый runtime proof** на реальном live-эфире, а не симуляцию. По каждому из 3 багов вынести verdict в формате `fixed / partially fixed / blocked` отдельно.

## Контекст из network-логов (что уже видно)

По эфиру `1514525a-e693-4791-93c7-8f00ff76fe40` (`testovyy-vebinar-200416`):

- `kinescope_live_event_id = 019daab7-341f-7cca-6d31-bea9026d6564` ✅
- `metadata.provider.current.stream_status = "on-air"` ✅ (Kinescope реально стримит)
- `metadata.provider.current.play_link = https://kinescope.io/0czeY9ooXTeQ5JV35ctZZf` ✅
- НО: последний PATCH к `live_events` записал `platform_status = "draft"` и `status = "draft"` ❌

**Это ключевой факт**: provider синхронизируется правильно, но наш UI/sync-функция **затирает platform_status обратно в `draft**`, хотя stream идёт. Отсюда:

- `live-resolve` не видит `platform_status='live'` → не отдаёт live-branch → blank screen
- Карточка показывает «Запустить эфир» — потому что снаружи действительно уже не `live`, а `draft`

Это объясняет оба бага одной причиной: **есть write-path, который затирает `platform_status` после ручного запуска эфира**.

## Discovery (шаг 1, без правок кода)

### 1.1. SQL proof — текущее состояние БД

```sql
-- A. Текущее состояние эфира
SELECT id, slug, platform_status, status,
       kinescope_live_event_id, kinescope_video_id, replay_video_id,
       metadata->'provider'->'current'->>'stream_status' AS provider_stream_status,
       metadata->'provider'->'current'->>'play_link' AS play_link,
       last_provider_sync_at, updated_at
FROM live_events
WHERE id = '1514525a-e693-4791-93c7-8f00ff76fe40';

-- B. История изменений platform_status за последний час (через domain_events)
SELECT created_at, event_type, source, payload
FROM domain_events
WHERE entity_id = '1514525a-e693-4791-93c7-8f00ff76fe40'
  AND created_at > now() - interval '2 hours'
ORDER BY created_at DESC
LIMIT 50;

-- C. Кто и когда сетил status='draft'
SELECT *
FROM audit_logs
WHERE meta::text ILIKE '%1514525a-e693-4791-93c7-8f00ff76fe40%'
  AND created_at > now() - interval '2 hours'
ORDER BY created_at DESC LIMIT 20;
```

### 1.2. Edge logs — payload `live-resolve` и `kinescope-api`

- `supabase--edge_function_logs(function_name='live-resolve', search='1514525a')` — что resolver реально возвращает по этому slug.
- `supabase--edge_function_logs(function_name='kinescope-api', search='019daab7')` — на каком вызове записался `platform_status='draft'`.

### 1.3. Code review — кто пишет `platform_status`

Поиск всех write-path:

- `code--search_files query="platform_status\s*[:=]" include_patterns="src/**,supabase/functions/**"`
- особое внимание: `kinescope-api/sync_live_event`, `useEventProvider`, `AdminLiveEvents.tsx` PATCH.

Гипотеза: в `kinescope-api` (action `sync_live_event`) или в клиенте после sync есть PATCH, который пишет `platform_status = 'draft'` поверх `live`, потому что берёт `status` из локального formData, который не обновился.

## Шаг 2 — Live runtime proof (browser tools, на текущем live)

### 2.1. UI proof через browser tools

- `browser--navigate_to_sandbox(path='/admin/live-events')` — список со статусами.
- `browser--screenshot()` — фиксирую: какой статус на карточке у `testovyy-vebinar-200416`.
- открыть карточку, screenshot — текст кнопки.
- `browser--navigate_to_sandbox(path='/live/testovyy-vebinar-200416')` — состояние комнаты.
- `browser--screenshot()` — пустой экран / live player / scheduled / replay.

### 2.2. Network proof через browser tools

- `browser--list_network_requests` — отфильтровать `live-resolve`.
- `browser--get_network_request_details` — снять полный JSON ответа: `kind`, `play_link`, `live_id`, `video_id`, `platform_status`, `reason`.

### 2.3. Console proof

- `browser--read_console_logs(search='[live-resolve]')` — что debug-log печатает в комнате.

## Шаг 3 — Локализация root cause (без правок кода до подтверждения)

Анализирую матрицу:


| `live-resolve.kind`       | UI в комнате    | Root cause                                                       |
| ------------------------- | --------------- | ---------------------------------------------------------------- |
| `live` + есть `play_link` | blank           | баг в `LiveEvent.tsx` / player mount                             |
| `scheduled`               | blank/scheduled | resolver не получает `platform_status='live'` → write-path затёр |
| `replay`                  | replay          | приоритет неверный (но в этом эфире `kinescope_video_id=null`)   |
| `source_unavailable`      | placeholder     | resolver падает                                                  |


Если подтверждается «гипотеза затирания» (status=draft при on-air) → правка точечная: убрать запись `status`/`platform_status` из sync-path, либо защитить write от downgrade.

## Шаг 4 — Точечный фикс (только после подтверждения root cause)

Add-only, без правок access-core/notifications/replay:

- **Если затирание из `kinescope-api/sync_live_event**`: убрать `platform_status` и `status` из UPDATE — sync должен писать только `metadata.provider.*` и `last_provider_sync_at`.
- **Если затирание из клиента (`AdminLiveEvents.tsx`)**: убрать `platform_status: 'draft'` из `formData` PATCH — оно не должно быть частью полей формы.
- **Если resolver правильный, но room blank**: фикс в `LiveEvent.tsx` — явный switch по `kind === 'live'`, mount `LiveKinescopePlayer`, guard на пустой `play_link`.
- **Если карточка не рефрешится**: уже добавлен `invalidateQueries(['live-event-provider', eventId])` — проверить, что хук в карточке использует именно этот ключ, иначе поправить queryKey.

## Шаг 5 — Финальный отчёт (4 блока + matrix)

### UI proof (скрины)

- админка список → статус
- карточка → текст кнопки
- комната → реальный рендер

### Network proof

- payload `live-resolve` целиком (kind, source, embed)

### Console proof

- лог `[live-resolve]` из комнаты

### SQL proof

- `live_events` снапшот до/во время/после
- `domain_events` timeline кто и когда менял `platform_status`

### Verdict (отдельно по каждому багу)

- **Blank screen**: `fixed / partially fixed / blocked`
- **Рассинхрон кнопки**: `fixed / partially fixed / blocked`
- **Навигация**: `fixed / partially fixed / blocked`

## Ограничения / правила

- Add-only. Не трогаю: `live_event_access_rules`, notifications, replay flow, recorded_webinar, access-core (`user_has_live_event_access`), kill-switch, proof_mode.
- Не даю verdict `fixed` без UI-скрина живого player.
- Все 4 блока proof обязательны.
- Если live от Сергея уже завершён (stream_status станет `finished`) — попрошу его перезапустить OBS на 3–5 минут для финального UI-proof; всё остальное (SQL/edge/code) сделаю автономно прямо сейчас.

## Что нужно от Сергея (минимум)

- Подтвердить, что OBS прямо сейчас стримит на эфир `testovyy-vebinar-200416` (по network-логу `stream_status=on-air` — стримит). Если уже остановил — перезапустить на 3–5 минут для финального скрина комнаты.
- Всё остальное собираю сам без его участия.