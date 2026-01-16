-- Удалить дубликаты если есть
DELETE FROM tariff_offers WHERE tariff_id IN (
  SELECT t.id FROM tariffs t 
  JOIN products_v2 p ON t.product_id = p.id 
  WHERE p.code = 'cb20'
);
DELETE FROM tariffs WHERE product_id IN (SELECT id FROM products_v2 WHERE code = 'cb20');

-- Создать тариф "Бухгалтер"
INSERT INTO tariffs (product_id, code, name, subtitle, description, is_popular, badge, period_label, access_days, sort_order, is_active, features)
SELECT 
  id,
  'buh',
  'Бухгалтер',
  'Для тех, кто хочет полюбить бухгалтерию',
  'Доступ 6 месяцев после окончания, 5 живых конференций',
  false,
  '',
  'BYN',
  180,
  1,
  true,
  '["Предобучение", "18 основных модулей", "Задания с подробными разборами", "Материалы, тетрадь, майндкарты", "Доступ к клубу Буква закона", "Итоговый конспект", "Сертификат о прохождении", "VIP модули: Делегирование, Найм, Таймлайн"]'::jsonb
FROM products_v2 WHERE code = 'cb20';

-- Создать тариф "Главный бухгалтер"
INSERT INTO tariffs (product_id, code, name, subtitle, description, is_popular, badge, period_label, access_days, sort_order, is_active, features)
SELECT 
  id,
  'gl-buh',
  'Главный бухгалтер',
  'Полная программа с глубоким погружением',
  'Доступ 8 месяцев после окончания, 6 живых конференций',
  true,
  'Популярный',
  'BYN',
  240,
  2,
  true,
  '["Всё из тарифа Бухгалтер", "Доступ к Клубу тариф Full на 4 недели", "Grand модуль: Налоговое законодательство", "Grand модуль: Система в бухгалтерии", "Письменная характеристика", "Личная рекомендация от Катерины"]'::jsonb
FROM products_v2 WHERE code = 'cb20';

-- Создать тариф "Бизнес-леди"
INSERT INTO tariffs (product_id, code, name, subtitle, description, is_popular, badge, period_label, access_days, sort_order, is_active, features)
SELECT 
  id,
  'biz-lady',
  'Бизнес-леди',
  'Максимальный результат после курса',
  'Доступ 10 месяцев после окончания, 6 живых конференций',
  false,
  'VIP',
  'BYN',
  300,
  3,
  true,
  '["Всё из тарифа Главный бухгалтер", "Business модуль: Экспресс-аудит", "Business модуль: Восстановление учета", "Скидка 50% на модули по отраслям", "Дополнительная живая встреча"]'::jsonb
FROM products_v2 WHERE code = 'cb20';

-- Создать offers для тарифа "Бухгалтер"
INSERT INTO tariff_offers (tariff_id, offer_type, button_label, amount, is_primary, is_active, sort_order, is_installment)
SELECT id, 'pay_now', 'Оплатить 1490 BYN', 1490, true, true, 1, false
FROM tariffs WHERE code = 'buh' AND product_id = (SELECT id FROM products_v2 WHERE code = 'cb20');

INSERT INTO tariff_offers (tariff_id, offer_type, button_label, amount, is_primary, is_active, sort_order, is_installment, installment_count)
SELECT id, 'pay_now', 'Рассрочка от 136 BYN/мес', 1490, false, true, 2, true, 12
FROM tariffs WHERE code = 'buh' AND product_id = (SELECT id FROM products_v2 WHERE code = 'cb20');

-- Создать offers для тарифа "Главный бухгалтер"
INSERT INTO tariff_offers (tariff_id, offer_type, button_label, amount, is_primary, is_active, sort_order, is_installment)
SELECT id, 'pay_now', 'Оплатить 2490 BYN', 2490, true, true, 1, false
FROM tariffs WHERE code = 'gl-buh' AND product_id = (SELECT id FROM products_v2 WHERE code = 'cb20');

INSERT INTO tariff_offers (tariff_id, offer_type, button_label, amount, is_primary, is_active, sort_order, is_installment, installment_count)
SELECT id, 'pay_now', 'Рассрочка от 227 BYN/мес', 2490, false, true, 2, true, 12
FROM tariffs WHERE code = 'gl-buh' AND product_id = (SELECT id FROM products_v2 WHERE code = 'cb20');

-- Создать offers для тарифа "Бизнес-леди"
INSERT INTO tariff_offers (tariff_id, offer_type, button_label, amount, is_primary, is_active, sort_order, is_installment)
SELECT id, 'pay_now', 'Оплатить 2490 BYN', 2490, true, true, 1, false
FROM tariffs WHERE code = 'biz-lady' AND product_id = (SELECT id FROM products_v2 WHERE code = 'cb20');

INSERT INTO tariff_offers (tariff_id, offer_type, button_label, amount, is_primary, is_active, sort_order, is_installment, installment_count)
SELECT id, 'pay_now', 'Рассрочка от 163 BYN/мес', 2490, false, true, 2, true, 12
FROM tariffs WHERE code = 'biz-lady' AND product_id = (SELECT id FROM products_v2 WHERE code = 'cb20');