# План: публикация фикса заголовка формы на /predzapisnalogi (PR #353)

## Итог discovery (read-only, изменений не вносилось)

- Managed-зеркало уже содержит merge PR #353: коммит `50a70404a1f95b34dd6c0bb39ccbe9f451448b40` присутствует в истории.
- Текущий managed HEAD — `5dcbf4c2653b42ca5f98a892c66ce8ddb5c92d98` («Work in progress», автор gpt-engineer-app[bot]) поверх `50a70404a`. Дельта — только автогенерируемые Lovable-файлы: `src/integrations/supabase/client.ts`, `src/integrations/supabase/previewAuthStorage.ts`, `src/integrations/supabase/types.ts`. Кода PR #353 это не касается.
- Рабочее дерево чистое (`git status --porcelain` пустой).
- Диff PR #353 (`36c0770ba`) затрагивает ровно 2 файла: `src/components/site-renderer/blocks/FormSection.tsx` и новый `FormSection.richText.test.tsx`. Миграций, Edge Functions, изменений схемы/данных Supabase нет.
- Изменение: `title`, `subtitle`, `buttonText` рендерятся через существующий `SafeHtml` (`src/components/ui/SafeHtml.tsx` → `sanitizeHtml`) в обеих ветках (`LegacyFormSection` и `AuthFormSection`). Новых зависимостей нет.
- Проверки в песочнице: typecheck без ошибок, регрессионный тест `FormSection.richText.test.tsx` — 2/2 PASS, dev-preview отвечает 200.
- Причина статуса «Build unsuccessful / Preview is out of date» на GitHub-событиях PR #353: события относятся к промежуточным состояниям зеркала до завершения синхронизации. Текущее состояние собирается успешно. Признаков реальной ошибки сборки в текущем зеркале не обнаружено.

**Статус: PASS для перехода к build-mode. Блокеров нет.**

## Шаги выполнения (build mode)

### 1. Подтверждение SHA
- Убедиться, что `50a70404a1f95b34dd6c0bb39ccbe9f451448b40` — предок HEAD и что дельта HEAD относительно него ограничена тремя автогенерируемыми файлами `src/integrations/supabase/*`.
- Дерево должно быть чистым. Любая другая дельта в `src/**`, `supabase/functions/**`, `supabase/migrations/**` → STOP.

### 2. Подтверждение отсутствия backend-работ
- Повторно подтвердить: 0 файлов в `supabase/migrations/**` и `supabase/functions/**` в диффе PR. Никаких SQL/DDL/DML, никаких deploy Edge Functions.

### 3. Успешная managed-сборка без правок кода
- Запустить полный typecheck и целевой тест `src/components/site-renderer/blocks/FormSection.richText.test.tsx`.
- Запустить production-сборку в песочнице; при ошибке — зафиксировать точный текст и STOP (правки кода запрещены этим планом).
- Никаких коммитов, миграций и правок файлов на этом шаге не выполняется.

### 4. Гейты PASS/STOP перед Publish
Publish разрешён только при одновременном выполнении:
- SHA-инвариант из шага 1 выполнен, дерево чистое;
- typecheck PASS, регрессионный тест PASS, production-сборка PASS;
- `security--get_scan_results` не содержит новых critical findings, связанных с этим изменением;
- backend-дельты нет.
Любое несовпадение → STOP/BLOCKED с отчётом, без Publish.

### 5. Publish
- Опубликовать frontend (`preview_ui--publish`). Backend не затрагивается.
- Зафиксировать опубликованный SHA и URL.

### 6. Пост-Publish верификация на https://gorbova.by/predzapisnalogi
Через headless-браузер, два отдельных прогона:
- Десктоп 1280×1800 и мобильный 390×844.
Проверить и приложить по одному скриншоту на viewport:
- заголовок формы отображает форматированный текст («Предзапись на менторство «Налоги и проверки Беларуси»»), в видимом тексте нет литералов `<b>`, `<span>`, `&nbsp;`;
- DOM заголовка содержит реальные элементы `b`/`span`, а не экранированный текст;
- заголовок читаем, не обрезан, не выходит за края и не перекрывается;
- поле email и кнопка «Продолжить» видимы и доступны; форма НЕ отправляется, реальные данные не вводятся;
- консоль без новых ошибок.
Скриншоты привязать к URL, опубликованному SHA и viewport. На скриншотах не должно быть персональных данных.

### 7. Rollback
Если любая проверка шага 6 не проходит:
- откатить публикацию на предыдущую опубликованную версию Lovable через историю версий проекта (restore предыдущей published-версии) и повторно опубликовать её;
- подтвердить откат теми же двумя viewport-проверками на https://gorbova.by/predzapisnalogi;
- зафиксировать в отчёте причину отката, точные evidence и предложение follow-up-задачи;
- код в GitHub не откатывать в рамках этой задачи (PR #353 уже в `main`), revert оформлять отдельной задачей при необходимости.

## Технические детали

- Затронутый компонент: `FormSection.tsx`, ветки `LegacyFormSection` и `AuthFormSection`.
- Санитайзер: существующий `sanitizeHtml` из `@/lib/sanitization`; `<script>` вырезается (покрыто тестом).
- Никаких новых зависимостей, миграций, функций и секретов.
