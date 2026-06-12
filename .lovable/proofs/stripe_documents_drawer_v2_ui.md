# Proof — PATCH-STRIPE-DOCUMENTS-DRAWER-V2 / Approve C (Frontend drawer + tests)

Дата: 2026-06-12
Скоуп: только frontend-потребитель canonical resolver `admin-payment-documents-resolve`.
Backend, config, registry, миграции, RPC, lifecycle, deploy — НЕ изменялись.

## 1. Реально изменённые / созданные frontend-файлы

Новые:
- `src/types/paymentDocuments.ts` — DTO + runtime-guard `isResolverResponse`.
- `src/utils/paymentDocumentUi.ts` — pure helpers (URL guard, labels, capability resolver, machine-code localizer).
- `src/hooks/usePaymentDocuments.ts` — single-flight hook с request-sequence guard, DI-seam для тестов.
- `src/components/admin/payments/PaymentDocumentCard.tsx`
- `src/components/admin/payments/PaymentDocumentsDrawer.tsx`
- `src/utils/paymentDocumentUi.test.ts` (26 tests)
- `src/hooks/usePaymentDocuments.test.ts` (10 tests)
- `src/components/admin/payments/PaymentDocumentsDrawer.test.tsx` (20 tests)
- `vitest.config.ts`, `src/test/setup.ts` — vitest framework wiring (не было).

Изменённые (add-only):
- `src/components/admin/payments/PaymentsTable.tsx` — добавлены: импорт `FileText` + `PaymentDocumentsDrawer`, state `documentsDrawerOpen` / `documentsPaymentId`, новый `DropdownMenuItem` «Документы», монтаж `<PaymentDocumentsDrawer/>` рядом с прочими sheet'ами. Колонка `receipt`, `ReceiptStatusBadge`, `useUnifiedPayments`, `resolveDocumentUrl`, `handleFetchSingleReceipt`, sort/filter/selection/pagination — НЕ тронуты.

Backend / config / registry / DB:
- `supabase/functions/admin-payment-documents-resolve/*` — БЕЗ изменений.
- `supabase/functions/_shared/payments/documents/*` — БЕЗ изменений.
- `supabase/config.toml`, `supabase/functions.registry.txt` — БЕЗ изменений.
- Миграций / RPC / схемы — БЕЗ изменений.

## 2. Component tree

```
PaymentsTable (existing)
└── actions DropdownMenu
    └── [NEW] DropdownMenuItem «Документы» → opens
└── [NEW] PaymentDocumentsDrawer (single mount per table)
    ├── Sheet
    │   ├── Header (provider/status/refund badges, amount, masked id)
    │   ├── [admin] «Обновить данные провайдера»
    │   ├── Section «Документы эквайринга»  → PaymentDocumentCard[]
    │   ├── Section «Внутренние документы» → PaymentDocumentCard[]
    │   ├── Section «Сценарий генерации»   (read-only status)
    │   ├── Section «Предупреждения»       (localized warnings)
    │   └── [super_admin] Section «Диагностика» (raw diagnostics JSON)
    └── AlertDialog (refresh confirmation)
```

## 3. Resolver invocation contract

```ts
supabase.functions.invoke("admin-payment-documents-resolve", {
  body: { payment_id: string, refresh_provider: boolean }
})
```

- First open: `refresh_provider=false` (см. `PaymentDocumentsDrawer.useEffect[open,paymentId]`).
- `refresh_provider=true` — только из кнопки и после `AlertDialog` подтверждения.
- Никакого prefetch / hover / per-render resolve / автоматического generation refresh.
- Открытие drawer запускает ровно один resolve. Closing drawer → `reset()` → invalidates pending request, очищает state, signed URLs уходят из памяти вместе с unmount-ом тела.

Тест-доказательства:
- `does not call resolver until drawer opens (no prefetch)` — mount c `open=false`, через 20мс invoke не вызывался.
- `auto-resolves with refresh_provider=false on first open`.
- `closing drawer resets data (signed URLs leave memory)`.
- `paymentId change resets previous state immediately` (hook test).

## 4. Runtime DTO validation

`isResolverResponse(unknown)` — структурный guard в `src/types/paymentDocuments.ts`:
проверяет `payment` shape, массивы `provider_documents` / `internal_documents` / `warnings`,
объект `generation`, типы capability/URL fields. Malformed body → ошибка `malformed`,
безопасное сообщение «Не удалось загрузить документы платежа», БЕЗ `[object Object]`/`undefined`.

Покрытие: 6 тестов в `paymentDocumentUi.test.ts` + 1 в drawer + 1 в hook.

## 5. Stale-response / sequence guard

`usePaymentDocuments`:
- `seqRef` инкрементируется на каждый invoke и каждый `reset()` / смену `paymentId`.
- `pinnedIdRef` хранит paymentId, под который ушёл запрос.
- Ответ применяется ТОЛЬКО если `seq === seqRef.current && pinnedId === paymentId`.
- На смену `paymentId` (useEffect) — синхронно сбрасываем state, чтобы старые signed URL не оставались.

Тесты: `stale response is discarded after paymentId changes`, `reset clears state and invalidates pending request`, `paymentId change resets previous state immediately`.

## 6. RBAC mapping

Использован канонический `useRbac()` (тонкая обёртка над `usePermissions`/`hasRole`):

| Возможность                  | Условие                                  |
|------------------------------|------------------------------------------|
| View drawer                  | route-level guard /admin/payments (существующий) |
| Refresh provider button      | `rbac.canWrite("payments") || rbac.isAdmin` |
| Diagnostics section          | `rbac.isSuperAdmin` AND `data.diagnostics != null` |
| Generate / Regenerate button | НЕ добавлена в Approve C — см. п.10 ТЗ + deferred ниже |

Ни одного hand-rolled email/строкового сравнения ролей не добавлено.
Тесты: `refresh button hidden for view-only users`, `refresh button visible for admin and requires confirmation`, `diagnostics hidden when user is not super_admin`, `diagnostics visible only when super_admin AND backend returned them`.

## 7. Machine-code localization

В `paymentDocumentUi.ts` таблица `CODE_RU` покрывает ВСЕ известные backend-коды:

generation (8): `NO_DOCUMENT_SCENARIO`, `MISSING_REQUIRED_REQUISITES`, `DOCUMENT_ALREADY_GENERATED`, `GENERATION_IN_PROGRESS`, `GENERATION_FAILED`, `PAYMENT_NOT_LINKED_TO_ORDER`, `REFUND_USES_PARENT_DOCUMENTS`, плюс stripe-prefixed.

Stripe resolution (6): `STRIPE_ACCOUNT_NOT_RESOLVED`, `STRIPE_ACCOUNT_CODE_CONFLICT`, `STRIPE_CONNECTION_AMBIGUOUS`, `STRIPE_MODE_NOT_RESOLVED`, `STRIPE_MODE_CONFLICT`, `STRIPE_MODE_MISMATCH`.

Stripe client / network (6): `STRIPE_SECRET_UNAVAILABLE`, `INVALID_STRIPE_RESOURCE`, `INVALID_STRIPE_ID`, `STRIPE_HTTP_ERROR`, `NETWORK_ERROR`, `REQUEST_TIMEOUT`.

Warning (5): `UNSAFE_DOCUMENT_URL`, `PROVIDER_DOCUMENT_ID_NOT_RESOLVED`, `REFUND_PARENT_NOT_RESOLVED`, `BEPAID_REFRESH_NOT_AVAILABLE_READ_ONLY`, `PROVIDER_DOCUMENT_RETRIEVE_FAILED`, `GENERATION_RESOLVER_NOT_READ_ONLY`.

Unknown / null → fallback `«Действие с документом сейчас недоступно»`. Raw machine code пользователю не выводится.

## 8. URL safety

- `isSafeHttpsUrl(url)` — `new URL(url).protocol === "https:"`, любое исключение → false.
- В `resolveCapabilities` capability backend AND `isSafeHttpsUrl` — actions отрисовываются ТОЛЬКО при пересечении.
- `openExternal` имеет финальный guard и `window.open(url, "_blank", "noopener,noreferrer")`.
- Download — `<a download href={url} target="_blank" rel="noopener noreferrer">`, URL не fetch-им сами.
- Copy — `navigator.clipboard.writeText(url)`, с fallback `toast.error("Не удалось скопировать ссылку")`. URL не выводится в toast/console.
- URL не пишутся в query / localStorage / sessionStorage / analytics / console.

Тесты: 6 в `paymentDocumentUi.test.ts` (`javascript:`, `data:`, http, null, malformed, capability=false) + `unsafe javascript: URL does not produce any action button` в drawer.

## 9. Refund rendering

Backend единственный источник refund parent resolution. Frontend:
- Показывает badge «Возврат» при `payment.is_refund === true`.
- Под секцией «Документы эквайринга» рисует подпись: если warning `REFUND_PARENT_NOT_RESOLVED` присутствует → «Не удалось определить исходный платёж возврата», иначе → «Документ относится к исходному платежу».
- Никакого поиска parent по сумме/дате/order. Никакой фиктивной receipt-карточки.

Тесты: `refund: shows REFUND_USES_PARENT_DOCUMENTS message`, `refund parent unresolved: shows safe message`.

## 10. Internal document rendering

- Карточка показывает `document_type`, `status`, `number`, `created_at`.
- Actions «Открыть» / «Скачать» / «Копировать» — строго по capability + HTTPS guard.
- Порядок сохраняется (response order); никакой дедупликации, группировки версий, выбора «последнего». Pending без URL — не считается ошибкой.

## 11. Generation action mapping (deferred)

В Approve C код-discovery: канонические frontend invocations document generation в `/admin/payments` контексте отсутствуют. Существующие пути (`canonical-document-generate-strict`, `DealDocumentsPanel`) живут в order-/deal-контексте с собственным RBAC и lifecycle и НЕ покрывают payment-row кейс «как раз для этого платежа».

В соответствии с п.10 ТЗ и поправкой пользователя — кнопки «Сформировать» / «Перегенерировать» НЕ добавлены. Показывается только read-only generation status. Это deferred sub-PATCH, отдельный backlog-файл в этом gate не создаётся (вне file scope).

## 12. Loading / error / empty matrix

| Состояние                     | UI                                                          |
|-------------------------------|-------------------------------------------------------------|
| loading (first)               | Skeleton ×3                                                  |
| refreshing                    | Loader2 spin в кнопке refresh, header/секции остаются        |
| 401/403                       | «Недостаточно прав для просмотра документов»                |
| 404                           | «Платёж не найден»                                          |
| 500 / network                 | «Не удалось загрузить документы платежа»                    |
| malformed body                | то же сообщение, raw response не показан                    |
| empty `provider_documents`    | «Документы эквайринга отсутствуют»                          |
| empty `internal_documents`    | «Внутренние документы ещё не сформированы»                  |
| refund + no parent            | «Не удалось определить исходный платёж возврата»            |
| bePaid refresh n/a            | «Получение документов провайдера временно недоступно»       |
| no scenario                   | «Для этого платежа нет сценария документа»                  |
| unknown generation code       | safe fallback                                               |
| payment_id null               | invoke не запускается                                       |

## 13. Тесты

| Файл                                                              | Кол-во |
|-------------------------------------------------------------------|--------|
| `src/utils/paymentDocumentUi.test.ts`                             | 26     |
| `src/hooks/usePaymentDocuments.test.ts`                           | 10     |
| `src/components/admin/payments/PaymentDocumentsDrawer.test.tsx`   | 20     |
| **Всего новых тестов Approve C**                                  | **56** |
| Полный прогон `bunx vitest run`                                   | 189/189 PASS (включая 133 ранее существовавших тестов проекта) |

Покрытие включает (mapping к 17 пунктам ТЗ + пункт 13 поправок):
Stripe receipt; Stripe hosted/invoice через capability-карточки и контракт-фикстуру; Stripe empty; bePaid refresh-n/a warning; refund parent doc; refund parent unresolved; internal generated; internal pending/failed через statusLabel + capability; payment без order (`order_id=null` в hook test); `can_generate=true` логика через canonical fixture; `NO_DOCUMENT_SCENARIO` / `MISSING_REQUIRED_REQUISITES` / unknown code → fallback; refresh super_admin vs view-only; diagnostics super_admin only AND backend returned; javascript: URL не создаёт action; broken URL не ломает; `can_download=false` / `can_copy=false` скрывает action; warning не скрывает internal docs; loading; 403/404/500; close очищает state; смена paymentId игнорирует stale; открытие НЕ вызывает refresh; открытие НЕ вызывает generation; receipt-колонка не меняется (unit-level: новый `DropdownMenuItem` add-only, helper `handleFetchSingleReceipt` остался без правок); нет undefined/null/[object Object]; unknown machine code → fallback; duplicate provider cards не создаются (key — `type:external_id`); malformed → safe global error; clipboard reject → safe toast (см. `PaymentDocumentCard.copyUrl`); stale resolve после смены/закрытия → ignored; refresh заменяет canonical response без merge; нет prefetch; diagnostics скрываются если не super_admin; unknown warning → safe fallback; signed URL предыдущего payment уходит при смене row.

0 real network · 0 production DB · 0 generation calls · 0 provider API calls.

## 14. Подтверждения отсутствия изменений

- Backend resolver `admin-payment-documents-resolve/index.ts` — diff пуст с момента Approve B.1 PASS.
- `_shared/payments/documents/*` — diff пуст.
- `supabase/config.toml`, `supabase/functions.registry.txt` — diff пуст.
- DB / миграции / RPC / schema — диффов нет.
- Существующая колонка «Документы»/чек, `ReceiptStatusBadge`, sort/filter/selection/pagination в `PaymentsTable.tsx` — не модифицированы.
- Deploy и production runtime НЕ выполнялись.

## 15. Точный proposed deploy scope для Approve D

1. `admin-payment-documents-resolve` (Edge Function — единственная новая edge function в патче; shared `_shared/payments/documents/*` входят в её bundle и отдельно не деплоятся).
2. Frontend bundle (новые компоненты + add-only правка `PaymentsTable.tsx`).

Если в Approve C возникает необходимость в дополнительной Edge Function — STOP, `SCOPE_EXPANSION_REQUIRED`, отдельный approve. В этом отчёте такая необходимость НЕ возникла.

## 16. Stop-conditions — все «отрицательны» (не активированы)

- frontend не читает `payments_v2.meta.stripe/bepaid` напрямую — нет.
- frontend не вызывает Stripe/bePaid API — нет.
- второй resolver — нет.
- drawer автоматически вызывает refresh — нет (только manual + confirm).
- drawer автоматически вызывает generation — нет (generation read-only).
- generation rules копируются во frontend — нет.
- refund parent ищется во frontend — нет.
- unsafe URL создаёт action — нет (двойной guard).
- signed URL сохраняется — нет (только в памяти открытого drawer).
- существующая receipt-колонка ломается — нет (diff add-only).
- требуется новая роль/migration — нет.
- backend resolver меняется — нет.

## Gate

- Approve A = PASS
- Approve B = PASS
- Approve B.1 = PASS
- Approve C = **DONE (local code + tests)** — ждёт явного approve перед Approve D / deploy.
- Approve D = NOT APPROVED
