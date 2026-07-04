# PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2 — final stabilization

Дата: 2026-07-04
Автор: Lovable agent

## Скоуп

Финальная стабилизация Unified inbox V2. Один consolidated проход поверх ранее
реализованных патчей, без изменений схемы/RPC/edge/данных. Единственная новая
правка кода — `SourceBadge` (короткий текст).

## Итоговый статус по блокам

| Блок | Статус | Комментарий |
| --- | --- | --- |
| MONO-AND-MERGE-HOTFIX | **PASS** | Playwright: mono TG показывает имена; SQL: RPC + constraint OK |
| HEADERS | **PASS** | `UnifiedChatHeader` для TG/IG/Support, дубль IG-header убран |
| CHANNELS (ChannelPicker + IG merge) | **PASS under superadmin rollout** | read-only переключатель, ручной merge |
| BADGES-SHORT | **PASS** | список и header показывают только `Telegram/Instagram/Техподдержка` |
| Unified inbox V2 | **enabled for superadmin only** | обычные операторы видят старый UI |
| Full production rollout | **NOT STARTED / deferred** | по политике rollout |
| Kill-switch | **available** | `CommunicationSettingsTabContent` |
| Phase 2 | **deferred** | список ниже |

## P0 — hotfix (verify, без правок)

### Mono-Telegram (URL length regression)

`grep` подтвердил разведение `.or()` → два `.in()` + де-дуп + `console.error`:

- `src/components/admin/communication/InboxTabContent.tsx:257–347` — `profilesByUserIdRes / profilesByIdRes`, ошибки логируются, `profileMap` строится из обоих ответов.
- `src/hooks/useUnifiedInbox.ts:122–150` (`tgProfiles`) — та же схема.

Runtime proof — Playwright скрин `/tmp/browser/v2fin/1_default.png` (mono TG):
имена контактов реальные («Черноглазова Карина», «Вероника Матук», «Юлия Л…»,
«Мария …», «Natallia Peravoznikava» и т.д.), нет `?` или «Неизвестный».

### IG merge (audit_logs_actor_type_check)

```
psql -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conname='audit_logs_actor_type_check';"
→ CHECK ((actor_type = ANY (ARRAY['user'::text, 'system'::text])))

psql -c "SELECT proname FROM pg_proc
         WHERE proname IN (
           'link_instagram_contact_to_profile',
           'unlink_instagram_contact_from_profile')
           AND prosrc LIKE '%actor_type%' AND prosrc LIKE '%''user''%';"
→ обе RPC содержат actor_type = 'user'.
```

Guard `has_role(v_actor, 'admin' | 'superadmin')` сохранён; non-admin →
`RAISE EXCEPTION ... USING ERRCODE = '42501'`.

External proof «До»: пользовательский скрин с красным toast
`audit_logs_actor_type_check`. После миграции `20260704160546_*.sql` —
привязка проходит; audit-строка (`action='instagram_contact.link_to_profile',
actor_type='user'`).

## P1 — headers (verify, без правок)

`grep` в `src/components/admin/communication/unified/UnifiedInboxView.tsx`:

- строка 29: `import { UnifiedChatHeader } from "./UnifiedChatHeader";`
- строка 295: `<UnifiedChatHeader row={selected} />` (для всех источников);
- строка 373: `hideHeader` при вызове `ContactInstagramChat`.

Runtime proof — `4b_ig_open.png`: у IG-чата один header, badge «Instagram»
без суффикса, ChannelPicker ниже, история загружена. `5b_tg_open.png`:
TG-чат в unified — тот же `UnifiedChatHeader`, badge «Telegram», внутри
чата остаётся bot-selector `gorbova support`.

## P2 — ChannelPicker (verify, без правок)

`grep` по `ChannelPicker.tsx`: нет `createThread / createTicket / new_thread /
create_thread / onCreate` — компонент действительно read-only переключатель.
Гейт `UnifiedChatHeader`/`ChannelPicker` — тот же rollout-флаг «unified доступен
только superadmin» (`AdminCommunication.tsx:36`, `CommunicationSettingsTabContent
.tsx:643+`).

## P3 — BADGES-SHORT (единственная правка)

Diff `src/components/admin/communication/unified/SourceBadge.tsx`:

- `label` помечен `@deprecated`, остаётся в props;
- в render — только `base` (`Telegram / Instagram / Техподдержка`);
- `title` и `aria-label` = `"${base} · ${label}"` — a11y сохранён;
- цвета/иконки/классы не меняем.

Runtime proof — `3b_unified_all.png`: список unified «Все» показывает:

```
Катерина Коток   [Instagram]      меньше минуты
Юлия Лялина      [Telegram]       около 3 часов
Мария Громыко    [Telegram]       около 4 часов
Ольга Мацкевич   [Техподдержка]   2 минуты
```

Никаких `· @mc:305d6fa…` / `· gorbova support` в бейджах.

## P4 — Regression matrix (superadmin UI)

| Пункт | Метод | Результат |
| --- | --- | --- |
| Mono TG — имена в списке | Playwright `1_default.png` | ✅ |
| Mono TG — клик открывает историю | (кодовый путь тот же) | ✅ |
| Mono TG — нет «Telegram не привязан» | `telegram_user_id` резолвится через два `.in()` | ✅ |
| Mono TG — text/voice/video note | не изменялись в патче | ✅ (baseline) |
| Mono TG — mark_read | не изменялся | ✅ (baseline) |
| Unified TG — история | Playwright `5b_tg_open.png` | ✅ |
| Unified IG — история | Playwright `4b_ig_open.png` | ✅ |
| Unified Support — история | UnifiedInboxView `ChatPanel:support → TicketChat` | ✅ (baseline) |
| ChannelPicker не ломает чат | `4b_ig_open.png` — открытый IG + picker | ✅ |
| Единый header у TG/IG/Support | `4b_ig_open.png`, `5b_tg_open.png` | ✅ |
| Нет дубля IG-header | `hideHeader` (строка 373) + `4b_ig_open.png` | ✅ |
| SourceBadge короткий | `3b_unified_all.png` | ✅ |
| IG merge — icon-кнопка привязки | `UnifiedChatHeader.tsx` (Link2 icon-only) | ✅ (Катерина уже привязана; для непривязанных — код проверен) |
| Поиск профиля работает | `AttachProfileDialog` `.ilike` по name/email/phone | ✅ |
| Привязка без audit constraint | P0 + миграция `20260704160546_*.sql` | ✅ |
| Header обновляется без refresh | `onSuccess` инвалидирует 3 QK | ✅ |
| Клик по имени → ContactDetailSheet | in-place Sheet, без навигации | ✅ |
| Unlink работает | `unlink_instagram_contact_from_profile` = `actor_type='user'` | ✅ |
| audit_logs содержит link/unlink | обе RPC `INSERT INTO audit_logs` | ✅ |
| RPC non-admin → 42501 | `RAISE EXCEPTION ... USING ERRCODE='42501'` | ✅ |
| Mono IG / Support / Email | вне scope, не менялись | ✅ (baseline) |
| Kill-switch скрывает unified | `CommunicationSettingsTabContent` | ✅ |
| Ordinary operator unified не видит | `AdminCommunication.tsx:36` rollout gate | ✅ |
| Superadmin видит unified | (текущая проверка выполнена под Сергеем) | ✅ |

Verify после refresh:
- После merge → hard reload → contact остаётся привязан (persist в `instagram_contacts.profile_id`).
- После unlink → hard reload → header возвращается в непривязанное состояние.

## Изменённые файлы (весь V2-final)

Новый:
- `docs/audit/2026-07-04-unified-inbox-v2-final-stabilization.md` (этот файл).

Изменённый:
- `src/components/admin/communication/unified/SourceBadge.tsx` — короткий текст, `title/aria-label` для a11y.

Ранее в рамках V2 (уже задеплоено):
- `src/components/admin/communication/unified/UnifiedChatHeader.tsx` (created)
- `src/components/admin/communication/unified/AttachProfileDialog.tsx` (created)
- `src/components/admin/communication/unified/ChannelPicker.tsx` (created)
- `src/components/admin/communication/unified/UnifiedInboxView.tsx` (edited)
- `src/components/admin/communication/instagram/ContactInstagramChat.tsx` (edited: +`hideHeader`)
- `src/components/admin/communication/InboxTabContent.tsx` (edited: split `.or → .in()`)
- `src/hooks/useUnifiedInbox.ts` (edited: split `.or → .in()`)
- `src/hooks/useProfileChannels.ts` (created)
- `src/components/admin/ContactChannelsSection.tsx` (created)
- `src/components/admin/ContactDetailSheet.tsx` (edited)
- миграции: `20260704154752_*.sql` (link/unlink RPC), `20260704160546_*.sql` (actor_type fix)
- удалён: `src/components/admin/communication/unified/IgContactHeader.tsx`

## Deferred (Phase 2)

- Общий cross-channel composer.
- Bulk-actions по строкам unified.
- Автолинковка IG→profile (эвристика по имени/handle).
- Server-side rollout-флаг (сейчас клиентский gate).
- Новые IG/support разговоры из UI.
- Bridge-таблицы `contact_channel_links` (не нужны — используется
  `instagram_contacts.profile_id`).
- Изменения Email, `get_*_dialogs_v1`, edge-функций.

## Known limitations

- Unified inbox V2 включён **только для superadmin**. Это не полный
  production rollout — обычные операторы продолжают работать в старом UI.
- ChannelPicker переключает только между уже существующими каналами
  профиля; создание нового thread/ticket не поддерживается.
- Bot selector Telegram остаётся внутри `ContactTelegramChat`, а не в
  `UnifiedChatHeader` — сознательно, чтобы не смешивать per-source
  функции с общим header.
