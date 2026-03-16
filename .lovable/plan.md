да, согласен, с учетом правок:

&nbsp;

1. В плане явно зафиксируй, что **сначала нужен dry-run proof причины**, и только после этого execute.
  Сейчас это описано смыслово, но добавь как обязательную последовательность:
  &nbsp;
  - Diagnose
  - exact mismatch proof
  - fix
  - post-execute parity proof
  &nbsp;
2. В п.1 добавь обязательную проверку **не только badges и list length**, но и:
  &nbsp;
  - counts object в TelegramClubMembers.tsx
  - summary payload, пришедший в UI
  - результат useClubAdmins() отдельно
    Иначе снова можно пропустить место, где ломается цепочка.
  &nbsp;
3. В п.2 зафиксируй жёстко:
  **один SoT для badge Админы и вкладки Админы**.
  Нельзя оставлять ситуацию, когда:
  &nbsp;
  - badge берётся из summary.admins_total
  - список вкладки строится по другому правилу
    Нужно либо привести оба к одному критерию, либо явно показать controlled split, но без расхождения чисел.
  &nbsp;
4. Отдельно добавь в план проверку на BkB:
  &nbsp;
  - admins_total
  - admins_in_club
  - admins_not_in_club
  - bot_admins_not_in_members
  - rendered admins tab rows
    С обязательной таблицей, чтобы было видно, откуда берётся итоговое число Админы.
  &nbsp;
5. В acceptance criteria добавь ещё одно условие:
  &nbsp;
  - карточка В клубе и badge Админы больше не должны восприниматься как противоречие для пользователя
    То есть должно быть явно доказано:
  - in_club_admins — это админы физически в клубе
  - admins_total — это все админы, включая вне клуба / bot admin, если они входят в модель
  &nbsp;
6. В scope укажи, что **если диагностика покажет backend mismatch**, то разрешена точечная правка backend-критерия, но только в пределах admin parity и без расширения в новый функциональный scope.
7. В финальном proof block по каждому клубу добавь отдельный блок:
  &nbsp;
  - summary.admins_total
  - useClubAdmins total
  - admins tab rendered length
  - in_club_admins
  - admins badge value
    И только если все эти значения согласованы по утверждённой модели — патч принимается.
  &nbsp;
8. В конце плана явно зафиксируй:
  &nbsp;
  - PATCH-STAT-6 не закрывается без UI screenshots для BkB и GC
  - PATCH-4 остаётся заблокирован независимо от промежуточных результатов
  &nbsp;
9. Не допускать “быстрого фикса badge”.
  Нужно именно закрыть structural mismatch, как ты и написал, а не локально подогнать отображение.
10. После внесения этих правок план можно выполнять.

&nbsp;

&nbsp;

PATCH: PATCH-STAT-6
STATUS: PLAN

Цель: восстановить единую и проверяемую parity-цепочку для BkB и GC, прежде всего починить кейс BkB, где UI сейчас противоречит сам себе: карточка «В клубе» использует `summary.in_club_admins`, а badge «Админы» показывает `counts.admins` из `summary.admins_total` (`src/pages/admin/TelegramClubMembers.tsx:245-258`, `992-1023`; `src/components/telegram/ClubQuickStats.tsx:362-385`).

Что уже установлено по коду:

1. SQL сейчас гарантирует `admins_total >= in_club_admins`, потому что `admins_total = COUNT(is_admin) + v_bot_admin_count`, а `in_club_admins` — подмножество тех же админов (`supabase/migrations/20260316090338_c3fa9f99-d0f0-4b3f-9c04-cce956327af7.sql:45-75`).
2. Значит наблюдение BkB `В клубе: 30 участн. + 1 адм.` при badge `Админы = 0` не может считаться нормой и требует точного разбора цепочки.
3. В админской странице уже есть два независимых источника admin-логики:
  - summary RPC для badge/counters (`TelegramClubMembers.tsx:245-258`)
  - `useClubAdmins()` для admin set / admin list / bot row (`useClubAdmins.ts:19-123`, `TelegramClubMembers.tsx:235-287`, `1373-1398`)
   Это главный кандидат на рассинхрон.

План исправления

1. Диагностика причины BkB-рассинхрона

- Проверить для BkB и GC одну полную цепочку:
  - SQL snapshot
  - authenticated RPC summary
  - UI badges
  - rendered list length
- Отдельно снять по BkB:
  - `in_club_total`
  - `in_club_regular`
  - `in_club_admins`
  - `admins_total`
  - `admins_not_in_club`
  - `bot_admins_not_in_members`
- Сопоставить это с:
  - длиной списка вкладки «Админы»
  - количеством human admins из `useClubAdmins`
  - количеством bot rows, добавляемых в UI
- Цель шага: доказать, где ломается цепочка — в summary payload, в отдельном `useClubAdmins`, в mapping `counts`, или в рендере вкладок.

2. Финальная унификация admin SoT в UI

- Убрать архитектурную двусмысленность: badge «Админы», вкладка «Админы» и карточка «В клубе» должны опираться на согласованную модель.
- Зафиксировать:
  - карточка «В клубе» = `in_club_total` + subtitle из `in_club_regular` и `in_club_admins`
  - badge «Админы» = `admins_total`
  - вкладка «Админы» должна рендерить состав, который объясняет `admins_total`, включая bot admin / admins_not_in_club
- Если `useClubAdmins` не совпадает по критерию с summary RPC, привести UI к одному правилу определения admin presence, не вводя club-specific веток.

3. Явно развести пользовательскую и диагностическую модель

User-facing:

- В клубе
- Админы
- С доступом
- Не вошли
- Удалённые
- Нарушители

Diagnostic/proof-only:

- `in_chat_count`
- `in_channel_count`
- `in_both_count`
- `chat_only_count`
- `channel_only_count`
- `not_joined_chat`
- `not_joined_channel`

Для BkB:

- chat-only остаётся намеренной моделью
- channel breakdown не попадает в пользовательские карточки
- отсутствие chat/channel-карточек должно быть intentional и подтверждено через `resource_mode`, а не случайным эффектом

4. Точечный scope PATCH-STAT-6

Разрешённый scope:

- только код UI/клиентской агрегации и, если потребуется для parity, согласование уже существующего admin-критерия между summary и admin list
- без PATCH-4
- без club-specific `if (clubId === ...)`
- через единый `club_id` + `resource_mode`

Вероятные зоны изменений:

- `src/pages/admin/TelegramClubMembers.tsx`
- `src/components/telegram/ClubQuickStats.tsx`
- `src/hooks/useClubAdmins.ts`
- при необходимости: только корректировка существующей admin-логики summary/list, если диагностика покажет реальный backend mismatch

5. Что должно получиться после execute

Для BkB и GC отдельно:

- exact SQL snapshot
- exact authenticated RPC summary
- exact UI badge values
- exact rendered list lengths
- parity table: SQL / RPC / Badge / List
- отдельное объяснение по BkB:
  - почему раньше badge «Админы» был 0
  - что именно исправлено
  - почему теперь `in_club_admins` и `admins_total` больше не противоречат UI

6. Acceptance criteria

PATCH принимается только если:

- BkB больше не показывает противоречие вида `+1 адм.` при `Админы = 0`
- `В клубе`, `Админы`, `Удалённые`, `Не вошли` совпадают по всей SoT-цепочке
- proof block дан отдельно для BkB и GC
- показана точка поломки старой цепочки
- подтверждено отсутствие club-specific UI branches
- PATCH-4 остаётся заблокирован

Техническая заметка
По текущему коду наиболее вероятная причина — не сама visual row «Присутствие», а разъезд между summary-based counters и отдельной admin-веткой `useClubAdmins`/admin list. В PATCH-STAT-6 нужно не просто “подправить badge”, а закрыть именно этот structural mismatch и доказать это parity-блоком.