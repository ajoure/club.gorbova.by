# Безопасное подтверждение runtime поддержки

## Причина

PR650 merged SHA 7e022cdafdda9d6218dd130eea49cc3395d1fd81 прошёл CI и
ограниченную Lovable verification. Managed migration применена; два пакета
развёрнуты. Runtime показывает версии 4495 / 200, однако функция уведомления
отвечает на безопасный отсутствующий UUID так же, как старая версия. Реальное
назначение ради проверки использовать нельзя: старая версия могла бы отправить
уведомление и записать outbox.

## Узкое изменение

Обе существующие функции возвращают публичный заголовок
`X-Support-Boundary-Version: support-boundary-20261022-r1`, включая OPTIONS и
отказ без авторизации. Это метка контракта, не криптографический хеш бинарника.
Проверка реального ответа вместе с verified source/package receipt и серверной
версией подтверждает, что загружен новый обработчик, без бизнес-операции.
Права, DB, payload, доставка и логика функций не меняются.

Тест исполняет настоящие entrypoints и imports в изолированном VM: OPTIONS/401
и authenticated отказ (unknown action / отсутствующее assignment UUID) имеют
заголовок. Разрешены только фиктивное чтение permissions и пустой lookup UUID;
любые записи/Storage/fetch запрещены и считаются ошибкой. Этот тест
добавлен в обязательный CI. Generated health manifest обновляет только digest,
список функций не меняется; health function не deploy.

## Managed артефакты PR650

Штатный apply автоматически создал commit 48290d88, затем merge 53e34646,
вопреки запросу не создавать commits. Это отклонение от execute-процесса,
а не предварительно разрешённое авторство кода Lovable. Codex сверил GitHub:
ровно 4 файла, без изменений runtime функций или иной функциональности:

- drizzle/migrations/0018_support_channel_boundary.sql: тот же blob
  0f6e81d3bf1c7da6988344d226222150b941e8a0, что reviewed SQL;
- meta snapshot/journal: ровно receipt 0018, без клиентских строк;
- Supabase types: только новые claims/config/marker/RPC типы (+177 строк).

Текущий scope начинается отдельной веткой от main 53e34646. Никакой rollback,
повтор migration или прямой production SQL не требуется и не разрешён этим PR.
При следующем managed apply заранее учитывать автоматические receipts и
проверять точный полный diff/новый HEAD до Publish.

## Применение и доказательство

1. Локальный entrypoint test, typecheck/build, required GitHub checks и узкая
   plan-only сверка Lovable; отдельный PR.
2. После merge подтвердить точный merged SHA и package source; deploy только
   telegram-admin-chat и contact-center-assignment-notify. Без миграций, SQL,
   data repair, других functions, новых commits/кода или Publish.
3. Read-back server versions и реальных headers обеих production функций.
   Сначала OPTIONS; если gateway перехватывает его или unauthorized 401, использовать
   штатную существующую авторизованную сессию: telegram-admin-chat unknown action
   support_runtime_probe (400), notifier отсутствующее UUID (404). Эти отказы
   безопасны и на старой версии. Не менять verify_jwt: gateway может законно
   вернуть 401 без application header, это не повод ослаблять защиту. Никаких messages/assignments/reactions/read flags,
   claims, платежей или auth signup как smoke. Даже rollback mutations не нужны.
4. При несовпадении/неизвестной версии/лишнем изменении STOP. Не повторять deploy
   с uncertain результатом до проверки.
5. После backend gates и полного GitHub/source read-back Publish интерфейса
   PR650 и desktop/mobile screenshots в разрешённом режиме без ПДн.

Временный worktree содержит symlink на прежние совпадающие locked зависимости;
новый комплект зависимостей не устанавливается.
