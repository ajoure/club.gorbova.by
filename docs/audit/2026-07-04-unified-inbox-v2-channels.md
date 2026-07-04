# PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-CHANNELS

Дата: 2026-07-04
Scope: 3 последовательных шага (P1 → P2 → P3), без bridge-таблицы, без общего composer,
без создания новых IG/support разговоров. Всё под rollout-флагом `useUnifiedInboxFlag`
(superadmin only + kill-switch), унаследованным от предыдущего патча V2-ROLLOUT.

## Ограничения (по согласованию)

- Bridge-таблицу `contact_channel_links` **НЕ создавали**. Канон — `instagram_contacts.profile_id`
  (см. discovery: `docs/audit/2026-07-04-unified-inbox-v2-channels-discovery.md`).
- ChannelPicker — только переключатель уже существующих каналов; создание тикетов/IG-thread'ов
  и cross-channel composer запрещены.
- RPC — только IG (`link/unlink_instagram_contact_to_profile`). Универсальный
  `link_contact_channel` не заводили: канон существует только для IG.
- Bot-selector Telegram живёт внутри `ContactTelegramChat` — не дублировали.

## P1 — ChannelPicker V1 (read-only)

**Файлы:**
- `src/hooks/useUnifiedInbox.ts` — в `UnifiedDialog.meta` добавлены `profileId`, `instagramContactId`,
  `instagramUserId`. Для IG-строк резолвим `profile_id` и `contact.id` через новый запрос
  `instagram_contacts` по видимым account_ids (canonical над `d.profile_id` из RPC).
- `src/hooks/useProfileChannels.ts` (новый) — параллельно тянет:
  `profiles.telegram_user_id`, `instagram_contacts WHERE profile_id=?`,
  `support_tickets WHERE profile_id=? AND status NOT IN (closed,resolved)`.
- `src/components/admin/communication/unified/ChannelPicker.tsx` (новый) — 3 кнопки
  Telegram/Instagram/Техподдержка над `ChatPanel`. `disabled` с tooltip'ом, когда:
  канал не привязан к профилю / нет активной строки в текущей unified ленте.
  Клик = `setSelectedKey(targetKey)` — переключение между уже отфильтрованными строками.
- `src/components/admin/communication/unified/UnifiedInboxView.tsx` — вставили
  `<ChannelPicker …/>` над `<ChatPanel …/>` в правой панели.

**Что запрещено внутри ChannelPicker:**
- новый тикет; новый IG-thread; выбор конкретного Telegram-бота; отправка через канал,
  где нет существующей связки. Всё выше — либо read-only, либо просто switch между
  уже сформированными `UnifiedDialog`.

## P2 — RPC + ручной merge IG→profile

**Миграция** (single non-schema-table migration, только функции):

```sql
CREATE OR REPLACE FUNCTION public.link_instagram_contact_to_profile(
  p_instagram_contact_id uuid,
  p_profile_id uuid,
  p_overwrite boolean DEFAULT false
) RETURNS jsonb …
-- validate auth.uid()
-- validate has_role(_, 'admin'::app_role) OR has_role(_, 'superadmin'::app_role)
-- validate both entities exist
-- if instagram_contacts.profile_id IS NOT NULL AND != new AND NOT p_overwrite → RAISE 23505
-- UPDATE instagram_contacts SET profile_id = p_profile_id
-- INSERT INTO audit_logs (action='instagram_contact.link_to_profile', meta={profile_id, previous_profile_id, overwrite, username, account_id})

CREATE OR REPLACE FUNCTION public.unlink_instagram_contact_from_profile(
  p_instagram_contact_id uuid
) RETURNS jsonb …
-- same role/auth check
-- UPDATE profile_id = NULL
-- audit action='instagram_contact.unlink_from_profile'

GRANT EXECUTE … TO authenticated;
REVOKE ALL … FROM anon, public;
```

Роль-проверка внутри функции (SECURITY DEFINER + `has_role(_, 'admin'|'superadmin'::app_role)`)
покрывает и всех прочих authenticated: `RAISE forbidden: admin or superadmin required`.

**UI:** `src/components/admin/ContactChannelsSection.tsx` (новый), встроен в profile-tab
`ContactDetailSheet.tsx:2011`. Секция «Каналы связи» read-only-safe:

- падение любого запроса **не ломает** открытие карточки (isolated Card с локальным
  isLoading/error);
- Telegram — read-only badge + username/ID;
- Instagram — список привязанных `instagram_contacts` с кнопкой «Отвязать»
  (AlertDialog confirm → RPC `unlink_instagram_contact_from_profile`);
  кнопка «Привязать IG» открывает `AttachInstagramDialog` — поиск по
  `instagram_username / full_name / instagram_user_id` с явным overwrite-confirm,
  когда контакт уже принадлежит другому профилю;
- Support — read-only список открытых тикетов (макс 5).

**Audit trail:** каждый link/unlink пишется в `public.audit_logs`
(actor_user_id, action, entity_type='instagram_contact', entity_id, meta={profile_id,
previous_profile_id, overwrite, username, account_id}).

## P3 — Кликабельное имя IG-строки → ContactDetailSheet

**Файлы:**
- `src/components/admin/communication/unified/IgContactHeader.tsx` (новый).
- `src/components/admin/communication/unified/UnifiedInboxView.tsx` — вставлен
  `{selected.source === "instagram" && <IgContactHeader row={selected} />}` над
  `<ChannelPicker>`.

Поведение:
- Если `row.meta.profileId` != null → клик по аватару/имени открывает существующий
  `ContactDetailSheet` (fetch `profiles.*` по id и передача в тот же компонент, что
  используется из `AdminContacts.tsx:1758`). Никакого нового sheet-компонента не заводили.
- Если `profileId` == null → tooltip «Не привязан к профилю» + кнопка
  «Привязать к профилю…», открывающая `AttachProfileDialog` — поиск `profiles` по
  `full_name / email / phone` (мин 2 символа), выбор → confirm → RPC
  `link_instagram_contact_to_profile(overwrite=false)`. Overwrite здесь невозможен
  по определению (контакт свободен).

`stopPropagation` в header'е не нужен: он живёт отдельным элементом над ChatPanel,
не внутри строки диалога. Клик по строке ленты по-прежнему выбирает диалог, как раньше.

## Что осталось нетронутым

- feature-flag/kill-switch (`useUnifiedInboxFlag`, `unified_inbox_kill_switch`);
- моно-Telegram / моно-Instagram / моно-Support UI;
- RPC `get_inbox_dialogs_v1`, `get_instagram_dialogs_v1`, edge `instagram-admin-chat`;
- `mark_read` для IG — по-прежнему через `thread_key`;
- `profiles.instagram_url` (свободный текст) — не используется, не переписывается;
- схема `instagram_contacts` кроме `profile_id` update внутри RPC.

## DoD / Regression-gate (нужно вручную под superadmin)

- [ ] unified Telegram — история/отправка/mark_read как раньше;
- [ ] unified Instagram — история грузится, mark_read работает, ChannelPicker показывает
      корректный статус каналов;
- [ ] unified Support — history/новое сообщение работают;
- [ ] mono Telegram (`/admin/communication` без unified) — регрессий нет;
- [ ] mono Instagram — регрессий нет;
- [ ] mono Support — регрессий нет;
- [ ] mono Email — регрессий нет;
- [ ] Kill-switch (`unified_inbox_kill_switch=true`) → unified скрывается, моно остаётся;
- [ ] Ordinary operator (не superadmin) → unified закрыт по flag;
- [ ] Клик по имени в IG-строке с `profile_id` → открывается ContactDetailSheet;
- [ ] Клик по имени в IG-строке без `profile_id` → tooltip + кнопка «Привязать»;
- [ ] Ручной merge (dialog) → RPC succeeds, audit_logs получает запись;
- [ ] Unlink из ContactDetailSheet → RPC succeeds, audit_logs получает запись;
- [ ] RPC под не-admin ролью → 42501 forbidden.

## Audit trail

Все link/unlink пишутся в `public.audit_logs`:

```sql
SELECT actor_user_id, action, entity_id, meta, created_at
FROM public.audit_logs
WHERE action LIKE 'instagram_contact.%'
ORDER BY created_at DESC LIMIT 20;
```

## Rollback

- UI: revert 4 файлов (`useUnifiedInbox.ts`, `UnifiedInboxView.tsx`, `ContactDetailSheet.tsx` +
  удалить 4 новых: `ChannelPicker.tsx`, `IgContactHeader.tsx`, `ContactChannelsSection.tsx`,
  `useProfileChannels.ts`).
- DB: `DROP FUNCTION public.link_instagram_contact_to_profile(uuid, uuid, boolean);`
  `DROP FUNCTION public.unlink_instagram_contact_from_profile(uuid);`
- Данные: `UPDATE public.instagram_contacts SET profile_id = NULL WHERE id IN (…)` по
  audit_logs — обратимо.

## Что вне скоупа (Phase 2)

- Общий cross-channel composer;
- Bulk-actions;
- Автоматическая линковка IG→profile по email/phone;
- Универсальный `contact_channel_links` (заведём, только если появятся ещё каналы без
  собственной canonical FK);
- Push/sound для новых IG каналов;
- Клик по имени в TG/Support-строке (сейчас P3 покрывает только IG, где связь новая).
