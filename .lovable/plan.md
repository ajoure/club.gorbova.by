да, согласен, с учетом правок:

1. Перед удалением сделать один discovery-проход и приложить список фактически найденных артефактов по маскам: instagram-pilot-send, pilot-, instagram-pilot, proof-. Не удалять по предположению.
2. В cleanup добавить не только файлы в репо, но и **storage-артефакты**:
  - объекты в bucket telegram-media с префиксом instagram-pilot/
  - только если они реально существуют
  - с proof списком удалённых путей
3. Добавить **DB-check** после cleanup:
  - нет ли instagram_[messages.media](http://messages.media)_url / raw_payload / логов, ссылающихся на instagram-pilot или pilot-URL
  - если такие записи есть, не удалять вслепую, а показать отдельно как residual list
4. В Verify добавить поиск остаточных ссылок по коду:
  - rg -n "instagram-pilot-send|pilot-|instagram-pilot|proof-" supabase src public
  - результат должен быть пустой, кроме исторических миграций/отчётов, если они сознательно сохраняются
5. В шаги исполнения добавить порядок:
  - discovery
  - удаление ссылок из UI/импортов/конфига
  - удаление файлов из репо
  - удаление storage-объектов
  - удаление deployed edge function
  - финальный grep + smoke-check Inbox
6. В финальном отчёте отдельно показать:
  - что удалено из репо
  - что удалено из storage
  - что удалено из deploy
  - что сознательно оставлено и почему
7. Не удалять production-proof и исторические миграции. Если есть pilot SQL/data-fix, сначала явно классифицировать: temporary artifact или исторический след спринта.

&nbsp;

## План: Cleanup временных pilot-артефактов

### Что удалить

**1. Временные pilot-функции и UI:**

- `supabase/functions/instagram-pilot-send/` — временная функция для тестового outbound
- `src/components/admin/communication/instagram/InstagramPilotPanel.tsx` (если есть) — UI для pilot-отправки
- Любые упоминания pilot-кнопок/панелей в `ContactInstagramChat.tsx` / `InstagramInboxView.tsx`

**2. Временные pilot-ассеты:**

- `public/pilot-*.png` / `public/pilot-*.mp4` / `public/pilot-*.pdf` — тестовые файлы, которые гонялись через outbound

**3. Конфиг:**

- Запись `[functions.instagram-pilot-send]` из `supabase/config.toml`

**4. Деплой:**

- Вызвать `supabase--delete_edge_functions` для `instagram-pilot-send`, чтобы удалить из развёрнутого окружения

### Что НЕ трогать

- `instagram-media-proxy` — production, остаётся
- `instagram-webhook` / `instagram-admin-chat` — production
- `telegram-media` bucket и его RLS — production transport
- migrations (backfill `media_type`) — историчны, не откатываем
- любые ApiX-Drive/Telegram пути

### Verify (DoD)

- В `supabase/functions/` нет директории `instagram-pilot-send`
- В `supabase/config.toml` нет блока `[functions.instagram-pilot-send]`
- В `public/` нет файлов `pilot-*`
- В `src/components/admin/communication/instagram/` нет компонентов с `Pilot` в имени
- Inbox UI грузится без ошибок, inbound/outbound media продолжают работать
- `supabase--delete_edge_functions(["instagram-pilot-send"])` отработала успешно

### Шаги исполнения

1. Прочитать актуальное содержимое директории `supabase/functions/`, `public/`, `src/components/admin/communication/instagram/` чтобы зафиксировать точный список pilot-артефактов
2. Удалить файлы (через перезапись пустыми не подойдёт — использовать прямое удаление через системные инструменты в default mode)
3. Убрать блок из `supabase/config.toml`
4. Вызвать `supabase--delete_edge_functions`
5. Дать короткий отчёт со списком удалённого