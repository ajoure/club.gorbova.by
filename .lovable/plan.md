

## Проблема

Лог чётко показывает:
```
page_id mismatch: expected katerina.gorbova, got 601477270056529
```

В таблице `instagram_accounts` поле `instagram_page_id` содержит **username** (`katerina.gorbova`), а ApiX-Drive передаёт **числовой ID страницы** (`601477270056529`).

Webhook проверяет совпадение → отклоняет запрос с HTTP 400.

## Решение

**SQL миграция** — обновить `instagram_page_id` на числовой ID:

```sql
UPDATE instagram_accounts 
SET instagram_page_id = '601477270056529' 
WHERE id = '1a7485fb-4738-483a-a69f-54c96c1dcecd';
```

Одна строка. Код не меняется. После этого повторный запрос от ApiX пройдёт проверку.

## Файлы

Изменений в коде нет. Только данные в БД.

