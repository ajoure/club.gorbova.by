## да, согласен, с учетом правок:

1. В `live-resolve` не ограничивайся только `play_link`. Делай приоритет источника для live так:
  &nbsp;
  &nbsp;
  - `metadata.provider.current.embed_link` — если уже есть готовый embed URL, использовать его как SoT;
  - иначе `metadata.provider.current.play_link` → извлечь slug → собрать `https://kinescope.io/embed/{slug}`;
  - если ни `embed_link`, ни `play_link` нет — `live_pending`, без fallback на `embed/live/{kinescope_live_event_id}`.  
  Это снизит риск повторного black screen из-за разных форматов ссылок у провайдера.
2. При извлечении slug из `play_link` сделай нормализацию безопасно:
  - убрать домен,
  - убрать query/hash,
  - trim,
  - не использовать slug, если он пустой.  
  В отчете приложи raw `play_link` и итоговый `resolved_embed_url`.
3. В `AdminLiveEvents.tsx` исправь не только debug-блок, но и все места, где embed/play URL показываются или копируются из live source. Внутри карточки диагностика должна показывать тот же URL, который реально уходит в room player.
4. В proof для blank screen обязательно добавь еще один факт:
  - в network/DOM подтвердить, что iframe в комнате загружен именно с `embed/{slug}`, а не со старым `embed/live/{id}`.  
  Иначе будет неполный proof.
5. Для бага кнопки в карточке в финальном proof отдельно покажи сценарий:
  - live уже идет,
  - открыть карточку,
  - нажать обычное «Сохранить» в карточке,
  - статус и кнопка не откатываются.  
  Это нужно как доказательство, что прошлый downgrade-path реально закрыт.
6. Для навигации пока не повышай статус выше `partially fixed`, если не будет отдельного runtime-proof:
  - зайти в комнату,
  - назад,
  - снова вперед / повторно открыть,
  - без hard reload и без зависшего black screen.
7. Ничего не менять в `LiveEmbedPlayer`, если после смены URL live-видео реально появится. Лезть в player только если после правильного `embed/{slug}` экран останется черным.
8. В следующем отчете статус по багам дать так:
  - blank screen — только после UI-proof живого видео;
  - рассинхрон кнопки — только после proof без reload и без downgrade после save;
  - навигация — отдельно, не объединять с первыми двумя.

&nbsp;

После этих правок план можно исполнять.

&nbsp;

План: финальный фикс blank screen — неверный live embed URL

### Главное открытие

Из БД: `kinescope_live_event_id = 019daada-...`, но реально работающий `play_link = https://kinescope.io/0czf27DrCof4abeYASUMew` (см. `metadata.provider.current.play_link`).

Наш resolver строит URL по шаблону `https://kinescope.io/embed/live/<live_event_id>` — **этот шаблон у Kinescope не работает для live**. Правильный embed для live: `https://kinescope.io/embed/<play_link_slug>` (slug из `play_link`).

Именно поэтому:

- статус «В эфире» виден (resolver вернул `kinescope_live_embed`),
- плеер смонтирован (iframe есть в DOM, чёрный прямоугольник на скрине),
- но видео не идёт — iframe загружает несуществующий/пустой Kinescope URL.

Это полностью объясняет blank-плеер при правильном статусе. Writer-downgrade в прошлой итерации был отдельным реальным багом (он закрыт триггером и правкой формы), но **корневой причиной самого blank** оказался **неверный шаблон embed URL**.

### Что меняю (точечно, add-only)

#### 1. `supabase/functions/live-resolve/index.ts` — корректный live embed

В resolver добавить извлечение play_link slug из `metadata.provider.current.play_link` и строить embed как `https://kinescope.io/embed/<slug>`:

```ts
const playLink: string | null = meta?.provider?.current?.play_link ?? null;
const playSlug = playLink ? playLink.replace(/^https?:\/\/kinescope\.io\//, '').split(/[/?#]/)[0] : null;
```

Применить в обеих ветках live (`active_live_priority` и `live_embed_fallback`):

- если `playSlug` есть → `resolved_embed_url = https://kinescope.io/embed/${playSlug}`
- если нет → `live_pending` (controlled state, не blank).

`source_reason` дополнить: `active_live_via_play_link` / `active_live_pending_play_link`.

#### 2. `src/pages/admin/AdminLiveEvents.tsx` — диагностика в карточке

В debug-блоке (строки ~1429–1437) тоже строить embed URL из `play_link`, а не из `live_event_id`. Чтобы proof в админке совпадал с runtime resolver.

#### 3. Ничего больше не трогаю

- Не трогаю writer-guard, триггер БД, lifecycle actions, query keys, cleanup `LiveEvent.tsx`, replay/recorded flow, access-core.
- Не меняю компонент `LiveEmbedPlayer` — он корректный, проблема не в нём.

### Runtime proof, который собираю сам после деплоя

#### UI proof (browser tools)

1. `/admin/live-events` — скрин, статус «В эфире» у `testovyy-vebinar-200416`.
2. Открыть карточку — скрин, кнопка «Завершить эфир», debug-блок показывает `embed/<play_slug>`.
3. `/live/testovyy-vebinar-200416` — скрин с **реальным видео** в плеере.

#### Network proof

`browser--list_network_requests` + `get_network_request_details` по `live-resolve` → JSON с:

- `platform_status`
- `resolved_source.resolved_source_kind`
- `resolved_source.resolved_embed_url` (должен быть `embed/0czf27DrCof4abeYASUMew`)
- `resolved_source.source_reason`

#### Console proof

`browser--read_console_logs(search='[live-resolve]')` — debug-лог из комнаты в момент live.

#### SQL proof (timeline)

```sql
SELECT updated_at, platform_status, status,
       metadata->'provider'->'current'->>'stream_status' AS provider_status,
       metadata->'provider'->'current'->>'play_link' AS play_link
FROM live_events
WHERE id = '1514525a-e693-4791-93c7-8f00ff76fe40';
```

- проверка после нажатия «Сохранить» в карточке во время live: статус остаётся `live` (триггер защищает).

### Финальный отчёт — таблица


| Баг               | Root cause                                                    | Файл                                                      | Чем доказано                                                           | Статус                                                  |
| ----------------- | ------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| Blank screen      | embed URL строился из `live_event_id` вместо `play_link` slug | `live-resolve/index.ts`, `AdminLiveEvents.tsx` debug-блок | UI скрин с live-видео + network payload + console log                  | будет `fixed` после UI-proof                            |
| Рассинхрон кнопки | save затирал `platform_status`, query keys не пересекались    | `AdminLiveEvents.tsx` (прошлая итерация) + триггер БД     | UI скрин «Завершить эфир» без reload + SQL что save не понижает статус | будет `fixed` после UI-proof                            |
| Навигация         | cleanup без AbortController/clearInterval                     | `LiveEvent.tsx` (прошлая итерация)                        | console без leaked logs + ручной back/forward                          | `partially fixed` (требует ручной верификации сценария) |


### Что остаётся Сергею (минимум)

- **OBS уже стримит** на `testovyy-vebinar-200416` — этого достаточно. Если поток успеет завершиться до моего runtime-proof, попрошу 3 минуты повторного OBS.
- Audio-loop тест в комнате (чисто перцептивная проверка).

### Ограничения / правила

- Add-only. Не трогаю access-core, notifications, replay, recorded_webinar, kill-switch, proof_mode.
- Verdict `fixed` для blank screen и кнопки — только после UI-скрина живого player.
- Все 4 блока proof обязательны.