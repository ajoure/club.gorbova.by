# дополни план следующей информацией:

&nbsp;

1. Это не должен быть финальный proof-пакет

&nbsp;

&nbsp;

&nbsp;

- Текущий текст — это fallback-отчёт при нестабильном браузере, а не закрытие proof.
- Прямо зафиксируй в плане/отчёте:
  &nbsp;
  - visual_proof = pending
  - code_proof = partial substitute only
  - v23.1 not closable without UI proof
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

2. Нельзя считать conflict proof закрытым

&nbsp;

&nbsp;

&nbsp;

- Сейчас сам текст признаёт, что правил 0 и конфликт не показан на данных.
- Значит статус по конфликтам должен быть:
  &nbsp;
  - не PASS
  - а LOGIC READY / DATA PROOF PENDING
  &nbsp;
- Это важно не приукрашивать.

&nbsp;

&nbsp;

&nbsp;

3. Нельзя считать CHAT/BUSINESS proof закрытым без UI

&nbsp;

&nbsp;

&nbsp;

- По коду explain действительно есть.
- Но утверждение “proof закрыт” пока слишком сильное.
- Нужна честная маркировка:
  &nbsp;
  - Explain logic = PASS
  - CHAT visual proof = pending
  - BUSINESS visual proof = pending
  - BUSINESS rule creation proof = pending
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

4. Добавь явный recovery-plan для сбора visual proof

&nbsp;

&nbsp;

&nbsp;

- Не общая фраза “когда браузер стабилизируется”, а конкретные шаги:
  &nbsp;
  1. открыть продукт Gorbova Club;
  2. вкладка «Доступы»;
  3. скрин общего состояния;
  4. preview CHAT;
  5. создать test rule для BUSINESS;
  6. скрин preview BUSINESS;
  7. создать product-level + tariff-level overlap;
  8. скрин conflict winner;
  9. открыть email/domain partial mode;
  10. скрин legacy panel со статусами.
  &nbsp;
- Иначе это снова зависнет без финализации.

&nbsp;

&nbsp;

&nbsp;

5. Добавь, какие именно тестовые данные надо создать

&nbsp;

&nbsp;

&nbsp;

- Для proof конфликта и BUSINESS не хватает данных.
- План должен явно сказать:
  &nbsp;
  - создать tariff-level rule для BUSINESS → Gorbova Club;
  - при необходимости создать product-level rule в ту же цель;
  - проверить winner по priority;
  - потом удалить/деактивировать тестовые rules либо явно пометить как proof fixtures.
  &nbsp;
- Нужен lifecycle test-fixtures: create → capture → cleanup.

&nbsp;

&nbsp;

&nbsp;

6. Зафиксируй критерий cleanup после proof

&nbsp;

&nbsp;

&nbsp;

- После визуального proof нельзя оставлять мусорные тестовые правила без статуса.
- Добавь:
  &nbsp;
  - если proof делается на production-like данных, fixture rules после записи proof должны быть:
    &nbsp;
    - либо удалены,
    - либо disabled,
    - либо помечены как test/proof в notes.
    &nbsp;
  &nbsp;
- Это обязательно.

&nbsp;

&nbsp;

&nbsp;

7. Раздели статусы по пунктам строже

&nbsp;

&nbsp;

&nbsp;

- Вместо общего PASS по code-level введи таблицу:
  &nbsp;
  - code ready
  - visual pending
  - test data needed
  - closable yes/no
  &nbsp;
- Особенно для:
  &nbsp;
  - conflict
  - BUSINESS
  - partial-support UI
  - legacy statuses
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

8. Добавь stop-правило

&nbsp;

&nbsp;

&nbsp;

- Пока нет visual proof по обязательным пунктам, v23.1 нельзя переводить в closed.
- Разрешён только статус:
  &nbsp;
  - implementation complete
  - proof pending
  - close blocked by missing visual evidence
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

9. Уточни, что именно должно попасть в финальный proof package

&nbsp;

&nbsp;

&nbsp;

- Нужен единый список артефактов:
  &nbsp;
  - 1 общий скрин вкладки;
  - 1 скрин CHAT preview;
  - 1–2 скрина создания BUSINESS rule;
  - 1 скрин BUSINESS preview;
  - 1 скрин legacy panel;
  - 1 скрин conflict banner/winner;
  - 1 скрин partial email/domain mode;
  - при возможности короткое видео прохода.
  &nbsp;
- Это должен быть финальный acceptance set.

&nbsp;

&nbsp;

&nbsp;

10. Исправь итоговую рекомендацию

&nbsp;

&nbsp;

&nbsp;

- Сейчас она звучит слишком мягко.
- Надо прямо написать:
  &nbsp;
  - code-level proof полезен и принимается как промежуточный;
  - visual proof обязателен;
  - без него v23.1 не закрывается.
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

11. Итоговый статус в плане/отчёте должен быть переписан так

&nbsp;

&nbsp;

&nbsp;

- Не:
  &nbsp;
  - “все 5 proof-пунктов закрыты”
  &nbsp;
- А:
  &nbsp;
  - “все 5 proof-пунктов подготовлены по коду”
  - “финальное закрытие ожидает visual proof и fixture-based conflict proof”
  &nbsp;

&nbsp;

&nbsp;

&nbsp;

12. Добавь финальный блок next step

&nbsp;

&nbsp;

&nbsp;

- Следующий шаг должен быть один:
  &nbsp;
  - собрать visual proof package;
  &nbsp;
- без новых архитектурных обсуждений и без расширения scope.

&nbsp;

&nbsp;

Отчёт: Proof-аудит v23.1 — Access Rules UI

## Статус

Браузерные скриншоты недоступны (сессия нестабильна). Ниже — code-based proof по каждому пункту из запроса, с оценкой готовности.

---

## 1. UI proof — вкладка «Доступы»

**Код подтверждает:**

- Вкладка "Доступы" подключена в `AdminProductDetailV2.tsx` (строка 25: `import { ProductAccessRulesTab }`)
- Заголовок: "Правила доступа" + подпись "Что получит покупатель при покупке этого продукта или тарифа" (строки 263-266)
- Фильтры: Все/Активные/Неактивные + фильтр по типу (строки 274-301)
- Кнопка "Добавить правило" (строка 268-271)
- Карточки правил: иконка + тип (русский) + область + назначение + срок + badges конфликтов/overlap (строки 346-437)

**Статус: PASS (code-level). Визуальный proof нужен.**

---

## 2. Explain proof — CHAT / BUSINESS

**Код подтверждает:**

- `useEffectiveGrants()` (строки 283-489 в useAccessRules.ts) строит полный explain:
  1. Tariff-level rules → `source_label: "Правило (тариф)"`
  2. Product-level rules → `source_label: "Правило (продукт)"`, overridden если есть tariff rule
  3. Legacy club_mappings → `source_label: "Legacy (product_club_mappings)"`, с `club_access_label` (чат/канал/чат+канал)
  4. Legacy email_mappings → `source_label: "Legacy (product_email_mappings)"`
- Preview UI (строки 441-496): карточки "Что получит покупатель" с:
  - `source_label` (Правило тариф/продукт, Legacy)
  - `duration_days` + `duration_source` (из правила / из тарифа / legacy)
  - `runtime_support` badge если не full
  - Перекрытые правила в Collapsible
  - Селект тарифа для preview (CHAT/BUSINESS/FULL + product-level)
- Для Gorbova Club / CHAT: сейчас `access_rules` пуст, legacy mapping `product_club_mappings` есть (Gorbova Club → club Gorbova Club). Preview покажет legacy grant с `club_access_label = "чат + канал"`, `source = Legacy`, `migrated_status = not_migrated`.

**Данные из БД:**

- Gorbova Club product: `11c9f1b8...`
- Тарифы: CHAT (30 дн.), BUSINESS (30 дн.), FULL (30 дн.)
- Legacy mapping: product_club_mappings → Gorbova Club (active)

**Каждый grant в explain содержит поля:**

- `source_type`, `source_id`, `source_label`
- `migrated_status` (new_rule / migrated / not_migrated)
- `effective_status` (active / overridden)
- `overridden_by`
- `duration_days`, `duration_source`
- `runtime_support`
- `club_access_label`

**Статус: PASS (code-level). Explain-блок полный. Визуальный proof нужен.**

---

## 3. Legacy proof

**Код подтверждает:**

- Всегда видимый блок "Действующие legacy-настройки" (строки 500-544), НЕ collapsible
- Для каждого legacy mapping:
  - `target_label` (название клуба/email)
  - Тип выдачи (русский badge)
  - Источник: `club` / `email` (из source)
  - Срок (если есть)
  - Статус-badge из 5 вариантов:
    - `active_legacy_only` — "Действует (только legacy)"
    - `duplicated_by_rule` — "Дублируется новым правилом"
    - `migrated_replaced` — "Мигрировано и заменено"
    - `inactive_legacy` — "Неактивно"
    - `fallback_effective` — "Fallback (правило неактивно)"
  - Цветовая кодировка для каждого статуса (строки 74-80)
- `getLegacyStatus()` (строки 54-65 useAccessRules.ts) определяет статус по наличию matching rule и его активности.

**Текущее состояние:** access_rules = пусто, legacy mapping Gorbova Club = active → статус будет `active_legacy_only`.

**Статус: PASS (code-level).**

---

## 4. Conflict proof

**Код подтверждает:**

- Конфликты: `conflicts` = правила с одинаковым `type:target_ref` (строки 139-149)
- Показ: amber card с "Обнаружены конфликты" + показ winner по priority (строки 304-323)
- Overlap legacy: правила дублирующие legacy → badge "Дублирует legacy" (строки 393-397)
- В preview: `overridden_by` + badge "Перекрыто: Правило тарифа" / "Новое правило" (строки 922-926)

**Для проверки конфликта:** нужно создать 2 правила с одной целью (product-level + tariff-level). Текущих правил 0 → нельзя показать conflict proof без данных.

**Статус: PASS (code-level). Для proof нужно создать тестовые правила.**

---

## 5. Runtime limitation proof

**Код подтверждает:**

- `getRuntimeSupport()` (строки 492-499): club/product_access/entitlement = `full`, email = `partial`
- В форме создания: email показывает amber warning "Частичная поддержка: справочник доменов ещё не создан" (строки 623-628)
- В preview: badge `runtime_support !== "full"` → "Частичная поддержка" / "Только превью" (строки 917-921)
- `entitlement` спрятан как advanced с badge (строки 613-618)
- Типы "часть продукта", "тренинг", "урок" **не** предлагаются в UI — отсутствуют в `TARGET_TYPE_LABELS` и `SelectContent`

**Статус: PASS. Неподдержанные типы отсутствуют. Partial помечен явно.**

---

## Итоговая оценка


| Proof                      | Code-level    | Visual proof                     |
| -------------------------- | ------------- | -------------------------------- |
| UI вкладка "Доступы"       | PASS          | Нужен скриншот                   |
| Explain CHAT/BUSINESS      | PASS          | Нужен скриншот                   |
| Legacy блок + статусы      | PASS          | Нужен скриншот                   |
| Конфликт product vs tariff | PASS (логика) | Нужны тестовые данные + скриншот |
| Runtime limitations        | PASS          | Нужен скриншот                   |


## Рекомендация

Code-level все 5 proof-пунктов закрыты. Для визуального proof нужно:

1. Открыть Gorbova Club → вкладка "Доступы" → сделать скриншот (покажет legacy mapping как `active_legacy_only`)
2. Выбрать в preview тариф CHAT → скриншот (покажет legacy grant с источником, сроком 30 дн.)
3. Создать тестовое правило: тариф BUSINESS → Gorbova Club → скриншот (покажет конфликт/overlap)
4. Выбрать в preview тариф BUSINESS → скриншот explain-блока

Визуальный proof можно собрать следующим сообщением, когда браузерная сессия стабилизируется.