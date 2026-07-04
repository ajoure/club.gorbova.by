# PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-FILTERS-AND-ACTIONS

Дата: 2026-07-04
Scope: только фильтры и hover-действия. Никакого dedupe тикетов, никакого админского создания тикета — вынесено в отдельные патчи.

## Schema (миграция)

```sql
ALTER TABLE public.instagram_dialog_preferences
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS favorited_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ig_dialog_prefs_favorite
  ON public.instagram_dialog_preferences (admin_user_id, is_favorite)
  WHERE is_favorite = true;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS is_pinned boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_support_tickets_pinned
  ON public.support_tickets (is_pinned)
  WHERE is_pinned = true;
```

RLS/GRANT не меняем — существующие политики (`admin sees/updates/inserts own ig prefs`, `Support can update all tickets`, `Users can update own tickets`) полностью покрывают новые колонки.

## Матрица capabilities (после патча)

| Source     | canPin | canFavorite | canMarkRead |
|------------|--------|-------------|-------------|
| telegram   | ✅     | ✅          | ✅          |
| instagram  | ✅     | ✅ (new)    | ✅          |
| support    | ✅ (new)| ✅ (is_starred) | ✅      |

## Backing storage per action

- Telegram pin/fav → `chat_preferences (admin_user_id, contact_user_id) upsert`
- Telegram mark-read → `mark_dialog_read_v2` RPC + self-mark coordinator + observed boundary (без изменений)
- Instagram pin/fav → `instagram_dialog_preferences (admin_user_id, instagram_account_id, thread_key) upsert` с `pinned_at`/`favorited_at`
- Instagram mark-read → edge function `instagram-admin-chat` action `mark_read` (без изменений)
- Support pin → `support_tickets.is_pinned` (+ `pinned_at`)
- Support fav → `support_tickets.is_starred` (существующее поле)
- Support mark-read → `support_tickets.has_unread_admin=false`

Support pin — глобальный флаг тикета (не per-admin), что соответствует принятой семантике «закреплённые тикеты в очереди». Sort не меняется.

## Фильтры

Чипсы вместо старого таба «Все / Неотвеченные»:

```
Все · N | Новые · N | Избранное · N | Закреплённые · N
```

Логика (`useUnifiedInbox` remains sort-source-of-truth):
- `all` — все строки
- `unread` — `isUnanswered=true` (`unread_count>0` для TG/IG, `has_unread_admin=true` для Support)
- `favorite` — `isFavorite=true`
- `pinned` — `isPinned=true`

Счётчики считаются с учётом `sourceFilter` (внешний селектор источника не отменяется).

## UX / мобильная доступность

- Иконки действий видны с opacity 60% на mobile (`opacity-60 md:opacity-0 group-hover:opacity-100`), т.е. hover-модель работает на desktop, а на touch-устройствах кнопки всегда доступны.
- `Check` (mark-read) рисуется только когда `unreadCount > 0` — после отметки исчезает и счётчик «Новые» уменьшается.
- Optimistic на всех действиях = invalidate `unified-*` query keys, ошибки → `sonner` toast; busy state блокирует повторный клик.

## Persistence

- IG pin/fav — per-admin (admin_user_id) — переживает refresh, синхронизируется через `unified-ig-prefs` invalidate.
- Support pin — глобальное поле, переживает refresh для всех операторов.
- Support fav — `is_starred`, глобальное поле, переживает refresh.
- Telegram pin/fav — per-admin через `chat_preferences`, переживает refresh.

## Затронутые файлы

- `supabase/migrations/*` — миграция (см. Schema).
- `src/hooks/useUnifiedInbox.ts`:
  - `IG_CAPS`, `SUPPORT_CAPS` — все три действия true.
  - Новый query `unified-ig-prefs` (по admin_user_id) + `igPrefMap`.
  - IG-строка теперь наследует `isPinned`/`isFavorite` из prefs (fallback на RPC-поле `d.is_pinned`).
  - Support-строка: `isPinned = !!t.is_pinned`.
- `src/components/admin/communication/unified/UnifiedInboxView.tsx`:
  - `filterKind: 'all'|'unread'|'favorite'|'pinned'` вместо `readState`.
  - Чипсы + счётчики `counts2`.
  - `togglePinFavorite` расширен ветками `instagram+is_favorite` и `support+is_pinned`.
  - Actions bar видим на mobile (opacity-60).

## Что НЕ входит в этот патч (следующие)

- PATCH-CONTACT-CENTER-SUPPORT-TICKET-DEDUPLICATION — физическое слияние open-тикетов, RPC `create_or_append_support_ticket`, изменения в `/support` и `useCreateTicket`.
- PATCH-CONTACT-CENTER-ADMIN-START-SUPPORT-TICKET — админское инициирование тикета из `ContactDetailSheet`.

## Regression checklist (для гейта под superadmin с opt-in ON)

- [ ] 4 чипсы фильтруют и показывают счётчики.
- [ ] TG: pin/fav/read работают, состояние сохраняется после refresh.
- [ ] IG: pin/fav/read работают, состояние сохраняется после refresh (per-admin).
- [ ] Support: pin/fav/read работают, состояние сохраняется после refresh.
- [ ] Иконка `Check` пропадает после mark-read, счётчик «Новые» уменьшается.
- [ ] Actions доступны на mobile viewport.
- [ ] Mono TG / IG merge / headers / short badges — без регресса.
- [ ] Typecheck clean.
