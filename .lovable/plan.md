# да, согласен, с учетом правок:

&nbsp;

1. **В useEffect после verifyStorageFiles() лучше явно обрабатывать случай частичного сбоя storage-check.**
  Если storage verification упадет, не нужно терять весь preview. Правильнее:
  &nbsp;
  - сохранить результат resolveManifestTemplates();
  - при ошибке storage-check показать warning;
  - не обнулять весь Step 4.
    Иначе preview станет хрупким.
  &nbsp;
2. **В verifyStorageFiles() желательно не листать весь bucket без нужды, если paths уже известны.**
  Если текущая реализация проверяет через list('templates'), это допустимо как временное решение, но нужно пометить в docs, что это preview-time check и при росте числа шаблонов может потребоваться более точная проверка по путям.
3. **В DoD добавить proof именно для missing_storage_file.**
  Не только “статус достижим”, а показать тестовый кейс:
  &nbsp;
  - временно битый/несуществующий template_path;
  - preview показывает missing_storage_file;
  - validation трактует его корректно.
  &nbsp;
4. **В документации pipeline лучше зафиксировать полный порядок одной строкой.**
  То есть явно:
  manifest → DB resolve → storage verify → validation → preview badges
  Чтобы потом не было разночтений.

&nbsp;

&nbsp;

В остальном патч точечный и правильный.

&nbsp;

PATCH 2.1.1 — Подключение storage verification в runtime preview flow

## Проблема

`verifyStorageFiles()` существует в `corporateTemplateResolver.ts` (строки 168-202), но **не вызывается** в Step 4 preview flow (строки 70-84 в `CorporateStep4Preview.tsx`). Pipeline сейчас:

```text
calculatePackageManifest() → resolveManifestTemplates() → validateTemplateAvailability()
                                                        ↑ verifyStorageFiles() не подключён
```

## Решение

Подключить `verifyStorageFiles()` между `resolveManifestTemplates()` и `validateTemplateAvailability()` в Step 4.

### Файл: `src/components/corporate/CorporateStep4Preview.tsx` (строки 70-84)

Изменить `useEffect`:

```ts
useEffect(() => {
  let cancelled = false;
  setResolving(true);

  resolveManifestTemplates(manifest)
    .then(result => {
      if (cancelled) return;
      // Storage verification — проверяем реальное наличие файлов
      return verifyStorageFiles(result.items).then(verifiedItems => {
        if (cancelled) return;
        const verifiedResult = { ...result, items: verifiedItems };
        setResolution(verifiedResult);
        setTemplateValidation(validateTemplateAvailability(verifiedResult));
        setResolving(false);
      });
    })
    .catch(() => {
      if (!cancelled) setResolving(false);
    });

  return () => { cancelled = true; };
}, [manifest]);
```

Добавить `verifyStorageFiles` в import (строка 37).

### Файл: `docs/corporate-templates-rules.md`

Обновить раздел «Resolver» — добавить `verifyStorageFiles()` в описание pipeline и указать, что availability теперь проверяется по DB **и** по фактическому наличию файла в storage.

## Файлы


| Файл                                                 | Что                                                    |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `src/components/corporate/CorporateStep4Preview.tsx` | Подключить `verifyStorageFiles()` в useEffect pipeline |
| `docs/corporate-templates-rules.md`                  | Обновить описание pipeline                             |


## Что НЕ меняется

- `corporateTemplateResolver.ts` — resolver и `verifyStorageFiles()` уже реализованы корректно
- DOCX шаблоны, DB записи, storage файлы
- Wizard logic, draft/session/reopen
- Manifest-driven architecture

## DoD

- Step 4 pipeline: manifest → resolve → **verifyStorage** → validate
- `missing_storage_file` реально достижим в UI
- Документация обновлена
- Build clean