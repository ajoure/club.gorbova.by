
-- Sprint 10: full backfill of document_token_registry with canonical placeholders.
-- Idempotent: existing rows are not touched (ON CONFLICT DO NOTHING).
-- All entries use source_type='system' (computed via resolver_key).

INSERT INTO public.document_token_registry
  (token_key, ui_label, description, category, source_type, resolver_key, data_type, is_required, display_order, example_value)
VALUES
  -- ── contact (6) ──
  ('contact.full_name',         'Контакт: полное имя',        'ФИО контакта/профиля',                 'contact', 'system', 'contact.full_name',         'string',  false, 10, 'Иванов Иван Иванович'),
  ('contact.first_name',        'Контакт: имя',                NULL,                                   'contact', 'system', 'contact.first_name',        'string',  false, 11, 'Иван'),
  ('contact.last_name',         'Контакт: фамилия',            NULL,                                   'contact', 'system', 'contact.last_name',         'string',  false, 12, 'Иванов'),
  ('contact.email',             'Контакт: email',              NULL,                                   'contact', 'system', 'contact.email',             'string',  false, 13, 'ivan@example.com'),
  ('contact.phone',             'Контакт: телефон',            NULL,                                   'contact', 'system', 'contact.phone',             'string',  false, 14, '+375291234567'),
  ('contact.telegram_username', 'Контакт: Telegram username',  NULL,                                   'contact', 'system', 'contact.telegram_username', 'string',  false, 15, '@ivan'),

  -- ── customer extras (4) ──
  ('customer.client_type',      'Заказчик: тип клиента',       'individual / entrepreneur / legal',    'customer', 'system', 'customer.client_type',      'string',  false, 100, 'individual'),
  ('customer.legal_address',    'Заказчик: юридический адрес', NULL,                                   'customer', 'system', 'customer.legal_address',    'string',  false, 101, 'г. Минск, ул. ...'),
  ('customer.bank_name',        'Заказчик: банк (название)',   NULL,                                   'customer', 'system', 'customer.bank_name',        'string',  false, 102, 'ОАО «Банк»'),
  ('customer.bank_code',        'Заказчик: код банка',         NULL,                                   'customer', 'system', 'customer.bank_code',        'string',  false, 103, '153001270'),
  ('customer.personal_number',  'Заказчик: личный номер',      NULL,                                   'customer', 'system', 'customer.personal_number',  'string',  false, 104, '1234567A000PB1'),

  -- ── customer.signer (4) ──
  ('customer.signer.full_name', 'Подписант клиента: ФИО',         NULL,                                'customer.signer', 'system', 'customer.signer.full_name', 'string', false, 200, 'Петров Пётр Петрович'),
  ('customer.signer.initials',  'Подписант клиента: инициалы',    NULL,                                'customer.signer', 'system', 'customer.signer.initials',  'string', false, 201, 'Петров П.П.'),
  ('customer.signer.position',  'Подписант клиента: должность',   NULL,                                'customer.signer', 'system', 'customer.signer.position',  'string', false, 202, 'Директор'),
  ('customer.signer.basis',     'Подписант клиента: основание полномочий', NULL,                       'customer.signer', 'system', 'customer.signer.basis',     'string', false, 203, 'Устава'),

  -- ── executor extras (5) ──
  ('executor.phone',             'Исполнитель: телефон',           NULL,                               'executor', 'system', 'executor.phone',             'string', false, 300, '+375291234567'),
  ('executor.email',             'Исполнитель: email',             NULL,                               'executor', 'system', 'executor.email',             'string', false, 301, 'info@example.com'),
  ('executor.director_full_name','Исполнитель: ФИО руководителя',  NULL,                               'executor', 'system', 'executor.director_full_name','string', false, 302, 'Сидоров Сидор Сидорович'),
  ('executor.director_position', 'Исполнитель: должность руководителя', NULL,                          'executor', 'system', 'executor.director_position', 'string', false, 303, 'Директор'),
  ('executor.basis',             'Исполнитель: основание полномочий', NULL,                            'executor', 'system', 'executor.basis',             'string', false, 304, 'Устава'),

  -- ── order / deal extras (8) ──
  ('order.id',             'Заказ: ID',              NULL,                                              'deal', 'system', 'order.id',             'string',  false, 400, '00000000-0000-0000-0000-000000000000'),
  ('order.number',         'Заказ: номер',           NULL,                                              'deal', 'system', 'order.number',         'string',  false, 401, 'ORD-2026-001'),
  ('order.status',         'Заказ: статус',          NULL,                                              'deal', 'system', 'order.status',         'string',  false, 402, 'paid'),
  ('order.created_at',     'Заказ: дата создания',   NULL,                                              'deal', 'system', 'order.created_at',     'date',    false, 403, '06.05.2026'),
  ('order.paid_at',        'Заказ: дата оплаты',     NULL,                                              'deal', 'system', 'order.paid_at',        'date',    false, 404, '06.05.2026'),
  ('order.amount',         'Заказ: сумма оплаты',    NULL,                                              'deal', 'system', 'order.amount',         'number',  false, 405, '1500.00'),
  ('order.currency',       'Заказ: валюта',          NULL,                                              'deal', 'system', 'order.currency',       'string',  false, 406, 'BYN'),
  ('order.customer_email', 'Заказ: email покупателя', NULL,                                             'deal', 'system', 'order.customer_email', 'string',  false, 407, 'ivan@example.com'),
  ('order.customer_phone', 'Заказ: телефон покупателя', NULL,                                          'deal', 'system', 'order.customer_phone', 'string',  false, 408, '+375291234567'),
  ('order.payment_method', 'Заказ: способ оплаты',   NULL,                                              'deal', 'system', 'order.payment_method', 'string',  false, 409, 'bepaid'),

  -- ── product (4) ──
  ('product.id',           'Продукт: ID',           NULL,                                               'product', 'system', 'product.id',           'string', false, 500, '00000000-0000-0000-0000-000000000000'),
  ('product.name',         'Продукт: название',     NULL,                                               'product', 'system', 'product.name',         'string', false, 501, 'Клуб'),
  ('product.code',         'Продукт: код',          NULL,                                               'product', 'system', 'product.code',         'string', false, 502, 'CLUB-1'),
  ('product.description',  'Продукт: описание',     NULL,                                               'product', 'system', 'product.description',  'string', false, 503, 'Краткое описание продукта'),

  -- ── tariff (6) ──
  ('tariff.id',           'Тариф: ID',           NULL,                                                  'tariff', 'system', 'tariff.id',           'string', false, 600, '00000000-0000-0000-0000-000000000000'),
  ('tariff.name',         'Тариф: название',     NULL,                                                  'tariff', 'system', 'tariff.name',         'string', false, 601, 'Месяц'),
  ('tariff.price',        'Тариф: цена',         NULL,                                                  'tariff', 'system', 'tariff.price',        'number', false, 602, '99.00'),
  ('tariff.currency',     'Тариф: валюта',       NULL,                                                  'tariff', 'system', 'tariff.currency',     'string', false, 603, 'BYN'),
  ('tariff.access_days',  'Тариф: срок доступа (дней)', NULL,                                          'tariff', 'system', 'tariff.access_days',  'number', false, 604, '30'),
  ('tariff.description',  'Тариф: описание',     NULL,                                                  'tariff', 'system', 'tariff.description',  'string', false, 605, 'Доступ на месяц'),

  -- ── offer (7) ──
  ('offer.id',              'Кнопка оплаты: ID',                NULL,                                   'offer', 'system', 'offer.id',              'string',  false, 700, '00000000-0000-0000-0000-000000000000'),
  ('offer.name',            'Кнопка оплаты: название',          NULL,                                   'offer', 'system', 'offer.name',            'string',  false, 701, 'Оплатить месяц'),
  ('offer.type',            'Кнопка оплаты: тип',               'pay_now / installment / trial / subscription', 'offer', 'system', 'offer.type',  'string',  false, 702, 'pay_now'),
  ('offer.amount',          'Кнопка оплаты: сумма',             NULL,                                   'offer', 'system', 'offer.amount',          'number',  false, 703, '99.00'),
  ('offer.currency',        'Кнопка оплаты: валюта',            NULL,                                   'offer', 'system', 'offer.currency',        'string',  false, 704, 'BYN'),
  ('offer.reentry_price',   'Кнопка оплаты: цена повторного вступления', NULL,                          'offer', 'system', 'offer.reentry_price',   'number',  false, 705, '49.00'),
  ('offer.is_subscription', 'Кнопка оплаты: подписка / автопродление', NULL,                            'offer', 'system', 'offer.is_subscription', 'boolean', false, 706, 'true'),

  -- ── document (extended for service act, ~26) ──
  ('document.contract_number', 'Договор: номер',               NULL, 'document', 'system', 'document.contract_number', 'string', false, 800, 'Д-2026-001'),
  ('document.contract_date',   'Договор: дата',                NULL, 'document', 'system', 'document.contract_date',   'date',   false, 801, '06.05.2026'),
  ('document.act_number',      'Акт: номер',                   NULL, 'document', 'system', 'document.act_number',      'string', false, 802, 'А-2026-001'),
  ('document.act_date',        'Акт: дата',                    NULL, 'document', 'system', 'document.act_date',        'date',   false, 803, '06.05.2026'),
  ('document.service_name',    'Услуга: наименование',         NULL, 'document', 'system', 'document.service_name',    'string', false, 804, 'Информационно-консультационные услуги'),
  ('document.service_description', 'Услуга: описание',         NULL, 'document', 'system', 'document.service_description', 'string', false, 805, 'Доступ к платформе на 30 дней'),
  ('document.service_unit',    'Услуга: единица измерения',    NULL, 'document', 'system', 'document.service_unit',    'string', false, 806, 'услуга'),
  ('document.service_quantity','Услуга: количество',           NULL, 'document', 'system', 'document.service_quantity','number', false, 807, '1'),
  ('document.service_price',   'Услуга: цена за единицу',      NULL, 'document', 'system', 'document.service_price',   'number', false, 808, '99.00'),
  ('document.service_amount',  'Услуга: сумма акта',           NULL, 'document', 'system', 'document.service_amount',  'number', false, 809, '99.00'),
  ('document.amount_words',    'Сумма прописью',               NULL, 'document', 'system', 'document.amount_words',    'string', false, 810, 'Девяносто девять рублей 00 копеек'),
  ('document.currency_major',  'Валюта: целая часть (рублей/злотых/долларов)', NULL, 'document', 'system', 'document.currency_major', 'string', false, 811, 'рублей'),
  ('document.currency_minor',  'Валюта: дробная часть (копеек/грошей/центов)', NULL, 'document', 'system', 'document.currency_minor', 'string', false, 812, 'копеек'),
  ('document.payment_due_days','Срок оплаты (рабочих дней)',   NULL, 'document', 'system', 'document.payment_due_days','number', false, 813, '5'),
  ('document.execution_days',  'Срок оказания услуг (рабочих дней)', NULL, 'document', 'system', 'document.execution_days', 'number', false, 814, '30'),
  ('document.service_period_from', 'Период оказания услуг с',  NULL, 'document', 'system', 'document.service_period_from', 'date', false, 815, '06.05.2026'),
  ('document.service_period_to',   'Период оказания услуг по', NULL, 'document', 'system', 'document.service_period_to',   'date', false, 816, '05.06.2026'),
  ('document.months_count',    'Количество месяцев',           NULL, 'document', 'system', 'document.months_count',    'number', false, 817, '1'),
  ('document.prepayment_percent','Предоплата, %',              NULL, 'document', 'system', 'document.prepayment_percent','number', false, 818, '50'),
  ('document.prepayment_amount', 'Предоплата, сумма',          NULL, 'document', 'system', 'document.prepayment_amount', 'number', false, 819, '49.50'),
  ('document.discount_amount', 'Скидка, сумма',                NULL, 'document', 'system', 'document.discount_amount', 'number', false, 820, '0.00'),
  ('document.first_payment',   'Первый платёж',                NULL, 'document', 'system', 'document.first_payment',   'number', false, 821, '49.50'),
  ('document.bank_credit_price','Цена для банковского кредита / рассрочки', NULL, 'document', 'system', 'document.bank_credit_price', 'number', false, 822, '99.00'),
  ('document.final_payment_amount','Окончательный расчёт, сумма', NULL, 'document', 'system', 'document.final_payment_amount', 'number', false, 823, '49.50'),
  ('document.deal_currency',   'Сделка: валюта',               NULL, 'document', 'system', 'document.deal_currency',   'string', false, 824, 'BYN'),
  ('document.usd_byn_rate',    'Курс USD/BYN',                 NULL, 'document', 'system', 'document.usd_byn_rate',    'number', false, 825, '3.25'),
  ('document.payment_date',    'Дата оплаты / дата ведения',   NULL, 'document', 'system', 'document.payment_date',    'date',   false, 826, '06.05.2026'),

  -- ── system (5) ──
  ('system.today',     'Сегодня (дд.мм.гггг)',  NULL, 'system', 'system', 'system.today',     'date',   false, 900, '06.05.2026'),
  ('system.today_ru',  'Сегодня прописью',      NULL, 'system', 'system', 'system.today_ru',  'string', false, 901, '«06» мая 2026 года'),
  ('system.now',       'Сейчас (дата+время)',   NULL, 'system', 'system', 'system.now',       'string', false, 902, '06.05.2026 14:30'),
  ('system.year',      'Текущий год',           NULL, 'system', 'system', 'system.year',      'number', false, 903, '2026'),
  ('system.month',     'Текущий месяц (01-12)', NULL, 'system', 'system', 'system.month',     'number', false, 904, '05')
ON CONFLICT (token_key) DO NOTHING;
