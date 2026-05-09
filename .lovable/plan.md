План:

1. **Проблема**
   Загруженный DOCX фактически содержит корректные ID-first плейсхолдеры, но UI помечает плейсхолдеры с модификаторами как invalid/legacy:
   - `{{field:FLD-000070|format=words}}`
   - `{{field:FLD-000153|case=genitive}}`
   - `{{field:FLD-000195|format=words}}`

   Из-за этого версия получает `validation_status='invalid'`, её нельзя активировать и нельзя использовать в генерации документа по сделке.

2. **Диагностика**
   По загруженному файлу `Шаблон._Счёт-акт_на_услуги_ИП_-_Исполнитель.docx`:
   - text-level extraction показывает 42 вхождения, 31 уникальный плейсхолдер;
   - все плейсхолдеры в текстовом представлении соответствуют утверждённому формату `{{field:FLD-XXXXXX}}` + разрешённые модификаторы `format=words`, `format=text`, `case=...`;
   - проблема не в DOCX, а в UI-валидаторе `StrictDocumentTemplatesManager.tsx`: сейчас он разрешает только `^field:FLD-\d+$`, то есть без `|format=...` и `|case=...`;
   - backend strict generator уже умеет модификаторы, поэтому фронтенд и backend сейчас расходятся по контракту.

3. **Предлагаемое решение**
   Сделать отдельный короткий PATCH для выравнивания валидатора и запуска ручного теста:

   **A. Исправить strict validation в UI**
   - В `StrictDocumentTemplatesManager.tsx` заменить клиентский regex на общий контракт:
     - `field:FLD-XXXXXX`
     - `field:FLD-XXXXXX|format=words`
     - `field:FLD-XXXXXX|format=text`
     - `field:FLD-XXXXXX|case=genitive`
     - `field:FLD-XXXXXX|format=words|case=genitive`
   - Добавить разбор `field_public_id`, `format`, `case_modifier` в `recognized`.
   - Красными оставлять только реально неправильные токены: старые `document.*`, `deal.*`, `cf.*`, неизвестные модификаторы, неизвестный `FLD`.
   - В списке найденных плейсхолдеров badge должен быть зелёный/нейтральный для разрешённых модификаторов, не destructive.

   **B. Синхронизировать сохранение validation snapshot**
   - При preview/validation сохранять в `document_template_versions`:
     - `validation_status='valid'`, если ошибок нет;
     - `validation_errors=[]`;
     - `detected_tokens` с полными токенами;
     - `token_manifest` с `field_public_id`, `placeholder`, `format`, `case_modifier`, label/data_type/required по `fields_registry`.
   - Это нужно, чтобы `DealDocumentsPanel` видел поля шаблона и генератор корректно проверял required.

   **C. Активировать шаблон штатным RPC**
   - После успешной валидации использовать существующий `canonical-template-activate-version`.
   - Не делать прямых UPDATE на `current_version_id` из UI.

   **D. Тест на реальной сделке**
   - В `DealDocumentsPanel` выбрать активный шаблон.
   - Выполнить `Preview`:
     - не должен выдавать legacy/invalid errors;
     - `FLD-000069` / `FLD-000070` должны присутствовать в списке полей;
     - preview не должен присваивать номер документа и не должен двигать counter.
   - Выполнить `Сформировать DOCX`:
     - создаётся запись в `ai_generated_documents`;
     - появляется `document_number` в формате `DDMM/N`;
     - скачивание DOCX работает;
     - номер в истории сделки копируется.

   **E. Зафиксировать proof**
   - Обновить `.lovable/proofs/document_generation_sprint11_c5g_document_numbering.md` или создать отдельный короткий раздел про template validation/generation QA:
     - загруженный файл;
     - найденные токены;
     - validation before/after;
     - activation proof;
     - preview no-op proof;
     - generate proof;
     - download proof.

4. **Изменяемые компоненты**
   - `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`
   - возможно `supabase/functions/canonical-template-validate/index.ts`, если текущая серверная валидация тоже используется при refresh/пере-проверке и должна быть приведена к тому же strict FLD-контракту;
   - proof-файл `.lovable/proofs/document_generation_sprint11_c5g_document_numbering.md`.

5. **Что не будет изменено в этом PATCH**
   - Не менять сам DOCX: файл корректный, чинить нужно валидатор.
   - Не менять генерацию номера `DDMM/N`.
   - Не менять email/Telegram/batch/auto-generation.
   - Не привязывать шаблон к тарифу/кнопке оплаты в этом же патче.
   - Не создавать новую сущность шаблона, если можно использовать существующие `document_templates`, `document_template_versions`, `document_generation_rules`.

6. **Dry-run**
   Перед изменениями:
   - повторно извлечь токены из загруженного DOCX;
   - проверить, что все `FLD-*` существуют в `fields_registry`;
   - проверить, что среди найденных токенов нет старых `{{document.*}}`, `{{deal.*}}`, `{{cf.*}}`;
   - проверить текущую версию шаблона и её `validation_errors`.

7. **Execute**
   - Внести минимальную правку regex/parser в UI.
   - При необходимости выровнять `canonical-template-validate` под тот же FLD-first контракт.
   - Обновить preview/validation сохранение `token_manifest`.
   - Прогнать загрузку/preview/activation на загруженном шаблоне.
   - Протестировать генерацию на одной реальной сделке.

8. **STOP-guards**
   Остановиться без активации, если:
   - найден хотя бы один старый токен `document.*`, `deal.*`, `cf.*`, `executor.*`, `customer.*`;
   - найден `FLD-*`, которого нет в `fields_registry`;
   - backend generator возвращает `legacy_placeholders_in_active_version`;
   - preview создаёт запись в `ai_generated_documents` или двигает `document_number_counters`;
   - в шаблоне есть required-поле без значения, и генерация блокируется корректно.

9. **DoD для этого PATCH**
   - Загруженный DOCX отображается как valid, без красных ошибок по `format=words` и `case=genitive`.
   - Версия шаблона активируется через штатную кнопку/RPC.
   - В `DealDocumentsPanel` шаблон доступен в списке активных.
   - Preview по сделке проходит без legacy errors и не создаёт номер.
   - Generate создаёт DOCX, номер документа и запись в истории сделки.
   - Скачивание созданного DOCX работает.
   - Proof-файл обновлён фактическими результатами.

10. **Следующий отдельный этап после этого**
   После того как шаблон реально загружается, активируется и генерируется по сделке, сделать отдельный план/патч для привязки шаблона к конкретной кнопке оплаты:
   - source of truth, вероятно, существующая `document_generation_rules` с `offer_id` / `tariff_id` / `product_id`;
   - в UI продукта/тарифа/offer добавить выбор активного шаблона для конкретной кнопки оплаты;
   - при успешной оплате выбирать шаблон по `offer_id` first, затем `tariff_id`, затем `product_id` fallback;
   - автогенерацию и отправку клиенту включать только после отдельного QA, чтобы не сломать текущие payment/email/Telegram потоки.

11. **Риски и зависимости**
   - Сейчас фронтенд и backend расходятся по допустимому формату плейсхолдера; нужно выровнять в одном патче.
   - Если `canonical-template-validate` используется где-то ещё, его тоже нужно привести к strict FLD-модели, иначе появится второй источник валидации.
   - Привязку к кнопке оплаты нельзя делать до успешной ручной генерации на сделке.