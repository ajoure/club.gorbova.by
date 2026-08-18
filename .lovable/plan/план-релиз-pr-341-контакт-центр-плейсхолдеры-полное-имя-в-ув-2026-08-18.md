# План: релиз PR #341 (контакт-центр, плейсхолдеры, полное имя в уведомлениях)

Режим проверки: PLAN-ONLY / STRICT READ-ONLY. Выполнялись только чтение репозитория, typecheck, production build и unit-тесты. Записей, SELECT с PII, деплоя, публикации, сообщений и очередей не было.

## 1. Managed owner и parity — PASS

- Owner: Lovable Cloud (managed backend), канонический project ref зафиксирован в `.lovable/architecture/canonical_infrastructure_v1.md`. Legacy ref не встречается.
- Managed Git HEAD: `71143c3d8ef7a38e414cd73eb669286e87a659b9` — «Merge pull request #341 from ajoure/codex/fix-contact-center-name-composer».
- Совпадение с указанным exact SHA: посимвольно ДА. Рабочее дерево чистое (`git status --porcelain` пуст). Паритет полный, SHA mismatch нет.

## 2. Diff PR #341 — PASS, в scope

23 файла, +408 / −106. Две группы, обе в объявленном scope:

Frontend (контакт-центр и плейсхолдеры): `ContactDetailSheet.tsx`, `ContactTelegramChat.tsx`, `TokenizedRichInput.tsx`, `BroadcastTemplateDialog.tsx`, `BroadcastsTabContent.tsx`, `InboxTabContent.tsx`, `unified/UnifiedInboxView.tsx`, `useUnifiedInbox.ts`, `contactCenterMessagePlaceholders.ts`, `system-token-resolver.ts` + 3 тестовых файла.

Edge Functions (полное имя в уведомлениях): новый общий модуль `_shared/admin-profile-name.ts`, обновлённый `_shared/stripe-admin-notify.ts` (+ его dispatch-тест) и 7 потребителей: `admin-manual-charge`, `bepaid-auto-process`, `diagnose-admin-notifications`, `direct-charge`, `notify-order-purchased`, `payments-reconcile`, `subscription-charge`.

Файлов вне scope (платежная логика, RLS, схемы, роли, cron) в диффе нет.

## 3. Миграции — PASS, отсутствуют

`git diff --name-only ... -- supabase/migrations` = 0 файлов. Изменений схемы, RLS, GRANT, enum и cron в PR нет.

## 4. Причина «Build unsuccessful / Preview out of date» — PASS (дефекта кода нет)

Локально на этом же SHA:

- `tsgo --noEmit -p tsconfig.app.json` — exit 0, ошибок нет;
- `npm run build` — PASS, `✓ built in 37.84s`, единственные предупреждения — размер чанков (не ошибка);
- `vitest run` по трём новым тестам PR — 10/10 PASS.

Вывод: verified build fault на SHA `71143c3d` не подтверждён. Статус относится к предыдущему preview-билду в конвейере синхронизации и снимается повторным успешным билдом/Publish. Правок в исходниках не требуется.

## 5. Точный post-merge EXECUTE (только после «EXECUTE APPROVED»)

1. Preflight: подтвердить HEAD = `71143c3d8ef7a38e414cd73eb669286e87a659b9`, дерево чистое. Любое расхождение — STOP.
2. Gates (read-only): typecheck, production build, три теста PR. Все PASS — иначе STOP.
3. Deploy Edge Functions: только изменённые и только потребители изменённого shared-кода, по одному вызову набора (см. §6). Webhook-функция деплоится индивидуально по протоколу `public_webhook_controlled_redeploy_protocol_v1.md`.
4. Frontend Publish — только после PASS деплоя.
5. Read-back (см. ниже). Отчёт: публичный URL + эффективный SHA.

## 6. Точный deploy set

Изменённые функции (7):
`admin-manual-charge`, `bepaid-auto-process`, `diagnose-admin-notifications`, `direct-charge`, `notify-order-purchased`, `payments-reconcile`, `subscription-charge`.

Потребитель изменённого shared-модуля, не затронутый диффом напрямую, но обязательный к передеплою (иначе останется старая версия `_shared/stripe-admin-notify.ts` в бандле):
`stripe-webhook` — деплоится ОТДЕЛЬНЫМ единичным вызовом по протоколу controlled redeploy (проверка блока `verify_jwt` в `supabase/config.toml`, snapshot источника, внешний pre-smoke, post-smoke на t=0/30s/2m, регрессия проверки подписи провайдера).

Итого 8 функций. Shared-модули (`_shared/admin-profile-name.ts`, `_shared/stripe-admin-notify.ts`) отдельно не деплоятся — они попадают в бандлы перечисленных функций.

## 7. Read-back проверки

- Каждая из 8 функций числится задеплоенной с текущего SHA, без ошибок в логах после деплоя.
- `stripe-webhook`: внешний неподписанный запрос даёт прикладную ошибку проверки подписи, а не платформенный JWT-wall; лайв-платежи для smoke не используются.
- Уведомления: проверка формата полного имени выполняется чтением кода/логов без PII; тестовые рассылки не запускаются.
- Frontend: опубликованный URL отдаёт эффективный SHA `71143c3d`; UI-приёмка контакт-центра и пикера плейсхолдеров — desktop + mobile, скриншоты без PII.
- Данные: изменений в таблицах, очередях и отправках 0 — деплой и Publish не пишут в production-данные.

## 8. Границы

Не входит: миграции, изменения схемы/RLS/GRANT, изменения данных, секреты, cron, создание пользователей/сессий, платежи и возвраты, отправка email/Telegram/SMS, деплой любых функций вне перечисленных восьми.

Вердикт: **PASS**. STOP-условий (SHA mismatch, missing dependency, critical finding) не обнаружено.
