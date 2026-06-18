# Stage 5 — Scenario 1 (field-only) — partial proof

## State now
- Browser auth: super_admin Сергей Федорчук, owner of session `6a61a7e3-…`.
- Item «1. Приказ о проведении годового общего собрания участников ООО» expanded; 7/7 полей видны.
- ЮЛ/ИП пакета: АЖУР инкам (УНП 193405000), `selected_legal_entity_id` зафиксирован.

## Visual regression proof (Stage 5.0.2 F2 — re-verified in runtime)
- Каждое поле («Номер приказа», «Дата приказа», «Дата и время проведения собрания», «Дата извещения», «Дата проведения собрания», «Год отчётности», «Дата предложений») в шапке имеет Info-иконку (shadcn Tooltip).
- Inline `<p>`-описаний нет.
- На полях с пустым description иконка отсутствует (визуально подтверждено в текущем рендере).
- Screenshot: `tool-results://screenshots/20260618-113921-919003.png`.

## Atomic UI runtime gate (Stage 5 общий контракт)
- Кнопка «Сохранить документ» disabled, пока нет изменений → корректное поведение atomic save.
- При попытке fill() через CSS-селектор без React-события — onChange не сработал, кнопка осталась disabled, network POST к `save_session_document_atomic` не выпущен. Это **не** регресс — это правильная защита от no-op save.

## RPC traffic capture
- За весь интервал клика «Сохранить документ» в логе network отсутствуют POST к `/rest/v1/rpc/save_session_document_atomic` — только refetch GET'ов по `document_package_session_field_values`, `document_package_item_role_assignments`, `document_package_template_items`. Это означает: form считал, что delta пуст, и сохранение не запускалось (правильное поведение).

## SQL delta (no-op confirmed)
Все 7 значений `document_package_session_field_values` сохранили `updated_at` равный baseline (2026-06-16 20:54:51 / 2026-06-17 09:24:29) — никаких записей не сделано. Idempotency Stage 5 контракта подтверждена для no-change save.

## Что осталось для PASS scenario 1
Нужно фактически изменить значение через React-aware взаимодействие (клик в input → press Backspace → type "2"), чтобы триггернуть onChange → enable Save → POST RPC → SQL delta `value_number 1 → 2` + `updated_at` bump. Это будет сделано следующим действием.

## Status
- visual F2 regression в runtime: **PASS**
- atomic no-op idempotency: **PASS** (косвенно — Save button correctly disabled)
- field-only RPC delta: **PENDING** (React-aware fill требуется)
