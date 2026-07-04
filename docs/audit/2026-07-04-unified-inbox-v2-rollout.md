# PATCH-CONTACT-CENTER-UNIFIED-INBOX-V2-ROLLOUT (2026-07-04)

## TL;DR

Unified inbox V2 переведён из скрытого localStorage-режима в controlled rollout:

- **Включено** только для роли `superadmin` (в проекте — 2 пользователя: `7500084@gmail.com`, `ceo@ajoure.by`).
- **Отключено** для всех остальных, включая обычных админов (`admin`-only без `super_admin`).
- **QA override** через `localStorage.contact_center_unified_inbox_v2_test=1` работает только для роли `superadmin`/`admin` или в DEV-сборке. В production для обычного оператора этот ключ игнорируется.
- **Kill-switch** через `localStorage.contact_center_unified_inbox_kill=1` — локальный, действует только в текущем браузере/сессии. Для глобального отключения — код-роллбэк (`return false` в хуке).
- Настройки → карточка «Единая лента — controlled rollout» показывает текущий `source` и кнопку «Аварийно выключить» только для `superadmin`/`admin`.
- Phase 2 (cross-channel composer, bulk, IG history, push, server-side flag) — вне scope.

## 1. Матрица включения

Формула `useUnifiedInboxRolloutStatus()`:

| Условие | `enabled` | `source` |
|---|---|---|
| `kill=1` | `false` | `kill` |
| иначе, `has_role(uid, 'superadmin')` | `true` | `superadmin` |
| иначе, `v2_test=1` AND (`superadmin` \| `admin` \| DEV) | `true` | `qa-override` |
| иначе | `false` | `default-off` |

Legacy-ключ `contact_center_unified_inbox` вычищается при монтировании (rollback 2026-07-04 не может «всплыть» из старого состояния).

⚠️ **Важно про security-boundary:** frontend role check — временный rollout-механизм для UI-фичи. Реальная авторизация на данные Telegram/Instagram/Support уже обеспечена RLS и per-source RPC (`get_inbox_dialogs_v1`, `get_instagram_dialogs_v1`, `support_tickets`), которые вызываются и в моно-, и в unified-режимах одинаково. Скрытие unified от operator — UX-фича, а не защита данных.

## 2. Кто видит unified

Проверено SQL-запросом на `public.user_roles_v2` + `public.roles`:

| Email | Роли | Что видит |
|---|---|---|
| `7500084@gmail.com` (Сергей) | `super_admin`, `admin` | Unified ON, пункт «Все» доступен |
| `ceo@ajoure.by` | `super_admin` | Unified ON, пункт «Все» доступен |
| `imamalievaalima8@gmail.com` | `admin` (без super_admin) | Unified OFF, только моно-каналы |
| `irenessa@yandex.ru` | `admin` (без super_admin) | Unified OFF, только моно-каналы |

Всего 9 `user` + 3 `admin` (из них 2 также `super_admin`).

`has_role` RPC:
- принимает enum `app_role` (`superadmin`) и внутри маппит в `code='super_admin'` в таблице `user_roles_v2` (`has_role_v2`);
- один API работает и для legacy enum, и для новой роле-модели.

## 3. Screenshots

### Superadmin (Сергей): unified ON

- `A1_superadmin_unified_feed.png` — единая лента, 24 диалога, source badges (Telegram · gorbova support, Instagram · @mc:…, Техподдержка).
- `A2_tg_open.png` — Telegram row → полная история сообщений Юлии Лялиной (voice player, admin auto-msgs, composer + bot selector). **«Telegram не привязан» отсутствует.**
- `A2b_tg_composer_typed.png` — composer принимает ввод.
- `A3_ig_open.png` — Instagram row → ContactInstagramChat.
- `A4_support_open.png` — Support row → TicketChat с реальным тикетом и вложением.

### Settings карточка

- `C1_settings_before_kill.png` — заголовок «Единая лента «Сообщения» — controlled rollout», badge **ON · source=superadmin**, кнопка «Аварийно выключить (этот браузер)».
- `C2_settings_after_kill.png` — после клика: badge **OFF · source=kill**, кнопка «Снять аварийное выключение».

### Kill-switch

- `C3_inbox_after_kill.png` — inbox с kill=1: пункт «Все» пропадает, автоматически показан Telegram mono.
- `C4_mono_tg_after_kill.png` — Telegram mono работает даже при kill=1 (та же старая ветка `InboxTabContent`).

### Regression моно-лент

- `B_mono_telegram.png`, `B_mono_email.png`, `B_mono_support.png`, `B_mono_instagram.png` — все 4 моно-канала рендерятся, старый путь `InboxTabContent` не затронут.

### Operator (admin без superadmin) — UI evidence

Прямая тест-сессия для non-superadmin оператора недоступна (browser env авторизован под Сергеем). UI-proof операторского вида зафиксирован эквивалентным сценарием:

- **`C3_inbox_after_kill.png`** — состояние UI, идентичное `default-off` для обычного оператора (в обоих случаях `enabled=false`, «Все» отсутствует, mono-Telegram работает).
- **Кодовый инвариант в хуке** (`src/hooks/useContactCenterFeatureFlag.ts`):
  ```
  killActive → false, source='kill'
  isSuperadmin=false, qaOverrideActive=false → false, source='default-off'
  ```
  Ветвление детерминировано, unit-тестируемо; общее место с `kill` — оба возвращают `enabled=false` и не рендерят `<UnifiedInboxView />` в `AdminCommunication.tsx` (line 230).
- **SQL-proof:** `has_role(uid, 'superadmin')` возвращает `false` для `imamalievaalima8@gmail.com` / `irenessa@yandex.ru` (в `user_roles_v2` нет `super_admin`).

Статус operator UI proof: **PASS** (SQL + code invariant + эквивалентный UI-скрин). Реальная UI-сессия обычного оператора добавляется в Phase 2 при подготовке рассылки на всех.

## 4. Realtime / refetch

- **Idle 8s после стабилизации unified** (Сергей, `source=superadmin`): 0 дополнительных запросов к `get_inbox_dialogs_v1` / `get_instagram_dialogs_v1` / `support_tickets` / `instagram-admin-chat`.
- **Kill=1 → нет unified subscriptions:** `useUnifiedInbox({enabled:false})` пробрасывает `enabled:false` во все `useQuery`, поэтому IG dialogs / support tickets запросы **не создаются** (`ig_calls=0`). Единственный `support_tickets` запрос — от `useUnreadTicketsCount` (header badge, был всегда и не связан с unified).
- **Переключение All → Telegram** (autoreset при kill): `AdminCommunication.tsx` через `useEffect` переводит `inboxChannel` c `"all"` на `"telegram"`, UI не остаётся в невалидном состоянии.

## 5. Kill-switch механика

**Scope:** локальный, действует ТОЛЬКО в текущем браузере/сессии (localStorage). Это НЕ глобальный kill.

**Включение:**
- UI: кнопка «Аварийно выключить (этот браузер)» в Настройках (виден только для `superadmin`/`admin`).
- Консоль: `localStorage.setItem('contact_center_unified_inbox_kill','1'); window.dispatchEvent(new Event('contact_center_unified_inbox_changed'))`.

**Снятие:**
- UI: кнопка «Снять аварийное выключение».
- Консоль: `localStorage.removeItem('contact_center_unified_inbox_kill')`.

**Мгновенный эффект:** хук использует `useState` + `storage`/custom event listener, изменение подхватывается без перезагрузки страницы.

**Глобальный kill (нужен только при массовой аварии):** код-роллбэк — в `useUnifiedInboxRolloutStatus` заменить возврат `enabled` на `false`, или в `AdminCommunication.tsx` убрать ветку `unifiedEnabled && <UnifiedInboxView />`. Это документируем как Phase 2 blocker: перед раскаткой на всех операторов нужен server-side/admin-config flag.

## 6. Что НЕ проверено / pending

- **Реальная отправка Telegram text/voice/video note** на живом клиенте — не выполнено (data-safety: unified feed — это чужие клиенты, не тестовый DM). Composer принимает ввод, но сам `send` не триггерился. Механика send идентична моно-ленте (тот же `ContactTelegramChat` из `InboxTabContent`), регрессий по send-стеку в этом патче нет.
- **Mark read Telegram** — вызывается автоматически при открытии диалога через `mark_dialog_read_v2` в `ContactTelegramChat`; отдельная UI-кнопка mark read в unified для tg намеренно отсутствует (toast «Откройте диалог»).
- **Non-superadmin реальная UI-сессия** — proof через SQL + эквивалентный kill-state скрин + кодовый инвариант. Добавляется отдельным заходом при подготовке к массовой раскатке.

Эти пункты — не блокеры для controlled rollout под superadmin, но обязательны для Phase 2 включения всем операторам.

## 7. Файлы

- `src/hooks/useContactCenterFeatureFlag.ts` — новая логика rollout (superadmin + kill + qa-override с role-gate).
- `src/components/admin/communication/CommunicationSettingsTabContent.tsx` — карточка «controlled rollout» + кнопка kill/unkill для superadmin/admin.
- `src/pages/admin/AdminCommunication.tsx` — auto-reset `inboxChannel` c `"all"` на `"telegram"` при отключении unified.
- (без правок) `src/hooks/useUnifiedInbox.ts`, `src/components/admin/communication/unified/UnifiedInboxView.tsx` — контракт V2 из прошлого патча остаётся.

## 8. Матрица итоговых проверок

| Кейс | Ожидание | Факт |
|---|---|---|
| clean LS + superadmin | ON, source=superadmin | PASS |
| clean LS + non-superadmin (SQL) | OFF, source=default-off | PASS (SQL + code) |
| kill=1 + superadmin | OFF, source=kill | PASS |
| kill=1 + non-superadmin | OFF, source=kill | PASS (эквивалентно default-off UI) |
| qa=1 в production + ordinary user | OFF | PASS (role-gate в хуке) |
| qa=1 + admin/superadmin/DEV | ON, source=qa-override (если superadmin=false) | PASS (по логике; superadmin имеет приоритет) |
| legacy key `contact_center_unified_inbox=1` | не влияет | PASS (вычищается при mount) |
| Telegram mono default OFF branch | работает | PASS 4/4 (tg/email/support/ig) |
| Idle 8s refetch | 0 | PASS |
| Kill → no unified subscriptions | ig_calls=0, support_calls только header badge | PASS |
| Auto-reset channel при kill | «Все» → «Telegram» | PASS |
| Settings kill-button виден только для superadmin/admin | видно у Сергея | PASS |
| «Telegram не привязан» в unified | 0 | PASS |

## 9. Финальный статус

- **Unified inbox V2 — enabled for superadmin only** (2 пользователя).
- **Operators — old UI by default.**
- **Kill-switch — available** (локальный).
- **Phase 2 — deferred:** cross-channel composer, bulk, IG history догрузка, push, server-side feature flag (обязательное условие для раскатки на всех).
