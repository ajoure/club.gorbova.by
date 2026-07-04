# PATCH-CONTACT-CENTER-ADMIN-INITIATE-SUPPORT-TICKET

Дата: 2026-07-04
Scope: только support-канал unified inbox. Telegram/Instagram/24h-окно/UX ошибки 3031 — не тронуты.

## Проблема

В карточке контакта unified inbox кнопка «Техподдержка» была задизейблена с тултипом «Канал не привязан к контакту», даже если у контакта есть привязанный `profileId`. У админа не было способа инициировать support-обращение на клиента из контакт-центра.

## Решение

1. Новая RPC `public.admin_create_or_get_support_ticket_for_profile(p_profile_id, p_subject, p_description, p_category default 'general', p_attachments default '[]')`:
   - `SECURITY DEFINER`, `search_path = public`.
   - Проверка `has_permission(auth.uid(), 'support.manage') OR has_permission(auth.uid(), 'admins.manage')`; иначе `error_code='forbidden'`.
   - Advisory lock `pg_advisory_xact_lock(hashtext('admin_init_ticket:' || profile_id))` — защита от параллельных вызовов.
   - Резолвит `profiles.user_id` (иначе `error_code='profile_has_no_user'`).
   - Dedupe: активный тикет по `profile_id`, `status IN ('open','in_progress','waiting_user')`, `merged_into_ticket_id IS NULL` → возвращает без вставки сообщения (`created_new=false`).
   - Иначе создаёт `support_tickets` (status=`open`, priority=`normal`, `has_unread_user=true`, `has_unread_admin=false`, `first_response_at=now()`) и первый `ticket_messages` (`author_type='support'`, `author_id=auth.uid()`, `is_internal=false`, `is_read=false`).
   - Валидация: subject ≥ 3, description ≥ 1, attachments = jsonb array.
   - GRANT EXECUTE TO authenticated; REVOKE FROM PUBLIC.

2. UI:
   - `ChannelPicker.tsx`: для `support` при наличии `profileId` и отсутствии support-канала кнопка становится «create»-состоянием (не disabled), иконка «+», border-dashed, тултип «Создать обращение в техподдержку». По клику — `onRequestCreateSupport(contact)`.
   - `AdminInitiateTicketDialog.tsx` — новый диалог (категория/тема/первое сообщение) → `supabase.rpc('admin_create_or_get_support_ticket_for_profile', ...)` → toast «создано / открыто существующее #N».
   - `UnifiedInboxView.tsx`:
     - Стейт `initiateFor`, диалог рендерится в обоих ветках (mobile/desktop).
     - После `onCreated` — `pendingSupportForProfileId = profileId`; отдельный `useEffect` ждёт появления support-канала в grouped row после инвалидации и переключает `activeSourceByKey[row.key] = 'support'`, синхронизирует `selectedKey`.
     - Инвалидации: `inbox-dialogs`, `unified-support-tickets`, `unified-ig-dialogs`, `admin-tickets`, `profile-channels`.

## DoD

- Админ/сотрудник с `support.manage` может инициировать обращение из карточки контакта с `profileId`. PASS.
- Активный тикет не задваивается: повторный вызов возвращает существующий, ticket_messages не добавляется. PASS (advisory lock + status-фильтр).
- Non-admin: RPC возвращает `{success:false, error_code:'forbidden'}`. PASS (проверка `has_permission` внутри SECURITY DEFINER).
- Клиент видит тикет в `/support`: PENDING — DB-level гарантировано (`user_id`, `has_unread_user=true`, полноценное `ticket_messages`-сообщение); UI клиента не менялся.
- Telegram/Instagram кнопки и остальной unified inbox не изменились: сравнение render-tree — только support-ветка получила «create»-состояние; для telegram/instagram сохраняются `disabled + Канал не привязан`.
- Типизация: RPC вызывается через `supabase.rpc('admin_create_or_get_support_ticket_for_profile' as any, ... as any)` до перегенерации `types.ts`.

## SQL для ручной проверки

```sql
-- Существующие активные тикеты у профиля
SELECT id, ticket_number, profile_id, user_id, status, has_unread_user, has_unread_admin, created_at
FROM support_tickets
WHERE profile_id = '<profile_id>'
ORDER BY created_at DESC;

-- Сообщения в тикете
SELECT author_type, author_id, message, is_internal, is_read, created_at
FROM ticket_messages
WHERE ticket_id = '<ticket_id>'
ORDER BY created_at ASC;
```

## Вне scope

- IG 24h-окно и UX ошибки `3031` (отложено отдельной задачей).
- Массовые/шаблонные обращения, категории сверх 8 существующих.
- Изменения RLS `support_tickets` / `ticket_messages`.
- Cross-channel merged history.
