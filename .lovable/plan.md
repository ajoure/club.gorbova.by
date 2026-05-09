да, согласен, с учетом правок:

1. **Разделить C5-I и C5-J жёстко.**  
C5-I можно выполнять сразу.  
C5-J запускать только после dependency gate по PDF-конвертеру. Не смешивать UI-исправления шаблонов с PDF-конвертацией в один deploy.
2. **C5-I должен быть основным sprint, C5-J — conditional.**  
Формат статуса:
3. **Добавить явную проверку валидного FLD-шаблона без разметки.**  
В DoD добавить:
4. **Не называть** `TemplateMarkupDialog` **настройками, если он не редактирует документ.**  
Лучше название:
  &nbsp;
  ```text
  Проверка и исправление плейсхолдеров
  ```
  Потому что «Настройки» звучит слишком широко и снова создаст ожидание полноценного редактора.
5. **Кнопку legacy-разметки сделать вторичной.**  
На основной панели:
  &nbsp;
  ```text
  Проверка и исправление плейсхолдеров
  ```
  Подпись:
6. **Добавить отдельную кнопку/действие “Скопировать плейсхолдеры”.**  
В workflow шаблонов должен быть видимый путь:
7. **PDF converter gate должен проверять не только secret, но и реальную конвертацию.**  
Добавить dry-run:
  &nbsp;
  ```text
  взять маленький тестовый DOCX;
  отправить в converter;
  получить application/pdf;
  проверить размер > 10 KB;
  сохранить временный PDF;
  открыть/скачать;
  удалить тестовый файл.
  ```
  Только после этого менять `canonical-document-generate-strict`.
8. **C5-J не должен ломать уже созданные DOCX-документы.**  
Добавить:
9. **В** `ai_generated_documents.meta` **сохранить больше технических данных.**  
Для PDF:
10. **Добавить fallback STOP, но не fallback HTML-PDF.**  
Если converter упал:

```text
generate должен завершиться ошибкой;
document row не должен остаться как успешный PDF;
номер документа не должен теряться;
если номер уже выдан, документ должен получить status='failed' / meta.error, но повтор с тем же idempotency_key должен продолжить тот же документ и тот же номер.
```

Это важно, потому что номер уже резервируется до render/conversion.

11. **Уточнить порядок при ошибке PDF после выдачи номера.**  
В C5-J добавить:

```text
номер выдан → DOCX создан → PDF conversion failed.
Тогда ai_generated_documents остаётся с document_number, status='failed', file_path NULL или technical docx path only in meta.
Повтор generate с тем же idempotency_key не выдаёт новый номер, а повторяет conversion для того же документа.
```

12. **Preview no-op проверить отдельно после C5-J.**  
В verify добавить:

```text
preview не вызывает converter;
preview не сохраняет DOCX;
preview не сохраняет PDF;
preview не пишет ai_generated_documents;
preview не выдаёт номер.
```

13. **Activation error normalization должна показывать причину backend.**  
Не просто `normalizeEdgeFunctionError`, а маппинг:

```text
validation_status != valid → «Шаблон содержит ошибки. Откройте проверку.»
markup_status not marked → «Шаблон не размечен / не проверен.»
role denied → «Недостаточно прав для активации шаблона.»
missing JWT → «Сессия истекла. Войдите заново.»
```

14. **После upload нужна авто-валидация с видимым состоянием загрузки.**  
В UI:

```text
Загружено → Проверяем шаблон… → Валиден / Есть ошибки
```

Нельзя оставлять pending без объяснения.

15. **Proof лучше сделать отдельным, не дописывать в C5-G.**  
Создать:

```text
.lovable/proofs/document_generation_sprint11_c5i_template_workflow.md
.lovable/proofs/document_generation_sprint11_c5j_pdf_primary_output.md
```

C5-G оставить только для нумерации.

16. **C5-H не трогать, но проверить регрессию.**  
В proof C5-I/C5-J добавить строку:

```text
search_deal_rows / C5-H files untouched
```

Если C5-H ещё не закрыт — не смешивать.

17. **C5-K вынесен правильно, но добавить stop-guard.**  
В этом патче запрещено менять выбор шаблона по offer/tariff. Только общий активный шаблон.
18. **Финальный порядок execute должен быть такой:**

```text
1. C5-I UI workflow шаблонов.
2. QA C5-I на валидном и невалидном DOCX.
3. Dependency gate PDF converter.
4. Если converter OK → C5-J backend PDF.
5. QA C5-J preview/generate/idempotency/PDF.
6. Если converter отсутствует → C5-J статус BLOCKED, текущий DOCX generate не ломать.
```

Главная правка: **не начинать C5-J без реального converter proof**. C5-I можно делать сразу.

&nbsp;

План:

## 1. Проблема

Сейчас раздел шаблонов документов технически работает кусками, но UX не объясняет нормальный путь:

- после загрузки непонятно, что делать дальше;
- кнопка «Сделать текущей» неочевидна и при ошибке показывает сырой `Edge Function returned a non-2xx status code`;
- «Расширенная разметка» выглядит как основной путь, но для уже корректного FLD-шаблона там нечего применять, поэтому кнопки недоступны;
- найденные плейсхолдеры и сырой текст документа занимают экран, но не помогают принять решение;
- генерация сейчас создаёт DOCX, а нужен PDF как основной клиентский формат, чтобы клиент не редактировал документ.

## 2. Диагностика

Фактическое состояние по коду:

- Основной UI шаблонов: `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`.
- Загрузка создаёт:
  - `document_templates` со статусом `draft`;
  - `document_template_versions` со статусом `pending`;
  - файл в private bucket `documents`.
- Валидация сейчас запускается только при выборе версии через `openPreview`, а не сразу после загрузки.
- Кнопка «Сделать текущей» вызывает `canonical-template-activate-version`.
- Backend activation требует:
  - JWT;
  - роль `admin | super_admin | owner`;
  - `validation_status='valid'`;
  - `markup_status` отсутствует или `marked`.
- Ошибка активации сейчас не нормализуется через `normalizeEdgeFunctionError`, поэтому пользователь видит технический toast.
- `TemplateMarkupDialog.tsx` — это инструмент замены старых/выделенных фрагментов на FLD-поля, а не «настройки шаблона». Для уже валидного шаблона с готовыми `{{field:FLD-...}}` там часто нет accepted replacements, поэтому `Применить`/`Применить и активировать` закономерно выключены.
- `DealDocumentsPanel.tsx` вызывает `canonical-document-generate-strict` в режимах:
  - `preview` — без номера документа;
  - `generate` — создаёт DOCX и пишет `ai_generated_documents`.
- `canonical-document-generate-strict` сейчас сохраняет основной файл как DOCX:
  - `file_path = generated/...docx`;
  - `file_mime = application/vnd.openxmlformats-officedocument.wordprocessingml.document`.
- Bucket `documents` уже разрешает `application/pdf`.
- Есть legacy `generate-document-pdf`, но он генерирует HTML/старый счёт-акт, не конвертирует strict DOCX-шаблон в настоящий PDF и не должен становиться вторым workflow.

## 3. Предлагаемое решение

Разделить задачу на два связанных патча.

### C5-I — человеческий workflow шаблонов

Сделать простой путь:

```text
1. Загрузить DOCX
2. Автоматически проверить шаблон
3. Если валиден — Активировать
4. Если невалиден — открыть настройки и увидеть только ошибки
5. В сделке — Тест / Создать PDF
```

Изменения UI:

- Переименовать «Сделать текущей» в понятное действие: `Активировать шаблон`.
- Убрать с основной панели сырой список всех плейсхолдеров и «Текст документа первые 3000 символов».
- На основной панели показывать только:
  - статус проверки;
  - количество FLD-полей;
  - если есть ошибки — список неправильных плейсхолдеров с причиной;
  - действия: `Проверить`, `Настройки`, `Активировать`.
- «Расширенная разметка (legacy)» переименовать в `Настройки / исправление полей`.
- Внутри настроек:
  - показывать документ и подсвечивать только проблемные/legacy placeholders;
  - для валидного шаблона показывать состояние «Шаблон уже валиден, можно активировать»;
  - не заставлять пользователя делать replacements, если все placeholders уже FLD-valid;
  - кнопка `Активировать` должна быть доступна для валидной версии даже без замен.
- После загрузки автоматически выполнить ту же strict validation, которая сейчас запускается при клике по версии.
- Все ошибки edge functions в этом UI пропускать через `normalizeEdgeFunctionError` и показывать человеческий текст.

### C5-J — PDF как основной результат генерации

Сделать PDF основным файлом для клиента, не создавая второй source of truth.

Канон:

- `ai_generated_documents` остаётся единственной записью документа.
- При `mode='preview'` ничего не сохраняется и номер не выдаётся.
- При `mode='generate'`:
  1. strict generator рендерит DOCX из активного шаблона;
  2. выдаёт номер документа как сейчас;
  3. конвертирует итоговый DOCX в PDF;
  4. сохраняет PDF в bucket `documents`;
  5. в `ai_generated_documents.file_path/file_mime/file_name` пишет PDF как основной файл;
  6. технический DOCX сохраняет только в `meta.docx_storage_path`, `meta.docx_file_name`, `meta.docx_mime` для админского аудита/отладки;
  7. download URL возвращает PDF.

UI сделки:

- `Preview` переименовать в `Тест`.
- `Сформировать DOCX` заменить на `Создать PDF`.
- В истории документов кнопка скачивания открывает PDF.
- Если нужен админский DOCX для диагностики — добавить вторичное действие `DOCX` только для admin/super_admin, но не показывать клиенту.

Важная зависимость по PDF:

- Для качественного PDF «как в Word» нужен backend-конвертер DOCX→PDF. В Lovable Cloud function нельзя надёжно запускать LibreOffice как локальный процесс.
- Поэтому реализация должна использовать один из безопасных вариантов:
  - уже подключённый внешний converter endpoint, если он есть в secrets;
  - либо запросить secret/URL для Gotenberg/CloudConvert/аналогичного сервиса;
  - HTML-заглушку вместо PDF из DOCX не использовать, потому что она не сохранит Word-разметку и создаст параллельный шаблонный движок.

## 4. Изменяемые компоненты

### UI

- `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`
  - новый основной workflow;
  - авто-валидация после upload;
  - понятные названия действий;
  - скрытие шумных блоков;
  - нормализация ошибок.
- `src/components/ai-documents/TemplateMarkupDialog.tsx`
  - превратить из «legacy-разметки» в понятные настройки/исправление полей;
  - валидный шаблон можно активировать без replacements;
  - убрать native `confirm`, заменить стандартным `AlertDialog` только если потребуется подтверждение.
- `src/components/ai-documents/DealDocumentsPanel.tsx`
  - `Тест` вместо `Preview`;
  - `Создать PDF` вместо `Сформировать DOCX`;
  - история скачивает PDF.

### Backend functions

- `supabase/functions/canonical-document-generate-strict/index.ts`
  - оставить preview no-op;
  - в generate добавить DOCX→PDF шаг;
  - PDF сделать primary file в `ai_generated_documents`;
  - DOCX-path сохранить в `meta`.
- Возможна новая shared helper/function для конвертации DOCX→PDF, если в проекте нет существующего корректного конвертера.
- `canonical-template-activate-version` менять только если диагностика подтвердит backend-дефект; текущая логика в целом правильная.

### Database

- Новую таблицу не создавать.
- Предпочтительно не добавлять новые колонки, использовать `ai_generated_documents.meta` для технического DOCX-path.
- Если dry-run покажет, что фильтрация/скачивание требует индексируемых PDF-полей, тогда отдельной миграцией добавить минимальные nullable columns, но это не основной путь.

### Proof

- Обновить `.lovable/proofs/document_generation_sprint11_c5g_document_numbering.md` или создать новый proof-раздел:
  - `C5-I — Template workflow UX`;
  - `C5-J — PDF generation as client output`.

## 5. Что не будет изменено

- Не менять C5-G нумерацию:
  - `allocate_document_number`;
  - `document_number_counters`;
  - immutable trigger;
  - `admin_override_document_number`.
- Не менять C5-H поиск сделок по номеру документа.
- Не добавлять связь шаблонов с тарифами/кнопками оплаты в этом патче — это следующий отдельный C5-K, потому что там нужен отдельный source of truth для выбора шаблона на уровне конкретной кнопки/оффера.
- Не показывать клиентам DOCX.
- Не делать HTML-PDF как замену Word-шаблону.

## 6. Dry-run

Перед изменениями выполнить безопасные проверки:

1. Проверить secrets/environment на наличие PDF-конвертера без вывода секретов.
2. Проверить фактическую структуру `ai_generated_documents` и `document_template_versions`.
3. Проверить, что bucket `documents` принимает PDF — уже подтверждено: `application/pdf` разрешён.
4. Проверить текущий ответ `canonical-template-activate-version` на валидной версии и понять причину `non-2xx` из UI/логов.
5. Взять один валидный template version и один order для теста preview/generate.
6. Если converter отсутствует — остановиться перед PDF-патчем и запросить подключение converter secret, не ломая текущий DOCX generate.

## 7. Execute

После approval:

1. UI-патч C5-I:
  - переписать основной правый блок в `StrictDocumentTemplatesManager` в компактную панель состояния;
  - добавить авто-валидацию после upload;
  - переименовать действия;
  - убрать raw placeholders/text с main screen;
  - сделать activation action понятной и с нормальными ошибками;
  - привести `TemplateMarkupDialog` к роли «Настройки / исправление полей».
2. Backend PDF-патч C5-J:
  - добавить helper вызова DOCX→PDF converter;
  - в `canonical-document-generate-strict` после DOCX-render загрузить DOCX как technical artifact;
  - сконвертировать DOCX в PDF;
  - загрузить PDF;
  - записать PDF в primary `file_path/file_mime/file_name`;
  - сохранить DOCX metadata в `meta`;
  - вернуть `download_url` на PDF.
3. UI сделки:
  - заменить тексты кнопок;
  - показать, что создаётся именно PDF;
  - история документов скачивает PDF.
4. Proof:
  - зафиксировать SQL/edge/UI проверки.

## 8. STOP-guards

Остановиться и не продолжать, если:

- нет доступного PDF converter secret/endpoint для настоящего DOCX→PDF;
- converter возвращает не `application/pdf`;
- PDF пустой или меньше разумного размера;
- после генерации `ai_generated_documents.file_mime` не `application/pdf`;
- preview создаёт строку документа или выдаёт номер;
- generate создаёт новый номер при повторе того же `idempotency_key`;
- activation backend отклоняет валидную версию по неожиданной причине;
- обнаружится, что текущий DOCX нужен клиентскому кабинету как primary download.

## 9. Verify

Проверки после выполнения:

### Шаблоны

- Загрузить валидный DOCX с `{{field:FLD-000069}}` / `{{field:FLD-000070}}`.
- После upload статус автоматически становится `valid` без ручного клика по версии.
- Main screen не показывает сырой текст документа и полный список placeholders.
- `Активировать шаблон` активирует версию и пишет audit `document_template.version_activated`.
- Невалидный placeholder показывает конкретную ошибку красным.
- Валидный шаблон в настройках можно активировать без replacements.

### Генерация

- `Тест` возвращает resolved tokens, не создаёт `ai_generated_documents`, не выдаёт номер.
- `Создать PDF` создаёт одну запись `ai_generated_documents`.
- `file_mime='application/pdf'`.
- `file_path` указывает на `.pdf`.
- `meta.docx_storage_path` содержит технический DOCX.
- PDF скачивается и открывается.
- Клиентский download получает PDF, не DOCX.
- Номер документа остаётся DDMM/N и не меняется.
- Повтор generate с тем же idempotency key не создаёт дубль и не выдаёт новый номер.

## 10. DoD

Задача считается закрытой, когда:

- пользовательский путь понятен без чтения технических подсказок;
- «Сделать текущей» заменено на понятную активацию;
- валидный шаблон можно активировать без захода в legacy-разметку;
- неправильные placeholders видны только как ошибки, а не вся техническая простыня;
- генерация создаёт PDF как primary document;
- DOCX не показывается клиентам как основной файл;
- preview остаётся no-op;
- C5-G/C5-H не затронуты;
- proof содержит реальные результаты UI/backend проверок.

## 11. Риски и зависимости

- Главный риск — качественная DOCX→PDF конвертация. Без внешнего converter endpoint нельзя гарантировать PDF, совпадающий с Word-разметкой.
- Нельзя подменять это HTML-генерацией: это будет второй шаблонный движок и расхождение с DOCX.
- Если converter недоступен, можно выполнить C5-I UX сейчас, а C5-J PDF остановить на dependency gate до подключения converter secret.

## 12. Следующий отдельный этап

После стабилизации шаблонов и PDF нужен отдельный C5-K:

- связать активный шаблон документа с конкретной кнопкой оплаты / offer / tariff offer;
- source of truth должен быть ID-first: `offer_id/tariff_offer_id -> document_template_id`;
- генерация при создании сделки должна брать шаблон из конкретной кнопки оплаты, а не из общего активного шаблона.