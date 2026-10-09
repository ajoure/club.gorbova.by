interface BonusQuery {
  eq(column: string, value: unknown): BonusQuery;
  single(): PromiseLike<{ data: unknown; error: unknown }>;
}
export interface BonusBackend {
  rpc(name: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
  from(table: string): { select(columns: string): BonusQuery };
}
interface BonusRoute { status?: string; invite_link?: string; request_id?: string; bot_id?: string; channel_id?: number }

export async function prepareQuestionnaireBonusInvite(admin: BonusBackend, pageId: string, blockId: string, userId: string) {
  const { data, error } = await admin.rpc("prepare_site_questionnaire_bonus_invite", {
    p_page_id: pageId, p_block_id: blockId, p_user_id: userId,
  });
  if (error || !data || typeof data !== "object") return { status: 503, body: { error: "bonus_invite_unavailable" } };
  const route = data as BonusRoute;
  if (route.status === "ready") return { status: 200, body: { success: true, invite_link: route.invite_link } };
  if (route.status !== "create") return { status: route.status === "busy" ? 409 : 403, body: { error: `bonus_invite_${route.status}` } };
  const fail = async () => {
    await admin.rpc("finish_site_questionnaire_bonus_invite", { p_request_id: route.request_id, p_user_id: userId });
    return { status: 503, body: { error: "bonus_invite_unavailable" } };
  };
  try {
    const { data: botData, error: botError } = await admin.from("telegram_bots").select("bot_token_encrypted")
      .eq("id", route.bot_id).eq("status", "active").eq("is_primary", true).single();
    const bot = botData as { bot_token_encrypted?: unknown } | null;
    if (botError || typeof bot?.bot_token_encrypted !== "string" || !bot.bot_token_encrypted) return await fail();
    const response = await fetch(`https://api.telegram.org/bot${bot.bot_token_encrypted}/createChatInviteLink`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: route.channel_id, name: "Предзапись: бесплатный бонус", creates_join_request: true }),
      signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true || typeof result.result?.invite_link !== "string"
      || result.result.creates_join_request !== true || result.result.expire_date != null) return await fail();
    const { data: saved, error: saveError } = await admin.rpc("finish_site_questionnaire_bonus_invite", {
      p_request_id: route.request_id, p_user_id: userId, p_invite_link: result.result.invite_link,
    });
    if (saveError || saved !== true) return { status: 503, body: { error: "bonus_invite_unavailable" } };
    return { status: 200, body: { success: true, invite_link: result.result.invite_link } };
  } catch { return await fail(); }
}
