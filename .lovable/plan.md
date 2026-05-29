# да, согласен, с учетом правок:

План технически в правильном направлении: `ai-generate-document-package` должен стать **orchestrator**, а не отдельным генератором. Но в плане не хватает важного блока по UI-кнопкам и по режимам запуска для пользователя/админа.

Ниже правки, которые нужно добавить перед approve.

```md
## Обязательные правки к Sprint 3I

### 1. Добавить UI-кнопки генерации пакета

Сейчас в UI нет понятной кнопки «Сформировать пакет». Это нужно добавить в двух местах:

#### 1.1. Пользовательский UI

В пользовательском разделе пакета:

```text
/document-generation → Пакеты документов → Идеология
```

или в текущем рабочем пользовательском маршруте, где клиент заполняет анкету пакета.

Добавить кнопку:

```text
Сформировать пакет документов
```

Кнопка должна быть видна пользователю после того, как:

- выбран ЮЛ/ИП пакета;
- в пакете есть хотя бы один привязанный шаблон;
- по каждому документу заполнены обязательные роли, которые реально используются в DOCX;
- validation не содержит error.

Если есть warning, но нет error — кнопка может быть активна, но перед запуском показывать confirm:

```text
В некоторых документах есть предупреждения. Вы можете сформировать пакет, но часть данных может быть неполной. Продолжить?
```

#### **1.2. Админский UI**

В админке также нужна кнопка тестовой генерации:

```text
/admin/documents → Пакеты документов → Идеология
```

Во вкладках:

```text
Состав
Проверка шаблонов
```

добавить admin-only кнопку:

```text
Тестово сформировать пакет
```

Назначение: админ может проверить пакет, не заходя под обычного пользователя.

Важно:

- кнопка доступна только admin/super_admin;
- она использует выбранную package_session;
- если package_session нет, админ должен выбрать пользователя/session или создать тестовую session;
- результат помечается как test/admin run в `audit_logs` и metadata.

---

### **2. Добавить режимы запуска: user run и admin test run**

В `ai-generate-document-package` добавить явное различие:

```text
run_mode: 'user_generate' | 'admin_test'
```

#### **user_generate**

- запускается пользователем из пользовательского UI;
- работает только по его `package_session_id`;
- проверяет ownership через `profile_id`;
- сохраняет результат как обычную генерацию пользователя.

#### **admin_test**

- запускается только admin/super_admin;
- может выбрать package_session пользователя;
- пишет audit:  
`package_generation_admin_test_started`;
- в metadata результата добавить:

```json
{
  "run_mode": "admin_test",
  "admin_user_id": "...",
  "package_session_id": "...",
  "package_template_id": "...",
  "is_test_generation": true
}
```

---

### **3. Не запускать генерацию, если анкеты документов не готовы**

Перед вызовом `canonical-document-generate-strict` orchestrator обязан сделать preflight по каждому `package_template_item`.

Проверки:

```text
1. template_item активен
2. DOCX валиден
3. нет validation error
4. все {{ln-XXXXXX}} принадлежат текущему пакету
5. для каждого обязательного ln есть assignment
6. package.ul/ip/fl токены имеют source path
```

Если есть error — item не отправлять в strict.

Статусы item:

```text
ready
skipped_validation_error
skipped_missing_role_assignment
generated
failed
```

---



### **4. Уточнить**

`role_assignment_missing`

В Sprint 3H-fix это warning. Но в генерации Sprint 3I нужно разделить:

- в validation UI — warning;
- в generation preflight — blocker, если роль используется в DOCX и не назначена.

Правило:

```text
role_assignment_missing в validation = warning
role_assignment_missing перед generation = error/blocker
```

Сообщение:

```text
Нельзя сформировать документ: для роли из шаблона не выбран человек в анкете документа.
```

---

### **5. Не расширять strict-функцию слишком широко**

В плане написано добавить `packageContext` в `canonical-document-generate-strict`. Это допустимо, но нужно жёстко ограничить:

```md
`packageContext` допускается только если:
- вызов пришёл из `ai-generate-document-package`;
- caller — service_role / internal call;
- package_session_id и package_template_item_id уже проверены orchestrator;
- single-document UI не может вручную передать packageContext.
```

Иначе можно случайно открыть bypass обычной order-логики.

---

### **6. Вызов strict из orchestrator**

Уточнить, как orchestrator вызывает `canonical-document-generate-strict`.

Рекомендуемая модель:

```text
ai-generate-document-package
  → service_role internal invoke canonical-document-generate-strict
```

В body:

```json
{
  "mode": "generate",
  "template_id": "...",
  "idempotency_key": "package_session:<id>:item:<id>:template_version:<id>",
  "packageContext": {
    "package_session_id": "...",
    "package_template_id": "...",
    "package_template_item_id": "...",
    "profile_id": "...",
    "preresolved_fields": {},
    "preresolved_ln_tokens": {},
    "preresolved_warnings": []
  }
}
```

Не использовать пользовательский JWT напрямую для internal strict-вызова, если strict в package-mode требует service-role контекст.

---





### **7. Уточнить обработку**

`{{ln-XXXXXX}}` **в strict**

План B1 правильный, но нужно добавить:

```md
Strict должен принимать `{{ln-XXXXXX}}` только при наличии `packageContext`.

Если `{{ln-XXXXXX}}` встречается в обычном billing/order-шаблоне без packageContext:
- error `ln_token_outside_package_context`.
```

---



### **8. Уточнить обработку**

`{{package.ul/ip/fl.FLD-XXXXXX}}`

Аналогично:

```md
`{{package.ul.FLD-...}}`, `{{package.ip.FLD-...}}`, `{{package.fl.FLD-...}}`
допустимы только при packageContext.

В обычном billing/order-шаблоне:
- error `package_token_outside_package_context`.
```

---

### **9. Добавить batch UI результата**

После нажатия «Сформировать пакет» UI должен показать результат по каждому документу:

```text
Документ | Статус | Предупреждения | Скачать DOCX | Скачать PDF | Открыть карточку
```

Статусы:

```text
Сформирован
Пропущен
Ошибка
Требует заполнения анкеты
```

Если пакет состоит из нескольких документов — пользователь должен видеть, какие документы готовы, а какие нет.

---

### **10. История генерации пакета**

В UI пакета добавить блок:

```text
История сформированных пакетов
```

Минимально:

- дата;
- кто сформировал;
- режим: пользователь / тест админа;
- количество документов;
- статус: success / partial / error;
- ссылки на документы.

Если это уже можно взять из `ai_document_generation_batches` — переиспользовать его, новую таблицу не создавать.

---



### **11.**

`ai_document_generation_batches`

В плане есть упоминание batch aggregation, но нужно уточнить:

- orchestrator создаёт batch до запуска items;
- каждый generated document получает связь с batch;
- если текущая схема `ai_generated_documents` не имеет `batch_id`, использовать существующие поля/meta;
- если нужен новый столбец — только после discovery и отдельного proof.

Не добавлять миграцию без проверки текущей схемы.

---

### **12. Проверить текущие ошибки загруженного DOCX до генерации**

Перед Sprint 3I execution добавить обязательный preflight:

```text
Пакет Идеология
→ приказ DOCX
→ validation report
→ список error/warning
```

Если шаблон ещё содержит invalid legacy role placeholder или неправильные package tokens — генерацию не запускать.

---

### **13. Отдельно проверить кнопку в админке и у пользователя**

DoD добавить:

```text
Пользователь видит кнопку «Сформировать пакет документов».
Админ видит кнопку «Тестово сформировать пакет».
Обе кнопки используют один orchestrator.
Обе кнопки показывают per-item результат.
Обе кнопки не создают новый renderer.
```

---

### **14. Proof по UI**

В proof добавить скриншоты/описания:

1. Пользовательская кнопка генерации.
2. Админская кнопка тестовой генерации.
3. Disabled/blocker state при незаполненной анкете.
4. Confirm при warning.
5. Per-item результат.
6. История пакета.
7. Ссылки на скачивание DOCX/PDF, если strict их возвращает.

---

### **15. Не делать сейчас email/telegram/auto-send**

После генерации ничего автоматически не отправлять.

Только:

- сформировать документы;
- показать ссылки;
- сохранить историю.

Автоматическая отправка клиенту — отдельный sprint.

---

## **Исправленный фрагмент цели Sprint 3I**

Цель должна звучать так:

```text
Sprint 3I подключает реальную генерацию пакета через существующий pipeline.

Появляются две UI-точки запуска:
1. пользовательская кнопка «Сформировать пакет документов»;
2. admin-only кнопка «Тестово сформировать пакет».

Обе кнопки вызывают `ai-generate-document-package`, который является только orchestrator и делегирует каждый документ в `canonical-document-generate-strict`.

Новый renderer, новый Gotenberg-клиент и новая ручная запись в ai_generated_documents запрещены.
```

---

## **Итог**

План можно утверждать только после добавления этих правок.

Главное, чего не хватает сейчас:

1. UI-кнопки генерации для пользователя;
2. UI-кнопки тестовой генерации для админа;
3. preflight перед генерацией;
4. per-item результат;
5. история сформированных пакетов;
6. запрет использовать `packageContext` извне orchestrator.

```
Коротко: план по backend-архитектуре хороший, но без UI-кнопок и результата пользователь не сможет этим пользоваться. Нужно добавить **две точки запуска**: пользовательскую и админскую тестовую.

План: Sprint 3I — Package generation orchestrator (без нового генератора)
```

Цель: `ai-generate-document-package` становится тонким orchestrator, который для каждого item пакета вызывает существующий `canonical-document-generate-strict`. Никакого Docxtemplater/PizZip, никакого нового рендера, никакого нового пути записи в `ai_generated_documents`, никакого второго Gotenberg-вызова.

---

## Discovery (что уже есть, проверено в коде)

### 1. Как сейчас вызывается одиночная генерация

- UI/хук `useAiDocuments.generate(...)` → `ai-generate-document` (legacy, отдельный pipeline, **не трогаем**).
- Canonical путь: фронт зовёт `supabase.functions.invoke('canonical-document-generate-strict', { body: { order_id, mode, template_id?, idempotency_key?, admin_force? } })`. JWT — обязателен (`getUser`).

### 2. Контракт `canonical-document-generate-strict` (Sprint 11, файл `index.ts`)

Вход (`body`):

- `order_id: uuid` — **обязателен** (`order_id_required`).
- `mode: 'preview' | 'generate'` (default `preview`).
- `template_id?: uuid` — иначе берётся из offer + scenario.
- `idempotency_key?: string` — иначе генерируется детерминированно.
- `admin_force?: boolean` + guards.

Что делает:

- Берёт `orders_v2` + `meta.document_data.fields[FLD-XXXXXX]` как SOT значений.
- Принимает в DOCX **только** `{{field:FLD-XXXXXX}}` (Sprint 11 canon).
- Пишет в `ai_generated_documents` (`context_type='order'`, `context_id=order.id`, `idempotency_key`, `profile_id=order.profile_id`).
- PDF — через `convertDocxToPdf` (Gotenberg, единственный путь).

### 3. Куда пишет `ai_generated_documents`

Строго один INSERT в strict-функции (≈строка 1100), с полным snapshot (`fields`, `token_manifest_snapshot`, `template_tokens_snapshot`, `source_trace`, `warnings_snapshot`, `resolver_version`, `context_type='order'`, `context_id`, `idempotency_key`, `template_version_id`). Других canonical write-path нет.

### 4. Текущее состояние `ai-generate-document-package`

**Сейчас это самостоятельный legacy-renderer**: PizZip + Docxtemplater, свой `buildTokenData`, свой upload в `documents`, свой INSERT в `ai_generated_documents` без `template_version_id`/`context_type`/`idempotency_key`. Это и есть «второй pipeline», который Sprint 3I должен ликвидировать.

### 5. Жёсткое расхождение, требующее решения до кода

Strict-генератор завязан на `orders_v2.meta.document_data.fields[FLD-...]` и `context_type='order'`. Пакет работает в контексте `document_package_sessions` + `document_package_template_items` + `document_package_item_role_assignments` + `package_session.client_legal_details_id/person_id`, **без order_id**. Поэтому нужно:

1. Не ломая single-document путь, разрешить strict-функции работать в режиме `context_type='package_session'` с тонким адаптером значений.
2. Все package-only токены (`{{ln-XXXXXX}}`, `{{package.ul|ip|fl.FLD-XXXXXX}}`) пре-резолвить orchestrator-ом через `_shared/resolve-package-tokens.ts` и подмешать в общий values-pool, который strict использует вместо `meta.document_data.fields`.

---

## Дизайн (без изменения single-document поведения)

### A. Strict-функция: точечно расширить SOT, не трогая существующие ветки

Добавить optional `packageContext` в body:

```
{
  mode: 'preview' | 'generate',
  // existing
  order_id?: uuid,
  template_id?: uuid,
  idempotency_key?: string,
  // NEW (Sprint 3I)
  packageContext?: {
    package_session_id: uuid,
    package_template_id: uuid,
    package_template_item_id: uuid,
    profile_id: uuid,           // владелец session
    legal_details_id?: uuid,
    person_id?: uuid,
    preresolved_fields: { [FLD-XXXXXX]: { value, source, ... } },
    preresolved_warnings: string[],
  }
}
```

Поведение:

- Если `packageContext` присутствует — `order_id` НЕ требуется. Контракт записи:
  - `context_type = 'package_session'`, `context_id = package_session_id`.
  - `profile_id` берётся из `packageContext.profile_id`.
  - `idempotency_key` (если не передан): `package_session:{session}:item:{item}:tplv:{version_id}`.
  - В `meta` добавляются `package_template_id`, `package_item_id` (как сейчас в legacy записи), `package_template_session_id`, `package_token_resolver_warnings`.
  - Snapshot значений = `packageContext.preresolved_fields` вместо `order.meta.document_data.fields`. Все прочие проверки (manifest, required_empty, `{{field:FLD-...}}` strict-validation, Gotenberg-convert) **не меняются**.
- Если `packageContext` отсутствует — поведение бит-в-бит, как сегодня (см. proof: single-document regression).

Никаких новых таблиц, никаких миграций для строгой схемы — `ai_generated_documents` уже имеет колонки `package_template_id`, `package_item_id`, `context_type`, `context_id`.

### B. Orchestrator `ai-generate-document-package`

Полная замена тела (legacy renderer удаляется):

1. Auth → `profile_id`.
2. Загружает `document_package_sessions` (по `package_session_id` из body) + `document_package_template_items` + `document_templates`.
3. Для каждого item:
  - Извлекает токены DOCX (через уже существующий `_shared/extract-docx-placeholders.ts` или эквивалент в strict).
  - Резолвит `{{ln-XXXXXX}}` через `_shared/resolve-package-tokens.ts` (с `HARDCODED_ENABLED=false` — оставляем как есть; orchestrator-фаза НЕ включает hardcoded, лишь читает branch).
  - Резолвит `{{package.ul|ip|fl.FLD-XXXXXX}}` (Sprint 3B namespace).
  - Резолвит `{{field:FLD-XXXXXX}}` document-level/system → строит `preresolved_fields` (исключительно `FLD-XXXXXX`-ключи, т.к. strict работает только с этим форматом). Package-specific токены конвертируются в внутренние `FLD-*`-эквиваленты только если уже маппятся через `package.ul/ip/fl` namespace; `{{ln-XXXXXX}}` для strict невидимы — orchestrator подменяет их прямо в шаблоне на временные `{{field:FLD-...}}` **только в варианте B-alt** (см. ниже).
4. Вызывает `canonical-document-generate-strict` с `mode='generate'`, `packageContext`, batch-уровень idempotency.
5. Собирает результаты в `ai_document_generation_batches` (статусы `generated/partial/error`).

### Вариант разрешения `{{ln-XXXXXX}}` без нового renderer

Strict валидирует токены regex `^\{\{field:FLD-[0-9]+\}\}$`. У нас два пути:

- **B1 (предпочитаемый):** в strict добавить разрешение для `^\{\{ln-[0-9]{6}\}\}$` **только когда** `packageContext` задан. Значение приходит в `preresolved_fields` по специальному синтетическому ключу `LN-XXXXXX`. Все остальные guards/manifest/PDF/Gotenberg/INSERT — без изменений.
- **B2 (fallback, если B1 будет признан расширением canon):** orchestrator делает pre-pass DOCX-templater-substitution только для `ln-XXXXXX` → `{{field:FLD-XXXXXX}}` синтетических FLD из dedicated registry namespace. Требует одной миграции на reserved range FLD-9xxxxx для ln-токенов. Менее предпочтительно — фактически расширяет registry.

В плане выбираем **B1**, как минимально-инвазивный.

### C. Где НЕ трогаем

- `ai-generate-document` (legacy) — без изменений.
- `_shared/document-render.ts` / `gotenberg.ts` / `convertDocxToPdf` — без изменений.
- `ai_generated_documents` schema — без миграций.
- billing-резолверы (`document-scenario-resolver`, `derivePaymentChannel`, `b97`) — без изменений; в package-режиме они просто не используются.

---

## Технические детали и риски

- Strict ranges (≈600 строк ветка `mode==='generate'`) предполагают `order` объект во многих местах (profile_id, order_number, snapshot order data, audit `order_id`). Нужно ввести локальный `ctx = order ? {kind:'order', ...} : {kind:'package_session', ...}` и заменить прямые `order.profile_id`/`order.id` на `ctx.profile_id`/`ctx.entity_id`. Снизим diff, не меняя ни одной строки в `order`-ветке кода после ветвления.
- Audit: `document.generated` уже пишется; добавить альтернативную meta-секцию `package_session_id/package_item_id` рядом с `order_id`.
- Required-fields check в strict работает по `manifest.required` — для package items, у которых обязателен `ln-XXXXXX`, требуется поддержка required-флага для ln-токена (или просто mapping warning→`required_empty` в orchestrator). MVP — orchestrator проверяет `role_assignment_missing` **до** вызова strict и режет с понятным кодом, не входя в strict.

---

## Сценарии и DoD-proof'ы (обязательны до закрытия Sprint 3I)

`.lovable/proofs/package_documents_sprint3i_orchestrator_2026_05.md` должен содержать grep/diff/runtime артефакты для следующих утверждений:

1. **Single-document regression**:
  - `canonical-document-generate-strict` вызванный без `packageContext` возвращает идентичный `resolver_version`, manifest и записывает `ai_generated_documents` с теми же ключами (`context_type='order'`, `idempotency_key` сформирован прежним образом). Снапшот сравнения preview-ответа до/после.
2. **No new renderer**: grep
  - `rg -n "Docxtemplater|PizZip" supabase/functions/ai-generate-document-package/index.ts` → 0 совпадений.
  - `rg -n "document-render|_shared/gotenberg" supabase/functions/ai-generate-document-package/index.ts` → 0 (он зовёт strict, не Gotenberg напрямую).
3. **Gotenberg only via existing pipeline**: единственный `convertDocxToPdf` остаётся в `canonical-document-generate-strict` и `_shared/gotenberg.ts`; grep по всему репо подтверждает, что новых импортов нет.
4. **ai_generated_documents only via existing pipeline**:
  - `rg -n "from\\(['\"]ai_generated_documents['\"]\\)\\.insert" supabase/functions/ai-generate-document-package/index.ts` → 0.
  - Запись только из `canonical-document-generate-strict` (1 INSERT) — подтверждаем строкой.
5. **Package preview/generate matrix** (4 кейса): minimal package (1 item, 1 ln-токен, 1 FLD-токен) — preview ok, generate ok; missing role assignment — orchestrator возвращает `role_assignment_missing` без вызова strict; required FLD пустой — strict возвращает `required_fields_empty`, orchestrator маркирует item error; `ln_token_outside_bound_package` — orchestrator режет item.
6. **Batch aggregation**: `ai_document_generation_batches.status ∈ {generated, partial, error}` корректен; ссылки `package_template_id` + `package_item_id` в каждой записи `ai_generated_documents` присутствуют.
7. **No legacy alias**: grep подтверждает, что в orchestrator нет `{{package.role.PKR-...}}` или `{{package.roles.*}}` обработки.

---

## Затрагиваемые файлы

- `supabase/functions/canonical-document-generate-strict/index.ts` — добавить ветку `packageContext` (без изменения order-ветки). +~80 строк, 0 удалений.
- `supabase/functions/ai-generate-document-package/index.ts` — **полная замена** legacy-renderer на orchestrator. −380 строк / +~180 строк.
- `supabase/functions/_shared/resolve-package-tokens.ts` — без структурных изменений, использование existing branch (`HARDCODED_ENABLED` остаётся `false` — флаг будет включён в отдельной финальной Phase 3I-flip, не в этом плане).
- `src/hooks/useAiDocumentPackageGeneration.ts` — параметры остаются (`package_template_id`, `legal_details_id?`, `person_id?`, `signer_link_id?`) + новый обязательный `package_session_id` (пакетная сессия — SOT назначений). Минимальный diff в форме старта пакета.
- Документация: `.lovable/plan.md`, новый proof, обновление `mem://architecture/documents/package-document-level-questionnaires-v1.md` и `mem://index.md`.

## Вне scope (явно)

- Включение `HARDCODED_ENABLED=true` для package-resolver (отдельная Phase 3I-flip).
- Любые изменения billing/customer/executor resolver'ов.
- Email/Telegram автоотправка пакетных документов.
- Расширение `document_token_registry` под ln-токены (B2 fallback).
- Изменения `canonical-template-audit`, `gotenberg-*`, `_shared/document-render.ts`.

## Definition of Done

- Single-document path не сломан (regression proof #1).
- Пакет с ≥2 items + ≥1 `{{ln-XXXXXX}}` + ≥1 `{{field:FLD-XXXXXX}}` генерируется полностью через strict (proof #5).
- Все 7 proof-пунктов выполнены и закоммичены.
- Legacy renderer удалён из `ai-generate-document-package/index.ts`.
- Memory + index.md синхронизированы.