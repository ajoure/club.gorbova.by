Да, согласен, с учетом правок:

&nbsp;

1. Не утверждай сразу «11 broken call-sites из 16 production paths» как окончательный факт без разделения на:
  &nbsp;
  - точно живые production paths,
  - legacy/сомнительные,
  - repair/admin-only,
  - cron-only,
  - dead-code candidates.
    Нужна отдельная колонка в матрице: **runtime status** = live / legacy-live / repair-only / suspicious / dead-candidate.
  &nbsp;
2. В PATCH A не пиши просто «исправить 11 файлов». Сначала добавь обязательный **discovery verdict по каждому broken месту**:
  &nbsp;
  - реально ли этот path исполняется в текущем runtime,
  - для какого сценария,
  - какой product/club он должен использовать,
  - можно ли его удалить вместо фикса.
    Иначе есть риск чинить мусорный legacy-код и плодить поддержку.
  &nbsp;
3. Усиль баг по grant-access-for-order:
  это не только snake_case bug, а **контрактный баг вызова canonical Telegram backend-path**.
  Попроси проверить во всех call-sites единый контракт:
  &nbsp;
  - user_id
  - club_id
  - source_id
  - source
  - при необходимости duration_days / reason
    И зафиксировать единый payload standard.
  &nbsp;
4. По club_id нельзя писать абстрактно «добавить club_id: product.telegram_club_id`, пока не доказано, что это везде каноничный источник.
  Нужно отдельное правило резолва club_id:
  &nbsp;
  - сначала через access_rules(grant_target_type='club', product_id=...)
  - если в path уже есть точный club_id — использовать его
  - прямой product.telegram_club_id только если это реально SoT для данного path.
    Иначе снова будут расхождения.
  &nbsp;
5. Вынеси отдельный **canonical Telegram grant helper**:
  сейчас проблема не только в параметрах, а в том, что разные места сами собирают payload по-разному.
  Нужен один shared helper/adapter для вызова telegram-grant-access, чтобы:
  &nbsp;
  - snake_case был единым,
  - source/source_id были едиными,
  - club_id резолвился одинаково,
  - новые вызовы не ломались снова.
  &nbsp;
6. По EditSubscriptionDialog.createTelegramAccess() формулировку сделай жёстче:
  не просто «удалить прямой insert», а:
  &nbsp;
  - полностью запретить любой UI write в telegram_access,
  - заменить кнопку/действие только на backend invocation,
  - провести grep-proof, что **кроме canonical backend functions** прямых insert/update в telegram_access больше нет.
  &nbsp;
7. Блок про false-pending нужно усилить:
  сейчас у тебя правильно отмечено, что telegram-grant-access сам тоже ставит pending до invite.
  Поэтому Discovery должен разделить pending минимум на 3 класса:
  &nbsp;
  - **valid-pending** — backend grant вызван, invite/ожидание входа реально есть;
  - **false-pending** — запись создана напрямую или без полного backend flow;
  - **stuck-pending** — backend flow стартовал, но invite/send/unban упал, а pending завис.
    Без этого repair будет слишком грубым.
  &nbsp;
8. По read-path UI добавь конкретную цель:
  UI не должен показывать одинаковое «в ожидании» для разных причин.
  Нужно хотя бы на уровне discovery определить, какие backend признаки доступны:
  &nbsp;
  - есть ли audit grant,
  - есть ли invite link / invite event,
  - есть ли error marker,
  - есть ли source/source_id.
    Даже если UI-изменение не в этом спринте, это надо явно зафиксировать.
  &nbsp;
9. По Светлане Василевской измени формулировку:
  сейчас у тебя написано, что pending — «штатное ожидание вступления». Это преждевременно.
  Нужно доказать:
  &nbsp;
  - был ли реальный вызов telegram-grant-access,
  - чем он закончился,
  - был ли создан invite,
  - был ли send,
  - какой audit trail,
  - есть ли error.
    Только после этого писать «штатное ожидание» или «stuck/false pending».
  &nbsp;
10. Cohort repair раздели на 2 очереди:

&nbsp;

&nbsp;

&nbsp;

- **Queue 1:** active subscription/access + revoked/removed → обязательный re-grant repair;
- **Queue 2:** pending > 24h → forensic classification before action, не всех подряд re-grant.
  Иначе можно задвоить приглашения или перетирать валидный pending.

&nbsp;

&nbsp;

&nbsp;

11. Добавь ещё один класс в discovery:

&nbsp;

&nbsp;

&nbsp;

- **active subscription/access, но вообще нет строки в telegram_access**.
  У тебя сейчас написано 0, но это нужно оставить как обязательную проверку в final proof, а не как промежуточную догму.

&nbsp;

&nbsp;

&nbsp;

12. Связь с платёжными путями распиши жёстче:
  для каждого payment/access path нужен итоговый verdict:

&nbsp;

&nbsp;

&nbsp;

- Telegram grant guaranteed,
- Telegram grant optional,
- Telegram grant broken,
- Telegram grant not applicable.
  Это нужно увязать с твоей общей задачей по «все пути денег → сделки → доступы → Telegram».

&nbsp;

&nbsp;

&nbsp;

13. В PATCH D repair добавь STOP-guard:

&nbsp;

&nbsp;

&nbsp;

- не делать re-grant, если пользователь уже в pending и есть свежий успешный backend grant след,
- не делать re-grant без подтверждённого club_id,
- не делать re-grant массово без dry-run списка.
  Для revoked + active subscription repair может быть автоматическим. Для pending — только после классификации.

&nbsp;

&nbsp;

&nbsp;

14. Добавь отдельный PATCH E / backlog:
  **state-machine cleanup внутри telegram-grant-access**:

&nbsp;

&nbsp;

&nbsp;

- pending до invite,
- отсутствие rollback,
- stuck pending при error,
- различие между “TG not linked” и “invite sent”.
  Сейчас это не надо чинить в этом патче, но нужно явно зафиксировать как техдолг, иначе проблема вернётся.

&nbsp;

&nbsp;

&nbsp;

15. В DoD дополни:

&nbsp;

&nbsp;

&nbsp;

- все живые production call-sites используют один canonical helper/contract;
- прямых UI write-path в telegram_access больше нет;
- revoked + active subscription/access после repair = 0;
- false-pending после repair = 0;
- по каждому repaired пользователю есть before/after proof;
- отдельно дан consolidated report по pending-классам;
- отдельно дан список legacy/dead candidates для последующего удаления.

&nbsp;

&nbsp;

&nbsp;

16. Финальную цель сформулируй так:
  результатом должен быть не просто «исправили 11 мест», а **единая Telegram access system**:

&nbsp;

&nbsp;

&nbsp;

- один canonical backend write-path,
- единый helper вызова,
- единый контракт payload,
- понятная классификация pending,
- отсутствие ложного pending,
- отсутствие active+revoked,
- прозрачный audit и source trace по каждому переходу состояния.

&nbsp;

&nbsp;

# План: Unified Telegram Access System — Discovery + 4 PATCH

## Discovery: Полная инвентаризация всех write-path Telegram

### Все call-sites `telegram-grant-access`


| #   | Файл                            | Строка | user_id       | club_id       | source_id               | Метод    | Verdict               |
| --- | ------------------------------- | ------ | ------------- | ------------- | ----------------------- | -------- | --------------------- |
| 1   | `grant-access-for-order`        | 938    | **camelCase** | **camelCase** | **camelCase `orderId**` | fetch()  | **BROKEN**            |
| 2   | `bepaid-webhook`                | 4417   | ✓             | **НЕТ**       | нет                     | invoke() | **BROKEN**            |
| 3   | `bepaid-webhook`                | 5310   | ✓             | ✓             | нет                     | invoke() | Canonical             |
| 4   | `bepaid-webhook`                | 5452   | ✓             | ✓             | нет                     | invoke() | Canonical             |
| 5   | `bepaid-webhook`                | 5496   | ✓             | **НЕТ**       | нет                     | invoke() | **BROKEN (fallback)** |
| 6   | `direct-charge`                 | 615    | ✓             | **НЕТ**       | нет                     | invoke() | **BROKEN**            |
| 7   | `direct-charge`                 | 1080   | ✓             | **НЕТ**       | нет                     | invoke() | **BROKEN**            |
| 8   | `telegram-webhook`              | 618    | ✓             | **НЕТ**       | ✓                       | invoke() | **BROKEN**            |
| 9   | `telegram-webhook`              | 682    | ✓             | **НЕТ**       | ✓                       | invoke() | **BROKEN**            |
| 10  | `telegram-webhook`              | 701    | ✓             | **НЕТ**       | нет                     | invoke() | **BROKEN (legacy)**   |
| 11  | `subscription-admin-actions`    | 828    | ✓             | **НЕТ**       | нет                     | invoke() | **BROKEN**            |
| 12  | `subscription-admin-actions`    | 942    | ✓             | **НЕТ**       | нет                     | invoke() | **BROKEN**            |
| 13  | `getcourse-import-deals`        | 1007+  | ✓             | ✓             | нет                     | invoke() | Canonical             |
| 14  | `payments-reconcile`            | 708    | **camelCase** | **НЕТ**       | нет                     | invoke() | **BROKEN**            |
| 15  | `admin-regrant-wrongly-revoked` | 182    | ✓             | ✓             | нет                     | invoke() | Canonical (repair)    |
| 16  | UI: `EditSubscriptionDialog`    | 367    | ✓             | ✓             | нет                     | invoke() | Canonical (manual)    |


**Итого: 11 BROKEN call-sites из 16 production paths.**

### Прямые insert/update в telegram_access


| #   | Файл                             | Строка   | Verdict                                        |
| --- | -------------------------------- | -------- | ---------------------------------------------- |
| 1   | `telegram-grant-access`          | 356, 590 | Canonical (backend)                            |
| 2   | `telegram-revoke-access`         | 412, 534 | Canonical (revoke)                             |
| 3   | `**EditSubscriptionDialog.tsx**` | **338**  | **BROKEN — прямой insert pending без backend** |


### Revoke/sync/repair paths

- `telegram-revoke-access`, `telegram-kick-violators`, `telegram-check-expired` — canonical
- `telegram-cron-sync`, `telegram-reinvite-ghosts`, `admin-regrant-wrongly-revoked` — canonical

---

## State-machine telegram-grant-access: pending flow


| Шаг | Что происходит                         | Состояние                              |
| --- | -------------------------------------- | -------------------------------------- |
| 1   | TG не привязан → upsert pending        | Допустимый pending (ожидание привязки) |
| 2   | TG привязан → upsert pending ДО invite | Кратковременный pending без invite     |
| 3   | unbanChatMember                        | pending + unbanned                     |
| 4   | createChatInviteLink                   | pending + invite создан                |
| 5   | Отправка invite пользователю           | pending + invite отправлен             |
| 6   | Пользователь вступил → sync → granted  | granted                                |


**Verdict:** Если шаги 3-5 упадут, pending останется навсегда. Нет rollback. Tech-debt, не чиним в этом спринте.

---

## Read-path UI

`EditSubscriptionDialog.tsx:527-536` проверяет ТОЛЬКО `state_chat`/`state_channel`. Не проверяет: invite, audit, source, last_error. UI показывает "в ожидании" при любом pending — включая прямой insert из строки 338.

**Баг:** pending показывается без доказательства реального backend grant.

---

## Forensic: Светлана Василевская

- state_chat = `pending`, state_channel = `pending`, active_until = `2026-05-13`
- `2026-04-12 21:00` — AUTO_REVOKE (cron)
- `2026-04-13 07:50` — MANUAL_GRANT (ok) — ручная выдача
- Текущий pending — результат MANUAL_GRANT через telegram-grant-access. Штатное ожидание вступления. Нужно проверить, был ли invite реально создан и отправлен (PATCH D).

---

## Масштаб пострадавших


| Класс                          | Count                                        |
| ------------------------------ | -------------------------------------------- |
| revoked + active subscription  | **13**                                       |
| pending + active subscription  | **155** (часть штатные, часть false-pending) |
| active sub, no telegram record | **0**                                        |


---

## Grace 72h и Telegram

Grace НЕ участвует в grant/pending/revoke flow. Не задерживает Telegram-выдачу. Не объясняет false-pending.

---

## 4 независимых PATCH

### PATCH A: Унификация всех backend call-sites

**11 файлов, единый контракт: `{ user_id, club_id, source_id?, source?, ... }` — snake_case, club_id обязателен.**

1. `grant-access-for-order` :938 — camelCase → snake_case, `orderId` → `source_id`
2. `bepaid-webhook` :4417 — добавить `club_id: productV2.telegram_club_id`
3. `bepaid-webhook` :5496 — добавить club_id или удалить dead fallback
4. `direct-charge` :615, :1080 — добавить `club_id: product.telegram_club_id`
5. `telegram-webhook` :618, :682, :701 — резолвить и добавить club_id
6. `subscription-admin-actions` :828, :942 — добавить `club_id: product.telegram_club_id`
7. `payments-reconcile` :708 — camelCase → snake_case, добавить club_id

### PATCH B: Запрет прямых UI write-path

**Файл:** `EditSubscriptionDialog.tsx`

- Удалить `createTelegramAccess()` (строки 332-355) — прямой insert
- Кнопка "Создать доступ" → вызывать `grantTelegramAccess()` (backend path)
- **Правило:** Никаких прямых UI insert/update в telegram_access

### PATCH C: Read-path UI (опционально)

- В карточке рядом с pending показывать индикатор: есть ли invite / была ли ошибка

### PATCH D: Cohort repair

1. **Dry-run:** SQL — 13 revoked users с active sub, before-state
2. **Execute:** вызвать telegram-grant-access для каждого с корректными параметрами
3. **Verify:** before/after proof
4. **155 pending:** drill-down — сколько с привязанным Telegram + pending > 24h → кандидаты на re-grant

---

## Что не делаем

- Не меняем telegram-grant-access внутреннюю логику
- Не меняем структуру таблиц / миграции
- Не трогаем revoke/sync/cron paths

## DoD

- Все 11 broken call-sites исправлены: snake_case + club_id
- Прямой UI insert в telegram_access удалён
- 13 revoked users repaired, before/after proof
- pending появляется только после backend grant path
- Нет active subscription + revoked Telegram state
- По Светлане — full forensic before/after
- Consolidated matrix write/read paths предоставлена
- Edge functions задеплоены
- Changed files list + diff-summary