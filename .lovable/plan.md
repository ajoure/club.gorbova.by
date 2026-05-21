## План: `patch_payment_paid_at_long_placeholder_2026_05`

### Цель
Добавить плейсхолдер «Дата оплаты прописью» по аналогии с системным `FLD-000209` (`«21 мая 2026 года»`), чтобы в актах можно было выводить дату оплаты словами, а не только в формате `21.05.2026` (`FLD-000263`).

### Что меняется

**1. Миграция БД (новая)**
Регистрируем новое поле в `fields_registry` и `document_token_registry`:
- `public_id`: `FLD-000371`
- `key` / `token_key`: `payment.paid_at_long`
- `label` / `ui_label`: «Дата оплаты прописью»
- `data_type`: `string`
- `category`: `payment`
- `example_value`: `«21» мая 2026 года`

**2. `supabase/functions/_shared/standard-fields.ts`**
Рядом с `FLD-000263` добавить:
```ts
'FLD-000371': pay?.paid_at ? ruWordsDate(pay.paid_at) : '',  // payment.paid_at_long
```
Используем уже существующий хелпер `ruWordsDate` (тот, что обслуживает `FLD-000209`).

**3. Деплой**
- `canonical-document-generate-strict`
- `bepaid-webhook` (трогать не нужно — функция формирования снапшота читает из standard-fields)

Достаточно передеплоить `canonical-document-generate-strict`.

### Diagnose / контекст
- `FLD-000263` (`payment.paid_at`) уже возвращает `dotDate(pay.paid_at)` → `21.05.2026`.
- Системное поле `FLD-000209` уже использует `ruWordsDate(now)` → `«20 мая 2026 года»`.
- В UI «Плейсхолдеры» новое поле появится автоматически после миграции (источник списка — `document_token_registry` + `fields_registry`).

### По второму пункту (данные о карте в тестовом 100 ₽)
Пользователь сам отмечает: «может быть, потому что я этот тестовый платёж делаю и там нет карты — ладно». На бэке `FLD-000259..262` приходят пустыми, потому что bePaid в тестовом ручном charge не возвращает card-блок. Это **не баг** — оставляем как есть, чтобы не плодить фейковые данные. Если позже потребуется тест-фикстура, делаем это отдельной задачей.

### DoD
- В UI «Плейсхолдеры → 8. Оплата» виден `FLD-000371` с примером `«21» мая 2026 года`.
- В шаблоне `{{field:FLD-000371}}` подставляется длинная дата оплаты.
- На уже существующих заказах (Федорчук `ORD-TEST-MPF8PW9G`, Пилецкая) preview-rebuild снапшота показывает корректное значение.
- `FLD-000263` продолжает работать без изменений (обратная совместимость).

### Артефакты
- `supabase/migrations/<ts>_fld_000371_payment_paid_at_long.sql`
- edit: `supabase/functions/_shared/standard-fields.ts`
- proof: `.lovable/proofs/patch_payment_paid_at_long_placeholder_2026_05.md`
