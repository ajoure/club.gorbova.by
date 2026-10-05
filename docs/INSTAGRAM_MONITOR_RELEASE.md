# Мониторинг Instagram — контракт реализации и приёмки

## Цель

Отдельный раздел `/admin/instagram-monitor`: публичные профили Катерины и
конкурентов, Reels, локально сохранённые видео, дословная расшифровка через
существующий Lovable Gemini helper, комментарии и CSV. Права — отдельная
секция RBAC v3, без предоставления доступа ученикам или обычным сотрудникам.

## Подтверждённый пилот 05.10.2026

- Аккаунт `katerina.gorbova`, официальный Apify Reel Actor.
- Первый запуск `1kJneDGHIlu27zcU8`: два результата, стоимость $0.006.
- Запуск с копией видео `PeZYge0dPiAr7P4YL`: один результат с MP4,
  стоимость $0.184; лимит результата/расходов прервал остальной сбор.
- Comments Actor `Hg5ZxA1Yie1AmhpF8`: 21 комментарий (15 + 6), $0.055.
- Бесплатный Comments Actor ограничен 15 последними комментариями на пост.
- Gemini на этой записи ещё не проверен. Наличие MP4 не доказывает транскрибацию.

## Архитектура

1. `instagram-monitor` — серверный административный API: статус, профили,
   настройки безопасных лимитов, запуск, история, результаты, экспорт,
   временная приватная ссылка видео и ручной повтор транскрибации.
2. `instagram-monitor-worker` — очередь с короткими тиками. Запустить Actor,
   сохранить provider run ID, позднее опросить; не держать HTTP до окончания
   Apify. Импорт, копирование MP4 в приватный Storage, отдельная Gemini-задача.
3. Канонический `transcribeAndSummarize` из `_shared/transcribe-audio.ts`;
   никакого OpenAI ключа и параллельной реализации транскрибации.
4. Новые `instagram_monitor_*` таблицы относятся к сбору публичного контента.
   Existing `instagram_accounts/messages/contacts` относятся к Direct и
   остаются без изменений. Секрет `APIFY_API_TOKEN` хранится в managed secrets.
5. Cron использует существующий проверенный серверный механизм авторизации;
   никогда не открывать worker по anon JWT. Проверить на Lovable plan-only.

## Бесплатный режим

- Максимум $0.25 за provider run, общий месячный резерв не выше $4.
- Одновременно один активный сбор; не более двух новых Reels за профиль.
- Не более 15 комментариев/ролик, coverage=partial, не заявлять «все».
- Первичный планировщик выключен до E2E; затем разрешено ограниченное
  расписание для одного аккаунта. До повышения лимитов не менять тариф.
- Резервировать бюджет в транзакции ДО HTTP. Таймаут создания provider run
  означает UNKNOWN и сохраняет резерв, не запускает повторный платный run.
- Транскрибация расходует отдельный AI кредит Lovable: показать это в UI.
- Не повторять скачивание/AI для уже обработанного shortcode. Comments
  дедуплицируются по provider comment ID. Хранить исходный пост у каждой строки.

## Безопасность и устойчивость

- RLS и явные grants; сервер проверяет RBAC перед каждым действием.
- Резерв бюджета, эксклюзивный claim/lease, retry policy, UNKNOWN и stale job
  recovery должны быть проверены контрактными тестами.
- URL allowlist, redirect validation, ограничение тела, duration и таймаут.
- Raw provider JSON и подписанные CDN URL не выводить, не сохранять в БД.
- Видео в приватном bucket, сервер выдаёт URL только после проверки прав.
- Ошибки клиенту без секретов/provider URL; CSV защищён от formula injection.
- Caption/comments — данные, не инструкции для Gemini. AI идеи отделять от
  дословной расшифровки, ничего автоматически не публиковать в Instagram.

## Release gate

Lovable plan-only → одна консолидированная ревизия → GitHub PR/checks →
merged SHA → managed миграция/functions/secrets → read-back/RLS/runtime
→ Publish → опубликованные desktop + mobile скриншоты и проверка сценария.

Реальная проверка: профиль → bounded run → MP4 в Storage → Gemini полный
текст → комментарии с coverage → CSV → повторный импорт без дубликатов.
Проверить anonymous/student отказ, stale lease, provider failure, бюджет,
навигацию меню, длинные русские тексты, ошибки и пустое состояние на mobile.

## PLAN-ONLY и ревизия Codex — 05.10.2026

Lovable подтвердил Cloud ref hdjgkjceownmmnrqqtuz; существующий Gemini key,
отсутствие APIFY key и monitor schema. Проверка не меняла production данные.
Режим Plan автоматически записал `.lovable/plan.md` в GitHub: этот служебный
побочный эффект восстанавливается в PR до исходного текста.

Корректировки к предложению Lovable:
- Не хранить raw provider JSON/подписанные media URL.
- Резерв остаётся до реального terminal usageTotalUsd; получение run ID ещё
  не подтверждает окончательную стоимость. UNKNOWN переносится через месяц.
- Gemini использует отдельные кредиты: после прерванного AI запроса только
  ручной повтор, без автоматических затрат и обещаний бесплатного Gemini.
- Один worker объединяет cron/tick; отдельный instagram-monitor API совпадает
  с UI контрактом. Таблицы settings/profiles/reels/comments/runs (5).
- Доступ наследует существующий admin/super_admin bypass RBAC v3; другие роли
  не получают нового grant автоматически. Нет новых Storage policies.
- До 2 роликов; первый enabled профиль для daily pilot. Общий cap $4 включает
  три проверенных исходных Apify запуска ($0.245). Auto-monitor по умолчанию off.
- Gateway input_audio mp4 — обязательный реальный acceptance до Publish.

## Проверки

- Browser application types, сборка и ESLint страницы — PASS.
- Deno check API/worker — PASS; 9 медиа/provider security tests — PASS.
- `node scripts/tests/instagram-monitor-db.mjs`: исполняет реальную миграцию
  в локальном PostgreSQL/PGlite с фикстурами только внешних auth/Vault/cron/net.
  Проверяет idempotency, exclusive lease, fencing, stale start UNKNOWN,
  месячный cap, rollover UNKNOWN, RLS anon/student/admin, private bucket и RPC
  grants. Это локальный контракт, не production E2E.

## Не выполненные release gates

APIFY_API_TOKEN через защищённый managed secret; GitHub checks/merge;
точный SHA sync; managed migration и обе functions; реальный Gemini/E2E;
Publish и две опубликованные UI проверки. До этого сервис не объявляется
работающим в production.

## Общая метка серверного пакета

CI вычисляет CB21 release digest по всему `_shared`, поэтому новые helper и
необязательный reel/timeout режим существующей транскрибации требуют обновления
метки. Для согласованного runtime read-back дополнительно пересобрать без
изменения конфигурации, очередей или отправок ровно `sales-runtime-worker`,
`sales-runtime-control`, `telegram-webhook`, `telegram-media-worker`; их
защищённые health probes должны вернуть новый digest. Никаких реальных
сообщений для smoke. Это обязательная зависимость release, не новая CRM задача.
