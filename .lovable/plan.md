## да, согласен, с учетом правок:

```text
1. Убрать из плана bulk-revoke 7 аккаунтов. Они не нарушители: link_check=match.

2. Зафиксировать новый факт:
   - в чате 35 человек;
   - 33 платных;
   - 1 админ;
   - 1 Ирина Гаринова — персонал/админ по бизнес-правилу;
   - unauthorized/mismatch = 0.

3. Основной фокус перенести с банов на:
   - исправление UI-счётчиков 28/38/35;
   - единый SoT по club_id;
   - корректное разделение paid / admin / personnel / removed / channel-state.

4. Ирина Гаринова:
   - добавить отдельный whitelist/role-механизм как staff/manual admin access, а не считать нарушителем.
   - в UI показывать «Персонал» или «Администратор», не «без доступа».

5. join_request_mode оставить в плане, но только как защита на будущее:
   - сначала проверить права бота;
   - включать после dry-run;
   - не использовать как повод для кика текущих участников.

6. CSV/dry-run оставить обязательными:
   - полный tg_id список;
   - paid/access/chat/admin/personnel classification;
   - источники, откуда UI берёт 38.

7. DoD обновить:
   - UI «в чате» показывает 35;
   - paid и staff/admin считаются отдельно;
   - unauthorized = 0;
   - removed/in_channel/stale записи не попадают в счётчик живого чата;
   - все цифры сходятся с SQL snapshot на одном timestamp.

План v3 (add-only) — «Бухгалтерия как бизнес»: ревизия + ужесточение Telegram-инвайтов
```

**Важная корректировка после повторной проверки:**
Я был неправ в v2, когда называл 7 username «вторыми аккаунтами». Перепроверка по join `telegram_club_members.telegram_user_id ↔ profiles.telegram_user_id` через `profile_id` показала:


| Метрика                                                                    | Значение |
| -------------------------------------------------------------------------- | -------- |
| Всего в чате (`in_chat=true`)                                              | **35**   |
| Из них с активным entitlement по БкБ (`link_check=match`)                  | **33**   |
| Админ (Сергей Федорчук)                                                    | **1**    |
| Персонал без entitlement (Ирина Гаринова, по вашему подтверждению — админ) | **1**    |
| MISMATCH (tg_id в чате ≠ привязанному в профиле)                           | **0**    |
| no_profile_link / profile_no_tg                                            | **0**    |


**Нелегитимных в чате нет.** Все 7 «подозреваемых» из v2 (`Iris_Fess`, `fs_by`, `MariyaBuhgalterGomel`, `anastasiya_hzarko`, `Karina_chernoglazova`, `Irina_Garinova`, `MaiyaAD`) — это реальные привязанные профили с активным правом доступа (или персонал). Бан-лист отменяется.

**Цифра «38» в UI** не сходится с фактом 35. Это баг отображения (скорее всего считает `in_chat OR in_channel` или включает `access_status='removed'`). Это правится только в UI, БД-данные корректны.

---

### Принятые add-only правила

План полностью встраивается в существующие стандарты — ничего не сносим:

- TG-доступы: `architecture/telegram/access-grant-integrity-v1`
- Club-as-SoT: `architecture/access-control/club-product-sot`
- Save≠Grant: `architecture/fulfillment/canonical-write-path-standard`
- Revoke/queue guards: `infrastructure/access/revoke-race-condition-guard`
- Audit standard: `architecture/access-control/audit-actor-standard`

---

### Часть 0. Когорта оттока (без изменений из v2)


| Месяц | Уник. оплативших |
| ----- | ---------------- |
| Янв   | 4 · Фев          |


«Отвалившихся» по факту 1 человек (Екатерина Юролайть, expired 07.03). Ещё 5 — `active` подписки с датой следующего списания 28–30 апреля (списание ещё впереди, не отток).

---

### Часть 1. Read-only аудиты (Diagnose) — ВЫПОЛНЯЕТСЯ ПЕРВЫМ, БЕЗ ЛЮБЫХ МУТАЦИЙ

CSV-экспорт в `/mnt/documents/`:

**A. `buh_business_chat_roster.csv**` — полный список всех `in_chat=true` в чате БкБ:
`telegram_user_id, telegram_username, tg_display_name, profile_email, profile_full_name, profile_tg_id, link_check, ent_status, ent_expires, sub_status, sub_end, app_roles, joined_chat_at`.
Это и есть «список tg-аккаунтов с разрешённым доступом» для ручной сверки.

**B. `buh_business_payments_cohort.csv**` — все, кто когда-либо платил (с jan/feb/mar/apr флагами, last_paid, статусом подписки и entitlement).

**C. `buh_business_funnel_anomalies.csv**` — 1 paid order без `pipeline_stage_id` + pending без стадии.

**D. `buh_business_dryrun_revoke.csv**` — кандидаты на revoke (только expired/superseded, чей профиль до сих пор `in_chat=true`). На текущий момент по живой проверке таких **нет** — файл будет пустой. Это ожидаемо.

**STOP**: после генерации CSV показываю вам, никаких UPDATE/ban/revoke без вашего явного «ок».

---

### Часть 2. CRM (минорное, после CSV-подтверждения)

1. UPDATE 1 paid order → стадия «Успешно» (по вашему подтверждению из CSV-C).
2. Tooltip в шапке Kanban: «Сделки = подписки. Платежи = списания (включая повторные)». Объясняет «27 vs 11».
3. Опц. переключатель «Все в стадии / Новые за период» в Summary Strip.

---

### Часть 3. Ужесточение инвайт-политики (превентивно, на будущее)

Текущее состояние (проверено в коде):

- `member_limit:1` + `expire_date:24h` уже стоят. ✓
- При `join_request_mode=true` — строгая проверка tg_id в `chat_join_request`. ✓
- У БкБ-клуба `join_request_mode=false` → ссылка работает напрямую. **Дыра.**
- В webhook на mismatch (`telegram-webhook/index.ts:1199–1247`) только лог `INVITE_MISMATCH`, без ban.

#### 3.1. Включить `join_request_mode=true` для клуба БкБ — С ПРЕДВАРИТЕЛЬНОЙ ПРОВЕРКОЙ

Перед UPDATE: вызвать `getChatMember` для бота → проверить, что бот **админ** в чате с правами `can_invite_users` + `can_restrict_members`. Если прав нет → **STOP**, выдать ошибку «Дайте боту права администратора с can_invite_users и can_restrict_members, затем повторите». Не включать режим без прав.

#### 3.2. Авто-кик при `INVITE_MISMATCH` (доработка `telegram-webhook/index.ts`)

В блоке обработки `chat_member` при mismatch добавить:

1. `revokeChatInviteLink` (одноразовость уже стояла, но дополнительно убиваем).
2. `banChatMember` **только** в `club.telegram_chat_id` (никаких `channel_id`, никакой cross-club логики).
3. Если у клуба `channel_id` не задан — channel state не трогаем.
4. Audit `AUTO_KICK_MISMATCH` с `meta = { invite_code, invite_link_id, expected_tg_id, actual_tg_id, club_id, decision: 'ban' }`. `club_id` обязателен в каждой записи.
5. DM нарушителю «Эта ссылка персональная для другого Telegram-аккаунта». DM-ошибка **не блокирует** ban; в audit фиксируем `dm_sent=true|false` + `dm_error`.

#### 3.3. Decline в `chat_join_request` — обогатить audit

При decline (нет активного доступа) дополнительно сохранять `expected_tg_id` (если invite_code присутствует в payload `chat_join_request.invite_link.invite_link`). Поведение не меняется, только аудит детальнее.

#### 3.4. Bulk-revoke — отменён

Перепроверка показала, что нелегитимных нет. Никаких массовых kick/ban. Никаких action на `Iris_Fess`, `fs_by`, `MariyaBuhgalterGomel`, `anastasiya_hzarko`, `Karina_chernoglazova`, `Irina_Garinova`, `MaiyaAD` не делаем — они все легитимны.

#### 3.5. Если в CSV-A после ручной сверки вы укажете лишних — отдельный шаг

Только тогда вызовем существующий `telegram-revoke-access` (по одному, с подтверждением каждого), `reason='manual_review_unauthorized'`, audit `MANUAL_KICK_REVIEWED`, `club_id` обязателен.

---

### Часть 4. UI

#### 4.1. Страница «Участники клуба» — починить расхождение 38 vs 35

Сейчас UI показывает 38, фактически в чате 35. Исправить SQL/агрегацию счётчика, чтобы:

- «В чате»: `COUNT(in_chat=true)`.
- «С активным правом по продукту»: использовать **тот же SoT, что в Club-as-SoT** — `has_valid_access_for_club(profile.user_id, club_id)` через `product_club_mappings`. Никакой отдельной логики только для БкБ.
- Если числа расходятся — янтарный бейдж.
- Кнопка «Сверить с Telegram» — запускает существующий `telegram-check-expired`.

#### 4.2. CRM tooltip — см. п.2.

---

### Часть 5. Verify (DoD)

После всех правок показать **5 чисел отдельно**, не смешивая:

a) **active paid rights** (`subscriptions_v2.status='active'` по продукту БкБ);
b) **active entitlements** (`entitlements.status='active'` по продукту БкБ);
c) **telegram_access ok** (`telegram_club_members.access_status='ok'`);
d) **фактически in_chat** (`telegram_club_members.in_chat=true`);
e) **админы/персонал отдельно** (по `user_roles` + ручной список Гариновой/Федорчука).

a == b == (c минус админы) == (d минус админы) — целевое равенство.

---

### Часть 6. Финальный отчёт (артефакты)

- SQL-снимки до/после каждого UPDATE.
- 4 CSV-файла (A/B/C/D) в `/mnt/documents/`.
- Список audit_logs за период по `event_type IN ('AUTO_KICK_MISMATCH','MANUAL_KICK_REVIEWED','JOIN_DECLINED','JOIN_APPROVED')` с `club_id` фильтром.
- Скрин страницы «Участники клуба» (числа сошлись).
- Скрин CRM с tooltip.
- Список изменённых файлов и diff-summary:
  - `supabase/functions/telegram-webhook/index.ts` (auto-kick + revoke + DM на mismatch)
  - `supabase/functions/telegram-grant-access/index.ts` (если потребуется доп. поле для audit)
  - UI компонент страницы участников клуба (новая метрика)
  - UI воронки CRM (tooltip)
  - 1 миграция: UPDATE 1 paid order на стадию «Успешно» (после подтверждения по CSV-C)
  - 1 insert через supabase tool: UPDATE `telegram_clubs.join_request_mode=true` (после проверки прав бота)

---

### Порядок выполнения (строго последовательно)

1. **Read-only**: сгенерировать CSV A/B/C/D → `/mnt/documents/` → показать пользователю → **STOP**.
2. По вашему подтверждению CSV-A: список tg-аккаунтов с доступом (для ручной сверки).
3. По вашему подтверждению CSV-C: UPDATE 1 paid order в воронку «Успешно».
4. Проверка прав бота в чате БкБ (`getChatMember`). Если ОК → UPDATE `join_request_mode=true`. Если нет — **STOP** и инструкция.
5. Доработка `telegram-webhook/index.ts` (auto-kick on mismatch, расширенный audit, DM-noblock).
6. Деплой edge-функции, тест через `supabase--test_edge_functions`.
7. UI-правки (метрика участников + tooltip CRM).
8. Verify-блок (5 чисел отдельно). Скрины.
9. Финальный отчёт.