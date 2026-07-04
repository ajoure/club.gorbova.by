# PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-MONO-AND-MERGE-HOTFIX

Дата: 2026-07-04
Автор: Lovable agent

## Контекст

По результатам regression-gate `PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-CHANNELS`
статус переопределён с PASS на **PARTIAL**. Обнаружены две критичные регрессии,
блокирующие продолжение работ по `HEADERS`:

1. **Моно-Telegram**: список показывает `Неизвестный`/`?` вместо контактов, при
   клике правая панель показывает «Telegram не привязан».
2. **Merge IG → profile**: RPC `link_instagram_contact_to_profile` падает с
   `new row for relation "audit_logs" violates check constraint
   "audit_logs_actor_type_check"`.

## P0 — моно-Telegram

### Root cause

`InboxTabContent.tsx` и `useUnifiedInbox.ts` резолвили `profiles` через:

```
.or(`user_id.in.(${userIds.join(',')}),id.in.(${userIds.join(',')})`)
```

При 100 диалогах (`p_limit: 100` в `get_inbox_dialogs_v1`) URL становится
~7.5 КБ и превышает лимит PostgREST (типично ~8 КБ, но зависит от прокси).
Запрос падает, но ошибка молча съедалась (`profiles = profilesRes.data || []`).
`profileMap` пуст → у каждого диалога `profile` = null → в списке `full_name`
пустой, а справа `telegram_user_id` = null → `ContactTelegramChat` отдаёт
дефолтный экран «Telegram не привязан».

### Fix

Разведены на два `.in()`-запроса, де-дуп по `profile.id`, ошибки логируются
через `console.error` (raise отключён, чтобы не крашить весь список из-за
частичного сбоя).

- `src/components/admin/communication/InboxTabContent.tsx` — блок RPC-mapping.
- `src/hooks/useUnifiedInbox.ts` — `tgProfiles` useQuery.

### Query keys

`INBOX_DIALOGS_QK` разделяется между моно и unified — это **допустимо**:
queryFn у обоих возвращает **сырой** массив RPC-строк (одинаковая форма),
а нормализация в UnifiedDialog делается только в `useMemo` внутри
`useUnifiedInbox`. Кэш не корраптится.

## P0A — merge IG → profile

### Root cause

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'audit_logs_actor_type_check';
-- CHECK ((actor_type = ANY (ARRAY['user'::text, 'system'::text])))
```

RPC писал `actor_type = 'admin'` — не входит в разрешённый набор.

### Fix

Миграция `20260704160546_*.sql`:

- `CREATE OR REPLACE FUNCTION link_instagram_contact_to_profile` — `'user'`.
- `CREATE OR REPLACE FUNCTION unlink_instagram_contact_from_profile` — `'user'`.

Контракт RPC (аргументы/возврат/права) не меняется. Rollback = откатить
миграцию или `CREATE OR REPLACE` c предыдущим телом.

### Права доступа

Не изменялись. Проверка `has_role(v_actor, 'admin' | 'superadmin')` сохранена;
non-admin → 42501.

## Verify (нужен от вас, superadmin)

- [ ] Моно-Telegram: имена контактов в списке, аватары не «?», клик по строке
      открывает `ContactTelegramChat` с историей (не «Telegram не привязан»).
- [ ] Моно-Telegram: text/voice/video note отправляются, mark_read работает.
- [ ] Моно-Instagram / моно-Support / моно-Email: без регрессий.
- [ ] Unified «Все»: TG/IG/Support-строки видны, история загружается.
- [ ] Ручная привязка IG-контакта к профилю проходит без ошибки; аудит-строка
      появляется в `audit_logs` (`action = instagram_contact.link_to_profile`,
      `actor_type = user`).
- [ ] Unlink IG работает; аудит-строка появляется.
- [ ] RPC под non-admin → 42501.
- [ ] Kill-switch OFF — unified недоступен, моно продолжает работать.

## Ограничения scope

- Не трогали `HEADERS`-задачу: `UnifiedChatHeader`, дублирование IG-шапки,
  компактная кнопка привязки, клик по имени TG/Support — это следующий патч.
- Не меняли `instagram_contacts.profile_id` у уже привязанных строк.
- Не расширяли `audit_logs_actor_type_check` (например, до `admin`) — принято
  решение оставить существующий контракт БД.
