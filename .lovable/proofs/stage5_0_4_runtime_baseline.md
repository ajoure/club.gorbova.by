# Stage 5.0.4 — Baseline + findings (PARTIAL, STOP)

Дата: 2026-06-18. Канал доказательств: SQL (`supabase--read_query`), code-grep, чтение исходников. Браузерные скриншоты, DOCX-генерация и E2E ещё не запускались — сначала фиксирую baseline и блокеры.

---

## 0. Идентификация рабочих fixture

| Сущность | UUID | Заметка |
|---|---|---|
| Пакет «Идеология» | `06068dcf-6943-425c-aa6b-8bfaa550cfd2` | 2 документа: «Приказ об организации идеологической работы» (sort_order=0), «Положение об организации идеологической работы» (sort_order=1) |
| Пакет «Годовое собрание участников» | `21764469-1ba9-49b3-90d9-5349bcbcd531` | 1 документ: «1. Приказ о проведении годового общего собрания участников ООО», sort_order = **1** (нулевого нет — это важно для §A.1 ниже) |
| Сессия «Идеология» | `b0b229b7-cf7e-4869-988e-8e97bdf54043` | user `05cd3754-d589-4d90-97d1-89ba2bee610b`, status draft, selected_legal_entity_id `30347fc5-…`, 1 session-level значение, 1 participant |
| Сессия «Годовое собрание» | `6a61a7e3-04b5-4e3c-aacb-8af1dbef6d53` | тот же user, тот же legal_entity, status draft, 7 session-level значений, 0 participants |
| Юр. лицо | `30347fc5-8b43-4391-88b4-9cdcf7befcb1` | `leg_org_form = 'Закрытое акционерное общество'` (уже в long-форме), `leg_name = 'АЖУР инкам'`, `leg_director_name = 'Коврижкин Алексей Игоревич'`, `leg_director_position = 'Управляющий'`, `leg_unp = '193405000'` |
| Архивное поле | `pf-000002` (`uat_b5_date`, label «UAT B5 — дата подписания») | `is_active = false`, принадлежит каталогу «Идеология», в сессии Идеологии хранится value_date = `2026-06-15` (orphan, item_id=NULL) |

Активные версии шаблонов (`is_current=true`):

| Template | current_version_id | v | detected_tokens (фрагмент) |
|---|---|---|---|
| Приказ об организации идеологической работы (8e46cf8a) | `53fb8ba7-…` | 6 | `package.ul.FLD-000011`, `package.ul.FLD-000013`, `package.ul.FLD-000014\|format=signature_short`, `package.ul.FLD-000039`, `field:FLD-000209`, `field:FLD-000211`, `ln-000012\|case=genitive\|include_position=true`, `ln-000012\|format=signature_short` |
| Положение об организации идеологической работы (9956a7e6) | `a8f81009-…` | 3 | `package.ul.FLD-000011`, `package.ul.FLD-000013`, `package.ul.FLD-000014\|format=signature_short`, `field:FLD-000209` |
| Приказ годового собрания участников ООО (682b16e8) | `e49dde18-…` | 2 | `package.ul.FLD-000010\|format=long`, `package.ul.FLD-000011`, `pf-000003..pf-000009`, `package.ul.FLD-000012`, `package.ul.FLD-000013`, `package.ul.FLD-000014\|format=signature_short`, `package.ul.FLD-000039` |

---

## §C. Архивное `pf-000002` — PASS (SQL)

```sql
SELECT dt.id, dt.name, dtv.id AS current_version_id, dtv.version_number,
       (dtv.detected_tokens::text LIKE '%pf-000002%') AS has_pf2
FROM document_templates dt
LEFT JOIN document_template_versions dtv ON dtv.id = dt.current_version_id
WHERE dt.id IN (
  '8e46cf8a-de0f-4dfb-a149-84810a12e8a7',
  '9956a7e6-670e-4904-9a28-289c7aa4f3e9',
  '682b16e8-5669-412a-9bc9-2c54461d987f'
);
```

Все три `has_pf2 = false`. Дополнительно `document_package_field_catalog.pf-000002.is_active = false`.

В `usePackageSessionFields.ts:91` каталог фильтруется по `is_active=true` до построения `questions`/`orphanQuestions`, поэтому `pf-000002` исключается и из per-item-вопросов, и из orphan-блока, и из required-gate. Это покрывает корректировку №2 («Для Stage 7 не брать архивированное pf-000002»).

---

## §A.2 — Архивное поле НЕ отображается в карточке Идеологии — PASS by code

`src/hooks/usePackageSessionFields.ts:83-96` (catalogQuery):

```ts
.from("document_package_field_catalog")
.select("*")
.eq("package_template_id", packageTemplateId)
.eq("is_active", true);   // ← фильтр архивных
```

`orphanQuestions` строится на этом же отфильтрованном массиве (`:139-165`). Старое значение `pf-000002 = 2026-06-15` в `document_package_session_field_values` физически остаётся (исторический факт сохранён), но в UI не показывается ни в одной из трёх точек: per-item card, orphan-блок, прогресс.

---

## §A.1 — Нумерация документов — **FAIL: расхождение со Stage 5.0.2**

`src/components/ai-documents/packages/PackageDocumentCard.tsx:340`:

```tsx
<span className="… tabular-nums">
  {item.sort_order + 1}
</span>
```

И `:259` (`displayName` fallback): `Документ №${item.sort_order + 1}`.

Stage 5.0.2 §1 явно требовал: **«Номер слева от заголовка = `index + 1` по отрисованному отсортированному списку документов сессии (а не `sort_order`)».** Текущая реализация использует `sort_order`. Корректировка пользователя №14 («проверить на пакете с несколькими документами») зафиксировала это как обязательную точку.

Фактические наблюдаемые значения:

| Пакет | item.sort_order | Бейдж сейчас | Бейдж ожидаемый (index+1) |
|---|---|---|---|
| Идеология / Приказ | 0 | `1` | `1` |
| Идеология / Положение | 1 | `2` | `2` |
| Годовое собрание / Приказ | **1** | **`2`** | **`1`** |

Сессия «Годовое собрание» с единственным документом получает бейдж `2`, что прямо противоречит §A.1.1 текущего плана и §1 Stage 5.0.2. Это регресс ранее объявленного PASS, а не новая фича.

**Действие:** правка — 1-2 строки (передать `index` из `items.map` в `<PackageDocumentCard index={idx} />`, заменить `item.sort_order + 1 → index + 1`). По правилу «не чинить молча» — НЕ правлю до подтверждения. См. §X (Findings — действия).

---

## §A.3 — Tooltip с описанием поля — **FAIL: расхождение со Stage 5.0.2**

`src/components/ai-documents/packages/PackageFieldsClientForm.tsx:383-384`:

```tsx
const help = effective.help ? (
  <p className="text-[10px] text-muted-foreground leading-snug">{effective.help}</p>
) : null;
```

Описание поля рендерится как inline-абзац под инпутом. Stage 5.0.2 §3 требовал иконку `Info` справа от label с shadcn `Tooltip` при hover/focus, а не inline-текст. Корректировка №13 уточнила: «иконка `i` обязательна только для полей с заполненным `catalog.description`» — но и для них её сейчас просто нет.

**Действие:** добавить `Info` lucide + `Tooltip` рядом с label, убрать inline `<p>`. ~10 строк правки. Не правлю молча — см. §X.

---

## §D — Runtime generation proof для Stage 5.0.3 — **BLOCKED**

Канонический путь генерации требует:
1. Реального вызова edge-функции `canonical-document-generate-strict` под аутентифицированным пользователем сессии.
2. Скачивания DOCX из storage, распаковки через skill `docx` (pandoc / extract_document.py).
3. Сравнения текста с ожидаемым контрактом.

Что я могу зафиксировать сейчас **без запуска генерации**:

### D.1. Резолвер канонического имени — статический анализ

Для legal_entity `30347fc5`: `leg_org_form = 'Закрытое акционерное общество'`, `leg_name = 'АЖУР инкам'`, `leg_short_name = NULL`, `leg_full_name = NULL` (колонок таких НЕТ в `client_legal_details` — подтверждено в `information_schema.columns`).

`supabase/functions/_shared/packageFieldFormatter.ts:39-45`:
```ts
function ulCanon(row) {
  return canonicalizeLegalEntity(
    row?.leg_org_form,        // 'Закрытое акционерное общество'
    row?.leg_name,            // 'АЖУР инкам'
    row?.leg_short_name || row?.leg_full_name,  // undefined → undefined
  );
}
```

`canonicalizeLegalEntity` (`typed-tokens-resolver.ts:54`) видит `org_form='Закрытое акционерное общество'` → нормализует через `ORG_FORM_FULL_TO_SHORT` в `'ЗАО'`; `name='АЖУР инкам'`; строит:

| tech_key | ожидаемое значение |
|---|---|
| `package.ul.org_form` | `ЗАО` |
| `package.ul.org_form` + `format=long` | `Закрытое акционерное общество` |
| `package.ul.name` | `АЖУР инкам` |
| `package.ul.short_name` | `ЗАО «АЖУР инкам»` |

### D.2. После Stage 5.0.3 fix lookup-priority

`supabase/functions/_shared/packagePlaceholderCatalog.ts:99-101` (после правки):
- `findByPackageToken('package.ul.FLD-000011')` → tech_key `package.ul.name` → `АЖУР инкам`.
- `findByPackageToken('package.ul.FLD-000345')` → tech_key `package.ul.short_name` → `ЗАО «АЖУР инкам»`.
- `findByPackageToken('package.ul.FLD-000010')` → tech_key `package.ul.org_form` → `ЗАО`. С `|format=long` → `Закрытое акционерное общество`.

Шаблоны, реально использующие `package.ul.FLD-000011`, по аудиту Stage 5.0.3:
- «Положение об организации идеологической работы» v3 — будет `АЖУР инкам`;
- «Приказ об организации идеологической работы» v6 — будет `АЖУР инкам`;
- «Приказ годового собрания участников ООО» v2 — `package.ul.FLD-000010|format=long` + `package.ul.FLD-000011` → `Закрытое акционерное общество` + `АЖУР инкам` (двумя соседними токенами).

Негативные ожидаемые ассерты (которые нужно проверить на реальном DOCX): отсутствие подстрок `ЗАО «ЗАО «АЖУР инкам»»`, `«ЗАО «АЖУР инкам»»`, `«ЗАО»`.

### D.3. Чего нельзя доказать без runtime-генерации

- Что edge-функция действительно вызывает `findByPackageToken` именно из этого файла (в репо есть несколько resolvers — нужно подтвердить trace на реальном вызове).
- Что typography кавычек `«»` действительно выводится в финальном DOCX (а не unicode-вариант).
- Что billing-документ `Шаблон. Счёт-акт ЮЛ - Исполнитель v3` после правки даёт тот же текст для `field:FLD-000345`, что и до (нужен diff двух сгенерированных файлов).

**Действие:** требуется либо (а) пользователь сам сгенерирует пакет «Годовое собрание» в /cabinet и пришлёт DOCX, либо (б) дать мне разрешение вызвать edge-функцию `canonical-document-generate-strict` или `supabase--curl_edge_functions` с реальными аргументами под service_role (для одной из двух сессий выше). См. §X.

---

## §E — Таблица «Плейсхолдеры для Word», группа «Пакет: ЮЛ» — PASS by code

`src/utils/packagePlaceholderCatalog.ts:185-199` (после Stage 5.0.3 правки):

| Label | reused_fld | tech_key | example_value | Token |
|---|---|---|---|---|
| «Название (без формы собственности)» | `FLD-000011` | `package.ul.name` | `АЖУР инкам` | `{{package.ul.FLD-000011}}` |
| «Краткое наименование» | `FLD-000345` | `package.ul.short_name` | `ЗАО «АЖУР инкам»` | `{{package.ul.FLD-000345}}` |
| «Форма собственности (кратко)» | `FLD-000010` | `package.ul.org_form` | `ЗАО` | `{{package.ul.FLD-000010}}` |

Развёрнутая форма (`{{package.ul.FLD-000010|format=long}} → Закрытое акционерное общество`) собирается из той же строки через `supportsLongFormat(ulOrgForm)=true` → пользователь выбирает modifier в `RowSettingsCell`. Отдельной строкой в таблице она НЕ показывается — это modifier, а не самостоятельный FLD. Это сознательное решение Stage 5.0.3 (см. proof `stage5_0_3_naming_contract_fix.md` §5).

Если требуется именно отдельная строка-пример «развёрнуто» для клиентского восприятия — это маленькая UI-правка (добавить компанию-row с предзаполненным settings.format='long'), но это уже add-on Stage 5.0.2/5.0.3, не runtime proof. См. §X.

Скриншот таблицы — TODO (нужен браузер-скрин, §F).

---

## §A.4 — Роли и обязательность — частично PASS by SQL

«Идеология / Приказ»: только `ln-000012` (`include_position=true`, `format=signature_short`) → одна роль; participant в сессии есть (1). Required-счётчик собирается в `PackageDocumentCard` через `document_package_item_role_assignments`. Reading самого SQL не проверял, нужны JOIN'ы — отложено в Stage 5 atomic proof, где это центральный сценарий.

«Годовое собрание»: 0 participants в сессии, в шаблоне ролей нет (`ln-…` отсутствует в detected_tokens) → required-gate ролей = 0/0 = passed. Соответствует ожиданию плана.

---

## §A.5 — empty-state «нет активной версии» — PASS by code

`PackageDocumentCard.tsx:350-358` — рендерит amber Badge «Нет активной версии», если `hasActiveVersion === false`. Деривация `hasActiveVersion` находится выше — не показал в этом отчёте, но при `dt.current_version_id IS NULL` (как у шаблона «1. Приказ … учредителей ООО» из `d135d42d-…`, не привязанного к нашим сессиям) карточка показывает безопасный fallback. Корректировка №12 («не создавать искусственную сессию ради скриншота») соблюдена: реальный fixture без active version уже существует в БД, скрин можно снять без mutating работающих шаблонов.

---

## §F — Скриншоты — **DEFERRED**

Не выполнено. Список того, что нужно отснять, остался без изменений (см. план §F). Это чистая proof-работа, безопасная, но трудоёмкая (× viewport × тема × сценарий). Стоит делать **после** фиксов §A.1 / §A.3 — иначе скриншоты зафиксируют известный регресс.

---

## §B — «Годовое собрание»: 7/7 полей, календарь, save — частично PASS by SQL

Все 7 catalog-полей (`pf-000003..pf-000009`) активны и присутствуют в current detected_tokens (v2) — значит они появятся в карточке через token-driven резолвер. 4 из 7 уже имеют сохранённые значения (см. snapshot §0). Сценарий save через RPC и подсчёт audit_logs — это Stage 5, отдельный proof.

---

## §X — Findings (требуют решения пользователя)

### F1. Регресс Stage 5.0.2 №1 — нумерация
Текущая реализация: `item.sort_order + 1` (PackageDocumentCard.tsx:340, :259).
Ожидание плана: `index + 1` по отрисованному списку.
**Воспроизведение:** сессия «Годовое собрание» → бейдж единственного документа = `2` вместо `1`.
**Предлагаемая правка:** 1-строчный change в `DocumentPackageQuestionnairesView.tsx:320-332` (передать `idx` в map) + `PackageDocumentCard.tsx` (новый prop `index`, заменить два usage).
**Решение:** разрешите ли мне починить это в рамках Stage 5.0.4 (он на эту регрессию опирается)?

### F2. Регресс Stage 5.0.2 №3 — tooltip
Текущая реализация: inline `<p>` (PackageFieldsClientForm.tsx:383).
Ожидание плана: `<Info>` lucide + shadcn `Tooltip`, только при заполненном `effective.help`.
**Предлагаемая правка:** ~10 строк в `FieldRow` (там же, файл 383-518 фрагмент).
**Решение:** разрешите ли мне починить это в рамках Stage 5.0.4?

### F3. Stage 5.0.4-D — DOCX runtime-генерация
Не могу запустить генерацию без явного согласия — это вызовет реальный edge-function call и запишет ai_generated_documents для рабочей сессии пользователя. Варианты:
- (a) Вы сами сгенерируете «Годовое собрание» через UI → пришлёте DOCX → я распакую и валидирую токены.
- (b) Я вызову `supabase--curl_edge_functions` (`canonical-document-generate-strict`) с session `6a61a7e3-…` и одним из двух item_id, и снова почищу test-artifact в конце.

### F4. Stage 6 — E2E нового пакета как non-admin
Эта стадия требует:
- залогиниться под обычным пользователем (не super_admin);
- через UI создать новый `document_package_template` + 2 items;
- загрузить DOCX-версии с pf-токенами;
- активировать current_version_id;
- создать сессию, заполнить, сохранить, сгенерировать.

Это не задача для агента в одиночку: я могу либо (а) подготовить SQL-fixture-сценарий и описать минимальные UI-действия для вас, либо (б) выполнить большую часть через `psql` + edge-функции (но это нарушит «без админ-консолей»). Уточните, что приемлемо.

### F5. Stage 7 — token-driven orphan transition
Требует загрузки новой версии DOCX с новым `pf-XXXXXX` токеном и активации `current_version_id`. Это тоже либо ручное UI-действие, либо нужна моя загрузка через storage API + миграция. Уточните.

---

## Итог по §A-F (на момент остановки)

| Блок | Статус | Комментарий |
|---|---|---|
| §A.1 нумерация | **FAIL** | sort_order вместо index; «Годовое собрание» = `2` |
| §A.2 архив pf-000002 не виден | **PASS** by code | `is_active` фильтр в catalogQuery |
| §A.3 tooltip с описанием | **FAIL** | inline `<p>`, нет Info-icon |
| §A.4 роли и обязательность | partial PASS | детально в Stage 5 |
| §A.5 empty-state «нет активной версии» | PASS by code | amber Badge, fixture есть |
| §B.1 заголовок и 7/7 полей | PASS by SQL | все 7 в detected + 4/7 заполнены |
| §B.2 save → 200 + audit+1 | DEFERRED | Stage 5 unified |
| §B.3 UI 1:1 как в Идеологии | DEFERRED screenshots | после §A.1/§A.3 |
| §C SQL pf-000002 absent | **PASS** | has_pf2=false × 3 |
| §D runtime DOCX | **BLOCKED** | см. F3 |
| §E таблица плейсхолдеров | PASS by code, screenshot pending | после §A.1/§A.3 |
| §F скриншоты | DEFERRED | после фиксов |

Stage 5, 6, 7 не начаты — продолжать после решения по F1–F5.
