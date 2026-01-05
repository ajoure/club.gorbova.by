import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DailySummaryRequest {
  club_id?: string;
  date?: string; // YYYY-MM-DD format
  force?: boolean;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: DailySummaryRequest = await req.json().catch(() => ({}));
    
    // Default to yesterday's date
    const targetDate = body.date || new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
    console.log(`Generating daily summary for date: ${targetDate}`);

    // Get clubs with analytics enabled
    let clubsQuery = supabase
      .from('telegram_clubs')
      .select('id, club_name, chat_id, bot_id')
      .eq('is_active', true)
      .eq('chat_analytics_enabled', true);
    
    if (body.club_id) {
      clubsQuery = clubsQuery.eq('id', body.club_id);
    }
    
    const { data: clubs, error: clubsError } = await clubsQuery;
    
    if (clubsError) {
      console.error('Failed to fetch clubs:', clubsError);
      throw clubsError;
    }
    
    if (!clubs?.length) {
      console.log('No clubs with analytics enabled');
      return new Response(JSON.stringify({ message: 'No clubs with analytics enabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results = [];

    for (const club of clubs) {
      console.log(`Processing club: ${club.club_name} (${club.id})`);

      // Check if summary already exists
      if (!body.force) {
        const { data: existing } = await supabase
          .from('tg_daily_summaries')
          .select('id')
          .eq('club_id', club.id)
          .eq('date', targetDate)
          .single();
        
        if (existing) {
          console.log(`Summary already exists for ${club.club_name} on ${targetDate}`);
          results.push({ club_id: club.id, status: 'skipped', reason: 'already_exists' });
          continue;
        }
      }

      // Get messages for the day
      const startOfDay = `${targetDate}T00:00:00Z`;
      const endOfDay = `${targetDate}T23:59:59Z`;
      
      const { data: messages, error: messagesError } = await supabase
        .from('tg_chat_messages')
        .select('*')
        .eq('club_id', club.id)
        .gte('message_ts', startOfDay)
        .lte('message_ts', endOfDay)
        .order('message_ts', { ascending: true });
      
      if (messagesError) {
        console.error(`Failed to fetch messages for ${club.club_name}:`, messagesError);
        results.push({ club_id: club.id, status: 'error', error: messagesError.message });
        continue;
      }
      
      if (!messages?.length) {
        console.log(`No messages for ${club.club_name} on ${targetDate}`);
        results.push({ club_id: club.id, status: 'skipped', reason: 'no_messages' });
        continue;
      }

      console.log(`Found ${messages.length} messages for ${club.club_name}`);

      // Prepare messages for AI
      const uniqueUsers = new Set(messages.map(m => m.from_tg_user_id));
      const messagesText = messages
        .filter(m => m.text)
        .map(m => `[${m.from_display_name || 'User'}]: ${m.text}`)
        .join('\n');
      
      if (!messagesText.trim()) {
        console.log(`No text messages for ${club.club_name} on ${targetDate}`);
        results.push({ club_id: club.id, status: 'skipped', reason: 'no_text_messages' });
        continue;
      }

      // Call Lovable AI for summary generation
      const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
      if (!lovableApiKey) {
        console.error('LOVABLE_API_KEY not configured');
        results.push({ club_id: club.id, status: 'error', error: 'AI not configured' });
        continue;
      }

      const aiPrompt = `Проанализируй следующие сообщения из чата клуба за ${targetDate} и создай структурированный отчёт.

СООБЩЕНИЯ:
${messagesText.slice(0, 15000)}

Верни JSON в формате:
{
  "summary": "Краткое резюме дня в 2-5 абзацах на русском",
  "key_topics": ["Топик 1", "Топик 2", ...],
  "support_issues": [
    {"category": "question|complaint|bug|suggestion", "severity": "low|medium|high", "excerpt": "Краткая цитата", "user": "Имя пользователя"}
  ],
  "action_items": ["Действие 1", "Действие 2", ...]
}

Обрати внимание на:
- Вопросы участников (помечай как support_issues с category=question)
- Жалобы и недовольства (category=complaint, severity=high)
- Баги и технические проблемы (category=bug)
- Предложения и идеи (category=suggestion)
- Важные темы обсуждений`;

      try {
        const aiResponse = await fetch('https://ai.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { role: 'system', content: 'Ты аналитик чатов. Отвечай только валидным JSON без markdown.' },
              { role: 'user', content: aiPrompt },
            ],
            temperature: 0.3,
            max_tokens: 2000,
          }),
        });

        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          console.error('AI API error:', errorText);
          results.push({ club_id: club.id, status: 'error', error: 'AI API error' });
          continue;
        }

        const aiData = await aiResponse.json();
        const aiContent = aiData.choices?.[0]?.message?.content || '';
        
        // Parse AI response
        let parsed;
        try {
          // Try to extract JSON from response
          const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            parsed = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error('No JSON found in response');
          }
        } catch (parseError) {
          console.error('Failed to parse AI response:', aiContent);
          parsed = {
            summary: aiContent,
            key_topics: [],
            support_issues: [],
            action_items: [],
          };
        }

        // Save summary
        const { data: summary, error: summaryError } = await supabase
          .from('tg_daily_summaries')
          .upsert({
            club_id: club.id,
            chat_id: club.chat_id,
            date: targetDate,
            summary_text: parsed.summary || '',
            key_topics: parsed.key_topics || [],
            support_issues: parsed.support_issues || [],
            action_items: parsed.action_items || [],
            messages_count: messages.length,
            unique_users_count: uniqueUsers.size,
            generated_at: new Date().toISOString(),
            model_meta: { model: 'google/gemini-2.5-flash', tokens: aiData.usage },
          }, { onConflict: 'club_id,date' })
          .select()
          .single();

        if (summaryError) {
          console.error('Failed to save summary:', summaryError);
          results.push({ club_id: club.id, status: 'error', error: summaryError.message });
          continue;
        }

        // Save support signals separately
        if (parsed.support_issues?.length) {
          for (const issue of parsed.support_issues) {
            await supabase.from('tg_support_signals').insert({
              club_id: club.id,
              date: targetDate,
              severity: issue.severity || 'low',
              category: issue.category || 'question',
              excerpt: issue.excerpt || '',
              tg_username: issue.user || null,
              status: 'new',
            });
          }
        }

        console.log(`Summary saved for ${club.club_name}: ${messages.length} messages, ${uniqueUsers.size} users`);
        results.push({ 
          club_id: club.id, 
          status: 'success', 
          messages_count: messages.length,
          users_count: uniqueUsers.size,
          issues_count: parsed.support_issues?.length || 0,
        });

      } catch (aiError) {
        console.error('AI processing error:', aiError);
        results.push({ club_id: club.id, status: 'error', error: String(aiError) });
      }
    }

    // Log cron execution
    await supabase.from('telegram_logs').insert({
      action: 'DAILY_SUMMARY_CRON',
      target: 'analytics',
      status: 'ok',
      meta: { date: targetDate, results },
    });

    return new Response(JSON.stringify({ success: true, date: targetDate, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Daily summary error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
