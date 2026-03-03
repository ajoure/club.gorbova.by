

## Проблема

CHECK-constraint на `integration_instances.category` разрешает только `['crm', 'payments', 'email', 'other']`. Категории `socials` и `telegram` отсутствуют — поэтому создание Instagram-подключения падает с ошибкой.

## Решение

**SQL-миграция** — заменить CHECK-constraint, добавив `telegram` и `socials`:

```sql
ALTER TABLE integration_instances
  DROP CONSTRAINT integration_instances_category_check;

ALTER TABLE integration_instances
  ADD CONSTRAINT integration_instances_category_check
  CHECK (category = ANY (ARRAY['crm','payments','email','telegram','socials','other']));
```

Одна миграция, никаких изменений в коде — после этого кнопка «Создать» заработает.

