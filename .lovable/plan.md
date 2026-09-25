# План: публикация PR #554 для `/cb`

## Вердикт

**PASS по правилу отсутствия unresolved critical findings в scope.** Все 13 активных error findings созданы до PR #554 и относятся к политикам чтения таблиц вне изменённых компонентов, `/cb`, checkout и механизма публикации. Пользователь предоставил точные успешные результаты GitHub CI и локальной production build; независимо перечитать GitHub API metadata нельзя, поскольку доступного read-only GitHub connection в среде нет.

## Диагностика

- Текущий HEAD: `74475538c3dfebe130902db69c53a03fbacece77`; рабочее дерево чистое.
- Merge commit имеет родителей `a35e49384…` и `7b0614577…`; это merge PR #554.
- Diff относительно первого родителя ограничен ровно тремя файлами:
  - `src/components/course/CourseIndustries.tsx`;
  - `src/pages/cb-native/sections/AdvantagesSection.tsx`;
  - `src/pages/cb-native/__tests__/industryModuleCtas.test.tsx`.
- На `/cb` удалён только недоставляемый платный модуль «Посредничество»; тест ожидает 8 платных CTA и отсутствие этого названия.
- На legacy-странице тот же модуль переведён из цены 500 BYN в состояние «Скоро».
- Production campaign `cb21-owner-test`: `off`, activation/enabled timestamp `NULL`, один `HUMAN_HOLD`, claimed/sending jobs — 0.
- GitHub CI по предоставленным run metadata: Code/contracts/production build PASS (`36160559640`), guard PASS (`36160559716`), opt-in checkout smoke SKIPPED по дизайну. Локальный `npm run build` для этого source SHA — PASS по предоставленному результату.
- Свежий security scan содержит 13 активных error findings, но все они pre-existing/out-of-scope: доступы/роли админки, CRM, база знаний, меню, учебные потоки и доступ к модулям. Ни один finding не указывает на два изменённых UI-компонента, тест, `/cb`, checkout или publication boundary.
- Текущая публикация имеет deployment marker `e0b181ef…`; доказанной связи с SHA PR #554 нет. На `https://gorbova.by/cb` всё ещё видны «Посредничество» и его 500 BYN, поэтому PR #554 ещё не опубликован.
- Публичная страница сейчас отвечает без browser console/page errors на 1280×720 и 390×844.

## Предлагаемое решение

Выполнить один frontend Publish ровно из SHA `74475538c3dfebe130902db69c53a03fbacece77`, без database migrations, Edge Function deploy и изменения кампании.

## Dry-run перед Publish

Непосредственно перед публикацией повторно подтвердить:

1. HEAD ровно `74475538…`, дерево чистое, diff всё ещё только 2 компонента + 1 тест.
2. Повторно сверить предоставленные GitHub checks: run `36160559640` PASS, run `36160559716` PASS, opt-in checkout smoke SKIPPED by design.
3. Подтвердить, что production build для этого SHA остаётся PASS.
4. Подтвердить отсутствие новых critical/error findings, относящихся к трём файлам PR #554, `/cb`, checkout или publication boundary. Существующие 13 findings вне scope не блокируют этот Publish по правилу проекта.
5. Кампания остаётся `OFF`, activation `NULL`, `HUMAN_HOLD = 1`, claimed/sending = 0.
6. До Publish зафиксировать текущий deployment marker для сравнения.

## Execute

1. Вызвать штатный Lovable Publish один раз без смены URL/visibility.
2. Не применять миграции и не разворачивать функции.
3. Дождаться нового deployment marker; не считать сам запрос на публикацию доказательством завершённого deploy.
4. При неизменившемся marker, ошибке публикации или расхождении SHA — STOP без повторной публикации.

## Read-back verification

Проверять опубликованный `https://gorbova.by/cb`, а не Preview.

### Desktop — 1280×720

- открыть страницу с чистой сессией и дождаться загрузки данных;
- перейти к «Бухгалтерия по видам деятельности»;
- подтвердить отсутствие текста «Посредничество» и отдельной карточки 500 BYN для него;
- подтвердить ровно 8 доступных платных дополнений;
- перейти к тарифам и подтвердить три актуальные live-цены из production catalog: **1790 BYN, 2190 BYN, 2990 BYN**;
- проверить отсутствие горизонтального скролла, обрезки и перекрытий;
- сохранить скриншот с URL, новым deployment marker, SHA и viewport.

### Mobile — 390×844

- повторить те же проверки в новой чистой сессии;
- проверить, что карточки и тарифы помещаются по ширине, текст и цены читаемы, CTA не перекрываются;
- сохранить отдельный скриншот с URL, новым deployment marker, SHA и viewport.

### Финальные неизменности

- повторно подтвердить campaign `OFF` / activation `NULL` / один `HUMAN_HOLD` / 0 claimed/sending;
- подтвердить отсутствие database, Edge Function и customer-message действий;
- зафиксировать новый published deployment marker и связанное с ним доказательство SHA, если платформа его предоставляет. Если SHA недоступен, пометить published SHA как `UNKNOWN`, не выводить его из HTTP 200.

## STOP-guards

- HEAD, дерево или diff отличаются от проверенных;
- любой обязательный CI/build check не PASS;
- появляется новый critical/error security finding в scope PR #554, `/cb`, checkout или publication boundary;
- кампания или очередь дрейфовали;
- после Publish осталась карточка «Посредничество»/500 BYN, отсутствует одна из трёх цен, число доступных add-ons не равно 8;
- deployment marker не изменился или опубликованный SHA нельзя достоверно связать с целевым коммитом.

## DoD

Публикация считается выполненной только после PASS всех preflight-гейтов, нового deployment marker и двух опубликованных UI-пруфов: desktop 1280×720 и mobile 390×844. До этого текущий статус — **не публиковать**.

## Что не будет изменено

Код, база, миграции, функции, цены, доступы, кампания, платежные ссылки и сообщения пользователям. В этой ревизии Publish не выполняется.
