// B7 corrective — canonical link-bot resolver.
// Central point for reading the active link-bot token. Consumers must NOT
// query telegram_bots directly. If the plaintext `token` column is empty,
// this helper reports token_source='none' so callers can log & skip cleanly
// instead of silently failing (encrypted-only tokens require a decrypt path
// that does not yet exist in Deno edge runtime; when it lands, extend this
// resolver — do not fork it).

export type ResolvedLinkBot = {
  bot_id: string | null;
  token: string | null;
  token_source: "plaintext" | "encrypted_unavailable" | "none";
};

export async function resolveLinkBot(supabase: any): Promise<ResolvedLinkBot> {
  try {
    const { data: bot } = await supabase
      .from("telegram_bots")
      .select("id, token, bot_token_encrypted, is_link_bot, is_active")
      .eq("is_link_bot", true)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!bot) return { bot_id: null, token: null, token_source: "none" };
    const plaintext = typeof bot.token === "string" && bot.token.length > 0 ? bot.token : null;
    if (plaintext) {
      return { bot_id: String(bot.id), token: plaintext, token_source: "plaintext" };
    }
    if (bot.bot_token_encrypted) {
      // Decrypt path not yet available in edge runtime — surface explicitly.
      return { bot_id: String(bot.id), token: null, token_source: "encrypted_unavailable" };
    }
    return { bot_id: String(bot.id), token: null, token_source: "none" };
  } catch (e) {
    console.error("[link-bot-resolver] error:", e);
    return { bot_id: null, token: null, token_source: "none" };
  }
}
