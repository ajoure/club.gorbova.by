
# План: убрать «Клиенты - январь - 01-2019» из заголовка скачанных документов

## Откуда берётся надпись

В верхней панели браузера (вкладка просмотра PDF/DOCX) показывается **внутренний title из метаданных файла** — `docProps/core.xml`, поле `<dc:title>`.

Сейчас этот title жёстко зашит в исходный DOCX-шаблон: когда-то Word-файл был сохранён с именем «Клиенты - январь - 01-2019», и Word записал это название в core properties. Шаблон с тех пор переименовали и переиспользовали для всех тарифов клуба, но `dc:title` внутри ZIP-архива остался прежним. PDF, генерируемый Gotenberg/LibreOffice, тоже наследует этот title из core.xml DOCX.

Никакой код в проекте сейчас core.xml не трогает — ни `canonical-document-generate-strict`, ни `ai-generate-document`, ни `generate-from-template`. Поэтому проблема воспроизводится для **всех** сгенерированных документов, а не только для Багинской.

## Что делаем

Перезаписываем `docProps/core.xml` сразу после `docxtemplater.render()` и **до** `getZip().generate()` / отправки в Gotenberg. Это автоматически чинит и DOCX, и PDF, потому что PDF строится из уже пропатченного DOCX.

Решение по содержимому title (рекомендуется вариант **A**, потому что он и осмысленный, и одинаково работает в PDF/DOCX, и совпадает с именем файла, который пользователь видит при скачивании):

- **A. Title = rendered file name без расширения** (например, «Счёт-акт Багинская Е. П. 2026-05»). Так браузер во вкладке покажет осмысленное название, совпадающее с именем файла.
- B. Очистить `dc:title`. Браузер тогда покажет имя файла из Content-Disposition — тоже приемлемо.

Берём A.

Заодно нормализуем сопутствующие core-поля, чтобы не светить старые имена:

- `dc:creator` → «Gorbova Club» (или название из настроек площадки).
- `cp:lastModifiedBy` → то же значение.
- `dc:subject`, `dc:description`, `cp:keywords` → очищаем (там тоже бывает мусор от шаблонов).
- `dcterms:created` / `dcterms:modified` → текущее время.

## Где править

1. `supabase/functions/_shared/` — добавить новый общий хелпер `docx-core-props.ts` с функцией:

   ```ts
   patchDocxCoreProps(zip: PizZip, props: { title?: string; creator?: string }): void
   ```

   Логика: читает `docProps/core.xml` из zip, парсит как строку, перезаписывает значения тегов `<dc:title>`, `<dc:creator>`, `<cp:lastModifiedBy>`, очищает `<dc:subject>`, `<dc:description>`, `<cp:keywords>`, обновляет `<dcterms:created/modified>`. Если файла `docProps/core.xml` нет — создаёт минимальный валидный.

2. `supabase/functions/canonical-document-generate-strict/index.ts`
   - Между `docx.render(resolved)` и `docx.getZip().generate(...)` (строки ~915–919) вызвать `patchDocxCoreProps(docx.getZip(), { title: renderedFileName, creator: 'Gorbova Club' })`.
   - **Важный порядок**: `renderedFileName` сейчас вычисляется *после* `getZip().generate()` (строки ~995–1020). Нужно вынести расчёт `renderedFileName` выше — до рендера DOCX, — чтобы он был доступен и для core.xml, и для текущего upload-кода. Никакой бизнес-логики это не меняет, только переставляем блоки.

3. `supabase/functions/ai-generate-document/index.ts` (строка 365) и `supabase/functions/generate-from-template/index.ts` (строка 327) — после `doc.render(...)` вызвать тот же `patchDocxCoreProps` с title = итоговым именем файла этого пути.

## Что НЕ делаем

- Не трогаем сами загруженные шаблоны в storage (`document_template_versions.storage_path`). Старые шаблоны останутся с грязным core.xml, но это уже не важно — мы патчим на лету при каждой генерации.
- Не делаем backfill уже сгенерированных файлов в bucket `documents`. Новые скачивания будут с правильным title; старые PDF/DOCX у клиентов на руках — оставляем как есть (никто не жаловался ретроспективно, риск ломать существующие ссылки бессмысленный).
- Не меняем UI, имя файла в Content-Disposition, шаблоны имени, нумерацию документов.

## Diagnose → Plan → Dry run → Execute → Verify

- **Diagnose**: подтверждено — ни одна edge-функция не пишет в `docProps/core.xml`; источник заголовка — сам DOCX-шаблон.
- **Dry run**: локально/в edge — сгенерировать один документ Багинской после патча, скачать PDF, открыть в браузере — во вкладке должно стоять `Счёт-акт Багинская Е. П. ...`, не «Клиенты - январь - 01-2019».
- **Execute**: deploy трёх функций.
- **Verify**:
  1. Скачать DOCX → распаковать `docProps/core.xml` → `<dc:title>` совпадает с именем файла, `<dc:creator>` = «Gorbova Club».
  2. PDF, открытый в Chrome, в заголовке вкладки показывает то же название.
  3. На уже сгенерированных документах (без перегенерации) title остался старый — это ожидаемо.

## DoD

- [ ] Хелпер `_shared/docx-core-props.ts` создан и покрывает 3 edge-функции.
- [ ] `canonical-document-generate-strict`, `ai-generate-document`, `generate-from-template` патчат core.xml перед сериализацией.
- [ ] Новый сгенерированный PDF Багинской открывается в Chrome без надписи «Клиенты - январь - 01-2019».
- [ ] Новый сгенерированный DOCX того же документа имеет корректные `dc:title`, `dc:creator`, очищенные `subject/description/keywords`.
- [ ] Proof: `.lovable/proofs/docx_core_props_title_cleanup_2026_05_22.md` с before/after скриншотом core.xml и заголовка вкладки.
