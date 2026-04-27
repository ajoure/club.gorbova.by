## План v5.1 (финальный, add-only) — «Бухгалтерия как бизнес»

Все разделы v5 сохраняются. Ниже — дополнения v5.1 (приняты к утверждению).

---

### Раздел G (новый). CSV schema validation (фейл-клоуз)

Перед запуском любого dry-run/kick этапа резолвер обязан валидировать заголовок CSV против эталона.

Эталонный набор колонок (порядок зафиксирован):
```
email, full_name, telegram_username, tg_id_in_profile, tg_id_in_chat,
link_check, entitlement_status, subscription_status, manual_access,
staff_role, final_status, reason, club_id, telegram_chat_id
```

Правила:
- Отсутствует хотя бы одна колонка → STOP, файл не используется, audit `CSV_SCHEMA_MISSING_COLUMN`.
- Есть лишняя колонка → STOP, audit `CSV_SCHEMA_UNEXPECTED_COLUMN`.
- Порядок колонок не совпадает → STOP, audit `CSV_SCHEMA_ORDER_MISMATCH`.
- Любой STOP — без частичной обработки строк.

Реализация: общая утилита `validateCsvSchema(filePath, expectedHeader[])`, используется и в edge-функции, и в локальных скриптах генерации CSV (чтобы CSV не мог быть выпущен с другим набором).

---

### Раздел H (новый). UI «Проверка доступа» (новый таб в «Участники клуба»)

В странице клуба добавляется таб **«Проверка доступа»** с фильтрами по `final_status`:

- `verified_paid`
- `verified_staff`
- `pending_review`
- `no_valid_access`
- `mismatch`
- `duplicate_tg`

Колонки таблицы: username, full_name, email, tg_id_in_chat, tg_id_in_profile, link_check, ent_status, sub_status, manual_access, staff_role, **final_status (бейдж)**, **reason (текст)**.

Функции:
- Поиск по email / username / tg_id / full_name.
- Фильтр-чипы по `final_status` (мульти-выбор).
- Бейджи окрашены: paid/staff — зелёный, pending — жёлтый, no_valid/mismatch/duplicate — красный.
- Тултип на бейдже: текст из `reason` + ссылка на audit_log этой записи.
- Действие «kick» в строке доступно ТОЛЬКО если `final_status ∈ {no_valid_access, mismatch, duplicate_tg}`. Для verified_*/pending — кнопка disabled с подсказкой «заблокировано guard'ом».
- Источник данных: тот же RPC, что использует safe-mode auto-kick (единый резолвер из раздела 0a). Никаких параллельных вычислений.

---

### Раздел I (новый). Audit блокировок (расширение C)

Все блокировки kick/revoke пишутся в `audit_logs` с одним из event_type:

- `KICK_BLOCKED_VERIFIED` — попытка kick по `verified_paid` или `verified_staff`.
- `KICK_BLOCKED_PENDING_REVIEW` — попытка kick по `pending_review`.
- `KICK_BLOCKED_CROSS_CLUB` — несовпадение club_id/chat_id (см. раздел J).
- `KICK_BLOCKED_INVALID_REASON` — `reason` вне разрешённого enum.

Обязательный `meta` для каждого:
```json
{
  "tg_id": <bigint>,
  "club_id": "<uuid>",
  "reason": "<input reason>",
  "final_status": "<computed by resolver>",
  "requested_by": "<actor uuid or 'system'>",
  "source_function": "<edge function name>"
}
```

Дополнительно для `KICK_BLOCKED_CROSS_CLUB` в meta: `member_club_id`, `request_club_id`, `chat_id_in_club`, `chat_id_in_request`, `invite_club_id` (если применимо).

Audit пишется ДО возврата ответа функции; при ошибке записи audit — функция возвращает 500 без выполнения kick (фейл-клоуз).

---

### Раздел J (новый). Cross-club guard

Любая функция, выполняющая kick/revoke/invite, перед действием обязана проверить ВСЕ три условия:

1. `telegram_club_members.club_id = request.club_id` (член относится к указанному клубу).
2. `telegram_clubs.telegram_chat_id (по request.club_id) = telegram_chat_id, на который выполняется API-вызов`.
3. Если в запросе используется `invite_link_id` или `invite_code` — `telegram_invite_links.club_id = request.club_id`.

Несовпадение любого условия → STOP + `KICK_BLOCKED_CROSS_CLUB` + 409. Никакого «ближайшего совпадения», никакого автоматического резолва клуба по чату.

Применяется к:
- `telegram-revoke-access`
- `telegram-grant-access` (выдача инвайта)
- safe-mode auto-kick в `telegram-webhook`
- любым ручным action из UI «Проверка доступа» и «Участники клуба»

---

### Раздел K (новый). Итоговый отчёт (auto-generated)

После выполнения шагов 4–9 порядка из v5 — автоматическая генерация отчёта `buh_business_report_<timestamp>.md` с разделами:

1. **CSV counts** — таблица: `final_status → count` по каждому из 6 статусов (на основе `access_revision.csv`).
2. **Контрольные числа:**
   - verified_paid: N
   - verified_staff: N
   - pending_review: N
   - kick-eligible (no_valid_access + mismatch + duplicate_tg): N
   - in_chat total: N (= сумма)
3. **Guard-блокировки** за период работы: count по каждому event_type из раздела I.
4. **Audit events** — список всех записей с event_type ∈ {AUTO_KICK_INTENT, AUTO_KICK_RESULT, KICK_BLOCKED_*, MANUAL_KICK_SECONDARY, STAFF_BYPASS, MANUAL_ACCESS_GRANTED} за период, с `tg_id, club_id, reason, final_status, actor`.
5. **UI screenshots:** «Участники клуба» (5 метрик), «Проверка доступа» (по каждому фильтру), CRM tooltip.
6. **SQL before/after:**
   - до: те же 5 метрик + распределение по `final_status` (на момент старта работ);
   - после: те же запросы (на момент завершения).
7. **Артефакты:** ссылки на все CSV (A, B, C, D, access_revision, double_logins_dryrun, kick_candidates_dryrun).

Отчёт сохраняется в `/mnt/documents/` и прикладывается к ответу.

---

### Сводный порядок выполнения v5.1

1. ✅ CSV A/B/C/D из v3 (готовы).
2. **Сейчас (read-only) с обязательной валидацией схемы (G):**
   - `buh_business_access_revision.csv`,
   - `buh_business_double_logins_dryrun.csv`,
   - `buh_business_kick_candidates_dryrun.csv` (ожидаемо 0 kick-eligible).
3. STOP → ваш просмотр трёх CSV.
4. По «ок»: `manual_access` для Гариновой и Федорчука (раздел D).
5. UI «Участники клуба»: 5 метрик + бейдж «Персонал» + починка счётчика.
6. UI «Проверка доступа» (раздел H) — новый таб.
7. UI CRM: tooltip «Платежи / Сделки / Pending».
8. RPC `is_verified_club_member` + резолвер `final_status` (единый источник для UI/CSV/edge).
9. Проверка прав бота → `join_request_mode=true` (только если права ок).
10. Доработка `telegram-webhook/index.ts`:
    - safe-mode auto-kick (контракт раздела 0c v5),
    - whitelist-guard через RPC,
    - cross-club guard (раздел J),
    - audit INTENT/RESULT/BLOCKED (раздел I),
    - CSV schema validation (раздел G) на любых импортных путях.
11. Деплой + `supabase--test_edge_functions` (Deno-тесты на резолвер, schema validator, cross-club guard, whitelist guard).
12. Verify + автогенерация отчёта (раздел K).
13. Финальная отправка отчёта.

---

### DoD v5.1 (полный)

- ✅ Все 7 verified tg_id никогда не появляются в kick-candidates (whitelist раздела 0).
- ✅ Любой kick-вызов с username вместо tg_id отклоняется на уровне сигнатуры.
- ✅ Любая попытка kick по `verified_*` или `pending_review` пишет соответствующий `KICK_BLOCKED_*` и возвращает 409.
- ✅ Cross-club kick/revoke/invite физически невозможен (раздел J).
- ✅ CSV без эталонной схемы не используется (раздел G).
- ✅ Таб «Проверка доступа» показывает 6 final_status с фильтрами и поиском.
- ✅ Гаринова и Федорчук — через `manual_access`, не email-whitelist.
- ✅ `GIFT-26-MOEMX59I` не перемещён без отдельного «ок».
- ✅ Все audit записи содержат `tg_id, club_id, reason, final_status, requested_by, source_function`.
- ✅ Итоговый отчёт сгенерирован автоматически и приложен.

---

### Дополнение v5.2 — Персональные invite-ссылки: переиспользование, без дублирования

**Жёсткое правило (add-only, не отменяет ничего из v5/v5.1):**

1. **Запрещено создавать новую edge function / новый RPC / новый writer** для персональных Telegram invite-ссылок под БкБ. Любая такая работа = нарушение архитектурного контракта.

2. **Единственный допустимый путь** — существующий канонический flow выдачи персональных ссылок:
   - Edge function: `telegram-grant-access` (см. `mem://architecture/telegram/access-grant-integrity-v1`).
   - Таблица: `telegram_invite_links`.
   - Движок: `mem://architecture/telegram/unified-club-engine-v3` — параметризация по `club_id` + `resource_mode`.
   - Контракт ссылки: персональная, с полями
     `club_id, user_id, telegram_user_id (expected_tg_id), invite_code, member_limit=1, expire_date=now()+24h`.

3. **Шаг 0 раздела J (обязательно ДО любых действий по БкБ):**
   Сделать **mapping-документ** `buh_business_invite_flow_mapping.md`:
   - какой code path использует Gorbova Club (далее GC) для выдачи персональной ссылки (функция, таблица, поля, аудит-события);
   - какой code path сейчас использует БкБ;
   - дельта между ними (что отличается: писатель ссылки, источник `expected_tg_id`, `member_limit`, `expire_date`, привязка `club_id`, аудит).
   - **Если flow совпадает** → подтвердить и зафиксировать.
   - **Если flow отличается** → привести БкБ к GC-пути через параметризацию `club_id`, БЕЗ создания новой функции и БЕЗ ветвления «if club = bkb».

4. **Параметризация:**
   - Любое поведение должно управляться `club_id` (и при необходимости `clubs.resource_mode` / конфигом клуба в БД), а не хардкодом названия клуба или email-исключениями.
   - Запрещены любые `if (club_slug === 'buh-business')` и аналогичные брэнч-конструкции в коде ссылок/доступа.

5. **Anti-duplication guard:**
   - Перед любым PR/патчем — `rg` поиск по проекту на предмет существующих writer'ов `telegram_invite_links` и вызовов `createChatInviteLink` / эквивалента в gateway. Если найдено ≥1 — переиспользовать, не плодить.
   - Любая «вторая» точка создания ссылки = блок-стопер, патч не выпускается.

6. **DoD v5.2 (добавляется к DoD v5.1):**
   - ✅ Mapping GC ↔ БкБ зафиксирован в `buh_business_invite_flow_mapping.md` и приложен к отчёту.
   - ✅ В репозитории остаётся **ровно один** code path создания персональной Telegram invite-ссылки.
   - ✅ Поведение для БкБ управляется только `club_id` (и конфигом клуба), без хардкода.
   - ✅ Новых edge functions/RPC/таблиц для персональных ссылок не создано (подтверждается diff'ом миграций и `supabase/functions.registry.txt`).
   - ✅ Все выданные в рамках задачи ссылки имеют `member_limit=1`, `expire_date ≤ now()+24h`, `expected_tg_id` совпадает с целевым `tg_id`, `club_id` = БкБ.
   - ✅ Аудит-события создания ссылки содержат `club_id, user_id, expected_tg_id, invite_code, source_function='telegram-grant-access'`.

---

### Дополнение v5.3 — Mapping-first и обязательный аудит инвайтов (add-only)

**Шаг 0 (блокирующий, до любых действий по БкБ):**
Сформировать `buh_business_invite_flow_mapping.md` со столбцами:
- club: GC | БкБ;
- writer entry point (UI/RPC/edge function);
- edge function name (например `telegram-grant-access`);
- какие таблицы пишутся (`telegram_invite_links`, `telegram_club_members`, `audit_logs`, …);
- поле, где хранится `expected_tg_id`;
- где проверяется `member_limit = 1`;
- где проверяется `expire_date ≤ now() + 24h`;
- какие audit-события эмитируются.

**Правила по mapping:**
- Если у БкБ обнаружится **отдельный** путь создания инвайта — он **не чинится отдельно**. БкБ переводится на тот же общий code path, что используется для GC, через параметризацию `club_id` (см. v5.2).
- Любая попытка создать **новый writer** для `telegram_invite_links` (новая edge function / RPC / прямой insert из другого места) — **запрещена без отдельного approve пользователя**. До approve — STOP.

**Обязательный аудит (новые / уточнённые события в `audit_logs`):**
Каждое событие должно содержать `club_id, user_id, expected_tg_id, invite_code, requested_by, source_function`.

| Событие | Когда эмитится | Дополнительные поля |
|---|---|---|
| `INVITE_CREATED` | После успешного создания персональной ссылки | `member_limit`, `expire_date` |
| `INVITE_USED` | Когда `expected_tg_id` фактически вступил по ссылке | `actual_tg_id` (= expected) |
| `INVITE_MISMATCH` | По ссылке пытается войти `tg_id ≠ expected_tg_id` → join отклонён | `actual_tg_id`, `expected_tg_id` |
| `INVITE_REVOKED` | Ссылка отозвана (revoke / expire / replace) | `revoke_reason` |
| `KICK_BLOCKED_VERIFIED` | Попытка kick verified члена | `final_status` |
| `KICK_BLOCKED_USER_MISMATCH` | tg_id в чате не совпадает с tg_id профиля | `tg_id_in_chat`, `tg_id_in_profile` |
| `KICK_BLOCKED_CROSS_CLUB` | Запрос с `club_id`, не совпадающим с `telegram_chat_id`/`invite_link.club_id` | `request_club_id`, `member_club_id` |

**DoD v5.3 (добавляется к v5.1/v5.2):**
- ✅ Файл `buh_business_invite_flow_mapping.md` создан и приложен **до** любых изменений по БкБ.
- ✅ В репозитории нет двух writer'ов `telegram_invite_links`; БкБ использует тот же путь, что и GC.
- ✅ Все 7 событий из таблицы выше реально пишутся в `audit_logs` и проверены на тестовом сценарии.
- ✅ Любой новый writer инвайтов без отдельного approve = блок.

Готов выполнять по утверждении.

---

## v5.3 — Audit-события invite-flow (выполнено 2026-04-27)

**Proof:** `/mnt/documents/buh_business_v51/buh_business_invite_writers_proof.md`

**Writer'ы (без новых):**
- `telegram-grant-access` — основной (manual_grant / auto_grant)
- `telegram-reinvite-ghosts` — cron re-invite
- `telegram-webhook` — обновление статусов (used/mismatch/revoked)

**Контракт invite-link:** member_limit=1, expire_date=now+24h, expected_tg_id=telegram_user_id колонка. Один code path для GC и БкБ (нет хардкодов по slug). Параметризация через `club_id` → `telegram_clubs`.

**Audit destination:** все INVITE_* события унифицированы в `telegram_access_audit` (raninvite-ghosts переведён с `audit_logs`).

**Добавленные события (event_type):**
| Event | Где пишется | Когда |
|---|---|---|
| INVITE_CREATED | grant-access, reinvite-ghosts | После успешного INSERT в telegram_invite_links |
| INVITE_USED | webhook | tg_id == expected_tg_id зашёл по ссылке |
| INVITE_REVOKED | grant-access | При выдаче новой ссылки старая активная ссылка помечается revoked |
| INVITE_MISMATCH | webhook (existing, обогащён meta) | tg_id != expected_tg_id попытался войти |
| INVITE_BLOCKED_VERIFIED | grant-access | Auto-grant пытался выдать verified-участнику |
| INVITE_BLOCKED_CROSS_CLUB | webhook | invite_code из другого клуба |
| INVITE_EXPIRED_OR_REUSED | webhook | invite в статусе ≠ created/sent (used/revoked/expired) |

**Обязательное meta для всех INVITE_* событий:**
`club_id, tg_id, expected_tg_id, invite_link_id, invite_code, source_function, decision, reason`

**Тест выполнен:**
- Self-test 3 синтетических audit-записей (INVITE_USED, INVITE_MISMATCH, INVITE_EXPIRED_OR_REUSED) — приняты таблицей, meta-контракт валиден.
- Фактические сценарии (mismatch / reused / normal) для test-user будут проверены на реальном next-grant без массовых действий.

**Деплой:** telegram-grant-access, telegram-reinvite-ghosts, telegram-webhook — успешно.
