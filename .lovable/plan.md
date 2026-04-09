# Да, согласен, с учетом правок:

&nbsp;

1. План в целом правильный по структуре:
  **A — Людмила canonical proof**,
  **B — display layer**,
  **C — Наталья / renewal flow**.
  Так и оставляем.
2. По **PATCH A (Людмила / Production)** добавь жёсткое правило исполнения:
  &nbsp;
  - сначала preview,
  - потом сразу execute,
  - потом сразу SQL-proof,
  - потом сразу повторный preview = already_satisfied.
  &nbsp;
  Не оставлять entitlement в expired дольше, чем на один короткий proof-run.
3. По Людмиле в SQL-proof добавь еще два обязательных пункта:
  &nbsp;
  - запись в audit_logs или access_grant_ledger, что реактивация произошла именно через rules-retroapply;
  - meta.source_type = retroapply, без ручных промежуточных маркеров, которые могут замаскировать повторную ручную правку.
  &nbsp;
4. По **PATCH B (display layer)** план пока слишком мягкий. По скринам видно, что проблема еще не закрыта:
  в сделках у Людмилы по-прежнему показывается **родительский курс**, а не модуль.
  Значит, в план надо добавить не просто “browser-proof”, а:
  &nbsp;
  - найти **конкретный consumer**, который в этом экране все еще не берет canonical display name;
  - исправить именно его;
  - затем дать повторный browser-proof по двум экранам:
    &nbsp;
    - Людмила,
    - Зимко.
    &nbsp;
  &nbsp;
5. Отдельно добавь в PATCH B явный DoD по Зимко:
  &nbsp;
  - модульные сделки отображаются как **два модуля** с правильными именами,
  - не создаются новые “левые” сделки на родительский курс,
  - суммы и даты совпадают с подтвержденными данными.
  &nbsp;
6. По **PATCH C (Казачок Наталья)** это уже настоящий root cause, и здесь план хороший. Но нужно жестко разделить:
  &nbsp;
  - **исправление кода для будущих renewals** — через bepaid-webhook -> grant-access-for-order;
  - **ремонт текущего состояния Натальи** — отдельно, через RetroApply / canonical repair.
    Иначе подрядчик “починит будущее”, а текущая клиентка так и останется без доступов.
  &nbsp;
7. По Наталье добавь отдельный блок:
  **“Current-state repair for Kazachok”**
  &nbsp;
  - восстановить положенные entitlements сейчас;
  - дать SQL-proof;
  - только потом считать issue закрытым.
    Потому что webhook fix сам по себе **не переиграет** уже прошедшее продление.
  &nbsp;
8. По Наталье формулировку про ea98d043 оставить, но сделать жёстче:
  &nbsp;
  - если нет доказанного standalone purchase на этот модуль, entitlement **не выдавать**;
  - текущий expired entitlement зафиксировать как legacy/backfill anomaly;
  - не продлевать его автоматически.
  &nbsp;
9. В PATCH C добавь обязательный proof после фикса webhook:
  &nbsp;
  - по **новому тестовому renewal** или по безопасному replay/canonical simulation,
  - должен появиться access_grant_ledger,
  - должен быть trace вызова grant-access-for-order,
  - secondary grants должны реально построиться.
    Иначе будет только “мы добавили вызов в код”, без доказательства, что путь живой.
  &nbsp;
10. В плане не хватает отдельного запрета на legacy-логику в renewal flow. Добавь:

&nbsp;

&nbsp;

&nbsp;

- новый патч **не должен** усиливать inline legacy обработку по product_code;
- grant-access-for-order должен стать **единственным** каноническим путём secondary grants;
- inline legacy branch можно временно оставить только для primary-safe compatibility, но без дальнейшего расширения.

&nbsp;

&nbsp;

&nbsp;

11. Добавь еще один STOP-guard:

&nbsp;

&nbsp;

&nbsp;

- не закрывать задачу, пока по Наталье не будет доказано одновременно:
  &nbsp;
  - grant-access-for-order реально вызывается из renewal flow,
  - текущие missing grants восстановлены,
  - следующий renewal не требует ручного RetroApply.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

12. Финальный порядок я бы зафиксировал так:

&nbsp;

&nbsp;

&nbsp;

- **A1** Людмила Production canonical proof
- **A2** Людмила display fix
- **B1** Зимко display/data correction
- **C1** webhook renewal fix
- **C2** current-state repair Натальи
- **C3** proof future renewal path
- только потом consolidated cohort dry-run.

&nbsp;

&nbsp;

&nbsp;

13. И еще одна важная правка по формулировкам:
  в отчете и плане не писать больше как логические идентификаторы cb20, cb2 и подобное.
  Разрешить только такой формат:

&nbsp;

&nbsp;

&nbsp;

- product_id
- public_id
- display_name
- при необходимости отдельно: legacy product_code (read-only reference)

&nbsp;

&nbsp;

&nbsp;

14. Итог: план годный, но **без этих правок его рано исполнять**, потому что иначе можно закрыть Людмилу формально, а Зимко и Наталья останутся недочиненными.

&nbsp;

&nbsp;

План: Canonical proof + Казачок fix + display layer

## Диагностика

### A. Людмила — Production entitlement `2687b521`

**Текущее состояние**: `status=active`, `expires_at=2026-05-05`, meta содержит `source_type: retroapply`, `source_rule_id: 1b497fba`, `business_subscription_id: e867f292`. Однако это результат ручной перезаписи meta (`CANONICAL-REPLACE-2026-04-09`), а не прохождения через rule engine. Retail entitlement `176e08a9` — полностью канонический (создан RetroApply), его не трогаем.

### B. Людмила — Display names

4 модульных заказа в `orders_v2`:

- 1× Розница (`MANUAL-RESTORE-001`, `display_purchase_name = ЦБ 2.0: Розничная торговля`)
- 3× Производство (GC-3822722, GC-3823669, GC-3824629, `display_purchase_name = ЦБ 2.0: Производство`)

Все имеют `historical_purchase_type = module_only_standalone` + корректный `module_list_mapped`. Display layer (`getDealDisplayName`) уже приоритизирует `display_purchase_name` для таких сделок. Нужен browser-proof.

### C. Казачок Наталья — корневая причина

**Критический баг**: subscription renewal webhook (`bepaid-webhook/index.ts`, строки 1574-1618) обрабатывает entitlements **inline** по `product_code` (legacy!) и **НЕ вызывает `grant-access-for-order**`. Значит secondary grants (access_rules) при продлении подписки не срабатывают.

Факты:

- Сегодня 09.04 в 13:45 оплачен заказ `fac49672` (BUSINESS renewal)
- Создана подписка `c30f04c3` (active, до 2026-05-09)
- `access_grant_ledger` по этому `order_id`: **0 записей**
- `audit_logs`: только `bepaid.subscription.processed`, нет `grant-access`
- Entitlement `45d5f391` (Учет у ИП, `ea98d043`) → `expired` в 12:00 (привязан к старой BUSINESS `eba308ca`)
- Entitlement `664332ed` (parent course `7101ed3c`) → `expired` в 12:00
- Entitlement `9a7c303c` (Деньги BY, `c153c811`) → `expired` в 12:00

Все три должны были быть reactivated/re-aligned при продлении BUSINESS. Не произошло, потому что `grant-access-for-order` не был вызван.

**Важное уточнение по prior_purchase**: Казачок имеет `base_tariff_purchase` для `7101ed3c` (а не module_only_standalone). Rule `1b497fba` работает в режиме `per_product`: каждый target требует отдельного paid order. У Казачок есть paid order только на `7101ed3c` — значит rule должен выдать доступ к `7101ed3c`, но НЕ к `ea98d043` (модуль Учет у ИП), на который у неё нет отдельного заказа. Entitlement на `ea98d043` был создан ранее через `historical_backfill` — это аномалия, которую нужно зафиксировать.

---

## PATCH A: Canonical proof для Production у Людмилы

### Шаги

1. **Expire** entitlement `2687b521` → `status = expired`, добавить в meta `deactivated_for_canonical_proof: true`, `deactivated_at: <timestamp>`
2. **НЕ трогать** Retail entitlement `176e08a9` (уже каноничен)
3. **RetroApply preview** для Людмилы:
  - `user_ids: ["eb39c79d-2588-4ab6-b831-7cd2d5a1641d"]`
  - `target_product_ids: ["064dd768-de8b-40db-89bc-f8d4a7e442ba"]`
  - `rule_ids: ["1b497fba-031a-4318-8d9f-2530f1bac116"]`
4. **Ожидаемый результат preview**: category = `missing_access` (expired entitlement found → reactivation path)
5. **Execute** → entitlement reactivated через rule engine
6. **SQL-proof block** (обязательный):
  ```
   status = 'active'
   expires_at = '2026-05-05 20:59:59+00'
   meta.source_rule_id = '1b497fba-031a-4318-8d9f-2530f1bac116'
   meta.retroapply_reactivated = true
   meta.previous_status = 'expired'
   meta.business_subscription_id IS NOT NULL
  ```
7. **Повторный preview** → `already_satisfied`

### STOP-guard

- Только entitlement `2687b521` (Production)
- Retail `176e08a9` не трогать
- Никаких других пользователей

---

## PATCH B: Display layer browser-proof

### Действия

1. Открыть карточку Людмилы в админке
2. Проверить, что сделки показываются как:
  - «ЦБ 2.0: Розничная торговля» (не «Ценный бухгалтер | 1 ступень 2.0»)
  - «ЦБ 2.0: Производство» (не «Ценный бухгалтер | 1 ступень 2.0»)
3. Проверить, что в Доступах одновременно видны курс + Производство + Розница
4. Grep-proof по display layer (список файлов, использующих `getDealDisplayName`)

---

## PATCH C: Казачок Наталья — исправление subscription renewal flow

### Корневой баг

`bepaid-webhook/index.ts`, строки 1574-1618: subscription renewal обрабатывает entitlements inline по `product_code` и **не вызывает `grant-access-for-order**`. Это означает, что при каждом продлении BUSINESS:

- Primary entitlement обновляется inline (legacy path)
- Secondary grants (rules, prior_purchase, bonus) — **не выполняются**
- Expired rule-based entitlements не реактивируются

### Исправление

После inline entitlement upsert (строка ~1618), добавить вызов `grant-access-for-order` с `orderId = orderV2Id`. Это обеспечит:

- Прохождение через access-resolver
- Обработку всех access_rules для тарифа
- Реактивацию expired secondary entitlements
- Запись в `access_grant_ledger`

### Безопасность

- `grant-access-for-order` уже идемпотентен (проверяет `already_fulfilled`)
- Inline primary entitlement upsert не конфликтует — grant-access тоже проверяет existing entitlement
- Нужно убедиться, что subscription уже создана/обновлена ДО вызова grant-access (порядок уже соблюдается)

### Proof по Казачок

После деплоя фикса:

1. Прогнать RetroApply для Казачок по rule `1b497fba`:
  - `user_ids: ["6b0e0451-c01b-4cd9-8fc4-dd7e83fd5c65"]`
  - Ожидание: entitlement на `7101ed3c` (parent course) → reactivated/extended до 2026-05-09
  - Entitlement на `c153c811` (Деньги BY, rule `6ba9727e`) → reactivated до 2026-05-09
2. **Для `ea98d043` (Учет у ИП)**: у Казачок НЕТ paid order на этот модуль отдельно, rule `per_product` НЕ должен его выдать. Текущий expired entitlement — аномалия от `historical_backfill`. Зафиксировать как `anomaly_from_backfill`.
3. SQL-proof:
  ```
   Entitlement 664332ed (7101ed3c): status=active, expires_at=2026-05-09
   Entitlement 9a7c303c (c153c811): status=active, expires_at=2026-05-09
   Entitlement 45d5f391 (ea98d043): status=expired (корректно — нет prior_purchase)
  ```

### DoD по Казачок

- Доступ к parent course восстановлен через rule engine
- Доступ к Деньги BY восстановлен через rule engine
- Учет у ИП остаётся expired (нет основания)
- Trace в `access_grant_ledger` по order_id / RetroApply batch
- При следующем продлении BUSINESS → `grant-access-for-order` вызывается автоматически

---

## Порядок исполнения


| Шаг | Действие                                                                            | Блокирует |
| --- | ----------------------------------------------------------------------------------- | --------- |
| A1  | Expire `2687b521`, RetroApply preview+execute                                       | —         |
| A2  | SQL-proof по Людмиле                                                                | A1        |
| B1  | Browser-proof display (Людмила)                                                     | A2        |
| C1  | Fix `bepaid-webhook` subscription renewal → добавить вызов `grant-access-for-order` | —         |
| C2  | Deploy `bepaid-webhook`                                                             | C1        |
| C3  | RetroApply для Казачок                                                              | C2        |
| C4  | SQL-proof по Казачок                                                                | C3        |
| D   | Consolidated dry-run по когорте (отдельный следующий шаг)                           | A+B+C     |


## STOP-guards

1. Не запускать cohort execute
2. Не трогать Retail entitlement Людмилы
3. Не создавать entitlement на `ea98d043` для Казачок (нет основания)
4. Не строить логику на `product_code` / legacy codes
5. `orders_v2.product_id` в исторических заказах не менять
6. Задачу не считать закрытой, пока не доказаны все три кейса

## Изменяемые компоненты


| Файл                                         | Действие                                                                                            |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `supabase/functions/bepaid-webhook/index.ts` | Добавить вызов `grant-access-for-order` после inline entitlement upsert в subscription renewal flow |
| `entitlements` (данные)                      | Expire `2687b521` → canonical reactivation через RetroApply                                         |
| Edge function deploy                         | `bepaid-webhook`, `rules-retroapply`                                                                |
