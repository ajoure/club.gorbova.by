# Диагностика отказов AI chat

База: origin/main `43f86d5160bb6de133673cabe1b3d4d3f0f3c154`.
Production: Lovable Cloud. Независимый backend scope; PR650/651 не переиспользуются.

## Проблема и результат

`gorbova-ai-chat` писал `actor_id` и `details`, которых нет в production
`audit_logs`. PostgREST возвращает `error` без исключения; прежний catch
этого не замечал. Причина отказа 107НК не сохранялась.

Локальный helper использует `actor_user_id`, `actor_type=user`, `action`,
`entity_type=ai_chat`, `meta`; проверяет возвращённый error и receipt id.
Ошибка/неясный результат не повторяются и не меняют отказ/ответ AI.
Warning содержит только фиксированный action и категорию сбоя.
Метаданные ограничены типизированными внутренними кодами, счётчиками,
baseline/corpus hash и двумя флагами проверок. Тексты запросов, ответов,
файлов, имена и содержимое ошибок не добавляются в журнал/console.

Отказ 107НК по-прежнему 422, не сохраняет и не выдаёт отвергнутый ответ.
Предикаты закона, подсказки, модели, тарифы, квоты и Auth не меняются.
Исправление журнала не доказывает устранение причины отказа модели.
Старые отсутствующие события восстановить этим патчем нельзя.

## Проверки

- 105 локальных профильных тестов: audit contract/privacy/failure, actual handlers,
  текущий закон и сохранение истории; затем повтор изменённых тестов.
- TypeScript, isolated Deno bundles обоих MNS entrypoints, Edge references.
- Health manifest: только digest функции; список 320 контрактов неизменен.
- Required GitHub quality gate на точном reviewed head обязателен до merge.

Production plan-only подтвердил canonical audit columns, отсутствие триггеров,
actor_type user/system/service и существующие ACL. Миграция/RLS не нужны.

## Точный production scope после review и CI

1. Убедиться, что Lovable синхронизирован с точным merged SHA и tree.
2. Развернуть только `gorbova-ai-chat`, включая его локальный helper.
   Не развёртывать health function, adapter, другие функции; без миграций,
   типов, новых коммитов, Publish и изменений verify_jwt.
3. Один native authenticated own-admin probe через существующий nonupload
   prompt (не asset_classifier, balance_analysis или107NK), с синтетическим
   user message и unsupported_files=[{name:probe.bin,reason:unsupported_format}].
   Ни fileContents/fileNames, ни реального файла. Никаких извлечений browser
   cookies/tokens и вывода session JSON/headers/secrets.
4. Ожидается 403 upload_not_allowed_for_mode до model/access/quota/history,
   ровно одна audit row с audit_schema_version=ai-chat-audit-20261022-v1,
   ноль новых AI messages/conversations/model calls. Read-back metadata only;
   ни user UUID, ни запрос в отчёт не включать. Audit evidence не удалять.
5. Timeout/неясный результат сначала сверить по журналу, не повторять probe.
   SHA drift, unexpected rowcount/side effects или missing helper => STOP.

Backend-only: frontend Publish и новые desktop/mobile изображения не применимы.
После подтверждения writer продолжить расследование конкретного отказа;
не повторять уже отправленные клиенту ответы и назначения.
