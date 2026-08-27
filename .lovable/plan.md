# EXECUTE-план: релиз PR #365 + фикс C4 (PR #368)

Целевой SHA: `39512923f1ddec437ad67dec1a9ae7b82bd0c5ad` (merge PR #368).
Managed HEAD `a64af8e19` = целевой SHA + только 3 генерируемых файла
(`src/integrations/supabase/client.ts`, `previewAuthStorage.ts`, `types.ts`).
Production project_ref `hdjgkjceownmmnrqqtuz`.

## Результат re-review (PASS)

- Блокер C4 закрыт: визард шлёт `filters.include = [{ tariff_ids: [...] }]`,
  что попадает в canonical-ветку резолвера аудитории
  (`resolve_broadcast_audience_user_ids_system`, RPC в production существует).
- Пустая тарифная аудитория больше не приводит к рассылке: отправка
  пропускается, в UI выводится предупреждение.
- `functions.registry.txt` дополнен `getcourse-grant-access` и
  `test-getcourse-sync` — CI-деплой их теперь видит.
- Контрактные тесты: 8/8 PASS.

## Шаг 1. Гейт SHA

Сверить managed HEAD с `39512923f`. Любая дельта, кроме трёх генерируемых
файлов, => STOP.

## Шаг 2. Deploy ровно четырёх Edge Functions

1. `getcourse-grant-access`
2. `test-getcourse-sync`
3. `telegram-revoke-access`
4. `system-health-full-check`

Вместе с ними применяются блоки `verify_jwt = false` из `supabase/config.toml`
для двух GetCourse-функций. SQL, миграции, RLS/Auth/Storage — не требуются
и не выполняются.

## Шаг 3. Read-back и безопасный smoke

- Логи запуска (`booted`) по каждой из четырёх функций, отсутствие 5xx.
- OPTIONS 200 и проверка `access-control-allow-headers`
  (`authorization`, `x-client-info`, `apikey`, `content-type`).
- POST с невалидным Bearer: ожидание 401 на `getcourse-grant-access`
  и `telegram-revoke-access`.
- `test-getcourse-sync` без `orderId`: ожидание 400
  `direct GetCourse test mode is disabled`.
- Реальные рассылки, revoke, удаление сделок и GetCourse writes — запрещены.

## Шаг 4. Build и Publish

- Прогнать `src/test/edgeFunctionContracts.contract.test.ts` и связанные
  контрактные тесты, затем production build.
- При всех PASS — Publish frontend с exact SHA `39512923f`.

## Стоп-условия

Расхождение SHA, missing dependency, ошибка деплоя, 5xx в логах, неожиданный
ответ smoke или новый critical/high finding => STOP без Publish.

## Известные ограничения (не блокеры)

- `telegram-mass-broadcast` по-прежнему добавляет к любой аудитории
  администраторов (`appendAdministrators`) — поведение существовало до PR
  и в scope не входит.
- Полный прогон 1096 тестов выполнялся в GitHub checks; локально
  подтверждены контрактные тесты.
