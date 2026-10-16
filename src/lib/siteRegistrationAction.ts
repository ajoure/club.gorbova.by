import type { SiteBlock } from "@/services/sitePages/types";

export type RegistrationContacts = Partial<Record<"first_name" | "last_name" | "email" | "phone", string>>;

/** Resolve only a form configured on this page, from its own sandboxed HTML block. */
export function resolveSiteRegistrationAction(blocks: SiteBlock[], pageId: string, detail: unknown) {
  if (!detail || typeof detail !== "object") return null;
  const event = detail as Record<string, unknown>;
  if (event.action !== "open-registration" || event.sourcePageId !== pageId || typeof event.sourceBlockId !== "string") return null;
  const payload = event.payload as Record<string, unknown> | undefined;
  if (!payload || typeof payload.form_block_id !== "string") return null;
  const source = blocks.find(block => block.id === event.sourceBlockId && block.type === "html");
  const form = blocks.find(block => block.id === payload.form_block_id && block.type === "form");
  if (typeof source?.content.code !== "string" || !source.content.code.includes(`data-lovable-registration-form="${form?.id}"`) ||
      form?.content.webinar_registration !== true || form.content.auth_mode !== true || form.content.questionnaire_first !== true || form.content.contact_first !== true) return null;
  const contacts: RegistrationContacts = {};
  if (payload.contacts && typeof payload.contacts === "object" && !Array.isArray(payload.contacts)) {
    const raw = payload.contacts as Record<string, unknown>;
    for (const mapping of ["first_name", "last_name", "email", "phone"] as const) {
      if (typeof raw[mapping] === "string" && raw[mapping].length <= 1000) contacts[mapping] = raw[mapping].trim();
    }
  }
  return { form, contacts };
}
