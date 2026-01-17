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

    // Get sent news to analyze style
    const { data: sentNews, error: newsError } = await supabase
      .from('news_content')
      .select('title, ai_summary, summary, telegram_sent_at')
      .eq('telegram_status', 'sent')
      .order('telegram_sent_at', { ascending: false })
      .limit(50);

    if (newsError) {
      throw new Error(`Failed to fetch sent news: ${newsError.message}`);
    }

    // If not enough sent news, try to use archived channel posts
    let postsForAnalysis: Array<{ title?: string; text: string }> = [];
    let dataSource = 'news_content';

    if (sentNews && sentNews.length >= 5) {
      postsForAnalysis = sentNews.map(news => ({
        title: news.title,
        text: news.ai_summary || news.summary || '',
      }));
    } else {
      console.log(`[learn-style] Only ${sentNews?.length || 0} sent news, checking channel_posts_archive...`);
      
      // Try to get posts from channel_posts_archive
      const { data: archivedPosts, error: archiveError } = await supabase
        .from('channel_posts_archive')
        .select('text, date, views')
        .eq('channel_id', channel.channel_id)
        .not('text', 'is', null)
        .order('date', { ascending: false })
        .limit(50);

      if (archiveError) {
        console.error('[learn-style] Archive query error:', archiveError);
      }

      if (archivedPosts && archivedPosts.length >= 5) {
        console.log(`[learn-style] Found ${archivedPosts.length} posts in archive`);
        postsForAnalysis = archivedPosts
          .filter(post => post.text && post.text.trim().length > 20)
          .map(post => ({ text: post.text }));
        dataSource = 'channel_posts_archive';
      } else {
        // Combine both sources if available
        const combinedPosts = [
          ...(sentNews || []).map(news => ({
            title: news.title,
            text: news.ai_summary || news.summary || '',
          })),
          ...(archivedPosts || [])
            .filter(post => post.text && post.text.trim().length > 20)
            .map(post => ({ text: post.text })),
        ];

        if (combinedPosts.length >= 5) {
          postsForAnalysis = combinedPosts;
          dataSource = 'combined';
        } else {
          return new Response(JSON.stringify({
            error: 'Недостаточно постов для анализа (нужно минимум 5). Импортируйте историю канала через JSON-экспорт из Telegram Desktop.',
            posts_found: combinedPosts.length,
            hint: 'Telegram Desktop → Канал → Меню (⋮) → Экспорт данных → JSON',
          }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    console.log(`[learn-style] Using ${postsForAnalysis.length} posts from ${dataSource}`);

    // Prepare posts text for analysis
    const postsText = postsForAnalysis.map((post, idx) => {
      const title = 'title' in post && post.title ? `Заголовок: ${post.title}\n` : '';
      return `--- Пост ${idx + 1} ---\n${title}Текст: ${post.text}`;
    }).join('\n\n');

    if (!lovableApiKey) {
      return new Response(JSON.stringify({ error: 'AI not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Analyze style with AI
    const stylePrompt = `Проанализируй следующие посты из Telegram-канала и создай "Стилевой профиль" канала.

ПОСТЫ ДЛЯ АНАЛИЗА:
${postsText.slice(0, 20000)}

Проанализируй и верни JSON объект style_profile:
{
  "tone": "формальный/неформальный/деловой/дружелюбный/нейтральный",
  "tone_details": "Подробное описание тона канала",
  "avg_length": "краткий (до 200 слов) / средний (200-500) / длинный (500+)",
  "length_recommendation": "Рекомендуемая длина поста в словах",
  "emojis": {
    "used": true/false,
    "frequency": "редко/умеренно/часто",
    "examples": ["🔥", "📌", ...]
  },
  "structure": {
    "has_headline": true/false,
    "has_call_to_action": true/false,
    "has_links": true/false,
    "typical_structure": "Описание типичной структуры поста"
  },
  "formatting": {
    "uses_bold": true/false,
    "uses_italic": true/false,
    "uses_underline": true/false,
    "uses_lists": true/false,
    "html_tags_used": ["<b>", "<i>", ...]
  },
  "characteristic_phrases": ["фраза 1", "фраза 2", ...],
  "vocabulary_level": "простой/профессиональный/смешанный",
  "target_audience": "Описание целевой аудитории на основе контента",
  "content_themes": ["тема 1", "тема 2", ...],
  "writing_guidelines": [
    "Правило 1 для написания в стиле канала",
    "Правило 2",
    ...
  ]
}

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
            { role: 'system', content: 'Ты аналитик контента. Анализируй стиль и возвращай только валидный JSON.' },
            { role: 'user', content: stylePrompt },
          ],
          temperature: 0.3,
          max_tokens: 2000,
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
          styleProfile = JSON.parse(jsonMatch[0]);
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
          profile_keys: Object.keys(styleProfile),
        },
      });

      return new Response(JSON.stringify({
        success: true,
        message: 'Style profile generated successfully',
        posts_analyzed: postsForAnalysis.length,
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
