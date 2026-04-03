# да, согласен, с учетом правок:

&nbsp;

1. **session_missing не своди автоматически к session_expired без различения причины.**
  Это два разных состояния:
  &nbsp;
  - session_missing — proof ещё валиден, но активной viewer-session нет;
  - session_expired — session была, но истекла/стала невалидной.
    Лучше либо:
  - показать отдельное состояние “Требуется повторный вход по ссылке”,
    либо
  - хотя бы явно различать их в коде и audit, даже если UI текст пока общий.
  &nbsp;
2. **Перед удалением autoCreateSession проверь, что re-entry flow реально достижим для пользователя без тупика.**
  Если /live/:slug вернёт session_missing, пользователь должен иметь понятный путь назад:
  &nbsp;
  - либо через сохранённую token-link,
  - либо через кнопку/redirect на /live-access/:token, если token ещё доступен,
  - либо через явный текст “откройте пригласительную ссылку снова”.
    Нельзя оставлять состояние, где доступ есть, proof жив, а пользователь не понимает, как восстановить session.
  &nbsp;
3. **В handleCreate расширение revoke до consumed нужно делать только если это не ломает обычный owner re-entry.**
  Для обычного create из broadcast/send-flow это нормально, потому что создаётся новая ссылка.
  Но в плане надо явно указать:
  &nbsp;
  - это безопасно, потому что create используется для новой выдачи/переотправки,
  - текущий доступ владельца через старую ссылку после создания новой считается намеренно заменённым.
  &nbsp;
4. **handleRevoke должен отзывать не только links/proof/session, но и быть идемпотентным.**
  Если admin нажмёт revoke повторно:
  &nbsp;
  - не должно быть ошибки,
  - состояние должно остаться корректным,
  - audit не должен вводить в заблуждение.
    Это стоит явно добавить в план.
  &nbsp;
5. **В PATCH D2 для revoke/reissue нужно отдельно указать порядок операций.**
  Лучше зафиксировать последовательность:
  &nbsp;
  1. revoke active session
  2. delete proof
  3. revoke existing links
  4. create new link (для reissue)
    Либо другой выбранный порядок, но один канонический. Это важно для предсказуемости race conditions.
  &nbsp;
6. **В handleReissue audit лучше не заменять старые события новым кастомным live_link_reissue_full, а дополнять ими, если нет реальной необходимости.**
  Для консистентности лучше:
  &nbsp;
  - сохранить live_link_revoked
  - сохранить live_link_created
  - при необходимости добавить live_link_reissued как summary event
    Но не заменять базовые события одним агрегатом.
  &nbsp;
7. **После reissue старая token-link должна давать явно определённый статус.**
  Нужно прописать в DoD:
  &nbsp;
  - старая ссылка после reissue возвращает token_revoked
  - а не token_not_found, access_denied или другой размытый ответ.
  &nbsp;
8. **Для revoke тоже нужен явный user-facing результат на старой вкладке и по старой ссылке.**
  После ручного revoke:
  &nbsp;
  - heartbeat в открытой вкладке должен привести к session_revoked
  - повторное открытие старой ссылки должно давать token_revoked
  &nbsp;
9. **Добавь proof-сценарий “proof жив, session нет”.**
  Это как раз основной смысл PATCH D1. Нужно отдельно проверить:
  &nbsp;
  - valid proof
  - active session отсутствует
  - /live/:slug возвращает session_missing
  - пользователь после повторной активации снова получает доступ
  &nbsp;
10. **Если session_missing маппится на существующий UI session_expired, зафиксируй это как временный MVP-компромисс.**
  Чтобы потом не забыть, лучше прямо пометить:

&nbsp;

&nbsp;

&nbsp;

- backend distinction есть,
- frontend пока использует общий overlay,
- отдельный UX copy можно вынести в follow-up.

&nbsp;

&nbsp;

В остальном направление правильное: убрать скрытое автосоздание session из live-resolve и сделать reissue полным разрывом старой цепочки — это именно то, что сейчас нужно.

&nbsp;

План: PATCH D — Закрытие архитектурных разрывов session lifecycle

## Диагностика

### Блокер 1: `live-resolve` создаёт session без передачи `session_key` клиенту

**Факт по коду (строки 102-116 live-resolve):** `autoCreateSession()` генерирует `session_key`, вставляет в БД, но `live-resolve` response (строки 182-190) НЕ содержит `session_key`. Клиент (`LiveEvent.tsx` строка 43) берёт ключ из `sessionStorage` — его там нет для авто-созданной session. Heartbeat не запускается.

**Решение: Вариант A** — убрать `autoCreateSession` из `live-resolve`. Session создаётся ТОЛЬКО в `live-token-validate`. Если proof валиден, но session нет/expired, `live-resolve` возвращает `session_missing` → клиент показывает "Сессия истекла, обновите страницу" или автоматически повторяет активацию через token-link.

### Блокер 2: `reissue` не отзывает `consumed` ссылку

**Факт по коду (строки 78-84 handleCreate):** `handleCreate` делает revoke только для `['created', 'sent']`. При `reissue` (строка 401) вызывается `handleCreate` — старая `consumed` ссылка остаётся рабочей.

**Решение:** В `handleReissue` перед вызовом `handleCreate` явно revoke все ссылки пользователя на этот event (включая `consumed`), удалить proof, revoke active session.

---

## PATCH D1 — Убрать autoCreateSession из live-resolve

### `supabase/functions/live-resolve/index.ts`

**Удалить:** функцию `autoCreateSession` (строки 197-225) и её вызов (строки 102-116).

**Заменить** блок строк 102-116 на:

```typescript
// Check active session
const { data: activeSession } = await supabase
  .from('live_active_sessions')
  .select('id, expires_at')
  .eq('user_id', userId)
  .eq('live_event_id', event.id)
  .is('revoked_at', null)
  .maybeSingle();

if (!activeSession || new Date(activeSession.expires_at) < new Date()) {
  // Proof valid but no active session — client must re-enter via token-link
  return jsonRes({
    status: 'session_missing',
    title: event.title,
    description: event.description,
    event_status: event.status,
  }, 403);
}
```

### `src/pages/LiveEvent.tsx`

Добавить в `LiveResolveResult.status` тип `session_missing`.

В switch (строка 104) добавить:

```typescript
case "session_missing":
  setState("session_expired");
  break;
```

Это переиспользует существующий UI overlay "Сессия истекла. Обновите страницу" — при refresh пользователь может повторно пройти через `/live-access/:token`.

Добавить `PageState` значение уже есть (`session_expired`), UI overlay уже есть (строки 160+). Дополнительных UI-изменений не требуется.

---

## PATCH D2 — Исправить reissue: полный revoke цепочки

### `supabase/functions/live-token-validate/index.ts`

**handleReissue** (строки 369-412) — переписать:

После получения `user_id` и `live_event_id` (строка 397), ПЕРЕД вызовом `handleCreate`:

```typescript
const now = new Date().toISOString();

// 1. Revoke ALL links for this user+event (including consumed)
await supabase
  .from('live_access_links')
  .update({ status: 'revoked', revoked_at: now })
  .eq('user_id', user_id)
  .eq('live_event_id', live_event_id)
  .in('status', ['created', 'sent', 'consumed']);

// 2. Delete proof
await supabase
  .from('live_access_proofs')
  .delete()
  .eq('user_id', user_id)
  .eq('live_event_id', live_event_id);

// 3. Revoke active session
await supabase
  .from('live_active_sessions')
  .update({ revoked_at: now })
  .eq('user_id', user_id)
  .eq('live_event_id', live_event_id)
  .is('revoked_at', null);
```

Также в `handleCreate` (строки 78-84) расширить список отзываемых статусов до `['created', 'sent', 'consumed']` — для консистентности при любом вызове create.

**handleRevoke** (строки 334-364) — расширить аналогично:

- Revoke ссылки любого статуса кроме уже `revoked`/`expired`
- Удалить proof
- Revoke active session

---

## PATCH D3 — Аудит для полноты reissue

В `handleReissue` audit (строка 407) добавить мету:

```typescript
await logAudit(supabase, 'live_link_reissue_full', 'user', admin.id, {
  old_link_id: link_id || null,
  user_id,
  live_event_id,
  actions: ['revoke_links', 'delete_proof', 'revoke_session', 'create_new'],
});
```

---

## Файлы


| Файл                                              | Действие                                                                         |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| `supabase/functions/live-resolve/index.ts`        | Убрать autoCreateSession, вернуть session_missing                                |
| `supabase/functions/live-token-validate/index.ts` | Reissue: full revoke chain. Revoke: full revoke chain. Create: расширить статусы |
| `src/pages/LiveEvent.tsx`                         | Обработка session_missing → session_expired UI                                   |


## DoD

1. `live-resolve` НЕ создаёт session — только проверяет наличие
2. При отсутствии active session и valid proof → `session_missing` → клиент показывает "сессия истекла"
3. `reissue` отзывает consumed ссылку + удаляет proof + revoke session + создаёт новую
4. `revoke` отзывает ссылку любого активного статуса + удаляет proof + revoke session
5. Старая вкладка после reissue теряет доступ через heartbeat → `session_revoked`
6. Владелец новой ссылки проходит стандартную активацию и получает новый session_key