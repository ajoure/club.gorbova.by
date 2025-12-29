-- Create email_accounts table for SMTP settings
CREATE TABLE public.email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT,
  provider TEXT NOT NULL DEFAULT 'smtp',
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 465,
  smtp_encryption TEXT DEFAULT 'SSL',
  smtp_username TEXT,
  smtp_password TEXT,
  from_name TEXT,
  from_email TEXT,
  reply_to TEXT,
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  use_for JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create email_templates table for customizable templates
CREATE TABLE public.email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  variables JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

-- RLS policies for email_accounts
CREATE POLICY "Admins can manage email accounts"
ON public.email_accounts
FOR ALL
USING (has_permission(auth.uid(), 'entitlements.manage'))
WITH CHECK (has_permission(auth.uid(), 'entitlements.manage'));

-- RLS policies for email_templates
CREATE POLICY "Admins can manage email templates"
ON public.email_templates
FOR ALL
USING (has_permission(auth.uid(), 'entitlements.manage'))
WITH CHECK (has_permission(auth.uid(), 'entitlements.manage'));

-- Insert default email templates
INSERT INTO public.email_templates (code, name, subject, body_html, variables) VALUES
('user_invite', 'Приглашение пользователя', 'Приглашение в {{appName}}', '<h1>Добро пожаловать в {{appName}}!</h1><p>Здравствуйте, {{name}}!</p><p>Вы были приглашены присоединиться к нашей платформе.</p><p>Ваш временный пароль: <strong>{{tempPassword}}</strong></p><p><a href="{{loginLink}}">Войти в систему</a></p>', '["name", "email", "tempPassword", "loginLink", "appName"]'),
('password_reset', 'Сброс пароля', 'Сброс пароля для {{appName}}', '<h1>Сброс пароля</h1><p>Здравствуйте, {{name}}!</p><p>Вы запросили сброс пароля.</p><p><a href="{{resetLink}}">Сбросить пароль</a></p><p>Если вы не запрашивали сброс пароля, проигнорируйте это письмо.</p>', '["name", "email", "resetLink", "appName"]'),
('payment_confirmation', 'Подтверждение оплаты', 'Оплата подтверждена - Заказ #{{orderId}}', '<h1>Спасибо за оплату!</h1><p>Здравствуйте, {{name}}!</p><p>Ваш заказ #{{orderId}} успешно оплачен.</p><p>Сумма: {{amount}} {{currency}}</p><p>Продукт: {{productName}}</p>', '["name", "email", "orderId", "amount", "currency", "productName"]'),
('role_assigned', 'Назначение роли', 'Вам назначена роль в {{appName}}', '<h1>Назначение роли</h1><p>Здравствуйте, {{name}}!</p><p>Вам была назначена роль: <strong>{{roleName}}</strong></p><p>Теперь у вас есть доступ к дополнительным функциям системы.</p>', '["name", "email", "roleName", "appName"]'),
('role_removed', 'Удаление роли', 'Роль удалена в {{appName}}', '<h1>Удаление роли</h1><p>Здравствуйте, {{name}}!</p><p>Роль <strong>{{roleName}}</strong> была удалена из вашего аккаунта.</p>', '["name", "email", "roleName", "appName"]');

-- Create trigger for updated_at
CREATE TRIGGER update_email_accounts_updated_at
BEFORE UPDATE ON public.email_accounts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_email_templates_updated_at
BEFORE UPDATE ON public.email_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();