// Archive only chats/channels explicitly connected to this bot. Telegram retries
// are safe: both destinations have a unique provider-message key.
export const TELEGRAM_MONITORING_UPDATES = ["channel_post", "edited_channel_post"] as const;

export async function persistMonitoredTelegramMessage(
  supabase: any,
  botId: string,
  update: Record<string, any>,
): Promise<{ handled: boolean; saved: number }> {
  const channelPost = update.channel_post || update.edited_channel_post;
  const msg = channelPost || update.message;
  const isChannel = msg?.chat?.type === "channel";
  const isGroup = ["group", "supergroup"].includes(msg?.chat?.type);
  if (!msg || (!isChannel && !isGroup)) return { handled: false, saved: 0 };

  const { data: clubs, error: clubError } = await supabase.from("telegram_clubs")
    .select("id")
    .eq("bot_id", botId)
    .eq(isChannel ? "channel_id" : "chat_id", msg.chat.id)
    .eq("chat_analytics_enabled", true);
  if (clubError) throw new Error("telegram_monitoring_club_lookup_failed");

  const mediaType = ["photo", "video", "document", "audio", "voice", "video_note", "sticker", "animation"]
    .find((type) => !!msg[type]) || null;
  const text = msg.text || msg.caption || null;
  const date = new Date(msg.date * 1000).toISOString();
  if (isChannel) {
    const { data: channels, error: channelError } = await supabase.from("telegram_publish_channels")
      .select("id").eq("bot_id", botId).eq("channel_id", String(msg.chat.id)).eq("is_active", true);
    if (channelError) throw new Error("telegram_monitoring_channel_lookup_failed");
    if (!clubs?.length && !channels?.length) return { handled: true, saved: 0 };
    const { error } = await supabase.from("channel_posts_archive").upsert({
      channel_id: String(msg.chat.id), telegram_message_id: msg.message_id,
      text, date, from_name: msg.author_signature || msg.chat.title || null,
      media_type: mediaType, raw_data: msg,
    }, { onConflict: "channel_id,telegram_message_id" });
    if (error) throw new Error("telegram_channel_archive_write_failed");
    return { handled: true, saved: 1 };
  }

  for (const club of clubs || []) {
    const { error } = await supabase.from("tg_chat_messages").upsert({
      club_id: club.id, chat_id: msg.chat.id, message_id: msg.message_id,
      message_ts: date, from_tg_user_id: msg.from?.id ?? msg.sender_chat?.id ?? msg.chat.id,
      from_display_name: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ")
        || msg.sender_chat?.title || null,
      text, has_media: !!mediaType, reply_to_message_id: msg.reply_to_message?.message_id || null,
      raw_payload: msg,
    }, { onConflict: "club_id,message_id" });
    if (error) throw new Error("telegram_group_archive_write_failed");
  }
  return { handled: true, saved: clubs?.length || 0 };
}
