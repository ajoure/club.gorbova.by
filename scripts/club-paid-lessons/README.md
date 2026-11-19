# Подтверждённые оплаченные права на отдельную запись Club

Миграция добавляет отдельный источник доказанного оплаченного права на урок.
Она не создаёт оплату, заказ, бонус, подарок, новый срок или покупку месяца.
Клиентские данные и вызов для production здесь отсутствуют.

`private.club_paid_lesson_corrections` и неизменяемый аудит доступны только
через контролируемый writer; прямые права у клиентских и технических ролей
отозваны, RLS включён. Writer разрешён существующим `service_role` и
проверенному исполнителю Cloud. `operator_ref` — технический исполнитель,
а `evidence_ref` — ссылка на проверенное согласование; поле не изображает
аутентифицированного сотрудника, когда SQL выполняется техническим каналом.
Поддержка клиентов не получает новый endpoint записи.

Writer проверяет точного пользователя/профиль, существующие оплату и
подписку, тариф, активное правило Club, месяц урока и исходный срок.
Финансовый источник блокируется на время проверки; запись и один аудит
атомарны. Повтор того же ключа возвращает прежнюю запись, конфликтующий
повтор отклоняется. `agreement_amount` — доказанная сумма соглашения,
**не новая проводка и не распределение денег между месяцами**.

Читатель каждый раз проверяет действующий оплаченный источник, возвраты,
неизменную принадлежность, активный урок/модули и правило. Срок коррекции
ограничен исходным согласованным концом и текущим сроком подписки;
последующее продление подписки автоматически не продлевает коррекцию.
Механизм ограничен каноническим продуктом Club и его корневым модулем,
поэтому он не обходит ограничения других программ и исторических курсов.

Bulk-RPC сохраняет непрозрачный ответный ключ `урок::тариф`. Только ветвь
нового источника разбирает строгий UUID-ключ, проверяет суффикс тарифа и
разрешает либо точный урок, либо навигацию по его предкам-модулям. Другие
уроки остаются закрыты; произвольные ключи эфирных проверок не совпадают.
Одиночная `has_month_purchase` не меняется: коррекция не утверждает покупку
всего месяца. Серверный lesson resolver читает то же точное право; прежнее
полное определение resolver сохранено закрытым forward-wrapper. Права,
OID и владелец существующих публичных RPC сохраняются.

Миграция атомарна. Preflight проверяет фактические body hash, владельца,
ACL и search path трёх существующих функций; drift останавливает выпуск.
Повтор миграции требует проверки управляемой истории и останавливается,
не изменяя уже сохранённые доказательства. Повтор бизнес-вызова проверяется
отдельным идемпотентным ключом. История миграций не создаётся вручную.

## Проверка

```sh
python3 scripts/club-paid-lessons/test_contract.py --static
```

Реальный PostgreSQL 17 job запускается в GitHub Actions на пустой БД
`club_paid_lesson_test`, только на loopback и с явным
`CLUB_PAID_LESSON_FIXTURE=1`. Никаких production-ключей/подключений нет.
Fixtures синтетические. Тесты проверяют отказы writer, положительные и
отрицательные права, реальный составной UI-ключ, навигацию, сервер/RLS,
отзыв/истечение/возврат/изменение источника, идемпотентность и прежние права.

До production нужны green CI, точный merged SHA, проверка текущей очереди
Lovable и одно согласованное применение через официальный плагин. Затем —
metadata/ACL/read-back, один вызов по частному проверенному реестру, точные
положительные/отрицательные gates и неизменность исходных финансовых строк.
Нового frontend/Edge-кода нет; эта миграция не разрешает общий Publish.
Клиентское воспроизведение проверяется отдельно по действующим ограничениям
поддержки; SQL PASS не выдаётся за просмотр плеера клиентом.

## Historical receipt with a separate current paid cap

The additive migration `20261119162522_club_paid_lesson_corrections.sql`
adds a separate, service-only exact-lesson writer and read-only preview.
It pairs a direct historical payment/order/expired-subscription lineage with
an independently paid current active subscription of the same Club/tariff.
Expired history is evidence, never a revived entitlement. The historical
receipt's paid month must equal the requested lesson month. Only the stored
order agreement price is used; current tariff price is never consulted.
Read-only legacy payment-kind recognition does not rewrite receipts.

New optional lineage fields are all-null for existing claims. That branch
calls a byte-identical copy of the old validator; the old 12-argument writer,
whole-month gate, bulk key semantics and server resolver remain unchanged.
The new branch has direct order joins, net-money/refund/chargeback checks,
ambiguous-lineage rejection, a frozen current expiry cap, fresh CAS fingerprint,
single historical-receipt use and an atomic private audit. Public clients have
no writer/preview privileges. No payment/order/subscription is mutated.

The native PostgreSQL CI executes all original contracts after installing the
extension, then `receipt_contract.sql`. For local offline validation using an
existing PGlite runtime (no dependency installation):

```sh
PGLITE_MODULE_PATH=/existing/cache/@electric-sql/pglite/dist/index.js node scripts/club-paid-lessons/test_receipt_pglite.mjs
```

This is a PostgreSQL engine fixture, not a production entitlement or player
verification. The actual case, customer IDs and production invocation stay
outside Git. Release and a concrete production correction remain with the
coordinator after review, exact-SHA deployment and fresh readback.
