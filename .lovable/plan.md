# План: консолидированная ревизия PR #335 (codex/broadcast-analytics)

## VERDICT: BLOCKED

Ревизию содержимого PR #335 сейчас выполнить невозможно: в управляемом окружении Lovable нет доступа к ветке `codex/broadcast-analytics` и к коммиту `f92fd6965958532ae2d6a3f1f95b5618249b8db7`.

## CRITICAL FINDINGS

1. **Ревизуемый код недоступен (blocker ревизии, не кода).**
   - `git ls-remote origin` отдаёт только `HEAD`, `refs/heads/main`, `refs/heads/_agent-publish` — все на `4594fef0f878bd019ba78a4b24cfd7be9c9a11c3`. Ветки `codex/broadcast-analytics` в зеркале нет.
   - `git cat-file -t f92fd696...` → `could not get object info` (объект отсутствует локально).
   - Токена доступа к GitHub в окружении нет (`GITHUB_TOKEN` не задан), внешний клон приватного репозитория недоступен.
2. **Заявленный файл миграции отсутствует в управляемом дереве.**
   - `supabase/migrations/20260817143430_broadcast_analytics.sql` — `No such file or directory`. Последняя миграция в дереве: `20260817092551_1d8d9274-70e0-4c81-b8f1-2e5f113a1c81.sql`.
   - Следовательно пункты 1, 2, 5, 7 запроса (применимость SQL, наличие referenced objects, атрибуция покупок, точные `file:line`) проверить нельзя без домыслов.

Управляемое дерево при этом чистое и в полном паритете с `origin/main` `4594fef0`; ничего не изменялось, SQL/миграции/деплой/Publish не выполнялись.

## Что удалось подтвердить read-only (baseline для будущей ревизии)

Существующие в Lovable Cloud объекты, связанные с рассылками:
`broadcast_templates`, `broadcast_runs`, `broadcast_automation_deliveries`, `broadcast_dispatcher_config`, `email_send_log`, `email_send_state`.
Отдельных таблиц кликов/открытий/трекинга (`*_click*`, `*_tracking*`, `*_analytics*`) в схеме нет — новая аналитика PR #335 будет вводить их с нуля, включая публичный tracker-эндпойнт (зона повышенного риска RLS/PII).

## NON-CRITICAL FOLLOW-UPS

- Заранее решить вопрос «вероятностных email-open»: пиксель-трекинг требует публичной (verify_jwt=false) функции; она обязана быть write-only без чтения PII и с идемпотентной записью по токену, а не по email.
- Telegram не отдаёт «прочитано» для DM: любые поля read/seen в модели должны быть либо отсутствовать, либо явно помечены как «не поддерживается каналом», иначе аналитика будет ложной.
- Атрибуция покупок должна опираться только на канонические `orders_v2`/`payments_v2` и на `paid`-состояние, с раздельными окнами direct-after-click и assist-after-receive.
- Для новых таблиц в `public` обязательны `GRANT` в той же миграции (текущее правило проекта), иначе Data API вернёт permission error.

## Как разблокировать ревизию

Достаточно одного из вариантов:
1. Смержить PR #335 в `main` (или пушнуть ветку в зеркало Lovable), после чего я делаю ревизию на точном SHA.
2. Прислать полный diff PR #335 (или как минимум `supabase/migrations/20260817143430_broadcast_analytics.sql` + список изменённых функций/файлов) текстом/файлом.
3. Выдать read-доступ к GitHub-репозиторию (токен), чтобы я снял diff `4594fef0..f92fd696` сам.

## EXACT EXECUTE PLAN

Не предоставляется: план execute выдаётся только при VERDICT: PASS.

Изменений не вносилось: код, коммиты, миграции, SQL, RLS, данные, секреты, cron, Edge Functions, Publish — не затронуты.
