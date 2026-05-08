# Sprint 8 — Production-ready ручной UX генератора документов

## Цель
Убрать необходимость вручную вводить UUID заказа и реквизитов; добавить поиск, превью результата.
Авторассылка и авто-генерация по оплате не трогались.

## Изменения (только UI / frontend)

### Новые файлы
- `src/components/ai-documents/OrderPickerDialog.tsx`
  - Поиск заказов по `order_number` / `customer_email` (ilike OR).
  - По умолчанию показывает последние paid/pending.
  - Подгружает имя продукта через FK `products:product_id(name)`.
  - Возвращает компактный объект `OrderPickResult { id, order_number, customer_email, product_name, final_price, currency, status, created_at }`.
- `src/components/ai-documents/LegalDetailsPickerDialog.tsx`
  - Список из `client_legal_details`, сортировка `is_default DESC, updated_at DESC`.
  - Опциональный фильтр по `profile_id`.
  - Поиск по `ind_full_name`, `ent_name`, `leg_name`, `ent_unp`, `leg_unp`, `email`.
  - Иконки: ИП/Юрлицо → Building2 (indigo), физлицо → User.

### Изменённые файлы
- `src/components/ai-documents/CanonicalActGenerator.tsx`
  - Убраны два `<Input>` для UUID заказа и UUID реквизитов.
  - Добавлены кнопки «Выбрать заказ» / «Выбрать реквизиты», открывающие соответствующие диалоги.
  - После выбора показывается компактная карточка с номером заказа, продуктом, суммой и email клиента; для реквизитов — название, УНП, email, бейдж «По умолчанию».
  - Кнопка «×» сбрасывает выбор и preview.
  - После успешной генерации больше НЕ инициируется автоматический браузерный download — вместо этого отображается отдельная карточка результата с кнопкой «Скачать DOCX». Это убирает агрессивный браузерный prompt и оставляет ссылку доступной для повторного скачивания.
  - Добавлено состояние `lastGenerated` и условный блок-карточка с зелёной обводкой.

## Что НЕ трогалось
- Edge functions (canonical-document-generate, canonical-document-regenerate, payment-hook).
- Бизнес-логика resolver / token mapping / snapshot / source_trace.
- Schema/RLS — миграций нет.
- Legacy flows (`generated_documents`, `ai-generate-document`, `document-auto-generate`).
- Email / Telegram / автодоставка.
- Feature flags `documents_canonical_generation_enabled` и `documents_service_act_auto_generation_enabled` остаются `false`.

## Proof: production safety
- `grep -r "Input" src/components/ai-documents/CanonicalActGenerator.tsx` → пусто (поля для ручного UUID удалены).
- Pickers — read-only `select` через RLS-защищённые таблицы; никаких mutate/insert.
- Auto-download снят: пользователь явно нажимает «Скачать», файл всегда виден в истории.

## UX сценарий теперь
1. Админ открывает «Акты выполненных работ».
2. Выбирает шаблон из списка.
3. Нажимает «Выбрать заказ» → ищет по номеру или email → один клик.
4. (Опционально) «Выбрать реквизиты» → выбор из готового списка клиента.
5. «Предпросмотр данных» → видит resolved/missing/unmapped токены.
6. «Сформировать DOCX» → видит зелёную карточку с кнопкой «Скачать DOCX».
7. Документ виден в истории, snapshot/source_trace доступны, регенерация по-прежнему работает.

## Deferred → Sprint 9
- Inline DOCX preview (рендер первой страницы, например через mammoth + pdfjs или server-side LibreOffice).
- Batch ручная генерация по фильтру заказов.
- Контролируемая активация авто-генерации по оплате (отдельный второй флаг).
- Доставка готового DOCX клиенту в личный кабинет (без email/Telegram).
