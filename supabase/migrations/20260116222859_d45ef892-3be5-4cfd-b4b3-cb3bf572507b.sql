-- Add new permissions for news/digest management
INSERT INTO permissions (code, name, category) VALUES
('news.view', 'Просмотр новостей', 'news'),
('news.edit', 'Редактирование новостей', 'news'),
('news.publish', 'Публикация новостей', 'news'),
('news.delete', 'Удаление новостей', 'news')
ON CONFLICT (code) DO NOTHING;

-- Add new permissions for executors management
INSERT INTO permissions (code, name, category) VALUES
('executors.view', 'Просмотр исполнителей', 'executors'),
('executors.manage', 'Управление исполнителями', 'executors')
ON CONFLICT (code) DO NOTHING;

-- Add new permissions for integrations management
INSERT INTO permissions (code, name, category) VALUES
('integrations.view', 'Просмотр интеграций', 'integrations'),
('integrations.manage', 'Управление интеграциями', 'integrations')
ON CONFLICT (code) DO NOTHING;

-- Add new permissions for deals management
INSERT INTO permissions (code, name, category) VALUES
('deals.view', 'Просмотр сделок', 'deals'),
('deals.edit', 'Редактирование сделок', 'deals'),
('deals.delete', 'Удаление сделок', 'deals')
ON CONFLICT (code) DO NOTHING;

-- Create news_editor role
INSERT INTO roles (code, name, description) VALUES
('news_editor', 'Редактор новостей', 'Управление новостями и дайджестами без доступа к финансам')
ON CONFLICT (code) DO NOTHING;

-- Assign news permissions to news_editor role
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
  r.id,
  p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'news_editor'
AND p.code IN ('news.view', 'news.edit', 'news.publish', 'news.delete')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Make sure admin_gost role has only view permissions (fix any potential issues)
-- First, remove non-view permissions from admin_gost
DELETE FROM role_permissions 
WHERE role_id = (SELECT id FROM roles WHERE code = 'admin_gost')
AND permission_id IN (
  SELECT id FROM permissions 
  WHERE code NOT LIKE '%.view'
);

-- Ensure admin_gost has all necessary view permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT 
  r.id,
  p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code = 'admin_gost'
AND p.code LIKE '%.view'
ON CONFLICT (role_id, permission_id) DO NOTHING;