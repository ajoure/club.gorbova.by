# Telegram P4 UI — Клубы в карточке контакта (proof)

**Дата:** 2026-05-05  
**Scope:** только UI карточки контакта + 1 read-only RPC. Никаких write-действий, alert'ов, кнопок ручной проверки, изменений cron/schema.

## Что сделано

### 1. RPC `admin_get_club_memberships_all(p_profile_id uuid)` (read-only, SECURITY DEFINER, требует `entitlements.manage`)

Возвращает по каждому **активному** Telegram-клубу пользователя:
- `club_id`, `club_name`, `is_active_club`
- `in_chat`, `in_channel`
- `access_status`, `link_status`
- `invite_status`, `invite_sent_at`
- `last_telegram_check_at`, `last_verified_at`, `member_updated_at`
- `club_last_status_check_at`, `club_last_members_sync_at`

Сортировка: сперва те, где пользователь физически в чате/канале, далее по имени клуба. RLS-функция; проверка `entitlements.manage` подтверждена (read-only вызов без auth → `access denied`).

### 2. UI компонент `src/components/admin/ContactClubMembershipsList.tsx`

Подключён в `ContactDetailSheet.tsx` внутри развёрнутой Telegram-карточки, заменил одиночный «Клуб» блок (старый `clubMembership` для краткого top-бейджа сохранён без изменений).

Бейджи на каждый клуб:
- **Sync клуба** — `Полная синхронизация` / `Частичная синхронизация` / `Устаревшая синхронизация`. Tooltip: точные значения `last_status_check_at` и `last_members_sync_at`.
- **Presence** — `В чате` / `Не в чате`, `В канале` / `Не в канале`.
- **Доступ** — `Доступ активен` / `Доступ: removed/expired/...`.
- **Invite** — `Invite отправлен` / `Invite ошибка` / `Invite истёк`.
- **Свежесть проверки участника** — `Свежая проверка` (≤24ч) / `Требует проверки` / `Не проверялся`. Tooltip: точное время `last_telegram_check_at`, `last_verified_at`.

Inline-tooltip с пояснениями:
- `last_status_check_at` = последний batch/status-check клуба;
- `last_members_sync_at` = полный проход по всем участникам клуба;
- `Полная` ≤24ч full pass, `Частичная` — status-check свежий, full pass устарел, `Устаревшая` — оба >24ч.

### 3. Запрещённое — НЕ сделано

- ❌ нет кнопок grant / revoke / reinvite;
- ❌ нет ручной проверки / триггера sync;
- ❌ нет alert'ов;
- ❌ cron не менялся;
- ❌ DB schema не менялась (только новая функция).

## DoD — verify по реальным данным

### A. Пользователь с двумя клубами (`0029edda-…`)

Снимок из БД (соответствует тому, что отрисует UI):

| Клуб | in_chat | in_channel | access | invite | last_telegram_check_at | club.last_status_check_at | club.last_members_sync_at | Sync-бейдж UI |
|---|---|---|---|---|---|---|---|---|
| Бухгалтерия как бизнес | false | false | ok | — | 2026-05-05 10:32 | 2026-05-05 12:00 | **2026-05-05 12:00** | **Полная синхронизация** ✅ |
| Gorbova Club | true | true | ok | sent | 2026-05-05 12:01 | 2026-05-05 12:01 | 2026-03-13 21:09 | **Частичная синхронизация** ✅ |

UI рендер:
- «Бухгалтерия как бизнес» → зелёный `Полная синхронизация`, `Не в чате` / `Не в канале`, `Доступ активен`, `Свежая проверка` (даже если 1.5ч — попадает под 24ч).
- «Gorbova Club» → жёлтый `Частичная синхронизация`, `В чате`, `В канале`, `Доступ активен`, `Invite отправлен`, `Свежая проверка`.

### B. DoD-чек (по требованиям задачи)

| Требование | Статус |
|---|---|
| Видны все активные клубы пользователя | ✅ компонент рендерит N клубов из RPC |
| `in_chat`, `in_channel`, `invite_status`, `access_status` показаны | ✅ отдельные бейджи |
| `last_telegram_check_at` / `last_verified_at` показаны | ✅ tooltip + бейдж свежести |
| Свежесть: fresh / stale / never | ✅ ≤24ч / >24ч / NULL |
| Полная / частичная / устаревшая для клуба | ✅ по `last_members_sync_at` + `last_status_check_at` |
| Пояснение в UI для двух дат | ✅ inline tooltip (Info icon) |
| Бухгалтерия как бизнес = full synced | ✅ `last_members_sync_at = 12:00 (свежий)` → зелёный «Полная» |
| Gorbova Club = partial syncing | ✅ `members_sync_at = 13.03 (старый)`, `status_check_at = 12:01 (свежий)` → жёлтый «Частичная» |
| UI не показывает «полностью синхронизировано» для partial-клуба | ✅ Gorbova не получит зелёный бейдж, пока `last_members_sync_at` не обновится |
| Никаких write-действий | ✅ нет кнопок и мутаций |

## Замечание по «Веронике»

Пользователь не передал `profile_id` Вероники в задаче. Логика бейджа для её сценария «invite sent / not in chat»:
- если в `telegram_club_members` для Gorbova Club у неё `in_chat=false, in_channel=false, invite_status='sent'`, UI покажет: `Не в чате`, `Не в канале`, `Invite отправлен`, `Доступ активен` (или другой по факту).
- При следующем cron-tick (Gorbova partial → full pass через ~2 тика) её `last_telegram_check_at` обновится, и бейдж свежести станет «Свежая проверка».

## Последующие шаги (НЕ в этом scope)

- Алерты по клубам с `Устаревшая синхронизация` > N часов.
- Кнопка ручного re-check для одного пользователя (отдельный edge function + RPC).
- Per-club бейдж в свёрнутом header карточки (сейчас — только в раскрытом).
