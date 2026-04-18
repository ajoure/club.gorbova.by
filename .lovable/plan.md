да, согласен, с учетом правок:

1. В **Шаге 1 (P2)** зафиксируй точнее:
  - terminal proof через admin test payment делать **обязательно**, если он не списывает реальные деньги и уже признан штатным тестовым путём;
  - если этот путь безопасен, не ограничиваться только pending+snapshot.
2. В **Шаге 2 (P3)** уточни правило:
  - **прямой INSERT в payment_links допустим только как proof-fixture**, если discovery подтвердит отсутствие writer-а;
  - в отчёте это должно быть явно помечено как **ручной seed для proof**, а не как продуктовый сценарий;
  - после proof либо удалить test row, либо явно пометить его как тестовый артефакт.
3. В **Шаге 3 (P4a)** исправь ожидаемый результат.  
Сейчас у тебя написано:
  - reason='no_offer_for_tariff', resolved_via='offer_id' или 'tariff_fallback'.
4. Это нужно разнести на **два разных сценария**, потому что это не одно и то же:  

  - если в запросе **есть offer_id**, negative reason будет идти по ветке **offer-level** (routing_disabled_or_missing / аналогичный offer-level reason), а не no_offer_for_tariff;
  - no_offer_for_tariff бывает только когда резолв идёт **без offer_id, по tariff_id fallback**.  
  Иначе proof будет логически некорректным.
5. Добавь в **Discovery (Шаг 0)** ещё один обязательный пункт:
  - проверить, не отправляет ли public-канал offer_id всегда автоматически из самой row payment_links;
  - если да, то P3-fallback через public /pay/:token **невоспроизводим без специального seed-а row без offer_id**, и это нужно заранее зафиксировать, а не выяснять в середине proof.
6. В **финальном отчёте** добавь отдельную колонку или поле:
  - **resolved_via**
  - и отдельно **snapshot.reason** для negative-cases.  
  Иначе по P4a/P4b будет трудно отличить positive/negative ветку и источник резолва.
7. Добавь отдельный раздел **Cleanup after proof**:
  - какие тестовые payment_links / orders_v2 / test rows были созданы;
  - что из этого удалено;
  - что оставлено и почему.  
  Это особенно важно, если будет ручной seed.
8. В **DoD** уточни P3:
  - если public writer отсутствует, P3 считается не “просто open”, а **blocked с конкретной причиной и отдельным PATCH-именем**;
  - в отчёте должен быть явный mapping: blocked because <reason> → next patch: <name>.
9. Зафиксируй ещё один инвариант:
  - для всех сценариев proof проверять не только snapshot и стадии, но и что **downstream не сломан**: redirect_url/checkout создаётся, order создаётся, ошибка routing не валит сам платёжный сценарий.

&nbsp;

В остальном план собран правильно.

&nbsp;

# План: B.0 live-proof (исполнение с доп. ограничениями)

## Доп. вводные от пользователя (зафиксировано)

- Учётка для proof: **[7500084@gmail.com](mailto:7500084@gmail.com)** (не [gelaev46@gmail.com](mailto:gelaev46@gmail.com)).
- Реальную оплату 500 BYN не делать. Минимальная сумма + admin test payment там, где возможно.
- Никаких новых payment-path ради proof.
- При отсутствии writer'а у public-канала — STOP, оформить отдельным PATCH, не маскировать proof.

## Порядок исполнения (строго)

### Шаг 0. Discovery (обязательный, до любых proof)

Цель — снять неопределённость по public-каналу до того, как создавать row в `payment_links`.

Зафиксировать в отчёте 4 пункта:

1. Кто пишет в `payment_links` (поиск writer-а: edge functions, RPC, admin UI). Кандидат-имя `create-public-payment-link` уже всплывало — проверить, существует ли реально и используется ли где-либо.
2. Где `public-checkout` берёт `offer_id` и `tariff_id` (уже статически подтверждено: из row `payment_links` напрямую, поля `offer_id`, `tariff_id`, `product_id`).
3. Какой writer реально создаёт row в `payment_links` сейчас: код / admin UI / отсутствует.
4. Расхождение preview vs published по этому каналу (роуты `/pay/:token`, RLS на `payment_links`).

**STOP-условие:** если writer отсутствует или сломан — остановиться, P3 не делать, оформить отдельный PATCH "payment_links writer", честно отметить P3 как незакрытый.

### Шаг 1. P2 — Admin UI с явным offer_id (positive exact)

- Залогиниться как **[7500084@gmail.com](mailto:7500084@gmail.com)**.
- Через `AdminPaymentLinkDialog` создать ссылку с явным `offer_id` для тарифа с routing-enabled оффером.
- **Сумма:** минимально допустимая по бизнесу (если тариф позволяет — 100 коп = 1 BYN; иначе минимум, который пропускает валидация).
- Проверить order: `meta.crm_routing_snapshot.resolved_via='offer_id'`, `pipeline_id`, `pipeline_stage_id`.
- Terminal proof для P2: **admin test payment** через `bepaid-create-token` (admin testing path, не новый payment-path), либо просто остановиться на pending+snapshot, если test payment рискует списать реальные деньги.

### Шаг 2. P3 — Public /pay/:token (только если Шаг 0 не дал STOP)

- Если writer есть: засидить row через writer (не через прямой SQL, чтобы не создавать обходной payment-path).
- Если writer отсутствует, но безопасный seed возможен через прямой `INSERT` в `payment_links` (read-only сейчас невозможно, но в default mode — да): сидить **минимальную сумму** и зафиксировать, что row создан вручную как часть proof, а не как продакшен writer.
- Зафиксировать pending + snapshot + routing resolution (resolved_via='offer_id').
- **Terminal proof:** только если bePaid sandbox/test environment реально доступен и безопасен. Иначе — terminal proof перенести, явно зафиксировать в отчёте.

### Шаг 3. P4a — no_offer_for_tariff (live, безопасно)

- Создать payment link через admin UI на тариф **без** routing-enabled офферов (кандидат `b276d8a5-...` FULL уже найден).
- Сумма минимальная.
- Проверить: order создан, `pipeline_id IS NULL`, snapshot `enabled=false reason='no_offer_for_tariff' resolved_via='offer_id'` (если offer_id передан) или `'tariff_fallback'`.
- Audit `crm_routing_snapshot_negative` присутствует.
- Downstream не сломан (checkout url выдан).
- **Без оплаты** — pending уже доказывает negative snapshot.

### Шаг 4. P4b — ambiguous_offers_for_tariff

- **Только unit + static proof.** Временный second offer в продакшене не создавать.
- Static: показать ветку кода `resolveOfferRoutingWithFallback` → `ambiguous_offers_for_tariff`.
- Unit: уже зелёный Deno-тест.
- В отчёте отдельным абзацем: почему не делали live, что это осознанное решение по чистоте продакшен-данных.

## Финальный отчёт (структура, обязательная)

1. **Discovery (Шаг 0):**
  - writer payment_links: найден / не найден / broken
  - public-checkout payload mapping
  - preview vs published расхождения
  - Решение: продолжаем proof или STOP+PATCH
2. **Per-scenario:**
  | Сценарий | Канал | Email | user_id | Сумма | Live/Test/Static | order_id | Snapshot | Result |
   | P2 exact | Admin UI | [7500084@gmail.com](mailto:7500084@gmail.com) | ... | ... | ... | ... | resolved_via='offer_id' | OK/FAIL |
   | P3 public | /pay/:token | ... | ... | ... | pending|terminal|skipped | ... | ... | ... |
   | P4a no_offer | Admin UI | [7500084@gmail.com](mailto:7500084@gmail.com) | ... | ... | live pending | ... | enabled=false reason=no_offer_for_tariff | OK/FAIL |
   | P4b ambiguous | static+unit | — | — | — | static | — | code path proof | OK |
3. **Незакрытое:**
  - Что осталось не покрыто live (например, P3 terminal)
  - Причина (нет writer / нет sandbox / небезопасно)
  - Куда переносится (отдельный PATCH / следующий спринт)
4. **Подтверждение инвариантов:**
  - "Новый payment-path не создан" + перечисление неизменённых точек
  - snapshot пишется один раз при materialize, после insert не затирается
  - В каждом из 3 write-path snapshot present
  - `pipeline_id`/`pipeline_stage_id` ставятся только при positive snapshot
  - Negative snapshot не ломает создание заказа

## DoD

1. ✅ Discovery шаг 0 выполнен и задокументирован до любых seed-операций.
2. ✅ P2 закрыт live (как минимум pending+snapshot, terminal — если admin test payment безопасен).
3. ✅ P3: либо закрыт безопасно (pending обязателен, terminal по возможности), либо явно зафиксирован как unblocked с STOP-причиной и PATCH-задачей.
4. ✅ P4a закрыт live pending без реальной оплаты.
5. ✅ P4b закрыт unit+static с обоснованием отказа от live.
6. ✅ Учётка proof = [7500084@gmail.com](mailto:7500084@gmail.com), зафиксирована.
7. ✅ Никаких новых payment-path не создано.
8. ✅ Финальный отчёт по структуре выше.