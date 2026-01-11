-- Сначала добавляем unique constraint на email для использования ON CONFLICT
-- Проверяем дубликаты и удаляем NULL email перед добавлением constraint
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique_idx ON profiles(email) WHERE email IS NOT NULL;

-- Теперь импортируем контакты: обновляем существующий профиль Пигашевой Ирины
UPDATE profiles SET
  phone = COALESCE(phone, '+375295305868'),
  telegram_username = COALESCE(telegram_username, '@irinapigasheva'),
  position = COALESCE(position, 'Главный бухгалтер'),
  was_club_member = true,
  updated_at = now()
WHERE email = 'irka13051989@mail.ru';

-- Вставляем новые архивные профили (только если email не существует)
INSERT INTO profiles (email, phone, telegram_username, full_name, first_name, last_name, position, was_club_member, status, created_at, updated_at)
SELECT * FROM (VALUES
  ('volhapp@gmail.com', '+375296561108', NULL, 'Корзун Ольга', 'Ольга', 'Корзун', NULL, false, 'archived', now(), now()),
  ('dkamenskij2404@gmail.com', '+375296875785', NULL, 'Каменский Дмитрий', 'Дмитрий', 'Каменский', NULL, false, 'archived', now(), now()),
  ('julia_ignatovich@mail.ru', '+375292759696', NULL, 'Игнатович Юлия', 'Юлия', 'Игнатович', NULL, false, 'archived', now(), now()),
  ('diamond-1996@mail.ru', '+375293120240', NULL, 'Виктория', 'Виктория', NULL, NULL, false, 'archived', now(), now()),
  ('anna90fedorova@mail.ru', '+375445229428', NULL, 'Федорова Анна', 'Анна', 'Федорова', NULL, false, 'archived', now(), now()),
  ('nayasuslova@gmail.com', '+375293264150', NULL, 'Малиновская Анастасия', 'Анастасия', 'Малиновская', NULL, false, 'archived', now(), now()),
  ('halynina@icloud.com', '+375447098090', '@ilonasuperwoman', 'Галынина Илона', 'Илона', 'Галынина', 'Предприниматель', true, 'archived', now(), now()),
  ('juli.lip@mail.ru', '+375445711547', NULL, 'Полукашко Юлия', 'Юлия', 'Полукашко', 'Бухгалтер', true, 'archived', now(), now()),
  ('rizevskaya@mail.ru', '+375447529257', NULL, 'Ризевская Наталья', 'Наталья', 'Ризевская', NULL, true, 'archived', now(), now()),
  ('matarasik@gmail.com', '+375447845159', NULL, 'Матарас Анна', 'Анна', 'Матарас', 'ИП', true, 'archived', now(), now()),
  ('sonocontenta36@mail.ru', '+375296869816', NULL, 'Климович Светлана', 'Светлана', 'Климович', NULL, true, 'archived', now(), now()),
  ('copybook479@gmail.com', '+375259164688', NULL, 'Вита Раевская', 'Вита', 'Раевская', NULL, true, 'archived', now(), now()),
  ('chakanat@gmail.com', '+375296532158', NULL, 'Чака Наталья Анатольевна', 'Наталья', 'Чака', NULL, true, 'archived', now(), now()),
  ('overchenko.lina@mail.ru', '+375336132927', '@angelina_overchenko', 'Залевская Ангелина', 'Ангелина', 'Залевская', 'Бухгалтер', true, 'archived', now(), now()),
  ('chirkovskaya_julia@mail.ru', '+375297676131', NULL, 'Чирковская Юлия Михайловна', 'Юлия', 'Чирковская', NULL, true, 'archived', now(), now()),
  ('matilda555@tut.by', '+375333279925', '@Olgaparibok', 'Ясевич Ольга', 'Ольга', 'Ясевич', NULL, true, 'archived', now(), now()),
  ('marina777@tut.by', '+375296169870', '@marina__kireeva', 'Киреева Марина Николаевна', 'Марина', 'Киреева', 'Бухгалтер', true, 'archived', now(), now()),
  ('bse98@tut.by', '+375291091375', '@elusive_sviat', 'Баранов Святослав', 'Святослав', 'Баранов', 'Специалист по защите ПД', true, 'archived', now(), now()),
  ('murena_m@mail.ru', '+375293079006', NULL, 'Прохоренко Марина', 'Марина', 'Прохоренко', NULL, true, 'archived', now(), now()),
  ('48918092@mail.ru', '+375297393880', '@Natallia_Neudakh', 'Невдах Наталья Васильевна', 'Наталья', 'Невдах', NULL, true, 'archived', now(), now()),
  ('nastya.pahitonova@yandex.by', '+375292453546', '@anastasiya_molotok', 'Молоток Анастасия Олеговна', 'Анастасия', 'Молоток', 'Главный бухгалтер', true, 'archived', now(), now()),
  ('nadja_chembrovich@tut.by', '+375291737348', NULL, 'Надежда Ермак', 'Надежда', 'Ермак', NULL, true, 'archived', now(), now()),
  ('tanya_zel@tut.by', '+375296217488', '@tatianazelionenkaya', 'Зелененькая Татьяна', 'Татьяна', 'Зелененькая', 'Главный бухгалтер', true, 'archived', now(), now()),
  ('dudinanl80@gmail.com', '+375293545388', '@natalia_dudina80', 'Дудина Наталья', 'Наталья', 'Дудина', 'Бухгалтер', true, 'archived', now(), now()),
  ('mar.li@mail.ru', '+375296252505', '@MarinaKoleichik', 'Колейчик Марина', 'Марина', 'Колейчик', 'Главный бухгалтер', true, 'archived', now(), now()),
  ('eleonmarina-petushkova@yandex.by', '+375297418502', '@marinakrasot', 'Петушкова Марина', 'Марина', 'Петушкова', 'Предприниматель', true, 'archived', now(), now()),
  ('shefska@gmail.com', '+375297501777', '@valentarina', 'Хрущёва Валентина', 'Валентина', 'Хрущёва', 'Главный бухгалтер', true, 'archived', now(), now()),
  ('375447190463@mail.ru', '+375447190463', '@yulka07031988', 'Щучко Юлия', 'Юлия', 'Щучко', 'Бухгалтер', true, 'archived', now(), now()),
  ('redevbuh@gmail.com', '+375257588936', NULL, 'Редевская Ирина', 'Ирина', 'Редевская', 'Бухгалтер', true, 'archived', now(), now()),
  ('chmeltatka@gmail.com', '+375297508101', '@chmeltatka', 'Гришина Татьяна', 'Татьяна', 'Гришина', 'Бухгалтер', true, 'archived', now(), now()),
  ('katrinn-kat@mail.ru', '+375297756162', '@Katerina_Ga', 'Галай Екатерина', 'Екатерина', 'Галай', 'Найм', true, 'archived', now(), now()),
  ('nasya_fox111@mail.ru', '+375336776605', NULL, 'Гончарова Анастасия', 'Анастасия', 'Гончарова', NULL, true, 'archived', now(), now()),
  ('katushap31@rambler.ru', '+375296410017', '@ekaterina_nikolaichik', 'Николайчик Екатерина', 'Екатерина', 'Николайчик', 'Бухгалтер', true, 'archived', now(), now()),
  ('k-amely@yandex.ru', '+375298931764', '@k_amely2014', 'Зельская Виталия', 'Виталия', 'Зельская', 'Бухгалтер', true, 'archived', now(), now()),
  ('mila-milanka@mail.ru', '+375296970405', '@milamilanka7', 'Демко Людмила', 'Людмила', 'Демко', 'Бухгалтер', true, 'archived', now(), now()),
  ('ssmmff@bk.ru', '+375298212240', '@svet_lanamonich', 'Монич Светлана Фёдоровна', 'Светлана', 'Монич', 'Зам. главного бухгалтера', true, 'archived', now(), now()),
  ('tatshov23@gmail.com', '+375445724231', NULL, 'Шовская Таня', 'Таня', 'Шовская', 'Бухгалтер', true, 'archived', now(), now()),
  ('alejnikovajulja@mail.ru', '+375293778764', '@yulianushechka', 'Алейникова Юлия', 'Юлия', 'Алейникова', 'Бухгалтер по оплате труда', true, 'archived', now(), now()),
  ('kaplin@tut.by', '+375445913144', '@dovydenko_ksusha', 'Довыденко Ксения', 'Ксения', 'Довыденко', 'Заместитель директора', true, 'archived', now(), now()),
  ('bunchuk.nastya@yandex.by', '+375292699562', NULL, 'Кита Анастасия', 'Анастасия', 'Кита', 'Директор', true, 'archived', now(), now()),
  ('demonessa@tut.by', '+375295217636', '@natashenka_lol', 'Кожемяко Наталья', 'Наталья', 'Кожемяко', 'Бухгалтер', true, 'archived', now(), now()),
  ('natalya_lis92@mail.ru', '+375297801356', NULL, 'Кунцевич Наталья', 'Наталья', 'Кунцевич', NULL, true, 'archived', now(), now()),
  ('jaromna@mail.ru', '+375296212337', NULL, 'Яромич Наталья', 'Наталья', 'Яромич', NULL, true, 'archived', now(), now()),
  ('diana.diana12.04@mail.ru', '+375295158331', '@alekseeva_dessert', 'Алексеева Диана', 'Диана', 'Алексеева', 'Кондитер', true, 'archived', now(), now()),
  ('dkarlyuk@bk.ru', '+375293735476', NULL, 'Шикольчик Дарья', 'Дарья', 'Шикольчик', 'Бухгалтер', true, 'archived', now(), now())
) AS v(email, phone, telegram_username, full_name, first_name, last_name, position, was_club_member, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM profiles p WHERE p.email = v.email);