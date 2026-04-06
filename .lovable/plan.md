## да, согласен, с учетом правок:

&nbsp;

1. **Зафиксировать, что по Дергелёвой root cause уже найден**
  &nbsp;
  - Это не “общая гипотеза”, а уже **доказанный баг support-path**:
    &nbsp;
    - useTicket не тащит profiles.user_id,
    - из-за этого ContactDetailSheet в support-ветке не видит подписки,
    - сделки при этом видит, потому что они грузятся по profile_id.
    &nbsp;
  - В отчёте и в статус-блоке это нужно писать как:
    &nbsp;
    - PATCH-DERGELEVA-GHOST-VS-LIVE | root cause proved | fix required
    &nbsp;
  - Не оставлять формулировки уровня “active investigation” для этого кейса.
  &nbsp;
2. **Не размывать Дергелёву в общий identity split**
  &nbsp;
  - Уточнить в выводе:
    &nbsp;
    - по Дергелёвой это **не routing split между двумя профилями**,
    - а **resolver mismatch внутри support entry path**.
    &nbsp;
  - То есть:
    &nbsp;
    - ghost-предупреждение и “нет подписок” в support-карточке вызваны не тем, что открыт другой человек,
    - а тем, что в карточку не передан user_id, и вкладка доступа ищет не по тому ключу.
    &nbsp;
  &nbsp;
3. **Сделать это отдельным execute-патчем сразу, не откладывая**
  &nbsp;
  - Добавить следующий явный патч:
    &nbsp;
    - PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX
    &nbsp;
  - Scope:
    &nbsp;
    - src/hooks/useTickets.ts — добавить user_id в profiles:profile_id(...)
    - src/components/admin/ContactDetailSheet.tsx — все access/subscription queries перевести на resolvedUserId, а не на сырой contact?.user_id
    &nbsp;
  - Нужен browser/UI-proof именно на кейсе Дергелёвой:
    &nbsp;
    - из support карточка должна показывать подписки и не должна помечать live-contact как ghost.
    &nbsp;
  &nbsp;
4. **Добавить explicit DoD для патча Дергелёвой**
  &nbsp;
  - Для одного и того же live-профиля Дергелёвой:
    &nbsp;
    - в Support видны подписки,
    - ghost-warning исчезает,
    - count “Доступы” соответствует реальным подпискам/entitlements,
    - сделки и доступы видны одновременно,
    - Telegram/Inbox path и Support path дают одну и ту же access-картину.
    &nbsp;
  - Отдельно потребовать screenshot proof “до/после”.
  &nbsp;
5. **Королёву не терять, но не смешивать с Дергелёвой**
  &nbsp;
  - Оставить в этом же forensic sprint отдельный подпатч:
    &nbsp;
    - PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS
    &nbsp;
  - Но в статусе прямо указать:
    &nbsp;
    - кейс Королёвой не связан с багом useTicket missing user_id.
    &nbsp;
  - Там нужно добить последнее недостающее доказательство:
    &nbsp;
    - состояние новой подписки в точку revoke,
    - почему cron не увидел продление до синка.
    &nbsp;
  &nbsp;
6. **По основной линии работы идти дальше параллельно**
  &nbsp;
  - Не останавливать основную ревизию доступов.
  - Параллельный трек:
    &nbsp;
    - PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX — чинить сейчас,
    - PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS — добить forensic,
    - PATCH 3 illegal_bonus_access — запускать discovery/dry-run,
    - PATCH 4 duration drift — запускать discovery/dry-run.
    &nbsp;
  - То есть не ждать полного закрытия всех forensic-подпатчей, чтобы продолжать ревизию доступов.
  &nbsp;
7. **По ghost placeholder cases уточнить формулировку**
  &nbsp;
  - Не писать, что entitlement “будет создан автоматически”, пока это не доказано отдельным proof.
  - Сейчас корректная формулировка:
    &nbsp;
    - auto-bridge not proved,
    - current trigger does not cover placeholder user_id pattern,
    - нужен отдельный bridge-fix / normalization patch.
    &nbsp;
  - Это важно, чтобы не создать ложное ощущение, что 12 ghost-кейсов уже безопасно закрыты.
  &nbsp;
8. **Добавить новый follow-up патч**
  &nbsp;
  - PATCH-GHOST-CLAIM-BRIDGE-PROOF
  - Цель:
    &nbsp;
    - доказать на реальных historical кейсах, создаётся ли entitlement после claim регистрации,
    - если нет — оформить отдельный execute-патч на normalization placeholder user_id = [profile.id](http://profile.id).
    &nbsp;
  &nbsp;
9. **Скорректировать consolidated вывод**
  &nbsp;
  - Финальная формулировка должна быть такой:
    &nbsp;
    - **Проблема 1:** support-path bug, доказан, требует немедленного fix
    - **Проблема 2:** Korolyova revoke race, forensic почти завершён
    - **Проблема 3:** ghost placeholder subscriptions, data/bridge problem, remediation pending
    &nbsp;
  - Убрать размытые формулировки, будто это всё один общий identity-баг.
  &nbsp;
10. **Обновить статус-блок**

&nbsp;

&nbsp;

&nbsp;

- Предлагаемый статус:
  &nbsp;
  - PATCH 1 — closed
  - PATCH 2 — partial, 12 ghost deferred
  - PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX — ready for execute
  - PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS — final proof pending
  - PATCH-GHOST-PLACEHOLDER-NORMALIZATION — discovery done, execute not approved
  - PATCH 3 illegal_bonus_access — start discovery now
  - PATCH 4 duration drift — start discovery now
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

11. **Следующим шагом**

&nbsp;

&nbsp;

&nbsp;

- Сразу после этого плана пусть делает:
  &nbsp;
  - PATCH-SUPPORT-CONTACT-USERID-RESOLVER-FIX
  &nbsp;
- И в этом же спринте, не теряя линию ревизии доступов:
  &nbsp;
  - отдельно открыть PATCH 3 illegal_bonus_access на discovery/dry-run,
  - отдельно добить Korolyova forensic до окончательного вывода.
  &nbsp;

&nbsp;

&nbsp;

План: FORENSIC-IDENTITY-ACCESS-SPRINT

Этот forensic sprint — продолжение основной ревизии доступов. Он проверяет, по какой сущности система определяет субъект доступа, что критично для безопасного выполнения PATCH 3–4.

### Общая гипотеза

Проблемы missing entitlements, false revoke (Королёва), ghost subscriptions и contact identity mismatch (Дергелёва) могут быть проявлениями единого контура ошибки в identity/access resolution, где путаются `user_id`, `profile_id`, `contact_id`, ghost-source и imported-source.

---

### Phase 0 — Canonical Identity Contract

**Каноническая сущность человека в системе:** `profiles.id`

Все таблицы и их текущая привязка:

```text
┌─────────────────────────┬─────────────────────────────┬──────────────┐
│ Таблица                 │ Ссылается на                │ Canonical?   │
├─────────────────────────┼─────────────────────────────┼──────────────┤
│ orders_v2               │ profile_id + user_id        │ ✅ profile_id│
│ subscriptions_v2        │ user_id (= profiles.user_id │ ⚠️ mixed     │
│                         │ ИЛИ profiles.id placeholder)│              │
│ entitlements            │ user_id (FK → auth.users)   │ ❌ auth only │
│ support_tickets         │ profile_id                  │ ✅           │
│ telegram_club_members   │ profile_id                  │ ✅           │
│ telegram_logs           │ user_id (= profiles.user_id)│ ⚠️ auth      │
│ audit_logs              │ target_user_id (auth)       │ ⚠️ auth      │
└─────────────────────────┴─────────────────────────────┴──────────────┘
```

**Ключевой вывод:** `subscriptions_v2.user_id` — это `profiles.user_id` (auth UUID), а НЕ `profiles.id`. ContactDetailSheet ищет подписки по `userIds` массиву, но если `contact.user_id` не передан — массив содержит только `profiles.id`, и подписки с `user_id = auth_uuid` не находятся.

---

### Подпатч A — PATCH-DERGELEVA-GHOST-VS-LIVE-CONTACT-FORENSICS

#### Доказанный root cause (DB + code proof)

**Два профиля Дергелёвой в БД:**


| Поле                       | Live profile                                      | Ghost profile                                       |
| -------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| profile.id                 | `2fe0679d`                                        | `7e155ca3`                                          |
| user_id                    | `300cafe6`                                        | NULL                                                |
| email                      | [o.dergeleva@mail.ru](mailto:o.dergeleva@mail.ru) | [s.dergelev@gmail.com](mailto:s.dergelev@gmail.com) |
| status                     | active                                            | imported                                            |
| deals                      | 17                                                | 0                                                   |
| subscriptions (by user_id) | 8                                                 | 0                                                   |


Тикет поддержки `c1723827` привязан к **live** профилю `2fe0679d`. НО:

**Bug найден в `useTicket` (src/hooks/useTickets.ts:192-197):**

```typescript
profiles:profile_id (
  full_name, email, phone, avatar_url
  // ← user_id НЕ ВКЛЮЧЕН!
)
```

Когда SupportTabContent открывает ContactDetailSheet:

```typescript
contact={{
  id: contactSheetContactId,          // '2fe0679d' ← правильный
  ...(selectedTicket?.profiles || {}), // { full_name, email, phone, avatar_url } ← БЕЗ user_id!
}}
```

Результат: `contact.user_id = undefined`.

**В ContactDetailSheet:**

- **Deals query** (строка 422): `.or(\`profile_id.eq.${contact.id},user_id.in.(...))`— ищет и по`profile_id` → **находит 17 сделок** ✅
- **Subscriptions query** (строка 467): `.in("user_id", userIds)` где `userIds = ['2fe0679d']` — подписки имеют `user_id = '300cafe6'` → **НЕ НАХОДИТ** ❌
- **Grant access**: `isGhostContact = !contact?.user_id` = true → **показывает ghost-предупреждение** ❌

`profileData` query (строка 337-350) потом загружает `user_id` из profiles, но `subscriptions` query key уже зафиксирован с `contact?.user_id = undefined` и не перезапрашивается.

**Это НЕ identity split. Это отсутствие `user_id` в JOIN профиля в хуке `useTicket`.**

#### Двухколоночный diff карточки


| Поле                | Telegram/Inbox path                | Support path                 |
| ------------------- | ---------------------------------- | ---------------------------- |
| contact.id          | `profile.id` (из dialog.profile)   | `ticket.profile_id`          |
| contact.user_id     | ✅ есть (из dialog.profile.user_id) | ❌ undefined (не в JOIN)      |
| subscriptions found | ✅ 8 шт                             | ❌ 0 ("Нет подписок")         |
| deals found         | ✅ 17 шт                            | ✅ 17 шт (ищет по profile_id) |
| ghost flag          | ❌ false                            | ✅ true (user_id undefined)   |
| entitlements tab    | ✅ показывает                       | ❌ "Ghost-контакт"            |


#### Fix

**Файл: `src/hooks/useTickets.ts`, строка 192-197**

Добавить `user_id` в select профиля:

```typescript
profiles:profile_id (
  user_id,        // ← ДОБАВИТЬ
  full_name,
  email,
  phone,
  avatar_url
)
```

**Дополнительный guard в ContactDetailSheet (строки 450-467):**

Subscriptions query должен учитывать `resolvedUserId` (который загружается из profileData), а не только начальный `contact?.user_id`. Нужно:

- добавить `resolvedUserId` в queryKey subscriptions
- использовать `resolvedUserId` в `userIds` массиве
- аналогично для других queries, зависящих от `user_id`

---

### Подпатч B — PATCH-CASE-KOROLYOVA-REVOKE-FORENSICS

#### Доказанные факты (DB proof)


| Время (UTC)    | Событие                                              |
| -------------- | ---------------------------------------------------- |
| 05.04 08:58    | Подписка `4462ee5c` (Бухгалтерия как бизнес) expired |
| 06.04 04:00:16 | REVOKE, reason: `access_expired`, actor: system      |
| 06.04 06:22    | bePaid sync обновил данные                           |
| 06.04 07:03    | Новая подписка `dea78a37` — access_chain_applied     |
| 06.04 07:06    | Admin manually granted access                        |


**Предварительный root cause:** окно между истечением старой подписки и материализацией новой в access resolver.

#### Обязательная дополнительная проверка (пока не выполнена)

- Состояние `dea78a37` на момент 06.04 04:00 UTC
- Была ли она уже в subscriptions_v2
- Какой имела status / access_start_at / access_end_at
- Почему hasValidAccessBatch её не увидел

**Финальный root cause НЕ фиксируется до этой проверки.**

#### Связь с identity bug

Проверено: Королёва имеет единственный профиль с живым `user_id`. Identity split НЕ причастен к этому revoke.

#### Safe remediation plan

Добавить pre-revoke guard в `telegram-kick-violators`: перед kick проверять наличие pending/new bePaid подписки на тот же product.

---

### Подпатч C — PATCH-GHOST-PLACEHOLDER-USERID-NORMALIZATION

#### Текущее состояние

12 ghost-подписок с паттерном `subscriptions_v2.user_id = profiles.id` (placeholder). Trigger `handle_new_user` ожидает `WHERE user_id IS NULL` и не может их подхватить.

#### Обязательная проверка популяции

Нужно найти ВСЮ популяцию placeholder-паттерна:

- total placeholder subscriptions
- active/trial vs expired
- по продуктам
- по источникам импорта

#### Machine-check: исторический bridge proof

Проверить по факту: есть ли хоть один исторический кейс, где ghost profile был claim-нут, подписка перепривязалась и entitlement появился.

Результат в buckets:

- `historical_success_proof_exists`
- `historical_success_proof_absent`
- `trigger_logic_insufficient`

#### Safe remediation

**Вариант A:** `UPDATE subscriptions_v2 SET user_id = NULL WHERE user_id = profile_id AND profiles.user_id IS NULL` — после этого trigger при регистрации сработает.

**Вариант B:** Расширить trigger `handle_new_user`: `WHERE (user_id IS NULL OR user_id = _archived_profile.id)`.

---

### Подпатч D — PATCH-CONTACT-IDENTITY-SPLIT-GHOST-MISMATCH

**Статус: active investigation, proof required before downgrade**

#### Доказанное

21 пара дублирующих профилей (live + imported) в БД найдена. Пока ни один ghost-профиль из этих пар не имеет привязанных тикетов или диалогов → прямого identity split через routing пока не подтверждено.

#### Гипотеза о внутренней несогласованности resolver-ов

Кейс Дергелёвой показал, что **внутри одной карточки** разные вкладки могут резолвить данные по разным ключам:

- Сделки → по `profile_id` → находит
- Подписки → по `user_id` → не находит (если user_id не передан)

Это НЕ identity split на уровне routing, а **missing field bug** в конкретном entry path (Support → useTicket).

#### DoD

Один из двух выводов:

- **A.** Реально существуют два профиля (live + ghost), и support/другой path открывает ghost — подтвердить SQL proof с конкретным тикетом/диалогом
- **B.** Профиль один, но вкладки используют разные ключи загрузки — **ПОДТВЕРЖДЕНО кейсом Дергелёвой**

---

### Cross-case matrix


| Кейс                | Live user    | Ghost entity                | Bug type                          | Subs found | Deals found | Revoke  | Root cause                         |
| ------------------- | ------------ | --------------------------- | --------------------------------- | ---------- | ----------- | ------- | ---------------------------------- |
| Дергелёва (Support) | ✅ `300cafe6` | ✅ `7e155ca3` (не причастен) | Missing user_id in useTicket JOIN | ❌ 0        | ✅ 17        | ❌       | **useTicket не передаёт user_id**  |
| Королёва            | ✅ `871ac688` | ❌                           | Race condition                    | ✅          | ✅           | ✅ 06.04 | bePaid sync lag                    |
| 12 ghost subs       | ❌ no auth    | ✅ placeholder               | FK constraint                     | N/A        | varies      | ❌       | placeholder user_id blocks trigger |


---

### Consolidated вывод

**Это 2 отдельные системные проблемы + 1 data quality issue:**

1. **UI resolver bug (Дергелёва):** `useTicket` не включает `user_id` в JOIN, из-за чего ContactDetailSheet из Support не видит подписки и помечает контакт как ghost. Затрагивает ВСЮ support-ветку. **Правится одной строкой.**
2. **Revoke race condition (Королёва):** bePaid sync отстаёт от cron kick-violators. Нужен pre-revoke guard.
3. **Ghost placeholder pattern (12 кейсов):** Импорт создал `user_id = profile_id`. Нужна нормализация + расширение trigger.

#### Влияние на основную ревизию доступов


| Направление             | Влияние                                                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Missing entitlements    | 12 кейсов — data quality. Fix placeholder → trigger отработает                                                    |
| Revoke logic            | Race condition, нужен guard. Не связано с identity                                                                |
| UI карточки контакта    | **Критично:** support-path показывает ghost вместо live. Любая ручная выдача из support может пойти по ghost-пути |
| Ghost/imported profiles | 21 дубль-пара, но ни одна не вызывает routing-split. Риск потенциальный                                           |
| PATCH 3/4 safety        | Можно начинать discovery/dry-run. Execute блокирован до fix useTicket + Korolyova proof                           |


---

### Изменяемые файлы


| Файл                                          | Что меняется                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/hooks/useTickets.ts`                     | Добавить `user_id` в profiles JOIN (строка 193)                                             |
| `src/components/admin/ContactDetailSheet.tsx` | Subscriptions/entitlements queries: использовать `resolvedUserId` вместо `contact?.user_id` |
| SQL миграция                                  | Korolyova: доп-проверка состояния `dea78a37` на момент revoke                               |


### STOP-guards

- Не менять auth, RLS, edge functions
- Не выполнять PATCH 3 execute до завершения forensic
- Не менять структуру таблиц
- Не менять handle_new_user trigger без отдельного утверждения

### DoD

1. `useTicket` включает `user_id` в profiles JOIN
2. ContactDetailSheet из Support показывает подписки корректно (proof: Дергелёва)
3. Ghost-flag не появляется для live-контактов, открытых из Support
4. Королёва: доказано состояние `dea78a37` на момент 04:00 UTC
5. Placeholder популяция полностью задокументирована
6. Historical bridge proof: bucket classification для всех 12 кейсов
7. Consolidated вывод: подтверждено 2 отдельные проблемы + 1 data issue

### Статус-блок


| Патч                                  | Статус                                                    |
| ------------------------------------- | --------------------------------------------------------- |
| PATCH 1                               | closed                                                    |
| PATCH 2                               | partial — 12 ghost кейсов ждут fix                        |
| PATCH-DERGELEVA-GHOST-VS-LIVE         | **root cause found: useTicket missing user_id**           |
| PATCH-CASE-KOROLYOVA-REVOKE           | preliminary root cause, final proof pending               |
| PATCH-GHOST-PLACEHOLDER-NORMALIZATION | discovery done, remediation plan ready                    |
| PATCH-CONTACT-IDENTITY-SPLIT          | **downgraded: not routing split, but resolver field bug** |
| PATCH 3 illegal_bonus_access          | pending (discovery можно начинать)                        |
| PATCH 4 duration drift                | pending (независим)                                       |
