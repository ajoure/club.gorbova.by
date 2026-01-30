-- Create broadcast_templates table for managing broadcast templates
CREATE TABLE public.broadcast_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'telegram' CHECK (channel IN ('telegram', 'email')),
  
  -- Telegram fields
  message_text TEXT,
  button_text TEXT,
  button_url TEXT,
  
  -- Email fields  
  email_subject TEXT,
  email_body_html TEXT,
  
  -- Status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sent', 'archived')),
  scheduled_for TIMESTAMPTZ,
  
  -- Stats (after sending)
  sent_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  sent_at TIMESTAMPTZ,
  
  -- Meta
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.broadcast_templates ENABLE ROW LEVEL SECURITY;

-- RLS policy for admins
CREATE POLICY "Admins can manage templates" ON public.broadcast_templates
  FOR ALL TO authenticated
  USING (public.has_permission(auth.uid(), 'entitlements.manage'));

-- Trigger for updated_at
CREATE TRIGGER update_broadcast_templates_updated_at
  BEFORE UPDATE ON public.broadcast_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Index for status filtering
CREATE INDEX idx_broadcast_templates_status ON public.broadcast_templates(status);
CREATE INDEX idx_broadcast_templates_channel ON public.broadcast_templates(channel);

-- Insert pre-defined templates
INSERT INTO public.broadcast_templates (name, channel, message_text, button_text, button_url, status)
VALUES (
  'Анонс Базы знаний',
  'telegram',
  '🎉 База знаний открыта!

Мы запустили новый публичный раздел на сайте — Базу знаний с ответами на реальные вопросы от Катерины Горбовой.

📚 Что уже доступно:
• более 670 вопросов и ответов
• 100 видеоэфиров с подробными разборами
• налоги, документы, клиенты, договоры
• практические ситуации из реальной работы

Все материалы удобно структурированы — можно быстро найти нужный ответ.

👉 Участникам Клуба с тарифами FULL и BUSINESS открыт полный доступ к видео.
👀 Остальные могут посмотреть вопросы и оценить ценность базы.',
  'Открыть Базу знаний',
  'https://club.gorbova.by/knowledge',
  'draft'
);

INSERT INTO public.broadcast_templates (name, channel, email_subject, email_body_html, status)
VALUES (
  'Анонс Базы знаний',
  'email',
  '🎉 Открыта База знаний — 670+ вопросов и 100 видеоэфиров',
  '<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5;">
  <div style="background: white; border-radius: 16px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    
    <h1 style="color: #1a1a1a; font-size: 24px; margin-bottom: 16px; text-align: center;">
      🎉 База знаний открыта!
    </h1>
    
    <p style="color: #444; font-size: 16px; line-height: 1.6;">
      Мы открыли новый публичный раздел — <strong>Базу знаний</strong> с ответами на реальные вопросы от Катерины Горбовой.
    </p>

    <p style="color: #444; font-size: 16px; line-height: 1.6;">
      На данный момент в базе:
      <strong>более 670 вопросов и ответов</strong> и
      <strong>100 видеоэфиров</strong> с подробными разборами.
    </p>
    
    <div style="background: #f8f9fa; border-radius: 12px; padding: 20px; margin: 24px 0;">
      <p style="color: #1a1a1a; font-weight: 600; margin: 0 0 12px 0;">📚 Что внутри:</p>
      <ul style="color: #555; margin: 0; padding-left: 20px; line-height: 1.8;">
        <li>ответы по налогам и документам</li>
        <li>разборы сложных клиентских ситуаций</li>
        <li>договоры, претензии, проверки</li>
        <li>практика и живые кейсы</li>
      </ul>
    </div>
    
    <p style="color: #444; font-size: 16px; line-height: 1.6;">
      Все материалы структурированы по темам — можно быстро найти нужный ответ и сразу перейти к видеоразбору.
    </p>
    
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 20px; margin: 24px 0; text-align: center;">
      <p style="color: white; margin: 0 0 4px 0; font-weight: 600;">
        Участникам Клуба с тарифами FULL и BUSINESS
      </p>
      <p style="color: rgba(255,255,255,0.9); margin: 0; font-size: 14px;">
        открыт полный доступ к видеоэфирам
      </p>
    </div>
    
    <p style="color: #666; font-size: 14px; text-align: center; margin-bottom: 24px;">
      Остальные участники могут посмотреть вопросы и оценить ценность Базы знаний.
    </p>
    
    <div style="text-align: center;">
      <a href="https://club.gorbova.by/knowledge" 
         style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; 
                font-weight: 600; font-size: 16px;">
        Открыть Базу знаний →
      </a>
    </div>
    
    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
    
    <p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
      Катерина Горбова • club.gorbova.by
    </p>
    
  </div>
</body>
</html>',
  'draft'
);