## да, согласен, с учетом правок:

Все пункты плана сохраняются по принципу add-only/no-loss. Approve C разрешён после следующих уточнений.

**1. Исправить будущий deploy scope**

В proof сейчас указано:

две edge functions + frontend bundle

Фактически в рамках этого патча создана одна новая Edge Function:

admin-payment-documents-resolve

Shared-модули входят в её bundle и отдельно не деплоятся.

Корректный proposed deploy scope Approve D:

admin-payment-documents-resolve

frontend bundle

Если в ходе Approve C выяснится необходимость второй Edge Function:

STOP

SCOPE_EXPANSION_REQUIRED

Без отдельного approve её не создавать.

&nbsp;

**2. Использовать существующий UI/RBAC-паттерн**

Не вводить параллельные проверки:

useRbac()

useSuperAdmin()

isAdmin

canWrite('payments')

если проект уже имеет один канонический payments-RBAC helper.

Нужно найти и использовать тот же guard, который применяется для существующих write-действий в /admin/payments.

Правила:

- просмотр drawer — действующее право просмотра платежей;
- refresh — действующее право редактирования платежей;
- diagnostics — фактический isSuperAdmin из канонического RBAC;
- никаких проверок по email;
- никаких ручных сравнений строк ролей;
- frontend RBAC только скрывает действия, backend остаётся обязательной границей безопасности.

&nbsp;

**3. Generation/Regeneration не добавлять без полностью подтверждённого flow**

В Approve C выполнить code discovery существующих frontend actions:

generate document

canonical-document-generate

canonical-document-regenerate

existing document action hooks

Кнопку «Сформировать» или «Перегенерировать» разрешено добавить только если одновременно доказаны:

- существующий production endpoint;
- существующий frontend invocation pattern;
- действующий RBAC;
- понятный loading/result flow;
- отсутствие необходимости менять backend.

Если хотя бы одного элемента нет:

- кнопки не добавлять;
- показывать только read-only generation status;
- deferred-пункт записать в proof Approve C;
- отдельный backlog-файл в этом gate не создавать, если он выходит за утверждённый file scope.

Это не блокирует PASS read-only drawer.

&nbsp;

**4. Runtime contract нельзя считать доверенным только из TypeScript types**

Ответ Edge Function приходит как runtime unknown.

Добавить структурную безопасную проверку DTO без копирования бизнес-правил:

isPaymentDocumentsResponse()

или существующий schema validator проекта

Проверять минимум:

- payment;
- массивы provider_documents, internal_documents, warnings;
- объект generation;
- допустимые типы capability и URL fields.

При malformed response:

Не удалось загрузить документы платежа

Не допускать runtime crash и [object Object].

Не добавлять новую dependency ради schema validation, если в проекте уже есть подходящий validator.

&nbsp;

**5. Локализация должна покрывать весь backend contract**

Не ограничиваться только перечисленными generation codes.

Frontend должен безопасно обрабатывать все machine codes, объявленные в backend types.ts, включая provider-resolution и warning codes:

STRIPE_ACCOUNT_NOT_RESOLVED

STRIPE_ACCOUNT_CODE_CONFLICT

STRIPE_CONNECTION_AMBIGUOUS

STRIPE_MODE_NOT_RESOLVED

STRIPE_MODE_CONFLICT

STRIPE_MODE_MISMATCH

STRIPE_SECRET_UNAVAILABLE

INVALID_STRIPE_RESOURCE

INVALID_STRIPE_ID

STRIPE_HTTP_ERROR

NETWORK_ERROR

REQUEST_TIMEOUT

PROVIDER_DOCUMENT_RETRIEVE_FAILED

BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY

REFUND_PARENT_NOT_RESOLVED

UNSAFE_DOCUMENT_URL

Необязательно давать каждому техническому коду отдельный длинный текст. Допустима категоризация:

provider temporarily unavailable

provider configuration unavailable

document unavailable

permission denied

Но raw code/error пользователю не показывать. Неизвестный код получает безопасный fallback.

&nbsp;

**6. Hook: строгая защита от stale response**

usePaymentDocuments должен иметь request-sequence guard.

Обязательная модель:

requestId++

запомнить paymentId для запроса

применять response только если:

  requestId всё ещё последний

  drawer открыт

  текущий paymentId совпадает

При закрытии drawer:

- увеличить sequence/invalidate request;
- очистить response;
- очистить error;
- удалить signed URL из памяти компонента.

Если Supabase invoke не поддерживает реальный AbortController, request-sequence guard обязателен.

&nbsp;

**7. Не выполнять resolve до фактического открытия drawer**

Действие в таблице должно сначала установить:

selectedPaymentId

drawerOpen = true

И только открытый drawer запускает:

refresh_provider=false

Запрещено:

- prefetch документов для всех строк таблицы;
- resolve при каждом render таблицы;
- resolve при hover;
- автоматический provider refresh.

Это исключает массовые вызовы resolver и создание лишних signed URL.

&nbsp;

**8. Confirm использовать через существующий UI-компонент**

Предпочтительно использовать существующий проектный:

AlertDialog / ConfirmDialog

Не применять window.confirm, если в проекте уже есть канонический dialog pattern.

Confirm должен отображаться только для ручного:

refresh_provider=true

Открытие drawer и обычный resolve подтверждения не требуют.

&nbsp;

**9. URL actions**

Для Открыть использовать:

[window.open](http://window.open)(url, "_blank", "noopener,noreferrer")

либо безопасную ссылку:

target="_blank"

rel="noopener noreferrer"

Для Скачать:

- не выполнять fetch внешнего Stripe/bePaid URL;
- использовать capability backend;
- для signed storage URL допускается безопасная ссылка с download только когда can_download=true.

Для Скопировать:

- обработать отказ Clipboard API;
- не выводить URL в console/toast;
- toast содержит только:  
Ссылка скопирована  
либо безопасную ошибку.

&nbsp;

**10. Existing receipt regression**

Поскольку изменяется PaymentsTable.tsx, proof должен содержать file-level diff, подтверждающий:

- существующая колонка receipt не удалена;
- ReceiptStatusBadge не изменён;
- старый обработчик чека остаётся;
- новое действие «Документы» добавлено отдельно;
- sorting/filtering/selection/pagination не изменены.

Добавить тест:

клик по существующему receipt action

→ прежний handler вызывается

→ PaymentDocumentsDrawer не открывается

И отдельный тест:

клик по «Документы»

→ открывается новый drawer

→ старый receipt handler не вызывается

&nbsp;

**11. Provider refresh response не merge-ить вручную**

После успешного refresh hook полностью заменяет текущий DTO ответом resolver:

setData(refreshedCanonicalResponse)

Запрещено:

- соединять старые и новые provider documents;
- дедуплицировать во frontend;
- сохранять старые signed URLs;
- сохранять прошлые warnings после нового response.

Backend является единственным источником canonical response.

&nbsp;

**12. Diagnostics**

Diagnostics показываются только при двух условиях одновременно:

backend response содержит diagnostics

AND

frontend canonical RBAC подтверждает super_admin

Frontend не должен выводить diagnostics, если backend ошибочно вернул их обычному admin.

Masked IDs отображаются только в уже замаскированном виде из DTO. Не маскировать raw secret/provider data самостоятельно, поскольку raw данные вообще не должны приходить.

&nbsp;

**13. Test scope дополнить**

К утверждённым тестам добавить:

1. Malformed resolver response → безопасная глобальная ошибка.
2. Старый resolve завершился после смены paymentId → response проигнорирован.
3. Старый resolve завершился после закрытия drawer → response проигнорирован.
4. Refresh полностью заменяет canonical response, без frontend merge.
5. Clipboard rejection → безопасный toast, URL не логируется.
6. Existing receipt action и новое Documents action не конфликтуют.
7. Drawer не делает prefetch для остальных payment rows.
8. Backend diagnostics скрываются, если frontend user не super_admin.
9. Malformed/unknown warning object не вызывает crash.
10. Signed URL предыдущего payment не остаётся после переключения строки.

Итоговое количество тестов может быть выше 35; в отчёте указать фактическое число.

&nbsp;

**14. Proof Approve C**

В .lovable/proofs/stripe_documents_drawer_v2_[ui.md](http://ui.md) дополнительно включить:

- exact future deploy scope:
- runtime DTO validation;
- request sequence/stale response guard;
- отсутствие prefetch;
- existing receipt regression diff;
- подтверждение отсутствия generation/regeneration flow, если он не найден;
- подтверждение отсутствия backend/config/registry изменений;
- полный список реально изменённых frontend-файлов;
- тесты и фактический результат.

&nbsp;

**Gate status**

PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve A = PASS

PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B = PASS

PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve B.1 = PASS

PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve C = APPROVED

Approve D = NOT APPROVED

После реализации Approve C остановиться.

Deploy, backend-изменения и production runtime не выполнять.

&nbsp;

План: PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve C — Frontend drawer + tests

Реализуем только frontend-потребителя canonical resolver `admin-payment-documents-resolve`. Backend, config.toml, registry, миграции, RPC, lifecycle, deploy — НЕ трогаем. Существующая колонка «Документы»/чек и `ReceiptStatusBadge` сохраняются как есть; новое действие добавляется add-only.

### 1. Новые файлы (frontend only)

- `src/types/paymentDocuments.ts` — TypeScript-зеркало DTO resolver-а (`payment`, `provider_documents[]`, `internal_documents[]`, `generation`, `diagnostics`, `warnings[]`, machine codes). Без бизнес-правил.
- `src/hooks/usePaymentDocuments.ts` — hook(paymentId): `resolveDocuments()`, `refreshProviderDocuments()`, `reset()`. Defaults `refresh_provider=false`, race-guard по последнему paymentId, очистка state при close/смене id, никакого persist signed URL.
- `src/utils/paymentDocumentUi.ts` — чистые helpers: локализация machine codes (таблица из п.10 ТЗ + safe fallback), `isSafeHttpsUrl(url)` (try/catch + `protocol === "https:"`), маскирование UUID, capability → action mapping. Никаких provider allowlist / refund / scenario логик.
- `src/components/admin/payments/PaymentDocumentsDrawer.tsx` — основной Sheet/Drawer: header, секции «Документы эквайринга», «Внутренние документы», «Генерация», «Диагностика» (super_admin), кнопка «Обновить данные провайдера» (с confirm), loading/error/empty states.
- `src/components/admin/payments/PaymentDocumentCard.tsx` — карточка одного документа (provider или internal): title/type/status/source/created_at, actions «Открыть»/«Скачать»/«Скопировать» строго по capability + secondary https-guard.
- Тесты рядом: `PaymentDocumentsDrawer.test.tsx`, `usePaymentDocuments.test.ts`, `paymentDocumentUi.test.ts`, contract-fixture тест DTO.

### 2. Изменения существующих файлов (минимум)

- `src/components/admin/payments/PaymentsTable.tsx` — add-only: новый action «Документы» в action-меню каждой строки (Stripe, bePaid, refund), открывает `PaymentDocumentsDrawer` по `payment.id`. Колонка `receipt`, `ReceiptStatusBadge`, `useUnifiedPayments`, `resolveDocumentUrl` не трогаются. Sort/filter/selection/pagination не меняются.

Других файлов не редактируем.

### 3. Контракт с backend

- Hook вызывает `supabase.functions.invoke('admin-payment-documents-resolve', { body: { payment_id, refresh_provider } })`.
- Первое открытие: `refresh_provider=false`. `true` — только из кнопки после `window.confirm`/AlertDialog.
- Frontend не интерпретирует provider metadata, не ищет refund parent, не строит signed URLs, не дедуплицирует, не запускает generation/refresh автоматически.

### 4. RBAC

- Через существующий `useRbac()` / `useSuperAdmin()`. Никаких новых ролей/permissions.
- Refresh provider: видим если `canWrite('payments')` или `isAdmin`.
- Diagnostics-секция: только `isSuperAdmin`.
- Generate/Regenerate кнопки: показываем ТОЛЬКО если найден существующий canonical action и RBAC разрешает; иначе — read-only статус + deferred sub-PATCH backlog файл.

### 5. URL безопасность

`isSafeHttpsUrl` обязателен перед каждым `window.open` / copy / download. `window.open(url, '_blank', 'noopener,noreferrer')`. URL не пишется в query/localStorage/sessionStorage/analytics/console.

### 6. Тесты (≥35, локальные, 0 network/DB/provider)

Полный список из п.17 ТЗ покрывается:

- Stripe (receipt / hosted invoice / invoice PDF / empty)
- bePaid (receipt / empty / refresh read-only)
- Refund (parent doc / parent unresolved)
- Internal (generated / pending / failed)
- Generation (`can_generate=true`, `NO_DOCUMENT_SCENARIO`, `MISSING_REQUIRED_REQUISITES`)
- RBAC (refresh super_admin vs view-only, diagnostics super_admin only)
- Security (`javascript:` URL, broken URL, capability=false скрывает action)
- Lifecycle (loading, 403/404/500, close очищает state, смена paymentId игнорирует stale response, открытие НЕ вызывает refresh/generation)
- Regression (receipt-колонка не меняется, нет undefined/null/[object Object], unknown machine code → fallback, дубли не создаются)
- Contract fixture (frontend DTO ↔ canonical response из backend proof)

Запуск: `bunx vitest run` (frontend only). Цель: все PASS.

### 7. Proof

`.lovable/proofs/stripe_documents_drawer_v2_ui.md` со всеми разделами из п.18 ТЗ: file list, diff summary, component tree, resolver contract, RBAC map, machine-code localization table, URL safety proof, refund rendering, internal rendering, generation-action mapping, loading/error/empty matrix, тесты, подтверждение отсутствия deploy/backend/config/DB изменений, exact deploy scope для Approve D (две edge functions + frontend bundle).

### 8. Stop-conditions

Любое из условий п.19 ТЗ → немедленный STOP и отчёт без продолжения.

### 9. Gate

После реализации остановиться и вернуть «Отчёт о выполнении: PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve C». Deploy и production runtime не запускаем.
---

## Approve C — DONE (2026-06-12)

- 56/56 новых frontend-тестов PASS; полный прогон 189/189 PASS.
- Backend / config.toml / functions.registry.txt / DB / RPC / миграции — без изменений.
- Existing receipt column / `ReceiptStatusBadge` / `useUnifiedPayments` / `resolveDocumentUrl` — не тронуты (add-only `DropdownMenuItem` + новый `<PaymentDocumentsDrawer/>`).
- Proof: `.lovable/proofs/stripe_documents_drawer_v2_ui.md`.
- Gate: Approve C = DONE. Approve D = NOT APPROVED — ждём отдельного approve на deploy.
