# да, согласен, с учетом правок:

&nbsp;

1. **create в live-token-validate лучше закрывать не “admin ИЛИ service role” в свободной форме, а только доверенным backend-caller.**
  Для MVP правильнее:
  &nbsp;
  - create разрешён **service role / internal backend flow**;
  - admin reissue из UI идёт не прямым create, а через reissue, где уже есть admin-check.
    Иначе можно случайно оставить лишний публичный контур генерации ссылок.
  &nbsp;
2. **live_link_opened не нужно писать до успешной аутентификации как user-событие.**
  Иначе actor semantics будут грязными. Лучше так:
  &nbsp;
  - до auth — только техническое обновление opened_at / last_opened_at без user-audit,
  - после успешного getUser() — писать live_link_opened с actor_type='user'.
    Если нужен след до логина, оформлять отдельно как system/anonymous technical trace, но не смешивать с user-audit.
  &nbsp;
3. **В A3 после успешной отправки нужно не только status -> sent, но и защита от повторной записи live_link_sent.**
  Добавь guard:
  &nbsp;
  - писать live_link_sent и обновлять sent_at только если ссылка ещё в created,
  - чтобы повторный retry/duplicate send не создавал ложные двойные sent-события.
  &nbsp;
4. **В mismatch нужно обновлять не только audit, но и сам link telemetry.**
  Ты это упомянул, но закрепи явно:
  &nbsp;
  - last_opened_by_user_id
  - last_opened_at
  - без смены status
    Это правильно и должно остаться в финальном патче как обязательная часть, а не побочный эффект.
  &nbsp;
5. **Для TokenizedRichInput лучше проверять не только target.closest('[data-token-picker]'), но и весь composed path, если доступен.**
  В Radix/Dialog outside click иногда target бывает не тем узлом, который ожидается. Надёжнее:
  &nbsp;
  - сначала проверить [event.target](http://event.target).closest(...),
  - если недостаточно — fallback на event.composedPath() с поиском узла с data-token-picker.
    Это повысит устойчивость фикса.
  &nbsp;
6. **В dialog.tsx не ломай глобально все Dialog’и без узкого guard.**
  Добавь правку так, чтобы она срабатывала только для token picker dropdown, а не меняла поведение любого outside click в системе. То есть строго scoped ignore только для [data-token-picker].
7. **В DoD по багу dropdown добавь не только “кликается”, но и конкретный runtime proof:**
  &nbsp;
  - можно прокрутить список мышью/трекпадом;
  - можно выбрать элемент кликом;
  - после выбора токен вставляется в editor/input;
  - Dialog при этом не закрывается преждевременно.
  &nbsp;

&nbsp;

&nbsp;

В остальном пакет правильный: сначала закрыть security-дыры (create, mismatch, sent/opened audit), потом фиксить token picker внутри Dialog.

&nbsp;

План: PATCH A (Security) + PATCH B (DoD) + Баг TokenizedRichInput в Dialog

## Диагностика

### Баг TokenizedRichInput: «мёртвый» dropdown в Dialog

**Причина**: TokenizedRichInput рендерит dropdown через `createPortal(…, document.body)`. Radix DialogContent перехватывает pointer events снаружи себя (dismiss on outside click). Поскольку dropdown находится вне DOM Dialog — клик по элементу dropdown воспринимается как «outside click», и Dialog / picker закрывается. Скролл тоже не работает, потому что Radix блокирует pointer-events на overlay.

**Решение**: Добавить `onPointerDownOutside` handler в `DialogContent` внутри `BroadcastTemplateDialog.tsx`, который проверяет, попал ли клик внутрь dropdown (по `data-token-picker` атрибуту), и если да — вызывает `event.preventDefault()`. Альтернативный вариант: добавить `data-token-picker` на dropdown div и в `dialog.tsx` глобально игнорировать такие клики.

### Security: create без auth-проверки

**Факт**: `handleCreate` вызывается без проверки caller. Endpoint доступен публично.

### Mismatch сжигает ссылку

**Факт**: При `user.id !== link.user_id` статус link переводится в `mismatch`, после чего правильный пользователь не может воспользоваться.

### Отсутствует `live_link_sent`

**Факт**: В `telegram-mass-broadcast` после успешной отправки нет audit записи `live_link_sent` с `link_id`.

### Отсутствует единообразный `live_link_opened`

**Факт**: В validate `live_link_opened` пишется только в ветке `already_used`, но не в основном flow.

---

## Фаза A — Security Hardening

### A1. `live-token-validate`: Защита `create`

**Файл**: `supabase/functions/live-token-validate/index.ts`

В `handleCreate` добавить проверку caller:

- Извлечь JWT из Authorization header
- Проверить `has_role_v2(user.id, 'admin')` — ИЛИ —
- Проверить что запрос идёт с service role key (header `Authorization: Bearer <service_role_key>`)
- Вариант: проверять что JWT принадлежит service role через decoded claims (`role === 'service_role'`)
- Если ни admin, ни service — вернуть 403

Это защитит от публичного вызова create с клиента.

### A2. Mismatch: audit-only, не сжигать ссылку

**Файл**: `supabase/functions/live-token-validate/index.ts`

В validate step 8 (user mismatch):

- НЕ менять `status` ссылки
- Обновлять только `last_opened_by_user_id` и `last_opened_at`
- Писать audit `live_link_mismatch`
- Убрать проверку `if (link.status === 'mismatch')` из step 6

### A3. Добавить `live_link_sent`

**Файл**: `supabase/functions/telegram-mass-broadcast/index.ts`

После успешной отправки сообщения с webinar invite (строка ~450, после `sent++`):

```
if (inviteLinkId) {
  await supabase.from('audit_logs').insert({
    action: 'live_link_sent',
    actor_type: 'system',
    actor_label: 'telegram-mass-broadcast',
    meta: { link_id: inviteLinkId, sent_via: 'telegram', user_id: profile.user_id }
  });
  // Update link status to 'sent'
  await supabase.from('live_access_links')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', inviteLinkId).eq('status', 'created');
}
```

### A4. Добавить `live_link_opened` в основной validate flow

**Файл**: `supabase/functions/live-token-validate/index.ts`

Сразу после step 2 (opened_at update, строка ~148), до проверок статуса:

```
await logAudit(supabase, 'live_link_opened', 'user', null, {
  link_id: link.id, result: 'pending_validation'
});
```

И после auth (step 7), обновить user_id в audit если user известен. Либо просто писать один `live_link_opened` после auth step с user_id.

### A5. Проверка raw URL в message_text

**Факт по коду**: `personalizedMessage` сохраняется в `telegram_messages.message_text`. Raw URL находится только в `keyboard` (inline button), а не в тексте сообщения. Значит raw URL в `message_text` НЕ хранится — только если текст шаблона не содержит его явно. Это корректно и нужно только подтвердить документально.

---

## Фаза B — Баг TokenizedRichInput в Dialog

### B1. Dropdown не кликается и не скроллится внутри Dialog

**Файл**: `src/components/admin/TokenizedRichInput.tsx`

На dropdown div (строка 838) добавить атрибут `data-token-picker="true"`.

**Файл**: `src/components/ui/dialog.tsx`

В `DialogContent` добавить `onPointerDownOutside`:

```tsx
onPointerDownOutside={(e) => {
  const target = e.target as HTMLElement;
  if (target?.closest?.('[data-token-picker]')) {
    e.preventDefault();
  }
  props.onPointerDownOutside?.(e);
}}
```

Это предотвратит закрытие Dialog при клике внутри token picker dropdown.

---

## Файлы


| Файл                                                  | Действие                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `supabase/functions/live-token-validate/index.ts`     | A1: auth guard на create, A2: mismatch audit-only, A4: live_link_opened |
| `supabase/functions/telegram-mass-broadcast/index.ts` | A3: live_link_sent + status update                                      |
| `src/components/admin/TokenizedRichInput.tsx`         | B1: data-token-picker атрибут                                           |
| `src/components/ui/dialog.tsx`                        | B1: onPointerDownOutside guard                                          |


## DoD

1. `create` недоступен без admin/service role JWT — 403 для обычных пользователей
2. Mismatch не убивает ссылку — правильный пользователь может воспользоваться после чужого открытия
3. После отправки webinar invite в Telegram — audit `live_link_sent` + статус link → `sent`
4. При любом открытии ссылки — audit `live_link_opened`
5. Token picker в BroadcastTemplateDialog кликается, скроллится и выбирает поля
6. Raw URL не хранится в `telegram_messages.message_text` (подтверждено по коду)