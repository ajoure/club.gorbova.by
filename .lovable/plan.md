## да, согласен, с учетом правок:

1. Блок про скрытие старой `apix_instagram_dm` интеграции через БД/миграцию **убрать из плана полностью**.  
Пользователь уже отключил старую интеграцию, и она больше не показывается. Значит, этот подпункт больше не актуален и не должен тянуть за собой лишние изменения.
2. В diagnose зафиксировать новый факт:
  - старая интеграция `apix_instagram_dm` уже отключена пользователем;
  - в dropdown/select старый аккаунт больше не отображается;
  - отдельный патч на скрытие/деактивацию больше не нужен.
3. Основной фокус плана теперь сузить до двух задач:
  - **A.** factual-диагностика, почему сообщение `тест три` не дошло до `manychat-inbound`;
  - **B.** при необходимости лёгкий UX-tail по русификации label’ов, только если это не мешает основной диагностике.
4. Блок про `тест три не дошёл` оставить приоритетом №1.  
Нужно сохранить жёсткую развилку:
  - `0` запросов в `manychat-inbound` → проблема в настройке External Request / Flow в ManyChat;
  - `401` → проблема в `X-ManyChat-Token`;
  - `404 instance_not_found` → проблема в `instance_id/page_id` routing;
  - `400 missing_sender_id/invalid_json` → проблема в body template;
  - `500 insert_failed` → backend bug.
5. В отчёте пользователю по `тест три` дать уже не общий вывод, а готовую инструкцию проверки:
  - exact URL;
  - exact headers;
  - exact body template;
  - к какому Flow/trigger это должно быть привязано;
  - как проверить в ManyChat, что Flow реально срабатывает на входящий DM.
6. Блок русификации оставить только как **optional UX-tail**, не как часть основного runtime-fix.  
Safe-scope, если будете делать сразу:
  &nbsp;
  &nbsp;
  - `Instagram DM (ApiX-Drive)` → `Instagram (ApiX-Drive)`
  - `ManyChat` → `ManyChat (Instagram)`
  - `Facebook` → `Facebook (скоро)`  
  Бренды `amoCRM`, `GetCourse`, `bePaid`, `Kinescope` не трогать.
7. Обновить DoD:
  - старый `apixdrive` аккаунт уже вне dropdown и не требует патча;
  - diagnose по `тест три` даёт точную причину;
  - есть короткий factual-отчёт с инструкцией, что именно проверить/настроить в ManyChat;
  - финальный E2E inbound proof остаётся отдельным следующим шагом после корректной настройки External Request в ManyChat.
8. Обновить порядок выполнения:
  - сначала factual diagnose по `тест три`;
  - потом краткий отчёт с exact причиной и инструкцией;
  - только после этого, если останется время, лёгкая русификация label’ов.  
  Не возвращаться к уже закрытой теме скрытия старой интеграции.

&nbsp;

&nbsp;

План: русификация интеграций + скрытие отключённой Instagram + диагностика «тест три не дошёл»

### Diagnose (готов)

1. **manychat-inbound endpoint** — рабочий. За ~17ч приходили только мои curl-smoke-tests (`A11 smoke test`, `A11 verify run #2`). Реального запроса от ManyChat за «тест три» НЕ БЫЛО.
  - Вывод: External Request в ManyChat Flow ещё не настроен / не сработал на триггер. Это не баг кода — это конфигурация в самом ManyChat.
2. **Старый Instagram (apix_instagram_dm)** до сих пор активен:
  - `integration_instances`: id `676c484b...`, status=`connected`
  - `instagram_accounts`: id `1a7485fb...`, page `601477270056529`, `is_active=true`, status=`active`
  - Поэтому в dropdown «Контакт-центр → Instagram → выбор аккаунта» он продолжает показываться. Пользователь хочет его скрыть.
3. **Названия провайдеров в UI** — частично русские (`bePaid`, `Instagram DM (ApiX-Drive)`, `ManyChat`, `Facebook`), но `name` для большинства — английские бренды. Описания (`description`) — все русские. Категории — русские. Что нужно русифицировать конкретно — нужно уточнить (см. вопросы ниже).

### Что меняем — три блока

#### Блок 1. Скрыть отключённый Instagram (apix_instagram_dm) из dropdown

Самый чистый путь: **деактивировать через UI/админку, не трогать код**. Пользователь говорит «я отключил предыдущую интеграцию», но в БД она всё ещё `status='connected'` и `is_active=true`. Это значит — отключил визуально (toggle?), но `instagram_accounts.is_active` не сбросился.

План:

- Миграция: для `integration_instances.id='676c484b...'` (apix_instagram_dm) поставить `status='disconnected'`.
- Миграция: для `instagram_accounts.id='1a7485fb...'` поставить `is_active=false`.
- Это автоматически скроет аккаунт из dropdown (`getAccounts` в `instagram-admin-chat` уже фильтрует `is_active=true` + `InstagramInboxView` фильтрует `status !== 'error'` — тут statuses ok, главное is_active).
- **История сообщений сохраняется** (29 старых apixdrive-сообщений в БД остаются, просто не видны в dropdown текущих диалогов).

Альтернатива (если нужна возможность включить обратно): не удалять, а только `is_active=false`. Это и делаем.

#### Блок 2. Диагностика «тест три» — почему не дошло

Это не code-fix, это **инструкция для пользователя** + одна проверка в edge-логах.

В отчёте дам:

- свежий список последних запросов к `manychat-inbound` за последний час (через `supabase--analytics_query` по edge logs);
- если 0 запросов → проблема 100% в настройке ManyChat External Request (не настроен / не на тот URL / Flow не триггерится на DM);
- если запросы есть, но 4xx → точный error из логов, fix.

Дам пользователю чек-лист настройки ManyChat External Request (URL, headers, body, на какой триггер вешать).

#### Блок 3. Русификация названий интеграций

Нужно уточнить scope (см. вопрос). Если коротко: переименовать `name` в `PROVIDERS` для тех, что точно стоит локализовать, оставив бренды как есть. Например:

- `SMTP` → `Почта (SMTP)`
- `hoster.by Cloud` → `hoster.by (облако)`
- `Kinescope` → `Kinescope (видеохостинг)`
- `Instagram DM (ApiX-Drive)` → `Instagram (ApiX-Drive)`
- `ManyChat` → `ManyChat (Instagram)`
- `Facebook` → `Facebook (скоро)`
- `amoCRM`, `GetCourse`, `bePaid` — оставить (это бренды).

Но это дизайн-решение, поэтому спрошу пользователя.

### DoD

1. В dropdown «Контакт-центр → Instagram» отключённый аккаунт `601477270056529` (apix_instagram_dm) НЕ показывается. Виден только `mc:305d6fa43ef5c6f8cc9602cb` (ManyChat).
2. Старые apixdrive-сообщения сохранены в БД (regression: не удалены).
3. Можно при необходимости переактивировать apix-инстанс через админку.
4. Дан чёткий ответ почему «тест три» не пришёл + проверяемый чек-лист настройки ManyChat External Request.
5. (По решению) переименованы `name` провайдеров в `PROVIDERS` без потери идентификации брендов.

### Stop-condition

После выполнения — короткий runtime-proof: dropdown показывает только ManyChat-аккаунт, старая история не утеряна. Финальный E2E ManyChat → IG → inbox — после настройки External Request пользователем.