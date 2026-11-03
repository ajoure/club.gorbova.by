План: BAVIDA_SAFE_UNLINK_PR_PLAN_20261103 — безопасная отвязка профиля администратора от существующей компании CMP-006161 (только план; production не трогаем)

## Факты, проверенные чтением (2026-11-03 ~12:56 UTC)
- HEAD `1ed1d6997ae3f0e8accdb6cd6cde1d4c5e9a95af`. В git status есть только автогенерируемый `src/integrations/supabase/types.ts`, его не трогаем. Последняя миграция: `20261027203832_bkb_custdev_service_acl.sql`.
- Цепочка вызовов: триггер `client_legal_details_enqueue_company_sync_trg` (AFTER INSERT/UPDATE реквизитов, только purpose=billing и тип legal_entity/entrepreneur) → `crm_enqueue_from_source_change` → `company-sync-worker` (`crm_company_sync_worker_claim` → writer RPC → `crm_company_sync_worker_complete`) → `crm_company_backfill_billing_cld` → `crm_company_upsert_from_billing` → `crm_company_link_contact`.
- Повторная постановка в очередь срабатывает при изменении любого из полей: leg_unp, leg_name, leg_org_form, leg_address, profile_id, purpose, client_type, status. Значит, если исправить адрес или название (пункт 3 прежнего плана), связь будет создана заново.
- Все функции SECURITY DEFINER. Отпечатки md5 текущих определений:
  - backfill_billing_cld: `36b5ee97…` (4439 байт), только service_role;
  - upsert_from_billing: `60ea8c07…` (18174 байт);
  - link_contact: `c6392337…` (7708 байт).
- link_contact блокирует advisory lock с ключом `hashtextextended('crm_company_link_contact:'||company||':'||profile||':'||rel, 0)`. Затем делает `SELECT … FOR UPDATE` и upsert. Отключённое состояние при этом не учитывается: удалённая связь при следующем запуске создаётся снова.
- backfill берёт `FOR UPDATE` на строку реквизитов, затем на строку map. Если map указывает на другую компанию, функция падает с конфликтом и ничего не перезаписывает.
- В `company_contacts` нет столбцов is_active и deleted_at. Есть UNIQUE(company_id, profile_id, relationship_type) и CHECK: флаг плательщика требует source=billing_requisites и наличия map_id. FK: company → CASCADE, profile → CASCADE, source map → CASCADE.
- В `client_legal_details_company_map` есть UNIQUE(client_legal_details_id). FK: реквизиты → CASCADE, компания → RESTRICT. Ссылается на map только `company_contacts`. На `company_contacts` не ссылается никто.
- RLS: удалять map может только super_admin. Вставлять — admin, менеджер и super_admin. Читать — эти роли и support.
- На `company_contacts` ссылаются экраны и код: `AdminCompanies.tsx`, `AdminContacts.tsx`, `ContactDetailSheet.tsx` (+ тест запросов), `linkedCompanyIds.ts`, `useUnifiedPayments.tsx`.

## Решение (минимальное и обратимое)
1. **Строку map (реквизиты → компания) не трогаем.** Она означает, что реквизиты принадлежат компании, и нужна документам и агрегатам. Удалять её нельзя ещё и потому, что CASCADE снесёт все billing-контакты.
2. **Новая таблица подавления** `crm_company_billing_link_suppressions`. Поля: id, company_id, profile_id, client_legal_details_id, map_id, reason, snapshot jsonb (полная прежняя строка контакта), created_by, created_at, revoked_at, revoked_by. Частичный UNIQUE(company_id, profile_id, client_legal_details_id) WHERE revoked_at IS NULL. RLS включён. GRANT только service_role; если чтение нужно в UI, отдельно SELECT для admin через has_role_v2.
3. **Новый RPC** `crm_company_unlink_billing_contact(_company_id, _profile_id, _cld_id, _expected_contact_id, _reason)`. SECURITY DEFINER, `search_path=pg_catalog,public`. Вызывать могут service_role и super_admin (проверка внутри функции).
   - Захватывает тот же advisory lock, что link_contact (ключ с relationship `billing_contact`). Затем `FOR UPDATE` на реквизиты, map и контакт.
   - Предусловия, иначе RAISE и откат:
     - контакт существует, его id = expected;
     - relationship=billing_contact, source=billing_requisites;
     - map_id контакта = map этих реквизитов, map.company_id = _company_id;
     - profile_id реквизитов = _profile_id;
     - компания не помечена как merged;
     - нет активного подавления.
   - Действие: INSERT подавления со snapshot, затем DELETE ровно одной строки контакта по id (GET DIAGNOSTICS = 1, иначе RAISE). После этого domain event и запись в `crm_activity_log` по образцу link_contact.
   - Реквизиты, их владельца и активность, map, документы, заказы, платежи и права не трогает.
4. **Защита от повторной синхронизации, ручного replay и параллельной записи.** Новая версия `crm_company_link_contact`: после advisory lock, при relationship=billing_contact и наличии активного подавления по (company, profile, cld этого map), функция возвращает NULL и пишет `skipped_suppressed` в журнал без INSERT/UPDATE. Те же правки в `crm_company_backfill_billing_cld`: в ответе `contact_suppressed=true`, а worker считает задачу done, а не ошибкой.
   - В worker это безопасное изменение: обработка NULL contact_id и явного флага.
   - Параллельная запись упирается в общий advisory lock. Кто бы ни шёл вторым, он увидит либо подавление, либо уже удалённую строку.
   - Остальные вызовы link_contact (ручные director/employee, admin_link) не затрагиваются. Подавление действует только на тройку company+profile+cld и только для billing_contact.
5. **Rollback** — `crm_company_restore_billing_contact(_suppression_id)`. Ставит revoked_at и восстанавливает строку из snapshot с тем же id (только если тройка свободна). Миграцию кода откатывает обратная append-only миграция, которая возвращает прежние определения (сохранены отпечатки md5). Таблицу подавлений не удаляем.

## Файлы PR (Codex, ветка `codex/bavida-safe-unlink` от `1ed1d699…`)
- `supabase/migrations/<ts>_crm_company_billing_link_suppression.sql`: таблица, GRANT, RLS, unlink и restore RPC, новые версии link_contact и backfill_billing_cld. В начале — guard: если md5 текущих определений не совпадает с отпечатками выше, RAISE.
- `supabase/functions/company-sync-worker/index.ts`: обработка `contact_suppressed`.
- `supabase/tests/crm_company_billing_unlink_suppression.sql` и PGlite-тест по образцу `src/lib/manualEmailQueueSql.test.ts`.
- В UI изменений нет: связь просто перестаёт отображаться. Агрегаты и поиск строятся по map и заказам, это проверяют тесты.

## Синтетические тесты (только локально, PGlite)
Тесты сохранности:
- После unlink неизменны: реквизиты (владелец, status, md5 строки), map, документы и черновики с этими реквизитами, заказы, платежи, права, company_order_links. Сравнение по количеству и контрольным суммам.
- Другие контакты этой компании и тот же профиль в других компаниях не изменились.

Тесты отказов:
- неверный expected_contact_id;
- чужая компания;
- profile ≠ владелец реквизитов;
- контакт не billing;
- повторный unlink;
- компания помечена как merged;
- вызов от роли authenticated без super_admin.

Повторная синхронизация:
- после unlink backfill, ручной вызов link_contact(billing) и UPDATE адреса реквизитов (триггер + worker) не создают связь заново;
- ручная привязка director того же профиля по-прежнему работает (подавление узкое).

Параллельная запись: две сессии (unlink и backfill) → ровно один итог, без связи.

Rollback: restore возвращает строку с тем же id, после этого backfill снова работает идемпотентно.

## Будущий production runbook (отдельное разрешение, через Lovable execute)
1. Сверить merged SHA, отпечатки md5 трёх функций, отсутствие чужих задач в очереди.
2. Применить миграцию и развернуть только `company-sync-worker`.
3. Dry-run SELECT: у CMP-006161 ровно одна billing-строка администратора, совпадает ожидаемый id, ровно одна map. Зафиксировать прежние счётчики и контрольные суммы (те же, что в preflight D).
4. Один вызов unlink с expected id. Ожидается 1 удалённая строка и 1 подавление.
5. Проверка чтением: связи администратора с компанией нет; реквизиты, map, документы и финансовые данные без изменений; количество контактов компании −1; другие компании без изменений.
6. Только после этого, отдельными разрешениями: адрес и название, затем две штатные связи (director и employee без флага плательщика). Финальная проверка: ровно 2 контакта.
7. Publish не нужен, если не меняется frontend.

## Ограничения
- Тело `crm_company_upsert_from_billing` (18 КБ) прочитано по отпечатку, не построчно. Перед реализацией Codex должен проверить, что функция не пишет в company_contacts напрямую.
- Определение `crm_company_sync_worker_claim/complete` не читалось.
- Очередь Lovable инструментально не проверяется; чужих исполняемых запросов в этой вкладке не обнаружено.

STOP — ничего не исполняется.
