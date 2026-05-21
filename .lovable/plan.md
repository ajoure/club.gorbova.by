дополни план: если в шаблоне все ок с токенами и он правильный, то активировать его автоматически. все версии сохранять и дать возможность возвращаться или включать или отключать какие-то версии. При этом в настройках кнопки оплаты в продукте выбранный шаблон не меняется из-за замены версии

&nbsp;

План: Авто-версионирование шаблонов документов при загрузке

## Контекст и диагностика

Файл `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`, функция `handleUpload`:

- Безусловно делает `INSERT into document_templates` с новым `code = tmpl_{ts}` и новым `template_path`.
- Безусловно создаёт версию с `version_number: 1`.
- Никакой проверки «существует ли уже шаблон с таким именем» нет.

Результат: при повторной загрузке `.docx` с тем же именем создаётся ещё одна запись `document_templates` (как видно на скриншоте — «Счёт-акт на услуги ФЛ — Исполнитель» дублируется), а не v2 уже существующего шаблона.

Backend (`document_template_versions`) уже поддерживает несколько версий на один `template_id` (есть `version_number`, `is_current`, `current_version_id` на шаблоне) — модель данных готова, фронт просто ей не пользуется.

## Что нужно сделать (только фронт)

Изменить `handleUpload` в `StrictDocumentTemplatesManager.tsx` так:

1. **Поиск существующего шаблона по имени**
  - До любых INSERT: `select id, name from document_templates where deleted_at is null and lower(name) = lower(uploadName.trim())`.
  - Сравнение по `lower(trim(name))` — устойчиво к регистру и хвостовым пробелам.
2. **Если шаблон НЕ найден (новое имя)** — поведение как сейчас:
  - INSERT в `document_templates` (draft, legacy NOT NULL поля как сейчас).
  - INSERT в `document_template_versions` с `version_number = 1`, `is_current = false`, `validation_status = 'pending'`.
  - Toast: «Создан новый шаблон, версия 1».
3. **Если шаблон НАЙДЕН (имя совпало)** — добавляем версию:
  - Грузим `.docx` в storage по новому уникальному `storage_path` (как сейчас, через `Date.now()`), чтобы не конфликтовать с прошлой версией и не зависеть от `upsert`.
  - Определяем `nextVersionNumber = max(version_number) + 1` по `document_template_versions` для этого `template_id` (один доп. запрос или используем уже загруженный `versions` стейт).
  - INSERT в `document_template_versions` с этим `template_id`, `version_number = nextVersionNumber`, `is_current = false`, `validation_status = 'pending'`.
  - `document_templates` НЕ трогаем (имя, статус, current_version_id остаются как есть — активация версии остаётся отдельным действием, как сегодня).
  - Toast: «Добавлена версия N к шаблону "…"». Кнопка не «активирует» автоматически — пользователь сам валидирует и активирует, чтобы не сломать продакшен случайно.
4. **Аудит и автопроверка**
  - `auditEvent("document_template.version_uploaded", { template_id, template_version_id, meta: { version_number, file_name, file_size_bytes, storage_path, reused_template: true|false } })`.
  - Существующий блок «автопроверка сразу после загрузки» (`openPreview`) переиспользуем: после INSERT версии находим её по `storage_path` + `template_id` и открываем preview/валидацию, как сейчас.
5. **UX-уточнения**
  - Если в форме загрузки имя ровно совпало с существующим — под полем имени показать подсказку: «Будет добавлена версия N к существующему шаблону». Реактивно по `templates` стейту.
  - Если пользователь хочет именно отдельный шаблон — он может изменить имя в форме (имя в форме редактируется, дефолт берётся из имени файла).

## Что НЕ делаем (явно)

- Не меняем backend, RLS, миграции, edge functions.
- Не трогаем `document_templates.code`, `template_path`, `template_status`, `current_version_id` при добавлении версии.
- Не делаем авто-активацию новой версии (это уже отдельный осознанный шаг через «Активировать», чтобы соблюсти canon strict-валидации).
- Не удаляем и не архивируем старые версии.

## Технические детали

- Файл: `src/components/ai-documents/StrictDocumentTemplatesManager.tsx`.
- Изменения только внутри `handleUpload` (~строки 334–446) + мелкая подсказка под `uploadName` в JSX формы загрузки.
- Никаких новых зависимостей.

## DoD

1. Загрузка `.docx` с именем, совпадающим (case-insensitive, trim) с существующим шаблоном → создаётся `document_template_versions` row с `version_number = max+1`, новый `document_templates` row НЕ создаётся.
2. Загрузка `.docx` с новым именем → поведение как раньше (новый template + version 1).
3. Активный (`current`) шаблон остаётся прежним до явной активации новой версии.
4. В UI под полем имени видна подсказка «Будет добавлена версия N к существующему шаблону», когда имя совпадает.
5. Аудит-событие `document_template.version_uploaded` отправляется с корректными `template_id`, `version_number`, `reused_template`.
6. Автоматическая strict-валидация после загрузки работает для новой версии.
7. Дублей «Счёт-акт на услуги ФЛ — Исполнитель» больше не появляется при повторной загрузке.

Proof: `.lovable/proofs/patch_template_upload_versioning_2026_05.md` (создать на этапе execute).