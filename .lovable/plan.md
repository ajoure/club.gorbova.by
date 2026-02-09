
PATCH-лист P0.9.8a (7 пунктов)
	1.	DEPLOY Edge Functions (обязательный): задеплоить обновлённые:
	•	telegram-grant-access (вставка в telegram_invite_links)
	•	telegram-webhook (обработка chat_member)
	•	telegram-bot-actions (action update_webhook)
	•	telegram-club-members (action reinvite_ghosts)
	•	telegram-reinvite-ghosts (новая cron-функция)
	2.	Webhook allowed_updates: сразу после деплоя вызвать telegram-bot-actions → update_webhook для активного бота.
DoD: getWebhookInfo.allowed_updates содержит chat_member.
	3.	pg_cron register: создать cron-job на telegram-reinvite-ghosts каждые 6 часов.
DoD: запись в cron.job + успешный запуск (audit/log).
	4.	Data-fix: неправильный доступ в “Бухгалтерия как бизнес”: 5 пользователей имеют access_status=ok, но нет подписки/entitlement на buh_business, только на Gorbova Club.
Действие: поставить им access_status='no_access' (или needs_review) в клубе Бухгалтерии + зааудитить как wrong_club_patch_p098a.
DoD: SQL-пруф: 0 строк “ok без права” для club_id Бухгалтерии.
	5.	Нина Осипик: invite_sent_at=NULL при активном entitlement club.
Действие: поставить в очередь telegram_access_queue action=‘grant’ (или вручную вызвать grant) для её user_id.
DoD: invite_sent_at стал не null и появилась запись в telegram_invite_links.
	6.	Smoke-test: отправить инвайт тест-юзеру, зайти по нему.
DoD: telegram_invite_links.status='used', used_by_telegram_user_id заполнен, telegram_club_members.verified_in_chat_at заполнен.
	7.	Проверка “пустой таблицы”: после первого реального grant/reinvite telegram_invite_links.count(*) > 0.
DoD: SQL-пруф.

⸻

Копируемый блок для Lovable (вставляй как есть)

# PATCH P0.9.8a — Deploy + Webhook chat_member + Cron + Wrong-club data-fix

## Жёсткие правила исполнения
1) Ничего не ломать и не трогать лишнее
2) Add-only где возможно, минимальный diff
3) Dry-run → execute для массовых действий
4) STOP-guards обязательны (лимиты, батчи, rate-limit)
5) No-PII в логах (особенно invite_link URL)
6) DoD только по фактам: SQL + UI-скрин + audit_logs/telegram_access_audit

## Факты из диагностики
- telegram_invite_links = 0 rows → записи не пишутся (функции не задеплоены/не триггерились)
- webhook не принимает chat_member → verified_in_chat_at всегда NULL
- cron telegram-reinvite-ghosts не зарегистрирован в pg_cron
- 5 пользователей имеют access_status=ok в клубе “Бухгалтерия как бизнес”, но НЕ имеют подписки/entitlement на buh_business (только Gorbova Club) → неверная выдача доступа
- Нина Осипик: invite_sent_at=NULL при активном entitlement club → ссылка никогда не отправлялась

## A) Deploy Edge Functions (обязательное)
Deploy:
- telegram-grant-access (writes telegram_invite_links)
- telegram-webhook (handles chat_member updates)
- telegram-bot-actions (action update_webhook)
- telegram-club-members (action reinvite_ghosts)
- telegram-reinvite-ghosts (new cron function)

## B) Webhook allowed_updates
После deploy вызвать telegram-bot-actions:
- action=update_webhook
- bot_id = активный бот
Цель: allowed_updates включает ["message","chat_member","my_chat_member","chat_join_request"]
DoD: getWebhookInfo показывает chat_member в allowed_updates.

## C) Register pg_cron for telegram-reinvite-ghosts
Создать cron-job каждые 6 часов (0 */6 * * *).
DoD: запись в cron.job + лог/аудит выполнения.

## D) Data-fix: wrong club access (Бухгалтерия)
Найти и исправить 5 пользователей (emails):
- 447417148@mail.ru
- finassist.by@gmail.com
- kazachoknbuh@gmail.com
- meryloiko@gmail.com
- silvia_r@mail.ru

Критерий: club_id = (Бухгалтерия), telegram_club_members.access_status='ok', но has_buh_sub=false AND has_buh_entitlement=false AND no manual access.
Действие:
- set access_status='no_access' (или 'needs_review') + audit action 'wrong_club_patch_p098a'
- НЕ кикать автоматически из Telegram, только исправить внутренний статус + пометка, дальше решим отдельно.
DoD: SQL: 0 строк “ok without buh access” для club_id Бухгалтерии.

## E) Нина Осипик — отправить ссылку
Если entitlement club active, но invite_sent_at is NULL:
- enqueue telegram_access_queue action='grant' for her user_id (source='patch_p098a')
DoD: invite_sent_at заполнен, telegram_invite_links получил новую запись.

## F) Smoke test
1) Выполнить grant тестовому TG пользователю
2) Пользователь входит по ссылке
DoD:
- telegram_invite_links.status='used', used_by_telegram_user_id заполнен
- telegram_club_members.in_chat=true и verified_in_chat_at not null
- audit_logs/telegram_access_audit содержит JOIN_VERIFIED

## Final DoD checklist
1) telegram_invite_links.count(*) > 0
2) allowed_updates включает chat_member (getWebhookInfo)
3) cron job существует в cron.job и отрабатывает
4) 5 wrong-club записей исправлены (SQL proof)
5) Нина получила invite (invite_sent_at not null + invite_links row)


⸻

Важное уточнение по твоему плану (чтобы не словить очередной “сюрприз”)
	•	Если бот не может писать юзеру в ЛС (юзер не стартовал бота или заблокировал), то reinvite через DM будет падать. Это должно помечаться в invite_status/invite_error, иначе ты опять будешь видеть “sent”, а по факту “не доставлено”.

