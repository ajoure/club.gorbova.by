# да, согласен, с учетом правок:

&nbsp;

План почти правильный, но у тебя в самом replacement-блоке все еще остались сокращенные форматы, а в DoD написано, что их нигде не должно быть.

&nbsp;

&nbsp;

**Что еще исправить**

&nbsp;

&nbsp;

1. Вместо:

&nbsp;

Product custom fields — Class A [legacy compat], UUID-based: {{cf.product.}}

нужно:

Product custom fields — Class A [legacy compat], UUID-based: {{cf.product.<UUID>}}

&nbsp;

2. Вместо:

&nbsp;

Class A: {{cf..}} — example: {{[cf.legal](http://cf.legal)_details.FLD-000042}}

нужно:

Class A: {{cf.<entity_type>.<PUBLIC_ID>}} — example: {{[cf.legal](http://cf.legal)_details.FLD-000042}}

&nbsp;

**Итог**

&nbsp;

&nbsp;

После этих 2 правок план можно принимать.

&nbsp;

Сейчас формально есть противоречие:

&nbsp;

- в DoD: “нигде нет сокращённых форматов”
- в тексте плана: сокращённые форматы всё ещё есть.

&nbsp;

План: финальная чистка header tokenRegistry.ts

## Диагноз

Строки 23–35 содержат два противоречия с dual-class моделью:

1. **Groups 5–9** написаны как "динамически из fields_registry" без указания класса — создаёт впечатление, что они Class A. На самом деле они Class B (metadata из registry, token по canonical key).
2. **Строка 34** `SoT хранения: {{canonical.key}}` — подана как универсальное правило, но для Class A SoT = `{{cf.<entity_type>.<PUBLIC_ID>}}`.

## Что менять

### `src/lib/tokens/tokenRegistry.ts` — заменить строки 23–35

Было:

```
 * Groups:
 * 1. CONTACT_TOKENS — 1:1 с resolveContactTokens() в edge functions
 * 2. DATETIME_TOKENS — 1:1 с resolveSystemTokens() в _shared/systemTokens.ts
 * 3. Product custom fields — динамически из fields_registry (UUID-based) [legacy compat]
 * 4. Legal details fields — динамически из fields_registry (public_id-based) [implemented]
 * 5. Person fields — динамически из fields_registry (entity_type='person')
 * 6. Entity-person link fields — динамически из fields_registry (entity_type='entity_person')
 * 7. Document fields — динамически из fields_registry (entity_type='document')
 * 8. Meeting fields — динамически из fields_registry (entity_type='meeting')
 * 9. Entity computed fields — динамически из fields_registry (entity_type='entity')
 *
 * SoT хранения: {{canonical.key}}, e.g. {{meeting.date}}
 * UI показывает label, хранит tokenString.
```

Станет:

```
 * Groups (with token class):
 * 1. CONTACT_TOKENS — Class B, 1:1 с resolveContactTokens() в edge functions
 * 2. DATETIME_TOKENS — Class B, 1:1 с resolveSystemTokens() в _shared/systemTokens.ts
 * 3. Product custom fields — Class A [legacy compat], UUID-based: {{cf.product.<UUID>}}
 * 4. Legal details fields — Class A [implemented], public_id-based: {{cf.legal_details.FLD-000042}}
 * 5. Person fields — Class B, metadata из fields_registry, token example: {{person.full_name}}
 * 6. Entity-person link fields — Class B, metadata из fields_registry, token example: {{entity_person.position}}
 * 7. Document fields — Class B, metadata из fields_registry, token example: {{document.number}}
 * 8. Meeting fields — Class B, metadata из fields_registry, token example: {{meeting.date}}
 * 9. Entity computed fields — Class B, metadata из fields_registry, token example: {{entity.name}}
 *
 * External token format (SoT):
 *   Class A: {{cf.<entity_type>.<PUBLIC_ID>}} — example: {{cf.legal_details.FLD-000042}}
 *   Class B: {{canonical.key}} — example: {{meeting.date}}
 * UI показывает label, хранит tokenString.
```

## DoD

1. Каждая группа аннотирована Class A или Class B
2. SoT разделён на Class A и Class B форматы
3. Groups 5–9: явно указано "metadata из fields_registry" + полный пример токена
4. Нигде нет сокращённых форматов (`{{cf..}}`, `{{person.}}` и т.д.)