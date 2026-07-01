да, согласен, с учетом правок:

1. Заменить ссылку в письме:
  - было: `https://gorbova.by/auth?mode=recover`
  - нужно: **персональная recovery-ссылка Supabase**, по которой пользователь сразу попадает на ввод нового пароля.
2. Для каждого email генерировать recovery-link через существующий auth/admin механизм, не через публичную страницу повторного запроса.
3. В письме написать прямо:

Здравствуйте!

Вы недавно запрашивали сброс пароля на платформе gorbova.by.

Доставка писем восстановления была исправлена. Перейдите по ссылке ниже и установите новый пароль:

[Сбросить пароль]

Ссылка действует в течение 24 часов.

Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.

Приносим извинения за неудобства.

Команда gorbova.by

4. Добавить stop-guard:
  - не отправлять письмо без валидной персональной recovery-ссылки;
  - не отправлять ссылку, если срок действия меньше 24 часов или это нельзя гарантировать;
  - не использовать magic-link для входа, только recovery/reset password flow.
5. Dry-run должен проверять не только доставку письма, но и полный сценарий:
  - ссылка открывается;
  - ведет на экран ввода нового пароля;
  - новый пароль можно сохранить;
  - после смены пароля вход работает.
6. Идемпотентность оставить:
  - `template_code = password_reset_recovery_notice_2026_07`;
  - не отправлять повторно тем, у кого уже есть `sent`.
7. Никаких новых кнопок, edge-функций, таблиц, cron и UI-дублей не создавать.
8. План и отчет — только на русском языке, с маркировкой `План:` / `Отчет о выполненной работе:`.
9. &nbsp;
10. План: разовая рассылка «сброс пароля работает» пострадавшим за последние 14 дней

Аудитория (27 уникальных email из `email_logs`, subject ~ «Сброс/Восстановление пароля»):
[1@ajoure.by](mailto:1@ajoure.by), [7500084@gmail.com](mailto:7500084@gmail.com), [a.falenta1988@gmail.com](mailto:a.falenta1988@gmail.com), [abramovich.87@inbox.ru](mailto:abramovich.87@inbox.ru), [alexasermyazhko@gmail.com](mailto:alexasermyazhko@gmail.com), [anastasiabulygo@gmail.com](mailto:anastasiabulygo@gmail.com), [anelagerasimova@gmail.com](mailto:anelagerasimova@gmail.com), [annakarpovich@outlook.com](mailto:annakarpovich@outlook.com), [annrezvaya@yandex.by](mailto:annrezvaya@yandex.by), [ip.12345@mail.ru](mailto:ip.12345@mail.ru), [irenessa@yandex.ru](mailto:irenessa@yandex.ru), [katerina5515530@gmail.com](mailto:katerina5515530@gmail.com), [katrinn-kat@mail.ru](mailto:katrinn-kat@mail.ru), [katyufka_94@mail.ru](mailto:katyufka_94@mail.ru), [lena_times@mail.ru](mailto:lena_times@mail.ru), [liza-gajduk@inbox.ru](mailto:liza-gajduk@inbox.ru), [m.v.grib@mail.ru](mailto:m.v.grib@mail.ru), [marina.pinchuk.mkp@gmail.com](mailto:marina.pinchuk.mkp@gmail.com), [natasha89k@gmail.com](mailto:natasha89k@gmail.com), [nika.1900735@mail.ru](mailto:nika.1900735@mail.ru), [ninel_dudina@mail.ru](mailto:ninel_dudina@mail.ru), [nserkevich@mail.ru](mailto:nserkevich@mail.ru), [orionna@mail.ru](mailto:orionna@mail.ru), [romashkadarden@gmail.com](mailto:romashkadarden@gmail.com), [tat.swatko@yandex.by](mailto:tat.swatko@yandex.by), [vmargalik@mail.ru](mailto:vmargalik@mail.ru), [volodik_84@mail.ru](mailto:volodik_84@mail.ru)

Канал: Email через существующий Яндекс SMTP (`noreply@gorbova.by`, edge-функция `send-yandex-smtp` / helper `yandex-smtp-sender.ts`, тот же путь, что и починенный `auth-actions`). Никаких новых интеграций.

Ссылка в письме: прямая страница восстановления `https://gorbova.by/auth?mode=recover` (пользователь сам вводит email — так безопаснее, не палим персональные recovery-токены и не создаём 27 живых magic-link'ов).

Черновик текста (subject + HTML):

- Subject: «Сброс пароля восстановлен — можно попробовать ещё раз»
- Body:
  > Здравствуйте!
  > Мы починили доставку писем восстановления пароля. Если недавно вы запрашивали сброс и письмо не пришло — оно уже не нужно, откройте страницу восстановления и запросите новую ссылку:
  > [https://gorbova.by/auth?mode=recover](https://gorbova.by/auth?mode=recover)
  > Письмо придёт в течение минуты (проверьте папку «Спам»).
  > Приносим извинения за неудобства.
  > Команда gorbova.by

Шаги (без параллели, по одному в ход, идемпотентно):

1. Diagnose — подтвердить, что используемый отправитель (`send-yandex-smtp` / `yandex-smtp-sender.ts`) жив и логирует в `email_logs`. Прочитать код helper'а, чтобы точно вызвать существующим контрактом (не создавать новую edge-функцию).
2. Plan-verify — сверить финальный список 27 адресов ещё раз перед отправкой (может добавиться свежий за время ожидания одобрения).
3. Dry-run — сгенерировать письмо на один тестовый ящик `1@ajoure.by` (наш собственный, уже в списке) через тот же helper, убедиться: `email_logs.status='sent'`, письмо реально в inbox.
4. Execute — последовательно, по одному вызову на адрес (rate-limit friendly), template_code = `password_reset_recovery_notice_2026_07`, meta `{ "campaign": "password_reset_recovery_notice_2026_07", "batch_id": <uuid> }` для идемпотентности и последующего аудита. Перед отправкой проверять, что для этого email + template_code уже нет `sent` записи в `email_logs` — не дублируем.
5. Verify — после прогона: `SELECT to_email, status FROM email_logs WHERE template_code='password_reset_recovery_notice_2026_07'` — должно быть 27 строк `sent`, 0 `failed`. Отчёт в чат со списком отправленных / провалившихся.

DoD:

- 27 писем ушли (или явно перечислены fail'ы с причиной).
- В `email_logs` есть строки с `template_code = password_reset_recovery_notice_2026_07`.
- Никаких новых таблиц, edge-функций, cron'ов, UI-компонентов не создано.
- Кампания одноразовая — cron/scheduling не заводим.

Stop-guards:

- Не рассылать, если dry-run не подтвердил доставку.
- Не расширять аудиторию за пределы согласованных 14 дней.
- Не отправлять повторно тем, у кого уже есть `sent` по этому `template_code`.

Технические детали:

- Источник аудитории: `email_logs WHERE created_at >= now() - interval '14 days' AND subject ILIKE '%сброс%|%восстанов%'` (DISTINCT to_email). Результат зафиксирован выше.
- Отправка: `supabase.functions.invoke('send-yandex-smtp', { body: { to, subject, html, template_code, meta } })` — с фактическим именем функции сверимся на шаге 1.
- Идемпотентность через проверку `email_logs` по паре (to_email, template_code).
- Никаких `admin.generateLink` / персональных recovery-токенов — ссылка публичная страница, снижает риск фишинга при пересылке.

Ничего кроме этой рассылки не трогаем.