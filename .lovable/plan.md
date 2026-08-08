# План: релиз PR #270 (telegram-cron-sync + shared accessValidation), fail-closed

Только план. Ни одной записи, миграции, деплоя, Telegram-действия и Publish не выполнено.

## 0. Diagnose (факты на момент проверки)

- Локальный HEAD = `e79814fdb3f57cc574cb9d80964d564d7a065aeb` («Синхронизировать производные сроки Telegram-доступа (#270)») — совпадает с каноническим merged SHA. Изменённые файлы в scope: `supabase/functions/_shared/accessValidation.ts` (813 строк) и `supabase/functions/telegram-cron-sync/index.ts` (538 строк).
- Миграция не требуется: код не использует новых колонок. Все читаемые поля (`telegram_clubs.channel_grant_enabled`, `telegram_access.active_until/state_chat/state_channel`, `subscriptions_v2`, `entitlements`, `telegram_manual_access`, `access_rules`) уже существуют в production-схеме.
- Publish не требуется: изменения только в Edge Function и её shared-модуле, фронтенд не затронут.
- Конфигурация клубов: Gorbova Club (GC) `fa547c41-…` — chat+channel, `channel_grant_enabled=true`, `autokick_no_access=true`; «Бухгалтерия как бизнес» (BB) `4f8f9d8f-…` — `channel_grant_enabled=false`, `autokick_no_access=true`.

## 1. Sync exact SHA

Синхронизировать managed-состояние ровно на `e79814fdb3f57cc574cb9d80964d564d7a065aeb`. STOP при любом расхождении SHA или размера/содержимого двух файлов scope.

## 2. Deploy

Ровно одна функция: `telegram-cron-sync`. Её бандл включает `_shared/accessValidation.ts` (импорт из `../_shared/`), поэтому отдельного деплоя shared-модуля нет и быть не может. Никаких других функций, никакой миграции, никакого Publish.

## 3. Verify маркеров задеплоенного исходника

| Требование | Маркер в исходнике |
| --- | --- |
| Побеждает самое широкое активное коммерческое окно | `selectWiderCommercialAccess` (accessValidation.ts:47) применяется ко всем 4 источникам |
| NULL = безлимит | `if (current.endAt === null) return current; if (candidate.endAt === null) return candidate;` |
| Сбой чтения источников/правил = abort, а не «нет доступа» | `club_access_rules_failed`, `commercial_access_subscriptions_failed`, `commercial_access_entitlements_failed`, `commercial_access_manual_failed`, `commercial_access_billing_day_failed`, `telegram_projection_load_failed` |
| `telegram_access` пишется только из валидного коммерческого/manual источника | ветка `if (userId && hasAccess && accessResult && accessResult.endAt !== undefined)` |
| Физически присутствующие незабаненные промотируются | `shouldPromote = Boolean(inChat && !isProfileBanned)` |
| BB `channel_grant_enabled=false` → `state_channel='none'` | `nextChannelState = club.channel_id && channelGrantEnabled ? 'active' : 'none'` |
| Kick только при полном отрицательном ответе | `GUARD_SKIP` при `undefined`, `ADMIN_PROTECTED` для administrator/creator |

## 4. Dry-run (уже выполнен read-only, до любого runtime-вызова)

Порядок выборки cron: `telegram_club_members` с непустым `profile_id`, `ORDER BY last_telegram_check_at ASC NULLS FIRST, id ASC`, `LIMIT 200` (`TELEGRAM_CRON_BATCH_LIMIT` не переопределяется).

Прогноз по текущему состоянию:

| Показатель | GC | BB |
| --- | --- | --- |
| Всего связанных участников | 648 | 641 |
| С валидным коммерческим правом | 167 | 31 |
| В чате без права (кандидаты на autokick) | 2 | 1 |
| Из них admin/creator (protected) | 2 | 1 |
| **Обычных клиентов под kick** | **0** | **0** |
| Ожидаемые update проекции | 62 | 29 |
| Ожидаемые create проекции | 0 | 0 |
| Валидные без проекции и вне чата (create пропускается) | 4 | 0 |

Обычных клиентов под autokick нет ни в одном клубе. Евгения Стриевич, Анна Бруйло и Анна Главчинская под kick не попадают и не затрагиваются.

Ключевые целевые строки (GC): Марина Лойко `active_until` 2026-08-06 → 2027-05-27; Елена Филиппова `NULL` → 2027-01-05; Дарья Шикольчик 2027-05-31 без изменений. У всех троих `in_chat=true`, `in_channel=true`, статус профиля не banned → chat+channel сохраняются. В BB все трое физически отсутствуют, права нет — cron их не трогает.

STOP-условия: любой обычный клиент в списке kick, любая финансовая/деривационная неоднозначность, отличие SHA, отличие схемы/зависимостей, ошибка `*_failed` в логах.

## 5. Сколько нужно вызовов cron

`BATCH_LIMIT=200`, обработанные строки получают свежий `last_telegram_check_at` и уходят в конец очереди, поэтому каждый следующий вызов берёт следующие 200.

На момент проверки позиции в очереди GC: Лойко rn≈218 (вызов 2), Шикольчик rn≈370 (вызов 2), Филиппова rn≈406 (вызов 3). Минимум — **3 вызова**, жёсткий предел — **4**.

Важно: позиции нестабильны (между двумя чтениями они сместились из-за штатного cron), поэтому ранг обеих целевых строк пересчитывается непосредственно перед каждым вызовом; лишние вызовы не делаются, как только обе строки обработаны.

После каждого вызова обязательный read-back:
- `audit_logs`: `telegram.cron_sync.batch` (`checked`, `kicked=0`, `projection_sync_count`, `guard_skip_count`, `error_count`, `is_partial`), отсутствие `telegram.autokick.attempt` для не-admin;
- `telegram_access` по трём целевым `user_id`;
- `telegram_club_members.last_telegram_check_at` для подтверждения продвижения курсора.

STOP при `kicked > 0` для обычного клиента, при `error_count > 0`, при любом create/update проекции без валидного источника.

## 6. Финальный read-back (критерий приёмки)

- GC: Лойко `active_until = 2027-05-27`, Филиппова `active_until = 2027-01-05`, Шикольчик остаётся `2027-05-31`; у всех троих `state_chat='active'`, `state_channel='active'`.
- BB: `state_channel='none'` для всех обновлённых проекций, инвайтов в канал нет.
- Нет сообщений/инвайтов клиентам, нет изменений в `orders_v2`, `payments_v2`, `subscriptions_v2`, `entitlements`, `access_rules`, других клубах и пользователях — только штатная сверка проекций cron.
- Стриевич, Бруйло, Главчинская остаются нетронутыми и в статусе ambiguous.

Выполнение не начато — жду отдельного EXECUTE.
