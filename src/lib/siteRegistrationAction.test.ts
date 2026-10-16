import { describe, it, expect } from "vitest";
import { resolveSiteRegistrationAction } from "./siteRegistrationAction";
import type { SiteBlock } from "@/services/sitePages/types";
const blocks = [
 { id: "html", type: "html", content: { code: '<form data-lovable-registration-form="form"></form>' } },
 { id: "form", type: "form", content: { webinar_registration: true, auth_mode: true, questionnaire_first: true, contact_first: true } },
] as SiteBlock[];
const action = { action: "open-registration", sourcePageId: "page", sourceBlockId: "html", payload: { form_block_id: "form", contacts: { first_name: " Анна ", email: "test@example.invalid", telegram_user_id: "injection", phone: "1" } } };
describe("site registration sandbox boundary", () => {
 it("accepts only its configured form and bounded contact text, never Telegram identity", () => {
  expect(resolveSiteRegistrationAction(blocks, "page", action)?.contacts).toEqual({ first_name: "Анна", email: "test@example.invalid", phone: "1" });
 });
 it("rejects missing provenance, a different page, non-registration forms and unrelated HTML", () => {
  for (const change of [{sourcePageId:"other"},{sourceBlockId:"other"},{sourcePageId:undefined}]) expect(resolveSiteRegistrationAction(blocks,"page",{...action,...change})).toBeNull();
  expect(resolveSiteRegistrationAction([{...blocks[0],content:{code:"unrelated"}},blocks[1]],"page",action)).toBeNull();
  expect(resolveSiteRegistrationAction([blocks[0],{...blocks[1],content:{...blocks[1].content,webinar_registration:false}}],"page",action)).toBeNull();
 });
});
