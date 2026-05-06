# Диагностика: orders ↔ entitlements ↔ training visibility

**User:** finassist.by@gmail.com / `a832c11e-1715-4646-bfcb-859fff931a0e`
**Дата:** 2026-05-06 (Minsk)
**Скоуп:** read-only. Никаких write.

## 0. Не выполнялось

- no UPDATE / INSERT / DELETE
- no grant / revoke / replay / retroapply
- no resolver / writer / UI changes
- no entitlement repair
- migration tool не вызывался

## 1. orders_v2 (paid, релевантные)

| order_number | order_id | product_id | product_name | tariff_id | source |
|---|---|---|---|---|---|
| GIFT-26-MOSCKHKU | `19a9a702…` | `ea98d043` | Учет у ИП | `5d6b73f3` | admin_grant |
| GIFT-26-MOSCJXYW | `76b5d268…` | `f833c846` | Строительство | `cbc9a3a2` | admin_grant |
| GIFT-26-MOSCJLRV | `328257af…` | `abee24cd` | Розничная торговля | `0f5183d8` | admin_grant |
| GIFT-26-MOSCJ3ZB | `16dc5fe6…` | `064dd768` | Производство | `c12acda3` | admin_grant |
| GIFT-26-MOSCIYVC | `8b3250ad…` | `99f1f156` | ПВТ | `7f69656c` | admin_grant |
| GIFT-26-MOSCIKFF | `77106e5d…` | `9187db54` | Общепит | `c31bf65f` | admin_grant |
| GIFT-26-MOSCIB2B | `bf9b10d2…` | `64d9f812` | Грузо/пасс. | `2c84e74c` | admin_grant |
| GC-3811270 | `3e27ce90…` | `7101ed3c` | ЦБ \| 1 ступень 2.0 (parent) | `9bc81736` | legacy GC |
| SUB-* (×4 paid) | … | `11c9f1b8` | Gorbova Club | `7c748940` | bepaid sub |
| MIG-ZG-ROW-150 | `74b173fe…` | `73c29914` | (ZG) | `56c35e86` | migration |

Активная подписка `subscriptions_v2`: `tariff_id=7c748940` (Gorbova Club).

## 2. entitlements (12 active, source-truth)

| product_id | product_name | mode | meta.tariff_id | hist_module_pids | source_type | source_rule_id |
|---|---|---|---|---|---|---|
| `7101ed3c` | ЦБ parent | full | `9bc81736` | `[d7effaf4]` | rule_engine | `1b497fba` |
| `d7effaf4` | Маркетплейсы | module_scope_only | — | `[4c97d21c]` ✅ repaired | rule_engine | `1b497fba` |
| `99f1f156` | ПВТ | full | `7f69656c` | `[]` | rule_engine | `1b497fba` |
| `f833c846` | Строительство | full | `cbc9a3a2` | `[]` | rule_engine | `1b497fba` |
| `ea98d043` | Учет у ИП | full | `5d6b73f3` | — | retroapply | `1b497fba` |
| `064dd768` | Производство | full | **NULL** | — | **retroapply** | `1b497fba` |
| `64d9f812` | Грузо | full | **NULL** | — | **retroapply** | `1b497fba` |
| `9187db54` | Общепит | full | **NULL** | — | **retroapply** | `1b497fba` |
| `abee24cd` | Розница | full | **NULL** | — | **retroapply** | `1b497fba` |
| `4fc18564` | Подоходный | full | — | `[]` | rule_engine | `ffe27040` |
| `c153c811` | Деньги BY | (null) | — | — | rule_engine | `6ba9727e` |
| `11c9f1b8` | Gorbova Club | (null) | — | — | primary_order_fulfillment | — |

⚠ Все «модульные» entitlements выданы НЕ через `grant-access-for-order`
(прямой fulfillment GIFT-сделок), а через `rule_engine` /
`retroapply` от bonus-правила Gorbova Club
`access_rules.id=1b497fba…` (`grant_target_type=product_access`,
`tariff_id=7c748940`, `target_label="9 продуктов: …"`).

## 3. access_rules `grant_target_type='training_content'` (visibility-rules)

| product_id | product | rules_count | tariff_id'ы правил | mode |
|---|---|---|---|---|
| `7101ed3c` ЦБ parent | 3 | `543940b1`, `adbe94e8`, `9bc81736` | partial |
| `064dd768` Производство | 1 | NULL (product-level) | full |
| `64d9f812` Грузо | 1 | NULL | full |
| `9187db54` Общепит | 1 | NULL | full |
| `abee24cd` Розница | 1 | NULL | full |
| `ea98d043` Учет у ИП | 1 | NULL | full |
| `4fc18564` Подоходный | 1 | NULL | full |
| `c153c811` Деньги BY | 1 | NULL | full |
| `11c9f1b8` Gorbova Club | 3 | `7c748940`, `b018e9be`, `b276d8a5` | partial (target=`8b1fb03e` База знаний) |
| **`d7effaf4` Маркетплейсы** | **0** | — | — |
| **`99f1f156` ПВТ** | **0** | — | — |
| **`f833c846` Строительство** | **0** | — | — |

## 4. training_modules (root) и наличие уроков

Все 12 продуктов имеют активный root `training_modules` с lessons:

| product | root training_module_id | lessons |
|---|---|---|
| `064dd768` | `a4a5102d` | 4 |
| `64d9f812` | `8f71d4a8` | 4 |
| `9187db54` | `841650a9` | 4 |
| `abee24cd` | `1ede03b4` | 4 |
| `99f1f156` | `b1199440` | **0** ⚠ |
| `f833c846` | `b7bae7fd` | **0** ⚠ |
| `d7effaf4` | `4c97d21c` | 4 |
| `ea98d043` | `881d514f` | 1 |
| `4fc18564` | `533aaa3f` | 11 |
| `c153c811` | `c21fcd81` | 2 |
| `7101ed3c` | `c9f7e9b8` | 106 |
| `11c9f1b8` | `8b1fb03e` | 149 |

## 5. Resolver-симуляция (`useTrainingContentRules` + `useTrainingModules`)

`userTariffIds` (из subv2) = `[7c748940]`
`entitlementTariffsByProduct` собирает только по `meta.tariff_id` из ent.
`productsWithManualEnt` (P4.5) содержит product_id, у которых ent есть, но
`meta.tariff_id` НЕ UUID **и** `scope_resolution_mode ∈ {null, full_tariff_scope}`.

| product | DB-rule | meta.tariff_id | mode | Resolver путь | Результат |
|---|---|---|---|---|---|
| `7101ed3c` ЦБ parent | partial(`9bc81736`) | `9bc81736` | full | P1 db_tariff (eff.tariff `9bc81736` из ent) | partial root visible |
| `d7effaf4` Маркетплейсы | none | — | module_scope_only | synthetic_bonus → partial, allowed=`[4c97d21c]` | visible (после repair) |
| `99f1f156` ПВТ | none | `7f69656c` | full | no DB-rule, no synthetic → resolver returns null → has_access=true НО **0 lessons** | **HIDDEN_BY_NO_LESSONS** |
| `f833c846` Строительство | none | `cbc9a3a2` | full | то же | **HIDDEN_BY_NO_LESSONS** |
| `ea98d043` Учет у ИП | full(prod-level) | `5d6b73f3` | full | P2 db_product → full | visible |
| `064dd768` Производство | full(prod-level) | NULL | full | P2 db_product → full | visible |
| `64d9f812` Грузо | full(prod-level) | NULL | full | P2 db_product → full | visible |
| `9187db54` Общепит | full(prod-level) | NULL | full | P2 db_product → full | visible |
| `abee24cd` Розница | full(prod-level) | NULL | full | P2 db_product → full | visible |
| `4fc18564` Подоходный | full(prod-level) | — | full | P2 → full | visible |
| `c153c811` Деньги BY | full(prod-level) | — | null mode | P2 → full | visible |
| `11c9f1b8` Gorbova Club (root=База знаний) | partial(`7c748940`) | — | null | P1 db_tariff (subv2 `7c748940`) → partial | visible как «База знаний» |
| `73c29914` ZG | (нет ent) | — | — | has_access=false | NOT_TRAINING_VISIBLE |

## 6. UI-фильтр «Незавершённые» (скриншот)

На скриншоте в правом верхнем углу включён фильтр **«Незавершённые»**.
В `Learning.tsx` `libraryModules` сам фильтр прогресса не применяет, он
делается в `LibraryTableView` поверх `libraryModules`. Если у root-модуля
**0 lessons** (ПВТ, Строительство), `recursive_lesson_count=0`, и при
фильтре «Незавершённые» (`completed < total` ⇒ `0 < 0` false) карточка
скрывается **дополнительно** к проблеме отсутствия контента.

## 7. Сравнение «UI ожидает vs UI показывает»

Скриншот показывает 9 строк (фильтр «Незавершённые» включён):
Деньги BY, Подоходный, ЦБ parent, Грузо, Маркетплейсы, Общепит,
Производство, Розница, Учёт у ИП.

Не видны: **ПВТ**, **Строительство**, Gorbova Club как тренинг (он
рендерится как «База знаний» — уже видно), ZG (тренинга нет).

Соответствует resolver-симуляции выше.

## 8. Итоговая классификация по продуктам

| product | классификация |
|---|---|
| ЦБ parent `7101ed3c` | VISIBLE_BY_ACCESS |
| Маркетплейсы `d7effaf4` | VISIBLE_BY_ACCESS (после repair 2026-05-06) |
| Учет у ИП `ea98d043` | VISIBLE_BY_ACCESS |
| Производство `064dd768` | VISIBLE_BY_ACCESS |
| Грузо `64d9f812` | VISIBLE_BY_ACCESS |
| Общепит `9187db54` | VISIBLE_BY_ACCESS |
| Розница `abee24cd` | VISIBLE_BY_ACCESS |
| Подоходный `4fc18564` | VISIBLE_BY_ACCESS |
| Деньги BY `c153c811` | VISIBLE_BY_ACCESS |
| Gorbova Club `11c9f1b8` | VISIBLE_BY_ACCESS (как «База знаний») |
| **ПВТ `99f1f156`** | **HIDDEN_BY_NO_LESSONS** |
| **Строительство `f833c846`** | **HIDDEN_BY_NO_LESSONS** |
| ZG `73c29914` | NOT_TRAINING_PRODUCT (нет entitlement) |

## 9. Root-cause гипотезы (ранжированы)

**H1 (главная).** ПВТ (`99f1f156`) и Строительство (`f833c846`) скрыты
не из-за access, а потому что в `training_lessons` для их root-модулей
(`b1199440`, `b7bae7fd`) — **0 активных уроков**.
- entitlement.status=active ✅
- access_rules training_content full ❌ (нет правил, но resolver→null=full)
- `recursive_lesson_count=0` → карточка либо скрывается, либо при
  фильтре «Незавершённые» отфильтровывается.
- Это **content/data task**, не access task.

**H2.** «4 модуля без `meta.tariff_id`» (Производство/Грузо/Общепит/Розница)
— это НЕ ошибка writer'а GIFT-сделок. GIFT-orders фактически НЕ
породили entitlements напрямую. Все 9 модульных ent выданы
`rule_engine`/`retroapply` через bonus-правило
`access_rules.id=1b497fba…` от подписки Gorbova Club. Retroapply-writer
не пробрасывает `meta.tariff_id` (только `historical_tariff_id`). Эти
ent визуально выглядят «потерянными», но видны через P2 (product-level
DB-rule access_rules training_content).
- НЕ требует data-fix entitlements (они работают).
- Открытый вопрос: должен ли `grant-access-for-order` для GIFT-orders
  тоже создавать entitlements (тогда бы они были с `meta.tariff_id`).
  Это **отдельная задача** на writer-аудит.

**H3.** Цепочка orders↔entitlements у этого user'а нестандартная:
- 7 GIFT (admin_grant) сделок не привели к прямым entitlements.
- Доступ материализовался через подписку Gorbova Club + bonus-правило.
- Если подписка отвалится → bonus-правило перестанет давать ent →
  модули исчезнут. Это семантика «бонус», не «купленный доступ».
- Вопрос для бизнеса: GIFT-сделки должны выдавать **прямой** ent
  (через `grant-access-for-order`) **и** не зависеть от Club-подписки?

## 10. Рекомендации для следующих задач (НЕ выполнять сейчас)

Раздельные patch-кандидаты:

1. **Content / data task** (приоритет 1, отдельный approve):
   Проверить с продактом, должны ли в ПВТ (`99f1f156`) и Строительство
   (`f833c846`) быть уроки. Если да — заполнить `training_lessons`.
   Это не resolver/writer issue.

2. **Writer аудит GIFT/admin_grant** (приоритет 2):
   Должен ли `grant-access-for-order` для `source=admin_grant` создавать
   прямой entitlement (с `meta.tariff_id` из order'а), помимо
   bonus-правила? Сейчас GIFT-сделки фактически no-op в части
   entitlements (всё делает rule_engine от Club-подписки). Это меняет
   семантику «у пользователя есть купленный доступ vs бонусный».
   Решение бизнес-уровня.

3. **Нет проблемы UI-фильтра как root-cause.** Фильтр «Незавершённые»
   усугубляет H1 (если уроков 0 → автоматически прячется), но без
   уроков карточка всё равно бесполезна. Если бизнес хочет показывать
   «пустой» курс — отдельная UX-задача.

4. **Ничего НЕ менять в resolver / `useTrainingContentRules` /
   writers.** Текущее поведение корректно для имеющихся данных.

## 11. Hardcode-policy gate

Файл не содержит запрещённых product code/slug. Используются только
UUID и `product_name`.

```
LEGACY_PRODUCT_TOKENS='cb20|CB20'
rg -n "$LEGACY_PRODUCT_TOKENS" .lovable/proofs/finassist_access_resolver_diagnostic_2026_05.md
# expected: 0 matches
```

## 12. Ничего не правится этим proof'ом

Только классификация и рекомендации. Любой fix — **отдельная задача с
approve**.
