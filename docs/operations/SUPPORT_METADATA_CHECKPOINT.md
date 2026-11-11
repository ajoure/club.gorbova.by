# Атомарный metadata checkpoint поддержки

`scripts/support_metadata_checkpoint.py` — локальный Python 3 stdlib-only CLI.
Он сохраняет baseline, SHA256 signatures, revisions и durable internal-review
outbox **в одном JSON checkpoint** под namespace `support_metadata_checkpoint`.
Сетевых запросов, клиентских отправок и вызовов БД нет. Автоматизация этим PR
не подключается и не считается исправленной до отдельной интеграционной проверки.

## Вход и явный bootstrap

Адаптер источника обязан завершить ВСЕ страницы и подтвердить envelope:

```json
{"complete":true,"pagination_complete":true,"rows":[{"metadata_key":"ticket:synthetic","metadata":{"latest_incoming_id":"message-a","is_read":false,"requires_reply":true}}]}
```

Каждый metadata_key — уникальная непустая строка; metadata — JSON object.
Partial/error/invalid/duplicate keys/NaN не меняют checkpoint. `success:false`,
error status или непустой `next_cursor` также отклоняются. Helper доверяет явному
подтверждению полноты адаптера; сам пагинацию и свежесть источника не проверяет.
Не передавать тела сообщений, секреты или клиентские документы; private
checkpoint хранить вне Git. stdout содержит только event ID/key/revision/status.

```sh
python3 scripts/support_metadata_checkpoint.py --checkpoint /private/task/checkpoint.json init \
  --snapshot /private/task/verified-full-baseline.json --baseline-ref verified-read-reference \
  --legacy /private/task/previous-signatures-only.json
python3 scripts/support_metadata_checkpoint.py --checkpoint /private/task/checkpoint.json ingest \
  --snapshot /private/task/new-full-snapshot.json
python3 scripts/support_metadata_checkpoint.py --checkpoint /private/task/checkpoint.json pending --limit 10
```

`init` — отдельная явно подтверждённая инициализация из сверенного полного
baseline, НЕ «изменений нет». Она не превращает существующие сотни записей в
новые случаи. Можно инициализировать existing signatures-only JSON на месте,
без `--legacy`; существующий namespace повторно не инициализируется. При
отдельном импорте исходный legacy-файл остаётся неизменным. Неизвестные root
и namespace поля сохраняются. Legacy signatures/pending/uncertain не удаляются
и не интерпретируются как новый формат: `legacy_outbox_present=true` требует
от владельца сверки прежнего ledger/pending до отправок. Старому writer нельзя
продолжать отдельно переписывать signatures-only файл после переключения:
авторитетный baseline теперь находится в namespace нового checkpoint.

## Durable работа и handoff

`ingest` одним atomic replace сохраняет новую baseline **вместе** с событиями
новой ревизии. Прерывание перед handoff не теряет работу: следующий noop
возвращает всё ещё pending. Event ID = SHA256 schema/key/revision/before/after
signatures, без времени и локальных путей. ABA получает новую ревизию.
Full before/after metadata остаются в checkpoint как история технических
обещаний; события не удаляются автоматически и не заменяются поздними.

Все `pending` — **внутреннее рассмотрение**, не разрешение ответить клиенту.
Новый incoming сохраняется даже при `is_read=true/requires_reply=false`.
Исчезновение записи создаёт pending `administrative_review`: это может быть
смена allowlist, merge или потеря источника. Bot `active/support_enabled`
изменение также требует рассмотрения. Старые pending/uncertain сохраняются.

`state_only` разрешён только при одном подтверждённом непустом
`latest_incoming_id` до/после и монотонном закрытии read/requires_reply/status
(плюс сопровождающий updated_at). Возобновление requires_reply, unread или
изменившийся incoming создаёт pending. Без latest_incoming_id helper выбирает
review. Текст технического обещания при закрытии не стирается из истории.

stdout ограничен 10 событиями суммарно (`pending` → `blocked_pending` →
`in_flight`), с полными `counts` и `has_more`. `pending --limit` принимает 1..100.
Полный outbox не усекается. Повторный pending стабилен; после authoritative
ack следующих первых событий следующая порция становится видимой. Нельзя
считать скрытые из-за limit события отсутствующими или всё закрытым при
`pending=[]`: проверять counts/in_flight/blocked_pending и legacy flag.

Внешний `handoff_ledger.py` остаётся авторитетом отправки и её результата.
Helper не заменяет его, не генерирует вторую рассылку и не отменяет свежие
проверки основного обработчика. Интегратор сначала сверяет authoritative ledger
по stable event ID, сохраняет его reference/dispatching **до** внешней отправки,
а результат отражает через CAS:

```sh
python3 scripts/support_metadata_checkpoint.py --checkpoint /private/task/checkpoint.json record \
  --event-id EVENT_ID --expected-status pending --status dispatching --ledger-ref EXISTING_LEDGER_REFERENCE
```

Разрешено pending → dispatching/api_accepted/uncertain/verified (последние —
сверка уже существующей ledger-записи), dispatching → api_accepted/uncertain/
verified, api_accepted → uncertain/verified, uncertain → verified. Запрещён
сброс в pending или повтор dispatching/verified. Ledger reference события
не меняется. Повтор точного уже отражённого статуса/reference — no-op.
`dispatching/api_accepted/uncertain` блокируют новые pending того же key до
сверки того же handoff. `verified` исключён из dispatch-кандидатов навсегда;
новая независимая ревизия может потребовать нового рассмотрения. Lease expiry
или время не создают разрешения retry.

## Запись и пределы

Стабильный sibling `.lock` + POSIX `flock` удерживаются на read/validate/write.
Temp 0600 → file fsync → os.replace → directory fsync. Checkpoint и outbox
никогда не коммитятся двумя файлами; `.lock` не содержит бизнес-состояния.
Cooperating writers должны использовать тот же lock и локальную FS с
поддержкой atomic replace/fsync; Windows/NFS не заявлены. Родительский каталог
должен существовать и принадлежать доверенному владельцу. Checkpoint symlink
отклоняется; защита от враждебной подмены всех parent-каталогов не заявлена.

Сбой до replace сохраняет прежние байты; сбой directory fsync после replace
имеет неопределённый durability outcome. CLI возвращает exit 2/not_confirmed:
сначала читать тот же checkpoint и ledger, не выполнять внешнюю отправку или
слепой retry. Нет политики pruning: outbox растёт, объём нужно контролировать
отдельным согласованным архивированием после проверки сохранности истории.

## Проверка

```sh
python3 -B -m unittest discover -s tests/python -p 'test_support_metadata_checkpoint.py' -v
```

Тесты используют только synthetic metadata и временные каталоги; проверяют
restart/noop recovery, uncertain/reopening/removal, ограниченный вывод,
bootstrap/legacy, CAS, реальных конкурентных локальных писателей и сбои записи
до/после replace. Runtime, расписания, SQL и production state не меняются.
