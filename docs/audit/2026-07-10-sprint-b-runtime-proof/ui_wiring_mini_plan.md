# UI mini-план — schema-first discovery (без предзаданной schema)

**Область:** страница `cb` (`gorbova.by/cb`), три оффера `bank_installment`, привязка CTA к `public-rr-installment-initiate`.

**Запрет:** не задавать заранее `action.type`, `action.target`, event schema. Все значения — только после чтения фактического кода-рендерера и `site_pages.blocks`.

## Discovery-шаги (только чтение, без правок)

1. Найти `site_pages` строку slug=`cb` домена `gorbova.by`, зафиксировать `id` и версию `blocks`.
2. Дампнуть `blocks` в `ui_wiring_discovery.artifacts/blocks.json`. Для каждого блока выписать: `type`, `id`, ключевые поля контента, есть ли CTA/action.
3. Определить фактические React-рендереры каждого блока (grep по `type`).
4. Для найденного pricing/CTA блока — прочитать из его рендерера **фактическую schema** `content.action`/`content.button.*`:
   - какие поля обязательны;
   - какие типы action существуют в коде (grep `switch (action.type)` / handler map);
   - как action.target интерпретируется (offer_id, tariff_id, url, …).
5. Найти в codebase существующий рабочий binding CTA типа `bank_installment` (эталон). Если такого нет — зафиксировать факт.
6. Для каждого из трёх офферов показать **фактический binding в блоке или его отсутствие**:
   - `15ce91ec-...` — binding: `<фактический JSON или "не привязан">`;
   - `2a07af43-...` — binding: `<фактический JSON или "не привязан">`;
   - `4f64def7-...` — binding: `<фактический JSON или "не привязан">`.
7. Найти реальный источник цен 1490 / 1690 BYN:
   - hardcoded в блоке (`content.price`),
   - или динамика из `tariff_offers.amount`,
   - или третий источник.

## Решение по patch — только после discovery

- Если подтверждённая schema **допускает** data-only binding CTA к `open_lead_form(offer_id)` (или как называется реальный тип) → предлагаем data-only patch `site_pages.blocks` в отдельном шаге Gate B.
- Если schema **не допускает** → фиксируем необходимость React-правки (новый action type / расширение handler map / lead form component) как отдельный подшаг Gate B с обоснованием и указанием изменяемых файлов.

## Что не делаем в этом шаге

- Не редактируем `site_pages.blocks`.
- Не редактируем React-компоненты.
- Не публикуем страницу.
- Не запускаем публичный E2E — он относится к Gate B, после подтверждения schema и патча.

## Артефакты (создаются на исполнении discovery)

- `ui_wiring_discovery.artifacts/site_page_cb.json` — актуальная строка `site_pages`.
- `ui_wiring_discovery.artifacts/blocks.json` — массив блоков.
- `ui_wiring_discovery.artifacts/renderers.md` — таблица `block.type → React component path`.
- `ui_wiring_discovery.artifacts/action_schema.md` — фактическая schema action, извлечённая из рендерера.
- `ui_wiring_discovery.artifacts/offer_bindings.md` — фактические bindings каждого из трёх офферов.
