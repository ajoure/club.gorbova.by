План:

1. Проблема
- В контакт-центре снова появляется уведомление «Страница не загрузилась» / перезагрузка.
- На мобильном поле ввода Telegram-чата смещается при открытии клавиатуры, из-за чего не видно сообщения и невозможно нормально вставлять/набирать текст.
- Визуальная часть контакт-центра «прыгает»: список/чат/панели меняют высоту и положение.

2. Диагностика
- `docs/ENGINEERING_RULES.md` прочитан, порядок работ: Diagnose → Plan → Dry run → Execute → Verify.
- Проверены компоненты контакт-центра:
  - `src/pages/admin/AdminCommunication.tsx`
  - `src/components/admin/communication/InboxTabContent.tsx`
  - `src/components/admin/communication/unified/UnifiedInboxView.tsx`
  - `src/components/admin/ContactTelegramChat.tsx`
  - `src/components/system/LazyErrorBoundary.tsx`
- Главная найденная причина мобильной поломки: `ContactTelegramChat` добавляет к composer `paddingBottom = safe-area + keyboardInset`, где `keyboardInset` берётся из `visualViewport`. На iOS/Android это поднимает composer внутри уже ограниченного flex-контейнера, уменьшает область сообщений и провоцирует скачки/невидимое поле ввода.
- Дополнительный риск: мобильные обёртки контакт-центра используют `h-full` внутри карточек/панелей, но не закрепляют высоту на `100dvh` для режима чата. При открытии клавиатуры браузер меняет visual viewport, и вся карточка пересчитывается.
- По `LazyErrorBoundary`: после первого фикса reload ограничен TTL, но для chunk-load ошибки fallback всё ещё показывает спиннер и может инициировать `window.location.reload()`. Если ошибка не chunk, показывается «Страница не загрузилась». Нужно зафиксировать поведение так, чтобы не было бесконечной перезагрузки и чтобы лог был диагностируемый.
- Консольные snapshot-логи по `LazyErrorBoundary` в текущем состоянии не содержат явной ошибки, поэтому фикс будет UI-stability + hardening error boundary, без изменения backend/payment/message workflow.

3. Предлагаемое решение
- В `ContactTelegramChat.tsx` убрать автоматическое прибавление `keyboardInset` к нижнему padding composer. Composer должен быть жёстким нижним элементом flex-контейнера, а не «ездить» вслед за клавиатурой.
- Сделать composer стабильным:
  - `shrink-0`, `min-h`, предсказуемая высота;
  - textarea с фиксированным диапазоном высоты и `overflow-y-auto`;
  - кнопки отправки/эмодзи/файла не растягивают строку;
  - нижний padding только `env(safe-area-inset-bottom)`, без visualViewport-сдвига.
- Для мобильного Telegram-чата в `InboxTabContent.tsx` закрепить контейнер чата на viewport-safe высоте: `h-[100dvh]`/`max-h-[100dvh]`, `overflow-hidden`, без внешних карточных отступов, которые съедают место при клавиатуре.
- Для unified-вида `UnifiedInboxView.tsx` применить тот же принцип к мобильному выбранному чату, чтобы не было расхождения между обычной Telegram-вкладкой и единой лентой.
- В `LazyErrorBoundary.tsx` усилить защиту от reload-loop:
  - для chunk-load ошибки после одной попытки показывать понятный экран с кнопкой ручного обновления, а не оставлять вечный спиннер;
  - увеличить TTL/использовать session marker так, чтобы частые ошибки не перезагружали страницу каждые несколько секунд;
  - логировать pathname/message, но не запускать повторный auto-reload в цикле.

4. Изменяемые компоненты
- UI-компоненты:
  - `src/components/admin/ContactTelegramChat.tsx`
  - `src/components/admin/communication/InboxTabContent.tsx`
  - `src/components/admin/communication/unified/UnifiedInboxView.tsx`
  - `src/components/system/LazyErrorBoundary.tsx`
- Таблицы, RPC, edge functions, cron/jobs: не изменяются.
- Сообщения, платежи, доступы, заказы: не изменяются.

5. Что не будет изменено
- Не трогаю отправку Telegram-сообщений через backend-функцию.
- Не трогаю RPC чтения сообщений и список диалогов.
- Не меняю права, роли, RLS, платежи, счета, продукты.
- Не меняю дизайн всего контакт-центра, только стабилизацию layout/composer/error-boundary.

6. Dry-run
- До правок: воспроизвести `/admin/communication?tab=inbox` в мобильном viewport через Playwright, открыть чат, сфокусировать textarea, вставить длинный текст, проверить bounding boxes composer/textarea/messages.
- Проверить, что console не содержит React hook/order errors и `LazyErrorBoundary route render failed`.
- После правок: повторить тот же сценарий и сравнить:
  - composer остаётся видимым;
  - textarea видна при фокусе;
  - список сообщений не исчезает;
  - нет автоматических reload каждые несколько секунд.

7. Execute
- Внести минимальные изменения в указанные 4 файла.
- Не создавать новые компоненты/таблицы/воркфлоу.
- Не менять бизнес-логику отправки/чтения сообщений.

8. STOP-guards
- Остановиться и не править backend, если проблема воспроизводится только как UI-layout.
- Остановиться перед любыми изменениями в RPC/edge/database, если нет явной ошибки backend.
- Остановиться, если Playwright покажет, что активен не Telegram-контакт-центр, а другой канал/страница.
- Не делать массовых миграций или сбросов данных.

9. DoD
- На мобильном viewport контакт-центр открывает выбранный Telegram-чат без визуального развала.
- При фокусе textarea composer остаётся видимым и закреплённым внизу панели.
- Можно вставить длинный текст из буфера, textarea не пропадает, кнопка отправки остаётся доступной.
- Сообщения остаются видимыми и прокручиваемыми.
- Авто-перезагрузка не повторяется циклом; при chunk-error максимум одна автоматическая попытка, затем ручной fallback.
- Проверка Playwright + console snapshot подтверждают отсутствие нового crash/reload-loop.

10. Риски и зависимости
- Поведение экранной клавиатуры в реальном iOS Safari отличается от headless Chromium; поэтому фикс делается через более надёжную стратегию: не двигать composer visualViewport-инсетом вообще.
- Если отдельная ошибка загрузки страницы окажется не chunk-load, потребуется следующий targeted patch по конкретному stack trace.

11. Требуется дополнительная информация
- Не требуется для начала выполнения. Скриншот подтверждает мобильную проблему с composer; код уже показывает вероятную причину с `keyboardInset`.