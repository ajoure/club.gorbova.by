/**
 * Pure conversation policy. This module does not send, persist or authenticate.
 * The server adapter must serialize events per exact dialog, persist the result,
 * identify manual replies vs AI echoes, and atomically claim an outbox item.
 * Client input and model output must never supply trusted eligibility evidence.
 */
export interface DialogueScope {
  botId: string;
  businessConnectionId: string;
  chatId: string;
}

export interface SalesCampaign {
  mode: "off" | "owner_test" | "live";
  revision: string;
  approvedRevision: string | null;
  botId: string;
  businessConnectionId: string;
  allowedChatIds: readonly string[];
  triggerPhrase: string | null;
  knowledgeReady: boolean;
  offerReady: boolean;
}

export interface DialogueState {
  scope: DialogueScope;
  started: boolean;
  activationRevision: string | null;
  hold: "none" | "human" | "stopped" | "delivery_unknown";
  version: number;
  latestInboundId: number;
  latestOutboundId: number;
  /** Opaque references to canonical saved context; never reset on resume. */
  stage: string | null;
  contextRef: string | null;
}

export interface ReplyTicket {
  scope: DialogueScope;
  campaignRevision: string;
  dialogueVersion: number;
  inboundId: number;
}

export interface ReplyEvidence {
  connectionEnabled: boolean;
  canReplyNow: boolean;
  historyComplete: boolean;
}

type Inbound = {
  scope: DialogueScope;
  messageId: number;
  kind: "new" | "edit" | "import" | "echo";
  text: string;
  preRegistrationVerified: boolean;
  optedOut: boolean;
};

export type ReplyDecision =
  | { action: "wait"; reason: string }
  | { action: "prepare"; ticket: ReplyTicket };

function nonEmpty(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function validMessageId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function sameDialogue(a: DialogueScope, b: DialogueScope): boolean {
  return [a.botId, a.businessConnectionId, a.chatId,
    b.botId, b.businessConnectionId, b.chatId].every(nonEmpty)
    && a.botId === b.botId
    && a.businessConnectionId === b.businessConnectionId
    && a.chatId === b.chatId;
}

/** Explicit normalization only: no fuzzy intent, substrings or punctuation removal. */
export function triggerMatches(text: string, phrase: string | null): boolean {
  if (typeof text !== "string" || typeof phrase !== "string" || !phrase.trim()) return false;
  const normalize = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
  return normalize(text) === normalize(phrase);
}

function campaignAllows(campaign: SalesCampaign, scope: DialogueScope): boolean {
  return (campaign.mode === "owner_test" || campaign.mode === "live")
    && nonEmpty(campaign.revision)
    && campaign.approvedRevision === campaign.revision
    && nonEmpty(campaign.triggerPhrase ?? "")
    && campaign.knowledgeReady === true && campaign.offerReady === true
    && sameDialogue(scope, { ...scope, botId: campaign.botId,
      businessConnectionId: campaign.businessConnectionId })
    && campaign.allowedChatIds.includes(scope.chatId)
    && (campaign.mode !== "owner_test" || campaign.allowedChatIds.length === 1);
}

export function newDialogue(scope: DialogueScope): DialogueState {
  if (!sameDialogue(scope, scope)) throw new Error("dialogue_scope_required");
  return { scope: { ...scope }, started: false, activationRevision: null, hold: "none", version: 0,
    latestInboundId: 0, latestOutboundId: 0, stage: null, contextRef: null };
}

/** Call only for authenticated, persisted Business webhook events. */
export function receiveInbound(
  state: DialogueState, event: Inbound, campaign: SalesCampaign,
): DialogueState {
  if (!sameDialogue(state.scope, event.scope) || event.kind !== "new"
    || !validMessageId(event.messageId)) return state;
  // Fail closed if a stop request arrives out of order. Resume never clears it.
  if (event.optedOut === true) return { ...state, hold: "stopped", version: state.version + 1,
    latestInboundId: Math.max(state.latestInboundId, event.messageId) };
  if (event.messageId <= state.latestInboundId) return state;

  const next = { ...state, version: state.version + 1, latestInboundId: event.messageId };
  // An older event, received out of order after an outbound, is not a fresh turn.
  if (event.messageId <= state.latestOutboundId) return next;
  if (state.hold !== "none" || state.started) return next;
  if (!campaignAllows(campaign, state.scope) || event.preRegistrationVerified !== true
    || !triggerMatches(event.text, campaign.triggerPhrase)) return next;
  return { ...next, started: true, activationRevision: campaign.revision };
}

/** Manual controls do not start a sale, change the audience, or clear an opt-out. */
export function pauseDialogue(state: DialogueState): DialogueState {
  return { ...state, version: state.version + 1,
    hold: state.hold === "none" ? "human" : state.hold };
}

export function resumeDialogue(state: DialogueState): DialogueState {
  if (state.hold !== "human") return state;
  return { ...state, version: state.version + 1, hold: "none" };
}

/** Silent handoff: server creates the existing internal assignment; no client text. */
export function handoffDialogue(state: DialogueState): DialogueState {
  return pauseDialogue(state);
}

export function recordManualReply(
  state: DialogueState, scope: DialogueScope, messageId: number,
): DialogueState {
  if (!sameDialogue(state.scope, scope) || !validMessageId(messageId)
    || messageId <= state.latestOutboundId) return state;
  return { ...pauseDialogue(state), latestOutboundId: messageId };
}

/** Record Telegram confirmation, even if a pause raced with an in-flight send.
 * Do not clear a human hold or an uncertain delivery here; resolution is separate.
 */
export function recordDeliveredReply(
  state: DialogueState, scope: DialogueScope, messageId: number,
): DialogueState {
  if (!sameDialogue(state.scope, scope) || !validMessageId(messageId)
    || messageId <= state.latestOutboundId) return state;
  return { ...state, version: state.version + 1, latestOutboundId: messageId };
}

export function recordUnknownDelivery(state: DialogueState): DialogueState {
  return { ...state, version: state.version + 1,
    hold: state.hold === "stopped" ? "stopped" : "delivery_unknown" };
}

export function decideReply(
  state: DialogueState, campaign: SalesCampaign, evidence: ReplyEvidence,
): ReplyDecision {
  if (!campaignAllows(campaign, state.scope)) return { action: "wait", reason: "campaign_not_ready" };
  if (!state.started) return { action: "wait", reason: "trigger_not_received" };
  if (state.activationRevision !== campaign.revision) return { action: "wait", reason: "activation_revision_changed" };
  if (state.hold !== "none") return { action: "wait", reason: state.hold };
  if (evidence.connectionEnabled !== true || evidence.canReplyNow !== true || evidence.historyComplete !== true) {
    return { action: "wait", reason: "delivery_or_context_not_ready" };
  }
  if (state.latestInboundId <= state.latestOutboundId) return { action: "wait", reason: "WAIT_CUSTOMER" };
  return { action: "prepare", ticket: { scope: { ...state.scope },
    campaignRevision: campaign.revision, dialogueVersion: state.version,
    inboundId: state.latestInboundId } };
}

/** Necessary pre-send gate, not a delivery authorization or an atomic claim.
 * Reread canonical campaign, dialog, history and rights immediately before send.
 */
export function ticketIsCurrent(
  ticket: ReplyTicket, state: DialogueState, campaign: SalesCampaign, evidence: ReplyEvidence,
): boolean {
  const decision = decideReply(state, campaign, evidence);
  return decision.action === "prepare" && sameDialogue(ticket.scope, state.scope)
    && ticket.campaignRevision === campaign.revision
    && ticket.dialogueVersion === state.version && ticket.inboundId === state.latestInboundId;
}
