# План: PR #269 — chat-only политика канала для «Бухгалтерия как бизнес»

Режим: PLAN-ONLY. Ниже — только read-only находки и план исполнения. Никаких изменений не выполнялось: миграция не применялась, функции не деплоились, Telegram-вызовов и Publish не было.

## 1. Read-only находки (текущее состояние production)

- Миграция `supabase/migrations/20260808123000_add_channel_grant_policy.sql` присутствует в рабочем дереве, содержимое соответствует ожиданиям: добавление `channel_grant_enabled boolean` + backfill `true` + `DEFAULT true` + `NOT NULL` + fail-closed `DO $$` блок с `ROW_COUNT <> 1 → RAISE EXCEPTION`.
- Колонка `public.telegram_clubs.channel_grant_enabled` в БД **отсутствует** → миграция ещё не применена.
- Цель миграции проверена: строка `id = 4f8f9d8f-07ce-4898-8012-39f1035c1456` AND `club_name = 'Бухгалтерия как бизнес'` существует ровно в **1** экземпляре → ожидаемый ROW_COUNT = 1.
- `channel_id` заполнены и должны быть сохранены: Gorbova Club `-1001791889721`, BB `-1002091043395`. Миграция их не трогает.
- Код на текущем дереве уже соответствует политике:
  - `telegram-grant-access`: `shouldGrantChannel = Boolean(club.channel_id && channelGrantEnabled)`; `state_channel = shouldGrantChannel ? 'pending' : 'none'`; в ответе `channel_skipped_by_policy`, `target = 'chat'`.
  - `telegram-reinvite-ghosts`: `requiresChannel = Boolean(club.channel_id && channelGrantEnabled)`.
  - `telegram-cron-sync`: `nextChannelState = club.channel_id && channelGrantEnabled ? 'active' : 'none'`.
  - `telegram-revoke-access`: канал по-прежнему по `club.channel_id`, без учёта флага → revoke/kick сохраняется.
- Frontend: `src/hooks/useTelegramIntegration.tsx` уже типизирует `channel_grant_enabled: boolean`, но это тип, не видимый пользователю артефакт. Пользовательского UI-изменения в scope PR не выявлено → **site Publish не требуется**.

## 2. Кандидаты BB (проверено read-only)

| Клиент | profile_id | user_id | TG | Активное право BB (до) | BB telegram_access |
|---|---|---|---|---|---|
| Анастасия Жарко | 6f388484… | 4a94ab96-4a10-48ef-9e7b-3737e9430dbc | 1187092793 | 2026-08-31 03:01:53.529Z (entitlement `buh_business` active + subscription active) | `pending / pending` |
| Екатерина Королёва | 640c34a1… | 871ac688-88c8-4739-b2eb-51779bd69fed | 463696422 | 2026-09-03 03:01:15.782Z (entitlement `buh_business` active + subscription active) | `pending / pending` |

Замечания:
- В базе есть однофамилец «Екатерина Королёва» (profile `4c11ca5f…`, user `dde2c1e1…`) — без Telegram и без прав BB, поэтому связка однозначна, а не ambiguous.
- У обоих BB-строка сейчас `state_channel = pending` — дефект проекции. После chat-only переиздачи ожидается `state_channel = none`.
- GC-доступ обоих (`fa547c41…`, active/active) должен остаться нетронутым.

## 3. План исполнения (после отдельного EXECUTE)

1. Sync ровно merged SHA `0f16206507e8baec3524a217bbdb1976b2660213`. STOP при любом расхождении.
2. Применить ровно одну managed-миграцию `20260808123000_add_channel_grant_policy.sql`. Без прочего DML.
3. Read-back схемы и конфигурации:
   - `channel_grant_enabled`: `boolean`, `NOT NULL`, `DEFAULT true`;
   - Gorbova Club `channel_grant_enabled = true`, `channel_id = -1001791889721`;
   - BB `channel_grant_enabled = false`, `channel_id = -1002091043395`.
   STOP при ROW_COUNT ≠ 1, очищенном `channel_id`, GC ≠ true, BB ≠ false.
4. Деплой ровно трёх функций с этого SHA: `telegram-grant-access`, `telegram-reinvite-ghosts`, `telegram-cron-sync`.
5. Read-back исходников/версий развёрнутых функций и подтверждение: все new/reissue пути уважают `channel_grant_enabled`, а revoke/kick/sync фактического членства канала по-прежнему опирается на сохранённый `channel_id`. STOP при неожиданном diff.
6. Publish сайта не выполняется (обоснование в §1).

## 4. Post-deploy recovery (ровно 2 клиента, батч максимум 2)

Непосредственно перед каждым вызовом — повторная валидация: оплаченная BB-линия, активная дата окончания, привязка TG, отсутствие в BB-чате.

Вызов `telegram-grant-access` (канонический), payload:

```json
{
  "user_id": "4a94ab96-4a10-48ef-9e7b-3737e9430dbc",
  "club_id": "4f8f9d8f-07ce-4898-8012-39f1035c1456",
  "is_manual": true,
  "valid_until": "2026-08-31T03:01:53.529Z",
  "source": "admin_reissue",
  "source_id": "bb-chat-only-reissue-2026-08-08:4a94ab96-4a10-48ef-9e7b-3737e9430dbc:4f8f9d8f-07ce-4898-8012-39f1035c1456",
  "admin_id": "<current admin_id>"
}
```

```json
{
  "user_id": "871ac688-88c8-4739-b2eb-51779bd69fed",
  "club_id": "4f8f9d8f-07ce-4898-8012-39f1035c1456",
  "is_manual": true,
  "valid_until": "2026-09-03T03:01:15.782Z",
  "source": "admin_reissue",
  "source_id": "bb-chat-only-reissue-2026-08-08:871ac688-88c8-4739-b2eb-51779bd69fed:4f8f9d8f-07ce-4898-8012-39f1035c1456",
  "admin_id": "<current admin_id>"
}
```

Обязательные условия ответа: `channel_skipped_by_policy = true`, `channel_invite_link = null`, ровно одна chat-инвайт-ссылка, DM отправлен, `state_channel = none`, никаких изменений GC.

Read-back после каждого вызова: `telegram_access`, grants/audit-логи, `telegram_messages`, фактическое членство. Физическое членство не заявляется до реального join.

## 5. STOP-условия

SHA mismatch; ROW_COUNT миграции ≠ 1; любой очищенный `channel_id`; GC флаг ≠ true; BB флаг ≠ false; неожиданный diff функций; любая канальная инвайт/операция для BB; изменённый или истёкший платёж; неоднозначная TG-привязка; любой прямой DML вне managed-миграции; любая запись в payment/order/deal/entitlement.

## 6. Отдельно

Стриевич Евгения остаётся **нетронутой**: конфликт между заказом со статусом `refunded` и успешными платежами по нему не разрешён владельцем. Никаких выдач, отзывов и правок по ней не планируется.
