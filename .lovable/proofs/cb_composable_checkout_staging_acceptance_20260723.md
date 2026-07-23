# Ценный бухгалтер — staging-приёмка составной корзины

Дата: 2026-07-23  
PR: https://github.com/ajoure/club.gorbova.by/pull/112  
Preview project: `dqmblbfhtmcvanasvjpr` (disposable, deleted after tests)

## Подтверждено

- Три миграции корзины применились на реальном PostgreSQL Supabase.
- SQL catalog/security contract прошёл после явного отзыва `EXECUTE` у
  `anon` и `authenticated`.
- Транзакционный сценарий с `ROLLBACK` подтвердил:
  - один основной заказ и два дочерних заказа модулей;
  - одну группу покупки и три неизменяемые позиции;
  - распределение единого платежа на общую сумму `1800 BYN`;
  - частичный возврат `200 BYN` только по выбранному модулю;
  - переход группы в `partially_refunded`.
- Девять затронутых Edge Functions успешно развернуты в preview.
- Публичные endpoints выполняют собственную валидацию, административные
  endpoints без JWT возвращают `401`.
- Публичный quote endpoint вернул:
  - «Ценный бухгалтер» — `1500 BYN`;
  - «Маркетплейсы» — `400 BYN` после скидки 20%;
  - «Общественное питание» — `0 BYN`;
  - общий итог — `1900 BYN`.
- Попытка добавить несвязанный offer отклонена:
  `400 addon_not_allowed`.

## Найдено и исправлено до production

1. Default function privileges проекта явно выдавали API-ролям право
   выполнять внутреннюю materialization RPC. Добавлена отдельная hardening
   migration с отзывом прав у `PUBLIC`, `anon` и `authenticated`.
2. Settlement использовал `order_groups.paid_at`, отсутствовавший в первой
   версии таблицы. Колонка добавлена в foundation и отдельной совместимой
   migration.

## Граница доказательства

- Реальные списания у acquiring/RR не выполнялись.
- Production database и production Edge Functions не изменялись.
- Preview был создан от доступного через connector проекта
  `ypwsuumurrtkxatoyqhk`, но конфигурация приложения указывает на фактический
  project ref `hdjgkjceownmmnrqqtuz`. Поэтому тест подтверждает поведение
  миграций и функций на реальном Supabase PostgreSQL, но не доказывает parity
  с целевым production.
- Текущая CLI-учётная запись не имеет прав читать целевой project ref
  `hdjgkjceownmmnrqqtuz`; production preflight остаётся обязательным gate.
- У доступного connector-проекта migration history расходится с фактической
  схемой; для приёмки использовался минимальный disposable fixture
  зависимостей.
- Production rollout требует отдельного разрешения и preflight фактической
  схемы перед применением DDL.
