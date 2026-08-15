# PLAN-ONLY / READ-ONLY ревизия PR #313 — вердикт PASS

Изменений не вносилось: код не редактировался, коммиты не создавались, SQL/миграции/деплой/Publish не выполнялись.

## 1) Managed Git SHA

- Текущий managed SHA: `d1e35290430e27834c469366553c94fbedd99a80` — «fix: hide Instagram transport identifiers (#313)».
- Точное совпадение с указанным merged main SHA — **PASS**. Sync не требуется, рабочее дерево чистое.
- Предыдущий коммит: `3c6e976eb422483eda4f50e6b1660a835c550dfd` (PR #312).

## 2) Build и «5 issues»

- `vite build` на текущем дереве: **успешно**, `✓ built in 42.69s`, ошибок нет. Единственное предупреждение — размер чанков (>500 kB), оно историческое и не блокирующее.
- Типы: `tsgo --noEmit` — без ошибок.
- Тесты изменённых файлов: `resolveInstagramSourceLabel.test.ts` + `useUnifiedInbox.instagramIsolation.test.ts` — 8/8 PASS.
- Dev-preview отвечает HTTP 200.

Вывод: статус «Build unsuccessful / Preview out of date» в UI — **устаревший артефакт предыдущего SHA**, а не текущий блокирующий отказ. Фактическая сборка d1e35290 проходит.

Про «5 issues»: панель мониторинга сейчас возвращает **8 pending findings**, ни одна не относится к PR #313 и ни одна не появилась из его диффа:

| # | Находка | Отношение к #313 |
|---|---|---|
| 1 | send-email 401 (регексп Bearer) | не связано, backend |
| 2 | legacy `has_role` permission denied | не связано, backend/RBAC |
| 3 | Дубль CB20-миграции ломает fresh deploy | не связано, миграции |
| 4 | live-resolve / live-session-heartbeat 502 | не связано, функции |
| 5 | canonical-document-send: `tariffs.public_title` | не связано, функции |
| 6 | getcourse-webhook `no_instance_id` | не связано, конфиг вебхука |
| 7 | telegram-check-expired revoke non-2xx | не связано, функции |
| 8 | amocrm-webhook `secret_not_configured` | не связано, конфиг вебхука |

Блокирующих для данного scope ошибок нет; все 8 — самостоятельные ранее известные backend-хвосты, каждый требует отдельной задачи и отдельного разрешения.

## 3) Диф PR #313 — проверка scope

`git diff 3c6e976e..d1e35290` содержит ровно 4 файла (+53/−5):

- `src/lib/resolveInstagramSourceLabel.ts` — в `isSyntheticId` добавлено снятие ведущих `@`, чтобы `@mc:*` трактовался как synthetic;
- `src/hooks/useUnifiedInbox.ts` — карта меток переведена на канонический `resolveInstagramAccountDisplayName`, убран fallback на `instagram_page_id`/`id` и префикс `@`;
- `src/lib/resolveInstagramSourceLabel.test.ts`, `src/hooks/useUnifiedInbox.instagramIsolation.test.ts` — регрессионные тесты.

Нет: миграций, Edge Functions, RLS/политик, изменений данных, роутинга, секретов, `config.toml`, зависимостей. **PASS.**

## 4) Минимальная безопасная EXECUTE-последовательность

1. Read-back managed SHA — подтвердить ровно `d1e35290430e27834c469366553c94fbedd99a80` (сейчас уже так; при расхождении — стоп).
2. Пересобрать preview из этого SHA (только build, без deploy и SQL).
3. Проверка PASS-гейта: build без ошибок, typecheck без ошибок, целевые vitest-тесты 8/8.
4. Production UI proof на менеджерском доступе: вкладки Contact Center Instagram/Unified Inbox — в списке диалогов и в шапке нет `mc:*`, `@mc:*`, `subscriber_id`, `thread_key`, `instagram_page_id`; вместо них человекочитаемое имя либо «Instagram Direct». Скриншоты ПК и мобильного viewport с привязкой к URL и SHA, без PII.
5. Publish ровно этого SHA — только после всех PASS пункта 3–4.

Ничего из БД, функций и секретов в этой последовательности не затрагивается.

## Hard stop conditions

- managed SHA ≠ `d1e352904…` или main ушёл вперёд — стоп.
- Ошибка build/typecheck/тестов на этом SHA — стоп без Publish.
- Любое предложение сгенерировать код, применить SQL/миграцию, задеплоить функцию или изменить данные в этом scope — стоп.
- В UI после сборки виден любой transport identifier — стоп без Publish.
- Появление нового critical finding, относящегося к Contact Center / Instagram — стоп.

## ИТОГ: PLAN PASS
