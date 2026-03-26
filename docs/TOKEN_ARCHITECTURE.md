# Dual-Class Token Architecture

> Документ описывает архитектуру токенов платформы.
> Каждое правило помечено статусом: **[implemented]**, **[target]**, **[legacy compat]**.

---

## §1 Два класса токенов — по модели резолвинга, не по имени сущности

Класс токена определяется механизмом резолвинга, а не именем бизнес-сущности. [implemented]

- **Class A** = registry-backed data token. Канонический формат: `{{cf.<entity_type>.<PUBLIC_ID>}}`. Пример: `{{cf.legal_details.FLD-000042}}`. [implemented]
- **Class B** = computed / package / procedure token. Формат: `{{canonical.key}}`. Пример: `{{meeting.date}}`. [implemented]

| Token family | Class | Format example | Resolution | Status |
|---|---|---|---|---|
| `cf.legal_details.*` | A | `{{cf.legal_details.FLD-000042}}` | `public_id` → `fields_registry` → DB column | [implemented] |
| `cf.product.*` | legacy exception | `{{cf.product.<UUID>}}` | UUID → `fields_registry` → `field_values_v2` | [legacy compat] — not a model for new Class A families |
| `meeting.*` | B | `{{meeting.date}}` | canonical key → resolver | [implemented] |
| `document.*` | B | `{{document.number}}` | canonical key → resolver | [implemented] |
| `package.*` | B | `{{package.signer.full_name}}` | canonical key → resolver | [target] |
| `person.*` | B (may evolve) | `{{person.full_name}}` | canonical key → resolver | [implemented] |

Явное правило: `cf.product` — это **legacy compatibility exception**, а не шаблон для новых Class A token families. [legacy compat]  
Новые entity types обязаны использовать `public_id`-формат `{{cf.<entity_type>.<PUBLIC_ID>}}`. [target — rule established, implemented for legal_details]

---

## §2 Правила ID-ячеек

- UUID не используется в новых канонических токенах для DOCX/UI. [implemented for legal_details, target as general rule]
- Исключение: legacy compatibility tokens, например `{{cf.product.<UUID>}}`. [legacy compat]
- Class A токены используют `public_id` в строке токена. [implemented]
- Class B токены используют canonical key в строке токена. [implemented]
- **Class A token never degrades to Class B token** — registry-backed field не заменяется canonical key, даже если alias существует. [target — rule established, enforcement not yet automated]

---

## §3 Поток резолвинга токенов

- Class A токен приходит в формате `public_id` (например, `{{cf.legal_details.FLD-000042}}`). [implemented]
- Система выполняет registry lookup: `public_id` → запись `fields_registry`. [implemented]
- Внутренний резолвинг идёт по UUID / ID-bound context (lookup колонки, чтение значения). [implemented]
- Снаружи (DOCX/UI) = `public_id`; внутри (логика резолвера) = UUID. [implemented]
- Class B токен приходит как canonical key, резолвится напрямую функцией-резолвером. [implemented]

---

## §4 Context binding — source slots

- Многосторонние документы используют именованные source slots: [target]
  - `party.customer_legal_details_id` [target]
  - `party.executor_legal_details_id` [target]
  - `selected_signer_link_id` [target]
  - `selected_person_ids[]` [target]
  - Дополнительно при необходимости: `beneficiary`, `representative` [target]
- Для двусторонних документов каждая сторона должна иметь явный source slot. [target]
- Генератор резолвит данные только по UUID-bound context, никогда по имени/email/label. [implemented in edge functions]

---

## §5 Snapshot source trace

Для каждого source slot:

- `source_slot` (имя роли) [target]
- `source_entity_id`, `source_legal_details_id` [target]
- `source_link_ids[]` [target]
- `token_set_version` / `resolver_version` для воспроизводимости [target]

---

## §6 Registry-first с разделением классов

- Структурированное/registry поле → Class A с `public_id`. Деградация до Class B запрещена. [target — rule established]
- Canonical key — только для computed/domain/package токенов (Class B). [implemented]

---

## §7 Pre-generation validation — source-binding completeness

- Все обязательные source slots выбраны? [target]
- `legal_details_id` указан для каждого слота? [target]
- Подписант/связь указан для каждого слота? [target]
- Обязательные поля заполнены для каждого выбранного источника? [target]

---

## §8 Compatibility layer

- Новые Class A токены → только `public_id`-формат: `{{cf.<entity_type>.<PUBLIC_ID>}}`. [target — rule established, implemented for legal_details]
- Новые Class B токены → только canonical key формат: `{{canonical.key}}`. [implemented]
- Legacy UUID/key aliases допускаются только как compatibility layer. [implemented]
- `{{cf.product.<UUID>}}` — legacy compatibility exception, не модель для новых token families; поддерживается через dual-resolve + diagnostics. [legacy compat]
- Legacy key-based aliases (например, `entity_name` → `legal_details.leg_name`) — dual-resolve, помечены для миграции. [legacy compat]
