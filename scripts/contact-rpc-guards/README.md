# Проверка прав в четырёх RPC списка контактов

Новая миграция `20261105131619_guard_contact_list_rpc_access.sql` закрывает
четыре существующих endpoint без изменения клиентских строк:

- `get_duplicate_contact_profiles(integer, integer, text)`;
- `get_profiles_with_paid_orders(integer, integer, text)`;
- `get_contact_tab_counts(text)`;
- `get_profiles_with_paid_orders_count(text)`.

В actual-схеме `profiles.loyalty_score` имеет тип `integer`, а paid-RPC
возвращает `numeric`. SQL-функция приводила тип результата автоматически;
PL/pgSQL `RETURN QUERY` требует точного типа. Поэтому только в итоговой paid-
проекции добавлен `filtered.loyalty_score::numeric`; все остальные поля
сохраняют исходные типы. Fixture проверяет integer, NULL и отрицательное
вымышленное значение на совпадение с прежним SQL-результатом.

В начале каждой функции требуется непустой `auth.uid()` и каноническое
`has_admin_section_access(actor, 'contacts', 'view')`. Это сохраняет доступ
сотрудников с `view/edit/manage`, включая делегированные роли, и существующий
bypass `admin/super_admin`. Отсутствие прав возвращает SQLSTATE `42501` до
запроса контактов или оплат. Глобальные роли, helper, RLS, индексы, Edge
Functions и интерфейс не меняются.

`PUBLIC` и `anon` теряют EXECUTE на точных перегрузках. Authenticated EXECUTE
сохранён. Существующие явные технические grants не удаляются. Контекст
`service_role` или технической роли без `auth.uid()` теперь также получает
отказ: серверных callers этих RPC в репозитории не найдено, отдельный bypass
не добавлен. Наличие технического EXECUTE само по себе не обходит guard.

## Применение и остановка на расхождении

Применять только через согласованный managed-процесс Lovable Cloud после PR,
CI и проверки точного SHA. Этот каталог не содержит production-исполнителя,
ключей, connection string или команд подключения к проекту.

Один `DO` выполняет preflight всех четырёх функций и канонического helper
до первого DDL. Проверяются полные body hash, сигнатуры, defaults, output
shape, owner, STABLE/SECURITY DEFINER, язык, search path и точные ACL вместе
с grantor/grant option. Поддерживаются только два целых состояния:

1. Все четыре исходных проверенных определения — заменить в одной транзакции.
2. Все четыре точных защищённых определения и ACL — проверенный no-op.

Смешанное состояние, другое тело/helper/ACL/owner/path/shape останавливают
миграцию. Postcheck заново проверяет фактические определения и ACL. Ошибка
откатывает весь `DO`. Функции не удаляются, OID и зависимости сохраняются.
Это ремонт конкретного проекта, а не универсальная миграция. Allowlist
включает существующую проверенную техническую роль Cloud; другая роль или
grant останавливают preflight для сверки, не исправляются автоматически.
Production-роль не создаётся и новый технический grant не добавляется.
Нельзя откатывать это исправление к прежнему неограниченному доступу;
совместимость восстанавливается узким forward fix с сохранением guard.

## Воспроизводимые проверки

Локальная проверка без установки зависимостей:

```sh
python3 scripts/contact-rpc-guards/test_contract.py --static
```

Она подтверждает только согласованность файлов и полных hash. SQL и права
проверяются отдельным GitHub Actions job **Contact RPC real PostgreSQL
authorization and atomicity** на PostgreSQL 17, без npm/package installation.
Зелёные статические проверки не заменяют этот job.

Реальный тест допускает только явно включённую синтетическую БД
`contact_rpc_guard_test` через loopback, пользователя `postgres` и
`CONTACT_RPC_GUARD_FIXTURE=1`. Он создаёт фиктивные записи, реальные SQL-роли,
закрытый RLS и функции с владельцем, который обходит RLS. Поэтому тест
доказывает действие guard, а не случайный запрет таблицы.

Проверяются:

- исходное воспроизведение дефекта на синтетических строках;
- отказ anon, обычному пользователю, staff без contacts и пустому uid;
- отказ service/technical context без uid при сохранении их явных ACL;
- сохранение результатов, 24 paid-колонок, поиска по компании, порядка,
  пагинации, defaults и counts для view/edit/manage/admin/super_admin;
- guard до подготовки запроса данных, при временно недоступной fixture-таблице;
- неизменность OID, зависимых views, owner, данных и memberships;
- точный no-op второго применения, включая `pg_proc.xmin`;
- атомарный отказ при drift тела/helper/ACL/default/path/owner, смешанном
  состоянии и ошибке postcheck. Другие SQLSTATE не принимаются за PASS.

`baseline-functions.sql` — полные исходные запросы проверенной миграции июля,
`canonical-helper.sql` — существующий неизменённый helper. Их полные body hash
сопоставлены с actual Cloud metadata до подготовки исправления. Данные
fixture вымышлены; production RPC тесты не вызывают.

После managed-применения нужны metadata read-back новых body/ACL/signatures,
подтверждение нулевого DML и разрешённый сценарий сотрудника. Анонимное чтение
реальных клиентских данных не используется для приёмки.
