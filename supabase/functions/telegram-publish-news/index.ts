import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface NewsItem {
  id: string;
  title: string;
  summary: string | null;
  ai_summary: string | null;
  source: string;
  source_url: string | null;
  effective_date: string | null;
  news_priority: string;
  created_at: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { action, newsId, newsIds, channelId, customMessage } = await req.json();

    console.log(`[telegram-publish-news] Action: ${action}, newsId: ${newsId}, channelId: ${channelId}`);

    if (action === "publish_single") {
      // Get news item
      const { data: news, error: newsError } = await supabase
        .from("news_content")
        .select("*")
        .eq("id", newsId)
        .single();

      if (newsError || !news) {
        throw new Error(`News not found: ${newsError?.message}`);
      }

      // Get channel with bot
      const { data: channel, error: channelError } = await supabase
        .from("telegram_publish_channels")
        .select("*, telegram_bots(token)")
        .eq("id", channelId)
        .single();

      if (channelError || !channel) {
        throw new Error(`Channel not found: ${channelError?.message}`);
      }

      const botToken = (channel as any).telegram_bots?.token;
      if (!botToken) {
        throw new Error("Bot token not found for channel");
      }

      const message = customMessage || formatNewsForTelegram(news as NewsItem);
      const result = await sendTelegramMessage(botToken, (channel as any).channel_id, message);

      if (result.ok) {
        await supabase
          .from("news_content")
          .update({
            telegram_status: "sent",
            telegram_message_id: result.result?.message_id,
            telegram_sent_at: new Date().toISOString(),
            telegram_channel_id: channelId,
            is_published: true,
          })
          .eq("id", newsId);

        return new Response(
          JSON.stringify({
            success: true,
            messageId: result.result?.message_id,
            channelName: (channel as any).channel_name,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else {
        throw new Error(`Telegram error: ${result.description}`);
      }
    }

    if (action === "add_to_queue") {
      const now = new Date();
      const scheduledAt = new Date();
      scheduledAt.setHours(19, 0, 0, 0);
      if (now.getHours() >= 19) {
        scheduledAt.setDate(scheduledAt.getDate() + 1);
      }

      await supabase.from("news_digest_queue").insert({
        news_id: newsId,
        channel_id: channelId,
        scheduled_at: scheduledAt.toISOString(),
        status: "pending",
      });

      await supabase
        .from("news_content")
        .update({ telegram_status: "queued" })
        .eq("id", newsId);

      return new Response(
        JSON.stringify({ success: true, scheduledAt: scheduledAt.toISOString() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (error) {
    console.error("[telegram-publish-news] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function formatNewsForTelegram(news: NewsItem): string {
  const summary = news.ai_summary || news.summary || "";
  let message = "";

  if (news.source_url) {
    message += `<b><a href="${escapeHtml(news.source_url)}">${escapeHtml(news.title)}</a></b>\n\n`;
  } else {
    message += `<b>${escapeHtml(news.title)}</b>\n\n`;
  }

  const date = new Date(news.created_at).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  message += `<i>(${escapeHtml(news.source)}, ${date})</i>\n\n`;

  if (summary) {
    message += `${escapeHtml(summary)}\n\n`;
  }

  if (news.effective_date) {
    const effectiveDate = new Date(news.effective_date).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    message += `<u>Вступает в силу: ${effectiveDate}</u>`;
  }

  return message;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
): Promise<{ ok: boolean; result?: { message_id: number }; description?: string }> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: false,
    }),
  });
  return response.json();
}
