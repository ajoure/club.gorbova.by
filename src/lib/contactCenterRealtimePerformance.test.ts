import { describe, expect, it } from "vitest";
import telegramChatSource from "../components/admin/ContactTelegramChat.tsx?raw";
import instagramChatSource from "../components/admin/communication/instagram/ContactInstagramChat.tsx?raw";
import instagramAdminSource from "../../supabase/functions/instagram-admin-chat/index.ts?raw";
import supabaseConfigSource from "../../supabase/config.toml?raw";

describe("Contact-center realtime and history performance", () => {
  it("never traps Telegram scrolling while media is settling", () => {
    expect(telegramChatSource).toContain('viewport.addEventListener("wheel", releaseInitialPin');
    expect(telegramChatSource).toContain('viewport.addEventListener("touchstart", releaseInitialPin');
    expect(telegramChatSource).toContain("shouldStickToBottomRef.current = false");
  });

  it("loads the live Instagram tail first and exposes older-page metadata", () => {
    expect(instagramAdminSource).toContain(".order('created_at', { ascending: false })");
    expect(instagramAdminSource).toContain("messages: page");
    expect(instagramAdminSource).toContain("has_more: page.length === lim");
    expect(instagramAdminSource).toContain("next_offset: offset + page.length");
  });

  it("patches Instagram chat from realtime and supports older history", () => {
    expect(instagramChatSource).toContain("queryClient.setQueryData<Message[]>");
    expect(instagramChatSource).toContain('queryKey: ["unified-ig-dialogs"]');
    expect(instagramChatSource).toContain('data-testid="instagram-load-older-messages"');
    expect(instagramChatSource).toContain("offset: messages.length");
    expect(instagramChatSource).not.toContain("refetchInterval: 10000");
  });

  it("declares the external ManyChat webhook without a platform JWT wall", () => {
    expect(supabaseConfigSource).toContain("[functions.manychat-inbound]");
    expect(supabaseConfigSource).toMatch(
      /\[functions\.manychat-inbound\][\s\S]*?verify_jwt = false/,
    );
  });
});
