да, согласен, с учетом правок:

&nbsp;

1. Корневой вывод правильный: текущий фикс недостаточен, потому что он обнуляет reference_payment_id только у payments_v2 внутри order_id in ids, а нужно разрывать **все inbound-ссылки** на удаляемые paymentIds.
2. В useDealsBulkDelete.ts обязательно зафиксировать **жёсткий порядок**:
  &nbsp;
  - получить paymentIds удаляемой пачки;
  - если paymentIds.length > 0, сделать update payments_v2 set reference_payment_id = null where reference_payment_id in (...);
  - только потом delete from payments_v2 where order_id in ids;
  - только после успешного удаления payments переходить к orders_v2 и остальным шагам.
  &nbsp;
3. Добавить явный **hard stop**:
  &nbsp;
  - если paymentsError есть, throw сразу;
  - никаких дальнейших delete orders_v2, entitlements, notifications и т.д. после failed payments delete.
  &nbsp;
4. В dry-run / logs лучше фиксировать не только paymentsCount, но и:
  &nbsp;
  - сколько строк затронул nullify inbound refs;
  - сколько реально удалено payments_v2;
  - какие paymentIds участвуют, хотя бы частично/сэмплом в debug log.
  &nbsp;
5. Патч должен оставаться **общим для list-view и kanban**, это верно.
  Никаких отдельных веток логики по delete для kanban делать не нужно.
6. В runtime-proof обязательно проверить именно problematic batch:
  &nbsp;
  - где есть refund / chargeback / reference_payment_id;
  - удалить из kanban;
  - refresh;
  - убедиться, что исчезли и сделки, и платежи;
  - затем повторить в list-view или подтвердить, что он использует тот же shared hook.
  &nbsp;
7. В DoD добавить ещё один пункт:
  &nbsp;
  - после failed payments cleanup UI не показывает ложный success и selection не сбрасывается как при успешном удалении.
  &nbsp;
8. Если после этого всплывёт **новый FK blocker**, не размазывать решение.
  Нужен отдельный узкий patch по конкретному FK, а не переписывание всего delete flow сразу.
9. Итоговый смысл патча сформулирован верно:
  &nbsp;
  - не менять схему БД;
  - не менять UI bulk flow;
  - чинить именно shared delete hook и порядок cleanup steps.
  &nbsp;
10. Этот план можно отдавать в работу как следующий fix-патч по bulk delete.

&nbsp;

&nbsp;

План:

1. Проблема

Bulk delete не закрыт: runtime по-прежнему падает с `payments_v2_reference_payment_id_fkey` (`23503`). Значит текущий shared hook не разрывает все ссылки перед удалением.

2. Диагностика

- `docs/ENGINEERING_RULES.md` прочитан, поэтому фикс планируется как diagnose-first, с dry-run и verify.
- В `src/hooks/useDealsBulkDelete.ts` nullify уже есть, но он делает только:
  - `update payments_v2 set reference_payment_id = null where order_id in ids`
  - затем `delete from payments_v2 where order_id in ids`
- По логам это реально выполняется, но delete всё равно падает.
- В схеме (`supabase/migrations/20260115180732_...sql` и `types.ts`) подтвержден самоссылочный FK:
`payments_v2.reference_payment_id -> payments_v2.id`
без каскада.
- Значит проблема не в отсутствии фикса в коде, а в недостаточном охвате: надо обнулять не только строки удаляемых заказов, но и все inbound-ссылки на payment id из этой пачки.
- Дополнительно сейчас hook после failed delete payments всё равно идёт дальше к delete orders, что даёт второй error и шумный ложный flow.
- Отдельно подтверждено: kanban и list-view уже используют один shared hook, значит чинить нужно только его.

3. Предлагаемое решение

Переработать payment-блок в shared hook в безопасный 4-шаговый flow:

- Шаг A: сначала получить `paymentIds` всех `payments_v2`, где `order_id in ids`
- Шаг B: dry-run/лог — сколько payment ids найдено
- Шаг C: обнулить `reference_payment_id` для всех строк, где `reference_payment_id in paymentIds`  
Это ключевой фикс: разрываем входящие self-references на удаляемые записи, а не только “внутри тех же order_id”.
- Шаг D: удалить `payments_v2` по `order_id in ids`
- Если delete payments упал — немедленный STOP, не продолжать delete orders
- Сохранить подробные логи:
  - сколько payments найдено
  - сколько ссылок nullified
  - сколько payments удалено

4. Изменяемые компоненты

- `src/hooks/useDealsBulkDelete.ts` — основной фикс порядка и охвата delete flow
- при необходимости только точечная корректировка query invalidation в этом же hook, если в verify выяснится, что не хватает связанных ключей

5. Что не будет изменено

- UI kanban/list bulk bar
- права admin/super_admin
- confirm dialogs
- bulk move/export
- логика selection/bulk mode
- структура таблиц и FK в БД в рамках этого патча

6. Dry-run

Перед финальным delete flow в коде:

- собрать `paymentIds` удаляемой пачки
- залогировать `paymentsCount`
- выполнить nullify только по `reference_payment_id in paymentIds`
- залогировать `nullifiedCount`
- только после этого делать delete payments
- если `paymentsCount = 0`, payment-блок пропускается

7. Execute

Внести изменения в shared hook:

- заменить update по `order_id` на двухфазный resolve:
  - select ids из `payments_v2`
  - update inbound refs по `reference_payment_id`
- добавить hard stop после `paymentsError`
- не переходить к delete orders, если payment cleanup не завершился успешно
- оставить reuse того же hook для list-view и kanban

8. STOP-guards

Остановиться и не считать патч успешным, если:

- payment ids не читаются из БД
- nullify даёт ошибку
- delete payments даёт любой FK error
- rowcount выглядит аномально большим относительно выбранной пачки
- после failed payments delete код всё ещё пытается удалять `orders_v2`

9. DoD

- bulk delete не падает с `payments_v2_reference_payment_id_fkey`
- shared hook сначала разрывает inbound references, потом удаляет payments
- при ошибке payments delete orders не трогаются
- kanban bulk delete работает на пачке с refund/chargeback/reference payment
- list-view delete использует тот же исправленный flow
- runtime-proof включает:
  - удаление тестовой пачки
  - отсутствие `23503`
  - refresh
  - подтверждение, что сделки и payments исчезли

10. Риски и зависимости

- Возможны дополнительные внешние ссылки на `payments_v2`, кроме `reference_payment_id`; если verify покажет новый FK blocker, потребуется второй узкий PATCH уже по конкретному FK.
- Supabase update/delete rowcount может не всегда возвращаться стабильно, поэтому proof должен опираться и на runtime-результат, и на post-delete UI/backend-проверку.

11. Требуется дополнительная информация

Дополнительных входных данных от вас не нужно. После approval следующий шаг — применить патч и сделать runtime-proof именно на проблемной пачке/аналогичном наборе сделок.