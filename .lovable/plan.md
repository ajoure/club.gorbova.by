# План: Пакет «Идеология» как анкета пользователя, шаблоны — только у админа

> **Язык артефактов (обязательно):**
> - План должен быть составлен на русском языке.
> - Отчёт о выполненной работе должен быть составлен на русском языке.
> - Вся переписка, пояснения, diff-summary, proof и результаты должны быть только на русском языке.

> **Жёсткая граница фазы 1 (frontend-only / read-only):**
> Фаза 1 НЕ генерирует документы, НЕ пишет в БД, НЕ создаёт batch, НЕ вызывает edge-functions и НЕ меняет RLS / RPC / types / storage policies / migrations. Это только пользовательская анкета (localStorage) + read-only отображение состава пакета по уже существующим активным шаблонам категории `ideology`.

---

## 0. Идеология разделения ролей

```
Админ (/admin/documents → Шаблоны документов)
   └── Загружает .docx, маркирует, активирует версии
       (присвоение category='ideology' — фаза 2, см. ниже)

Пользователь (/document-generation)
   ├── «Реквизиты» → вносит юрлица / физлица
   └── «Документы» → «Идеология»
        ├── Состав пакета (read-only): активные валидные шаблоны категории ideology
        └── Анкета: выбор юрлиц/физлиц/ролей (localStorage, без БД)
             └── Кнопка «Сформировать пакет» — disabled, фаза 2
```

---

## 1. Discovery (обязательный read-only этап ДО любых правок)

Перед любыми UI/код-правками выполнить полный read-only Discovery всего, что уже создано по генерации документов. Цель — **не создавать заново то, что уже есть**, а понять текущий фактический контур и переиспользовать его.

### 1.1. Инвентаризация БД
- Таблицы шаблонов: `document_templates`, `document_template_versions`, `document_token_registry`.
- Таблицы сгенерированных документов: `ai_generated_documents`, legacy `generated_documents`.
- Таблицы batch/session: `ai_document_generation_batches`, `document_generation_sessions`.
- Таблицы snapshot/history/audit: где хранятся `placeholder_data_snapshot`, `source_trace`, `warnings_snapshot`, `template_version_id`, `idempotency_key`.
- Проверить: есть ли поле `category` в `document_templates` фактически в Supabase schema и в `src/integrations/supabase/types.ts`.
- Проверить статусы шаблонов/версий: как определяется `active`/`current`/`valid`/`archived`.

### 1.2. Инвентаризация storage
- Бакеты: `documents-templates` (где лежат .docx шаблоны + размеченные версии), `documents` (где лежат сгенерированные акты/счета/PDF/пакеты).
- Пути: канонический префикс `documents/canonical/{profile_id}/...` (из roadmap).
- Политики RLS на бакетах: public/private, кто пишет (service_role), кто читает.

### 1.3. Инвентаризация edge-functions
- `canonical-document-generate-strict` — текущий канонический рендер.
- `canonical-template-apply-markup`, `canonical-template-audit`.
- `ai-generate-document-package` (см. `useAiDocumentPackageGeneration`) — уже существующая batch-генерация пакетов.
- Legacy: `ai-generate-document`, `generate-from-template`, `generate-invoice-act`, `generate-document-pdf`, `document-auto-generate`.

### 1.4. Инвентаризация frontend
- Хуки: `useAiEntities`, `useAiPersons`, `useDocumentPackages`, `useDocumentPackageItems`, `useLastPackageBatch`, `useAiDocumentPackageGeneration`.
- Компоненты: `StrictDocumentTemplatesManager`, `EntityTableView`, `PersonsTableView`, `PlaceholdersCatalogTab`, `AiPageContent`, `TemplateMarkupDialog`, `FileNameTemplateEditor`.
- Reusable multiselect/combobox: проверить наличие в `src/components/ui/` (`Command`, `Popover`, готовые multi-select).

### 1.5. Инвентаризация legacy «Нейросеть → Документы»
- Какие таблицы/UI/edge-functions/файлы использовались год назад.
- Есть ли legacy aliases, старые токены, старые шаблоны в production.
- Можно ли безопасно подключить их к новому `/document-generation` через compatibility layer.

### 1.6. Анализ контура сгенерированных документов
Отдельно подтвердить, где сейчас хранятся уже сгенерированные акты/счета/PDF/документы из legacy `/ai`, чтобы определить **единый канонический контур** для пакета «Идеология». Проверить:
- Есть ли уже async-flow со статусами `pending / processing / completed / failed`.
- Есть ли retry, idempotency_key, audit log, signed URL, zip generation.
- Как избежать повторной генерации одного и того же пакета.

### 1.7. Формат отчёта Discovery (обязательно ДО кода)
Краткий read-only отчёт:
- **Reuse:** что используем из существующего.
- **Add-only:** что нужно добавить (минимально).
- **Do not touch:** что не трогаем.
- **Storage decision:** где будут храниться сгенерированные документы пакета (с указанием существующего бакета/пути).
- **Generation decision:** какая существующая edge-function / pipeline будет использована.
- **Open gaps:** что переносится в фазу 2.

**Правило reuse-first:** все существующие функции генерации, хранения, snapshot, history, storage и download должны быть переиспользованы. Новые таблицы, edge-functions, RPC, storage buckets и компоненты создаются только если Discovery докажет, что существующего механизма нет или он объективно не подходит.

---

## 2. STOP-guards (фаза 1 немедленно прекращается, если)

- Для анкеты требуется писать в БД.
- `document_templates.category` отсутствует в types/schema.
- Обычный user не имеет прав читать список шаблонов, а исправление требует RLS-миграции.
- `StrictDocumentTemplatesManager` невозможно перевести в `readOnly` без риска сломать `/admin/documents`.
- Для выбора юрлиц/физлиц требуется менять `useAiEntities` / `useAiPersons`.
- План начинает затрагивать edge-functions, generation pipeline, storage policies, RLS или миграции.
- Реализация предлагает новую таблицу / новый bucket / новую edge-function для хранения сгенерированных документов без доказанного Discovery, что существующий контур актов/счетов/PDF и `ai_generated_documents` не подходит.

---

## 3. Изменения UI (фаза 1)

### 3.1. `src/components/ai-chat/AiPageContent.tsx`
- В рендере подвкладки `pkg-ideology` **НЕ показываем** `StrictDocumentTemplatesManager` напрямую как редактор.
- Рендерим новый компонент `<DocumentPackageIdeologyView />`.
- Подвкладка «Идеология» остаётся; иконка/градиенты без изменений.
- Секция `doc-packages` остаётся видимой и для user, и для admin (для админа это «как видит пользователь»).

### 3.2. Новый файл `src/components/ai-documents/DocumentPackageIdeologyView.tsx`

Структура (канон UI: `GlassCard`, как в остальных вкладках):

**Блок A. «Состав пакета» (read-only):**
- Использует `<StrictDocumentTemplatesManager embedded readOnly categoryFilter="ideology" title="Состав пакета «Идеология»" />`.
- Показывает только то, что **реально готово к генерации**: `document_templates.category = 'ideology'` И не архивный И есть current/active version И версия валидна (`validation_status = 'valid'`, если поле существует).
- Если валидных активных версий нет — empty-state «В пакете «Идеология» пока нет готовых шаблонов. Администратор добавит их позже.» + кнопка «Сформировать пакет» disabled с warning.

**Блок B. «Анкета» (frontend-only, localStorage):**
- Мультивыбор «Юрлица / ИП» — данные из `useAiEntities().allEntities`. UI: переиспользовать существующий `Command + Popover` (если есть в `src/components/ui/`); иначе — простой список с чекбоксами внутри `ScrollArea`. **Новый универсальный table-picker НЕ создавать.**
- Мультивыбор «Физлица» — данные из `useAiPersons().allPersons`, аналогично.
- Роли сторон (минимум: «Исполнитель», «Заказчик») — Select из уже выбранных entities/persons. Роли — **временные frontend answers**; каноническая модель ролей пакета будет утверждена во фазе 2 вместе с `document_package_questionnaires` и rule layer.
- Кнопка «Сохранить анкету» — пишет **только в localStorage**.

**Блок C. «Сформировать пакет»:**
- Кнопка всегда **disabled** в фазе 1.
- Tooltip/подпись: «Генерация пакета будет подключена во второй фазе».
- Никаких вызовов `canonical-document-generate-strict`.
- Никаких batch-записей.
- Никаких zip/download действий.

### 3.3. `StrictDocumentTemplatesManager.tsx` — добавить prop `readOnly?: boolean`

При `readOnly = true`:
- Скрыты все мутационные действия: «Загрузить .docx», «Загрузить новую версию», «Удалить», «Активировать», «Разметить», `FileNameTemplateEditor`.
- Карточка шаблона: только название, бейджи (active / current vN / valid), без actions.
- Клики по версии могут открывать preview, **только если** существующий preview безопасно read-only (не выполняет admin-only действий). Иначе — preview скрыт полностью.
- `readOnly` **не меняет** query/load/validation state — это чисто UI-фильтр.
- Поведение без `readOnly` (в `/admin/documents`) — **не меняется ни в одной точке**.

---

## 4. localStorage контракт анкеты

**Ключ (стабильный, scoped):**
```
document_package_questionnaire_ideology_v1
```

**Структура (ID-driven, без display labels):**
```ts
{
  version: 1,
  updatedAt: string, // ISO
  selectedEntityIds: string[],    // UUID из client_legal_details
  selectedPersonIds: string[],    // UUID из legal_details_persons
  roles: {
    executorId?: string,          // UUID
    customerId?: string,          // UUID
    // ...при необходимости
  }
}
```

**Guards при чтении:**
- Битый JSON → сброс (silent reset, без toast).
- Структура versioned: если `version` не совпадает — сброс.
- ID, которых уже нет в `useAiEntities().allEntities` / `useAiPersons().allPersons`, **игнорируются** при восстановлении (UI не падает).
- Display name всегда вычисляется заново из текущих данных.

---

## 5. Что НЕ трогаем в фазе 1

- БД: `document_templates`, `ai_document_generation_batches`, `document_template_versions`, `ai_generated_documents`, RLS, RPC, миграции.
- Edge-functions, storage policies, бакеты, generation pipeline.
- Supabase types (`src/integrations/supabase/types.ts`).
- `useAiEntities`, `useAiPersons` — API не меняем.
- Раздел «Реквизиты» — уже в каноне.
- Админская маркировка `category='ideology'` через UI — **фаза 2**. В фазе 1 пакет читает уже существующие шаблоны с `category='ideology'`, если они есть. Механизм присвоения категории через админский UI не реализуется в этой фазе и остаётся backlog/фаза 2.

---

## 6. Фаза 2 (после утверждения, отдельным планом)

1. UI выбора категории пакета при загрузке/редактировании шаблона в админке (`category ∈ {ideology, ...}`).
2. Таблица `document_package_questionnaires` (profile_id, package_code, answers jsonb, roles jsonb) + RLS — для серверного хранения анкеты.
3. Подключение существующего `ai-generate-document-package` (если Discovery подтвердит совместимость) — batch-генерация всех активных шаблонов пакета по анкете + zip-архив. Хранение сгенерированных файлов — **в том же каноническом контуре**, где хранятся акты/счета/PDF (`ai_generated_documents` + бакет `documents`), через расширение metadata (`context_type='package_ideology'`, `package_code`).
4. Подключение кнопки «Сформировать пакет» в `DocumentPackageIdeologyView`.
5. Не создавать отдельный bucket/таблицу только для «Идеологии».

---

## 7. DoD фазы 1

### 7.1. Discovery
- [ ] Подтверждено, где хранятся .docx шаблоны (бакет + путь).
- [ ] Подтверждено, где хранятся сгенерированные документы (бакет + путь + таблица).
- [ ] Подтверждено, можно ли использовать существующий контур актов/счетов/PDF для будущей генерации пакета.
- [ ] Подтверждено, какие старые документы из домена `/ai` существуют.
- [ ] Подтверждено, что новая реализация не дублирует уже созданные таблицы/edge-functions/storage.
- [ ] Предоставлен список найденных файлов frontend/backend.
- [ ] Предоставлен список найденных таблиц/RPC/edge-functions/storage buckets.
- [ ] Предоставлен рекомендуемый путь reuse-first.

### 7.2. UI пользователя
- [ ] На `/document-generation → Документы → Идеология` НЕТ кнопки «Загрузить .docx» и никаких мутационных действий.
- [ ] Виден read-only список активных валидных шаблонов категории `ideology` (или корректный empty-state).
- [ ] Видна анкета (мультивыбор юрлиц/физлиц + роли).
- [ ] Сохранение в localStorage работает, ключ `document_package_questionnaire_ideology_v1`.
- [ ] Кнопка «Сформировать пакет» disabled с понятным tooltip.

### 7.3. Админская обратная совместимость
- [ ] `/admin/documents → Шаблоны документов`: upload, markup, activation, delete работают как раньше.
- [ ] `readOnly` prop никак не влияет на админский режим без `readOnly`.
- [ ] Шаблоны без `category` или с другой `category` не попадают в пакет «Идеология».
- [ ] Если шаблонов `ideology` нет — корректный empty-state.

### 7.4. localStorage
- [ ] Выбранные юрлица/физлица/роли сохраняются после refresh.
- [ ] При очистке localStorage анкета сбрасывается.
- [ ] При удалённой/архивной записи в сохранённых answers UI не падает.

### 7.5. Канон
- [ ] `GlassCard`, единый стиль таблиц, иконки `FileStack`/`FileText` как сейчас.
- [ ] Нет изменений в БД, RLS, edge-functions, типах, storage, миграциях.

---

## 8. Финальный отчёт (proof, обязательно)

В отчёт о выполненной работе включить (на русском):
- Список изменённых файлов.
- Diff-summary по каждому файлу.
- Явное подтверждение, что БД / RLS / RPC / edge-functions / types / storage / миграции не менялись.
- Скриншот `/document-generation → Документы → Идеология` (с шаблонами).
- Скриншот empty-state при отсутствии шаблонов `ideology`.
- Скриншот анкеты с выбранными юрлицами/физлицами.
- Proof localStorage (DevTools → Application → Local Storage → ключ `document_package_questionnaire_ideology_v1` с JSON).
- Regression proof `/admin/documents → Шаблоны документов` (upload/markup/activation работают).
- Отдельный блок Discovery-отчёта (см. §1.7).

---

**Главное:** фаза 1 — это **только UI + localStorage + read-only package composition + Discovery-отчёт**. Не создавать batch, не писать в `ai_document_generation_batches`, не расширять права, не подключать генерацию, не плодить новый контур хранения до отдельного плана фазы 2.
