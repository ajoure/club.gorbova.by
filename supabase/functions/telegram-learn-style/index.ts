import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LearnStyleRequest {
  channel_id: string;
  force?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: LearnStyleRequest = await req.json().catch(() => ({}));

    if (!body.channel_id) {
      return new Response(JSON.stringify({ error: 'channel_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[learn-style] Starting style analysis for channel: ${body.channel_id}`);

    // Get channel info
    const { data: channel, error: channelError } = await supabase
      .from('telegram_publish_channels')
      .select('*')
      .eq('id', body.channel_id)
      .single();

    if (channelError || !channel) {
      return new Response(JSON.stringify({ error: 'Channel not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if style profile already exists and skip if not forced
    const existingProfile = channel.settings?.style_profile;
    if (existingProfile && !body.force) {
      console.log('[learn-style] Style profile already exists, use force=true to regenerate');
      return new Response(JSON.stringify({
        success: true,
        message: 'Style profile already exists',
        style_profile: existingProfile,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // PRIORITY 1: Get messages from @katerinagorbova (from_tg_user_id = 99340019)
    console.log('[learn-style] Fetching messages from @katerinagorbova (user_id: 99340019)...');
    const { data: katerinaMessages, error: katerinaError } = await supabase
      .from('tg_chat_messages')
      .select('text, message_ts')
      .eq('from_tg_user_id', 99340019) // @katerinagorbova
      .not('text', 'is', null)
      .order('message_ts', { ascending: false })
      .limit(150);

    if (katerinaError) {
      console.error('[learn-style] Error fetching Katerina messages:', katerinaError);
    }

    // Filter messages with sufficient content (> 50 chars)
    const meaningfulKaterinaMessages = (katerinaMessages || [])
      .filter(msg => msg.text && msg.text.trim().length > 50);

    console.log(`[learn-style] Found ${meaningfulKaterinaMessages.length} meaningful messages from @katerinagorbova`);

    // Prepare posts for analysis
    let postsForAnalysis: Array<{ text: string; source?: string }> = [];
    let dataSource = '';

    if (meaningfulKaterinaMessages.length >= 5) {
      // Use Katerina's messages as primary source
      postsForAnalysis = meaningfulKaterinaMessages.map(msg => ({
        text: msg.text,
        source: 'tg_chat_messages',
      }));
      dataSource = 'katerina_gorbova_chat';
      console.log(`[learn-style] Using ${postsForAnalysis.length} messages from @katerinagorbova`);
    } else {
      // Fallback: combine with other sources
      console.log('[learn-style] Not enough Katerina messages, checking other sources...');

      // Get sent news
      const { data: sentNews } = await supabase
        .from('news_content')
        .select('title, ai_summary, summary, telegram_sent_at')
        .eq('telegram_status', 'sent')
        .order('telegram_sent_at', { ascending: false })
        .limit(50);

      // Get archived posts
      const { data: archivedPosts } = await supabase
        .from('channel_posts_archive')
        .select('text, date, views')
        .eq('channel_id', channel.channel_id)
        .not('text', 'is', null)
        .order('date', { ascending: false })
        .limit(50);

      // Combine all sources
      const combinedPosts = [
        ...meaningfulKaterinaMessages.map(msg => ({
          text: msg.text,
          source: 'katerina_chat',
        })),
        ...(sentNews || []).map(news => ({
          text: news.ai_summary || news.summary || '',
          source: 'news_content',
        })),
        ...(archivedPosts || [])
          .filter(post => post.text && post.text.trim().length > 20)
          .map(post => ({
            text: post.text,
            source: 'channel_archive',
          })),
      ];

      if (combinedPosts.length >= 5) {
        postsForAnalysis = combinedPosts;
        dataSource = 'combined';
        console.log(`[learn-style] Using combined sources: ${combinedPosts.length} posts`);
      } else {
        return new Response(JSON.stringify({
          error: 'Недостаточно данных для анализа стиля. Нужно минимум 5 сообщений.',
          posts_found: combinedPosts.length,
          katerina_messages: meaningfulKaterinaMessages.length,
          hint: 'Дождитесь накопления сообщений от @katerinagorbova в чате клуба.',
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    console.log(`[learn-style] Analyzing ${postsForAnalysis.length} posts from source: ${dataSource}`);

    // Prepare posts text for analysis
    const postsText = postsForAnalysis.slice(0, 80).map((post, idx) => {
      return `--- Сообщение ${idx + 1} ---\n${post.text}`;
    }).join('\n\n');

    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Analyze style with AI - special prompt for Katerina's personal style
    const stylePrompt = `Проанализируй следующие сообщения Екатерины Горбовой из Telegram и создай её "Стилевой профиль".

ВАЖНО: Это реальные сообщения владельца бизнеса, эксперта по налогам. Выяви её УНИКАЛЬНЫЙ стиль общения.

СООБЩЕНИЯ ДЛЯ АНАЛИЗА:
${postsText.slice(0, 25000)}

Проанализируй и верни JSON объект style_profile:
{
  "tone": "экспертный/дружелюбный/ироничный/деловой",
  "tone_details": "Подробное описание тона: как говорит, какие эмоции передаёт",
  "personality_traits": ["черта 1", "черта 2", ...],
  "avg_length": "краткий / средний / длинный",
  "emojis": {
    "used": true/false,
    "frequency": "редко/умеренно/часто",
    "examples": ["🔥", "📌", ...]
  },
  "structure": {
    "uses_numbering": true/false,
    "uses_paragraphs": true/false,
    "typical_structure": "Описание типичной структуры сообщения"
  },
  "formatting": {
    "uses_dashes": true/false,
    "uses_emphasis": true/false,
    "html_tags_used": ["<b>", "<i>", ...]
  },
  "characteristic_phrases": ["фраза 1", "фраза 2", ...],
  "communication_patterns": [
    "Как начинает сообщения",
    "Как аргументирует",
    "Как завершает мысли"
  ],
  "vocabulary_level": "простой/профессиональный/смешанный",
  "target_audience": "Кому адресованы сообщения",
  "writing_guidelines": [
    "Правило 1 для написания в стиле Екатерины",
    "Правило 2",
    "Правило 3",
    ...
  ]
}

Обрати особое внимание на:
- Использование тире (—) для акцентов
- Психологическую глубину в объяснениях
- Структурированность мыслей
- Профессионализм с человечностью
- Характерные обороты речи

Отвечай ТОЛЬКО валидным JSON без markdown.`;

    try {
      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            { role: 'system', content: 'Ты аналитик стиля общения. Анализируй манеру речи и возвращай только валидный JSON.' },
            { role: 'user', content: stylePrompt },
          ],
          temperature: 0.3,
          max_tokens: 2500,
        }),
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error('[learn-style] AI API error:', errorText);
        throw new Error('AI API error');
      }

      const aiData = await aiResponse.json();
      const aiContent = aiData.choices?.[0]?.message?.content || '';

      // Parse AI response
      let styleProfile;
      try {
        const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          // Handle nested style_profile - AI sometimes returns { style_profile: {...} }
          styleProfile = parsed.style_profile || parsed;
          console.log('[learn-style] Parsed profile keys:', Object.keys(styleProfile));
        } else {
          throw new Error('No JSON found in response');
        }
      } catch (parseError) {
        console.error('[learn-style] Failed to parse AI response:', aiContent);
        throw new Error('Failed to parse style profile from AI');
      }

      // Save style profile to channel settings
      const currentSettings = channel.settings || {};
      const updatedSettings = {
        ...currentSettings,
        style_profile: styleProfile,
        style_profile_generated_at: new Date().toISOString(),
        style_profile_posts_analyzed: postsForAnalysis.length,
        style_profile_data_source: dataSource,
        style_profile_katerina_messages: meaningfulKaterinaMessages.length,
      };

      const { error: updateError } = await supabase
        .from('telegram_publish_channels')
        .update({ settings: updatedSettings })
        .eq('id', body.channel_id);

      if (updateError) {
        throw new Error(`Failed to save style profile: ${updateError.message}`);
      }

      console.log('[learn-style] Style profile saved successfully');

      // Log the action
      await supabase.from('telegram_logs').insert({
        action: 'STYLE_PROFILE_GENERATED',
        target: channel.channel_name,
        status: 'ok',
        meta: {
          channel_id: body.channel_id,
          posts_analyzed: postsForAnalysis.length,
          data_source: dataSource,
          katerina_messages: meaningfulKaterinaMessages.length,
          profile_keys: Object.keys(styleProfile),
        },
      });

      return new Response(JSON.stringify({
        success: true,
        message: 'Style profile generated successfully',
        posts_analyzed: postsForAnalysis.length,
        katerina_messages: meaningfulKaterinaMessages.length,
        data_source: dataSource,
        style_profile: styleProfile,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (aiError) {
      console.error('[learn-style] AI processing error:', aiError);
      throw aiError;
    }

  } catch (error) {
    console.error('[learn-style] Error:', error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
