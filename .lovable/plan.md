# да, согласен, с учетом правок:

&nbsp;

1. **Resolver не должен резолвить только included items.**
  Нужно уметь проверять весь manifest, но в UI отдельно показывать:
  &nbsp;
  - для included — runtime critical status;
  - для excluded — informational status.
    Иначе будет сложно диагностировать, почему шаблон не попал в пакет и существует ли он вообще.
  &nbsp;
2. **В resolveManifestTemplates() обязательно разделить типы недоступности:**
  &nbsp;
  - missing_db_record
  - inactive_template
  - missing_template_path
  - missing_storage_file
  - pending_sprint3
    Не сводить всё к одному missing, иначе диагностика будет слабой.
  &nbsp;
3. **Проверку storage делать реально, а не только по template_path.**
  Наличие пути в БД не равно наличию файла в bucket. Нужен фактический proof, что файл существует в storage и доступен для генерации.
4. **runtime_status брать из corporateTemplateSpec, но не дублировать бизнес-решение в двух местах.**
  Rule engine должен использовать spec как source of truth, а не иметь параллельную логику статусов. Иначе позже статусы разъедутся.
5. **В PackageManifestItem лучше добавить ещё spec_category / source_category, если category и availability начнут смешиваться.**
  Сейчас важно не потерять разделение:
  &nbsp;
  - system_generated
  - conditional_generated
  - externally_provided
    Availability — это отдельная ось, не замена категории.
  &nbsp;
6. **Step 4 Preview должен показывать не только availability, но и “готов к runtime сейчас / подготовлен на Sprint 3”.**
  Это важнее простого pending, потому что пользователю и нам нужно понимать: шаблон существует, но пока не активируется из-за loops/arrays.
7. **Validation layer должен уметь возвращать blocking/non-blocking результат.**
  Пример:
  &nbsp;
  - active template missing → blocking
  - pending_sprint3 template in excluded state → non-blocking
  - externally_provided → informational only
    Это лучше сразу заложить, чтобы потом не переделывать под генерацию.
  &nbsp;
8. **Документацию manifest-driven architecture нужно дополнить разделом “почему corporate templates скрыты из AI manager”.**
  Не просто “by design”, а коротко зафиксировать:
  &nbsp;
  - отдельный corporate flow;
  - templates не пользовательские универсальные, а системные нормативные;
  - редактирование/использование идет не через generic AI templates UI.
  &nbsp;
9. **В proof matrix добавить колонку used_now.**
  Нужна итоговая матрица:
  &nbsp;
  - code
  - db_template_id
  - template_path
  - storage_exists
  - runtime_status
  - availability
  - used_now
    Это даст полную картину без догадок.
  &nbsp;
10. **В DoD добавить proof, что corporateTemplateSpec.ts перестал быть orphaned.**
  То есть явно показать импорт и фактическое использование в runtime flow / preview.

&nbsp;

&nbsp;

В таком виде PATCH 2.1 можно отдавать в работу.

&nbsp;

PATCH 2.1 — Интеграционное завершение Sprint 2

## Текущее состояние

1. **18 DOCX** в storage и `document_templates` (scope=`corporate`)
2. `**corporateTemplateSpec.ts**` создан, но **нигде не импортируется**
3. `**calculatePackageManifest()**` возвращает manifest с `template_code` строками, но **никто не резолвит** их в реальные DB-записи / storage paths
4. **DB package templates** не созданы (document_package_templates пусто для corporate)
5. **AI-менеджер** фильтрует `scope === 'ai' || 'both'` — corporate templates intentionally невидимы
6. **Нет validation layer** — если template missing/inactive/file broken, система узнает об этом только при генерации

## Архитектурное решение

**Вариант A: manifest-driven only** (рекомендуемый).

Обоснование:

- `document_package_templates` — tenant-scoped (требует profile_id), а corporate пакеты — системные
- Состав пакета определяется динамически через charter rules / params — статический DB package не может это выразить
- `calculatePackageManifest()` уже делает эту работу корректно

DB packages НЕ создаются. Это явно документируется.

## Что нужно сделать

### 1. Template Resolver — связка manifest → DB → storage

Новый файл: `src/lib/corporate/corporateTemplateResolver.ts`

```
resolveManifestTemplates(manifest: PackageManifestItem[])
  → для каждого included item с category != externally_provided:
    → запрос document_templates по code + template_scope='corporate'
    → проверка is_active, template_path
    → проверка runtime_status из TEMPLATE_SPECS
    → возврат enriched manifest с db_template_id, template_path, availability status
```

Также: `validateTemplateAvailability()` — проверка до генерации, что все нужные templates доступны.

### 2. Подключить resolver в CorporateStep4Preview

Вызвать `resolveManifestTemplates()` и показать для каждого item:

- ✅ шаблон доступен
- ⚠️ шаблон pending_sprint3
- ❌ шаблон отсутствует / inactive

### 3. Подключить corporateTemplateSpec в rule engine

Импортировать `getTemplateSpec()` в `corporateRuleEngine.ts` → добавить `runtime_status` в `PackageManifestItem`.

### 4. Документировать manifest-driven architecture

Обновить `docs/corporate-templates-rules.md`:

- явный раздел "Почему НЕ DB packages"
- описание flow: wizard → manifest → resolver → edge function
- visibility policy: corporate templates скрыты от AI-менеджера by design

### 5. Расширить corporateTypes

Добавить в `PackageManifestItem`:

- `runtime_status?: 'active' | 'pending_sprint3'`
- `db_template_id?: string`
- `template_path?: string`
- `availability?: 'available' | 'pending' | 'missing' | 'inactive'`

## Файлы


| Файл                                                   | Что                                                  |
| ------------------------------------------------------ | ---------------------------------------------------- |
| `src/lib/corporate/corporateTemplateResolver.ts` (NEW) | Resolver: manifest code → DB template → availability |
| `src/lib/corporate/corporateRuleEngine.ts`             | Import spec, add runtime_status to manifest items    |
| `src/lib/corporate/corporateTypes.ts`                  | Extend PackageManifestItem                           |
| `src/components/corporate/CorporateStep4Preview.tsx`   | Show template availability status                    |
| `docs/corporate-templates-rules.md`                    | Architecture decision + flow documentation           |


## Что НЕ меняется

- DOCX шаблоны, storage, DB records
- Edge functions, wizard close/draft/reopen logic
- AI-менеджер шаблонов (corporate остаётся скрытым — by design)
- document_package_templates (не создаются — by design)

## DoD

- Resolver проверяет все included manifest items против DB
- Step 4 показывает availability каждого шаблона
- runtime_status из spec подключён к manifest
- Документация явно фиксирует manifest-driven architecture
- Proof: матрица code → DB → storage → availability
- Build clean