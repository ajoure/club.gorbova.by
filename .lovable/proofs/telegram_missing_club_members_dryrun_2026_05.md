# Telegram Missing Club Members — Dry-run Report (2026-05-05)

**Mode:** read-only. Никакие queue items не создавались, telegram-grant-access не вызывался, cron не включался, telegram_club_members не менялся.

## Scope
- Active subscription (`subscriptions_v2.status='active' AND access_end_at > now()`) ИЛИ active entitlement (`entitlements.status='active' AND expires_at > now()`).
- Клубные продукты определены через `access_rules.grant_target_type='club'` → `telegram_clubs`:
  - **Gorbova Club** (`fa547c41…`) — продукты: `Gorbova Club`, `Платная консультация` (tariff `c1b4bb88…`).
  - **Бухгалтерия как бизнес** (`4f8f9d8f…`) — продукт: `Бухгалтерия как бизнес`.
- Telegram linked: `profiles.telegram_user_id IS NOT NULL AND telegram_link_status='active'` (can_dm=true для всех в выборке).
- Membership: `telegram_club_members.in_chat=false` И (channel отсутствует ИЛИ `in_channel=false`).
- Доступ ещё не истёк.

## Totals

- **Всего к re-invite:** 37 (Gorbova Club: 34, Бухгалтерия как бизнес: 2)

### По reason_bucket

- `stale_invite_sent_not_joined`: 35
- `no_invite_ever_sent`: 1
- `None`: 1

### По источнику доступа

- entitlement: 19
- subscription: 17
- None: 1

## Cohort A — Safe re-invite candidates (30)

Критерии: `no_invite_ever_sent` ИЛИ `stale_invite_sent_not_joined` с `invite_sent_at` ≥ 3 дня назад. Доступ активен, Telegram linked, can_dm=true. Никаких failed/no-effect в очереди.

| email | name | user_id | club | product | access source | expires | invite | link | membership | last queue | queue meta | bucket |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| natasha89k@gmail.com | Наталья Кажуро | `df411c24-015e-4eea-950b-1282d33efc4f` | Gorbova Club | Gorbova Club | entitlement `e5fa2647-18b1-43ef-a8ac-76de961c3b71` | 2026-05-06 20:59 | sent / 2026-04-06 08:41 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-06 08:40) | src=- intent=- | **stale_invite_sent_not_joined** |
| tatsiana0708@yandex.ru | Татьяна  Трубникова | `4870dfc5-6609-4e0c-96a9-20fbd2d05928` | Gorbova Club | Gorbova Club | entitlement `9394dbdb-130d-423c-8a7c-f702285d7589` | 2026-05-09 20:59 | sent / 2026-04-11 08:44 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-11 08:43) | src=- intent=- | **stale_invite_sent_not_joined** |
| slmmls@mail.ru | Мария Громыко | `a8b321b2-779b-42b8-a8d4-bde8ecba7dac` | Gorbova Club | Gorbova Club | entitlement `4577259d-5a0e-4eff-83e9-8554fa945905` | 2026-05-10 20:59 | sent / 2026-04-15 09:34 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-15 09:33) | src=- intent=- | **stale_invite_sent_not_joined** |
| ink2004@bk.ru | Алина Керек | `94dd8f18-fd9b-4f06-ab57-c759f1c59a3e` | Gorbova Club | Gorbova Club | entitlement `471cc18a-f17b-4385-baa4-892f5ed97a59` | 2026-05-11 20:59 | sent / 2026-04-11 17:58 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-11 17:57) | src=- intent=- | **stale_invite_sent_not_joined** |
| a5153253@yandex.by | Чаплыгина Татьяна | `baacd7a4-a99e-46f8-9de8-58e8990cdcbd` | Gorbova Club | Gorbova Club | subscription `1c621f5c-49ac-4678-b859-9fc30d9a7ee6` | 2026-05-13 20:59 | sent / 2026-04-13 11:13 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-13 11:12) | src=- intent=- | **stale_invite_sent_not_joined** |
| alexasermyazhko@gmail.com | Alexandra Sermyazhko | `f4dba33b-6afb-4360-a7ee-a94f58858ae2` | Gorbova Club | Gorbova Club | entitlement `f7f62078-a414-4329-a6c0-34829fc5b2d9` | 2026-05-16 20:59 | sent / 2026-04-16 16:16 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-16 16:15) | src=- intent=- | **stale_invite_sent_not_joined** |
| holgacher@mail.ru | Ольга Черкашина | `69e504d3-703d-4562-b200-8ed20c52e7ab` | Gorbova Club | Gorbova Club | subscription `4a08ce6f-9327-498f-84e1-0c34e06d56c3` | 2026-05-17 20:59 | sent / 2026-04-17 13:53 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-17 13:52) | src=- intent=- | **stale_invite_sent_not_joined** |
| sm_ulik@mail.ru | Юлия  Смолик | `523168b2-bada-48a1-aeae-5d032d632918` | Gorbova Club | Gorbova Club | subscription `eaeb666b-11d3-4204-bef8-bb72fca78743` | 2026-05-17 20:59 | sent / 2026-04-25 10:13 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-25 10:12) | src=- intent=- | **stale_invite_sent_not_joined** |
| katrinkap777@rambler.ru | Katerina Kaplia | `61ef2f4b-04a4-4c14-a97a-0f3a4ec51e74` | Gorbova Club | Gorbova Club | subscription `6c1dd0d1-4042-4ca4-8d3f-f91b1ac5ad41` | 2026-05-20 20:59 | sent / 2026-04-20 12:12 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-20 12:11) | src=- intent=- | **stale_invite_sent_not_joined** |
| okka1105@gmail.com | Оксана Зеленкевич | `09f6350e-12da-4478-96d2-d67e247296f3` | Gorbova Club | Gorbova Club | entitlement `7a5143f0-8124-44de-ada0-6fc6e663e499` | 2026-05-20 20:59 | sent / 2026-04-22 05:33 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-22 05:32) | src=- intent=- | **stale_invite_sent_not_joined** |
| katerina5515530@gmail.com | Катерина Рыштакова | `7c53b6af-92d0-4a8d-881f-3fe9de45dffd` | Gorbova Club | Gorbova Club | subscription `163429af-e88b-4437-a964-a7a1041f9717` | 2026-05-20 20:59 | sent / 2026-04-20 17:36 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-20 17:36) | src=- intent=- | **stale_invite_sent_not_joined** |
| w7032341@mail.ru | Юлия Соваськова | `038a3667-be23-45fa-9b3e-e92c678e8bde` | Gorbova Club | Gorbova Club | entitlement `9ce31619-8277-45e7-8b6a-2065208d2bac` | 2026-05-21 20:59 | sent / 2026-04-21 06:45 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-21 06:44) | src=- intent=- | **stale_invite_sent_not_joined** |
| shkurenochek@mail.ru | Татьяна Железовская | `17516f27-2d1d-461c-a2e2-d214a6c1d8e6` | Gorbova Club | Gorbova Club | entitlement `0fb3b786-a5eb-49ae-b511-9688481b74de` | 2026-05-22 20:59 | sent / 2026-04-22 13:16 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-22 13:15) | src=- intent=- | **stale_invite_sent_not_joined** |
| ir.leshchinskaya@gmail.com | Ирина Лещинская | `6748c3bc-0891-4d9a-97f9-cdd183389658` | Gorbova Club | Gorbova Club | entitlement `f4a9513b-fdf6-4ede-ada9-1696c877be48` | 2026-05-22 20:59 | sent / 2026-04-22 13:49 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-22 13:48) | src=- intent=- | **stale_invite_sent_not_joined** |
| ghom1721@gmail.com | Алеся Хомич | `89a35c48-6ed9-4ccf-8f73-4690a47d510f` | Gorbova Club | Gorbova Club | entitlement `3b03a997-152d-49da-8c12-cc5aa469758e` | 2026-05-22 22:00 | sent / 2026-04-24 11:26 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-24 11:25) | src=- intent=- | **stale_invite_sent_not_joined** |
| 7575557@list.ru | Валерия Латушкина | `2b69ecf2-4acd-4a50-9235-fd3e25a79684` | Gorbova Club | Gorbova Club | subscription `98e9a2f3-c565-40fd-b404-d94196b7e701` | 2026-05-24 20:59 | sent / 2026-04-26 05:24 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-26 05:23) | src=- intent=- | **stale_invite_sent_not_joined** |
| 2.lady.di.only@gmail.com | Новородская Диана | `4b22714f-a57c-4606-a0e2-1a8ac80b68e6` | Gorbova Club | Gorbova Club | subscription `e1f30324-3b24-43c8-afea-0fb002451a1f` | 2026-05-25 20:59 | sent / 2026-04-25 03:03 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-25 03:02) | src=- intent=- | **stale_invite_sent_not_joined** |
| vmargalik@mail.ru | Виктория Маргалик | `7329990d-8ed6-4cc5-91ca-b6b6a92cb087` | Gorbova Club | Gorbova Club | subscription `13844454-5d7b-4bc6-a055-8a77ca9a7503` | 2026-05-25 20:59 | sent / 2026-04-25 03:02 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-25 03:01) | src=- intent=- | **stale_invite_sent_not_joined** |
| nasstasia2015@gmail.com | Anasstasia Stankevich | `41bdb289-12d3-4ae4-94f6-8c5109ae8ee7` | Gorbova Club | Gorbova Club | subscription `9d897d4f-6e26-4bd7-a58c-4ce35e0437a0` | 2026-05-26 20:59 | sent / 2026-04-26 08:07 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-26 08:06) | src=- intent=- | **stale_invite_sent_not_joined** |
| volodik_84@mail.ru | Юлия Лялина | `2c8ffa9e-6d40-4dc8-b5aa-30a8fc7afec1` | Gorbova Club | Gorbova Club | entitlement `46926ecc-18c4-41b9-9d12-784526c7cba4` | 2026-05-26 20:59 | sent / 2026-04-26 04:54 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-26 04:53) | src=- intent=- | **stale_invite_sent_not_joined** |
| olesiko105@mail.ru | Олеся Волынец | `01450527-4020-4f1e-b31e-28fb9d07b27f` | Gorbova Club | Gorbova Club | entitlement `36cedda8-c7c0-4f1a-aacf-f2eacf735dea` | 2026-05-26 20:59 | sent / 2026-04-26 13:46 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-26 13:45) | src=- intent=- | **stale_invite_sent_not_joined** |
| 1@ajoure.by | Тест Тестовый | `37e91f59-e4db-4840-b9c9-e760e634ddd1` | Gorbova Club | Gorbova Club | subscription `be7fe667-7ec0-4257-9044-ba888e2926f9` | 2026-05-26 22:00 | sent / 2026-04-23 11:57 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-23 11:56) | src=- intent=- | **stale_invite_sent_not_joined** |
| vishnia81@mail.ru | Наталья В | `c19f3b8f-4305-4d8c-a2b5-24f1b5e292e0` | Gorbova Club | Gorbova Club | entitlement `6092082e-46bc-4b63-9360-946d01184f97` | 2026-05-27 20:59 | sent / 2026-04-30 11:09 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-27 05:15) | src=- intent=- | **stale_invite_sent_not_joined** |
| olga.yushchuk@gmail.com | Ольга Синяк | `44985cf1-9914-4447-ada7-53f37c2456f7` | Gorbova Club | Gorbova Club | subscription `d74b7dbb-b2ca-4ae7-ae7c-f3e2b659aafd` | 2026-05-27 20:59 | sent / 2026-04-27 04:34 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-27 04:33) | src=- intent=- | **stale_invite_sent_not_joined** |
| makarevich.polina18@gmail.com | Полина Макаревич | `7a019b41-6193-4091-8cc3-f9b071e61976` | Gorbova Club | Gorbova Club | subscription `ccc67f24-dd58-466f-ab51-664441eec8c5` | 2026-05-29 20:59 | sent / 2026-04-29 08:02 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-29 08:01) | src=- intent=- | **stale_invite_sent_not_joined** |
| vsl83@rambler.ru | Светлана Василевская | `56de61af-3e13-4ab9-b492-8287a3d3cd21` | Gorbova Club | Gorbova Club | subscription `efaeed28-91a3-4eb4-ab95-1e0bfa3efc7d` | 2026-05-29 20:59 | sent / 2026-04-29 07:07 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-29 07:06) | src=- intent=- | **stale_invite_sent_not_joined** |
| pbourdon@tut.by | Юлия  Бурдон | `acd9116c-528f-44c9-9af2-cfe2ba804386` | Gorbova Club | Gorbova Club | subscription `6d123c1b-86ed-4a6c-a447-f9f2a4dd2aff` | 2026-05-31 20:59 | - / - | link=f | chat= ch= | completed/grant attempts=1 `-` (2026-04-01 10:35) | src=- intent=- | **no_invite_ever_sent** |
| lori-30@tut.by | Лариса Конобеева | `e748983f-8409-49b6-b5f5-88a7c95920b0` | Gorbova Club | Gorbova Club | entitlement `53a0616a-21e5-46fe-bce8-1555eec594e3` | 2026-06-12 12:00 | sent / 2026-04-23 11:31 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-14 03:00) | src=- intent=- | **stale_invite_sent_not_joined** |
| kaplin@tut.by | Ксения Довыденко | `13c5a43d-a933-4155-88d6-97a9cf109319` | Gorbova Club | Gorbova Club | entitlement `c7356351-76a3-460d-a3f9-742f91026542` | 2026-06-18 12:00 | sent / 2026-04-17 21:13 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-17 21:12) | src=- intent=- | **stale_invite_sent_not_joined** |
| iryna.troinich@gmail.com | Ирина Тройнич | `bddef8eb-170f-44b6-94a2-8a28a7d0fe9d` | Бухгалтерия как бизнес | Бухгалтерия как бизнес | entitlement `ea45ac55-cfe7-4d1d-8395-011c04614165` | 2026-05-31 20:59 | sent / 2026-05-01 10:54 | link=t | chat=f ch=t | completed/grant attempts=1 `-` (2026-03-30 16:15) | src=- intent=- | **stale_invite_sent_not_joined** |

## Cohort B — Manual review (7)

Критерий: invite отправлен < 3 дней назад (пользователь ещё мог не успеть перейти) ИЛИ запись из failed/no-effect/unknown bucket.

| email | name | user_id | club | product | access source | expires | invite | link | membership | last queue | queue meta | bucket |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| (36 rows) | None | `None` | None | None | None `None` | None | - / - | link=None | chat=None ch=None | -/- attempts=- `-` (-) | src=- intent=- | **None** |
| nika.1900735@mail.ru | Вероника Матук | `341e6f46-79dd-4920-b500-da78e3574aab` | Gorbova Club | Gorbova Club | subscription `22576f44-0921-433d-95b3-ae58c9c57522` | 2026-05-11 12:19 | sent / 2026-05-05 08:37 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-05-05 08:37) | src=repair intent=manual_repair | **stale_invite_sent_not_joined** |
| 790375111@mail.ru | Анастасия Жарко | `4a94ab96-4a10-48ef-9e7b-3737e9430dbc` | Gorbova Club | Gorbova Club | entitlement `6dd012ba-03b8-4565-843a-ea7ace37812c` | 2026-06-02 20:59 | sent / 2026-05-04 04:18 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-29 13:39) | src=- intent=- | **stale_invite_sent_not_joined** |
| jkryshtopik@mail.ru | Криштопик Юлия | `d8127155-5ed3-42df-ac10-e4348b5ff641` | Gorbova Club | Gorbova Club | subscription `17a39859-4602-4138-8b8c-00b82d63686f` | 2026-06-02 20:59 | sent / 2026-05-04 08:14 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-05 15:15) | src=- intent=- | **stale_invite_sent_not_joined** |
| sar8@mail.ru | Татьяна Ефимчик | `7d773d71-70de-44e1-899c-cbeaa8686c30` | Gorbova Club | Gorbova Club | subscription `09ee2e16-303e-4698-8d0b-b9a119a00fe4` | 2026-06-02 20:59 | sent / 2026-05-04 04:18 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-03 15:15) | src=- intent=- | **stale_invite_sent_not_joined** |
| yuliyakisileva@yandex.ru | Юлия Киселева | `a33beb82-baae-4a7e-bc77-dcb31a63012d` | Gorbova Club | Gorbova Club | entitlement `061be89e-12df-4952-90a7-d0b77b3ed835` | 2026-07-04 12:00 | sent / 2026-05-05 07:23 | link=t | chat=f ch=f | completed/grant attempts=1 `-` (2026-04-07 11:57) | src=- intent=- | **stale_invite_sent_not_joined** |
| iris.fess2020@gmail.com | Ирина Добровольская | `6b6001fd-6800-429a-ab60-d3dd37e18726` | Бухгалтерия как бизнес | Бухгалтерия как бизнес | entitlement `1d86a4dc-6d2b-4e85-801e-b01dc18547e3` | 2026-07-03 20:59 | sent / 2026-05-04 06:17 | link=t | chat=f ch=t | completed/grant attempts=1 `-` (2026-04-03 12:02) | src=- intent=- | **stale_invite_sent_not_joined** |

## Excluded / Staff

- `1@ajoure.by` (Тест Тестовый, `37e91f59…`) — внутренний тестовый аккаунт. Технически попадает в Cohort A, но из массового re-invite его лучше исключить.
- Иных staff-исключений в выборке не обнаружено.

## Veronika sanity check

- `nika.1900735@mail.ru` (Вероника Матук, `341e6f46…`) — ей 2026-05-05 08:37 был отправлен новый invite через `MANUAL_REPAIR_REINVITE` (queue source=`repair`, intent=`manual_repair`, force_new_invite=true). Сейчас invite_status=sent, in_chat=false. Это ожидаемо — < 3 дней с последнего invite. Попадает в **Cohort B (manual review)**, повторный re-invite сейчас не нужен.

## Notes / observations

- Ни одной записи с `failed_grant_unrecovered` или `completed_without_effect` — после фикса процессора (effect-check guard) такие случаи будут видны явно.
- 1 запись с `no_invite_ever_sent` — Юлия Бурдон (`pbourdon@tut.by`): queue completed 2026-04-01, но invite_link так и не был сохранён в `telegram_club_members`. Это legacy-кейс ровно того же класса, что был у Вероники.
- У всех остальных 35 пользователей очередь показывает `completed/grant attempts=1 last_error=NULL` — стандартный legacy auto-grant, инвайт сохранён, но пользователь по нему не перешёл.

## Recommendation (apply only after explicit approve)

- **Cohort A (30 чел.)** — безопасны для bulk re-invite через canonical `telegram_access_queue` с `meta.source='reinvite'`. Если duplicate-DM-guard блокирует (как было у Вероники) — использовать `meta.source='repair'` + `intent='manual_repair'` + `force_new_invite=true`.
- **Cohort B (7 чел.)** — отложить минимум на 72 часа после `invite_sent_at` или связаться индивидуально.
- Тестовый аккаунт `1@ajoure.by` исключить из bulk.
- Никаких действий не выполнять до отдельного approve на bulk repair.
