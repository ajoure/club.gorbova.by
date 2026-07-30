import { describe, expect, it } from "vitest";
import canonicalDocumentSendSource from "../../supabase/functions/canonical-document-send/index.ts?raw";
import contactTelegramChatSource from "../components/admin/ContactTelegramChat.tsx?raw";

describe("canonical document Telegram delivery truth", () => {
  it("resolves the linked bot first and never picks an arbitrary active club bot", () => {
    expect(canonicalDocumentSendSource).toContain("docProfile?.telegram_link_bot_id");
    expect(canonicalDocumentSendSource).toContain('.eq("is_primary", true)');
    expect(canonicalDocumentSendSource).not.toContain("tgGetBotToken");
    expect(canonicalDocumentSendSource).not.toContain('.from("telegram_clubs")');
  });

  it("requires provider delivery evidence instead of trusting a boolean response", () => {
    expect(canonicalDocumentSendSource).toContain("telegram_response_missing_delivery_evidence");
    expect(canonicalDocumentSendSource).toContain("provider_message_id");
    expect(canonicalDocumentSendSource).toContain("provider_chat_id");
    expect(canonicalDocumentSendSource).toContain("provider_http_status");
  });

  it("mirrors provider-confirmed documents into the Contact Center idempotently", () => {
    expect(canonicalDocumentSendSource).toContain("mirrorTelegramDocument");
    expect(canonicalDocumentSendSource).toContain('.from("telegram_messages")');
    expect(canonicalDocumentSendSource).toContain('message_origin: "bot_automation"');
    expect(canonicalDocumentSendSource).toContain('source: "canonical_document_send"');
    expect(canonicalDocumentSendSource).toContain('.eq("message_id", args.sendResult.messageId)');
  });

  it("does not resend a document that already has provider proof", () => {
    expect(canonicalDocumentSendSource).toContain("hasExistingProviderProof");
    expect(canonicalDocumentSendSource).toContain('existingTelegramDelivery?.status === "sent"');
  });

  it("does not restore a sticky personal sender in the Contact Center", () => {
    expect(contactTelegramChatSource).toContain("selectDefaultTelegramSender");
    expect(contactTelegramChatSource).toContain("senderWasChosenManuallyRef");
    expect(contactTelegramChatSource).not.toContain("tg_sender_");
    expect(contactTelegramChatSource).not.toContain("tg_bot_");
  });
});
