Да, согласен, с учетом правок:

&nbsp;

1. В PATCH-STAT-2 зафиксируй **один backend source of truth** для всех метрик:
  &nbsp;
  - cards
  - tab badges
  - tab filters
  - rendered lists
    Нельзя оставлять схему, где badge берётся из summary, а список — из локальной фильтрации по другим правилам.
  &nbsp;
2. Для Админы явно раздели две сущности:
  &nbsp;
  - member_admins
  - bot_admins_not_in_members
    И зафиксируй, где используется:
  - admins_tab_total
  - admins_in_club
  - admins_total_for_badge
    Сейчас именно это даёт рассинхрон 2 vs 4.
  &nbsp;
3. Критерии надо вынести в явный единый набор флагов на backend:
  &nbsp;
  - is_not_joined
  - is_removed_visible
  - is_admin_visible
  - is_in_club_regular
  - is_in_club_admin
    Чтобы UI не пересобирал бизнес-логику вручную.
  &nbsp;
4. not_joined обязательно считать так:
  &nbsp;
  - has_active_access = true
  - in_any = false
  - access_status != 'removed'
  - !is_admin для regular counters, если админы не должны туда попадать
    И это же правило должно использоваться и в summary, и в list, и в badge.
  &nbsp;
5. removed обязательно считать так:
  &nbsp;
  - access_status = 'removed'
  - in_any = false
  - !is_admin
    И этот же критерий должен применяться в:
  - SQL snapshot
  - summary RPC
  - tab filter
  - rendered list
  &nbsp;
6. Формат В клубе сделать не просто текстом рядом, а как явный breakdown:
  &nbsp;
  - regular
  - admins
  - total
    То есть именно в виде: 26 (+4 админа) = 30, без повторной интерпретации на клиенте.
  &nbsp;
7. В proof-пакете после execute отдельно покажи по каждому клубу:
  &nbsp;
  - admins_tab_total
  - admins_in_club
  - removed_non_admin
  - removed_admin
  - not_joined_non_admin
  - not_joined_admin
    Иначе снова нельзя будет понять, где именно расходится логика.
  &nbsp;
8. Для GC обязательно закрыть текущий баг:
  &nbsp;
  - сейчас not_joined у тебя туда попадают removed записи
    После фикса покажи 20 sample rows GC not_joined, чтобы там не было access_status='removed'.
  &nbsp;
9. Делай это **одним execute-циклом**:
  &nbsp;
  - SQL/RPC criteria
  - UI counters/filters
  - format В клубе
  - final proof
    Без промежуточного “частично исправлено”.
  &nbsp;
10. PATCH-4 по-прежнему не трогать, пока PATCH-STAT-2 не даст полный parity:

&nbsp;

&nbsp;

&nbsp;

- card value
- tab badge
- rendered list length
- SQL snapshot

&nbsp;

&nbsp;

&nbsp;

11. В следующем ответе нужен уже не новый план, а:

&nbsp;

&nbsp;

&nbsp;

- exact changed files
- exact migration filenames
- execute report
- final parity table for BkB and GC
- UI screenshots / proof по Админы, Удалённые, Не вошли, В клубе

&nbsp;

PATCH-STAT-2 принимаю как следующий обязательный цикл. PATCH-4 остаётся заблокирован.

Что уже видно по коду/данным (корень текущего рассинхрона):

1. `Админы` badge сейчас считается как `summary.in_club_admins + botAdminsNotInMembers`, а список вкладки `Админы` фильтруется по `adminsList` (все админы, не только `in_any`) → отсюда 2 vs 4.
2. `Не вошли` в SQL/RPC сейчас считается как `has_active_access=true AND in_any=false` без `access_status != 'removed'` → в GC попадают `removed` записи.
3. В previous proof для `Удалённые` были включены admin-removed, а UI их исключает (`!isAdmin`) → proof/UI разошлись.

План PATCH-STAT-2 (execute-план):

1. Зафиксировать единые правила классификации (backend + UI):
  - `not_joined`: `has_active_access=true AND in_any=false AND access_status!='removed'` (+ исключение админов из regular-счётчиков).
  - `removed`: `access_status='removed' AND in_any=false AND !is_admin`.
  - `admins_tab`: все TG-админы + bot-admins (включая отсутствующих в members-таблице).
2. Синхронно обновить backend-источники:
  - `get_club_members_enriched` (и search-RPC) — флаги по новым критериям.
  - `get_club_member_summary` — те же критерии и тот же relevant-scope.
  - Миграция одним патчем, чтобы summary/list не расходились между деплоями.
3. Привести UI к одному SoT:
  - `TelegramClubMembers.tsx`: tab badges и tab filters считать из одного набора правил/флагов.
  - `Админы` badge считать по total admins (чтобы совпадал с вкладкой).
  - Убрать смешанную логику “часть из summary, часть из локальных фильтров” для тех же метрик.
4. Формат `В клубе`:
  - Явно показывать breakdown `regular + admins = total` в UI (рядом с вкладкой/счётчиком).
5. Финальный proof-пакет (факт, не прогноз), на одном timestamp, отдельно BkB и GC:
  - `card value` / `tab badge` / `rendered list length` / `SQL snapshot`.
  - Поля: `В клубе`, `С доступом`, `Не вошли`, `Нарушители`, `Удалённые`, `Админы`.
  - Мини-sample:
    - BkB `not_joined` после фикса = 0 строк.
    - BkB `removed` после фикса = строки только по критерию `removed && !in_any && !is_admin`.
6. STOP-guard:
  - если post-check показывает расхождение любого из 4 столбцов (card/badge/list/sql) по клубу — патч не принимается и идём в точечный follow-up (в рамках PATCH-STAT-2, без запуска PATCH-4).

Файлы/зоны изменений:

- `supabase/migrations/<new_patch_stat_2>.sql` (RPC-критерии и scope).
- `src/pages/admin/TelegramClubMembers.tsx` (единый подсчёт counters + filters + формат “В клубе”).
- при необходимости типы-потребители в `src/hooks/useTelegramIntegration.tsx` (без ручного редактирования auto-generated файлов).