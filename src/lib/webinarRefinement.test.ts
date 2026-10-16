import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { webinarThanksDesign } from "./webinarThanksDesign";
describe("one registration form and configured designer thanks", () => {
  it("landing collects no contact data: its CTA opens the one canonical platform form", () => {
    const html = readFileSync("scripts/webinars/web-2410-refinement/landing.html", "utf8");
    const dom = new JSDOM(html, { runScripts: "outside-only" });
    try {
      const win = dom.window;const post = vi.fn();win.postMessage = post;
      win.eval(win.document.scripts[0].textContent || "");
      expect(win.document.querySelectorAll("input")).toHaveLength(0);
      expect(win.document.querySelectorAll('a[href="#reg"]')).toHaveLength(4);
      const form = win.document.querySelector("form")!;
      form.dispatchEvent(new win.Event("submit", { bubbles: true, cancelable: true }));
      expect(post).toHaveBeenCalledOnce();
      expect(post.mock.calls[0][0]).toEqual({ type: "site-action", action: "open-registration", payload: { form_block_id: "f04721a0-2430-4f24-8a24-202610240001" } });
    } finally { dom.window.close(); }
  });
  it("both designer buttons follow the current CMS links and have no tracking extensions", () => {
    const designer_html = readFileSync("scripts/webinars/web-2410-refinement/thanks.html", "utf8");
    const content = { design: "webinar", designer_html, channel_url: "https://t.me/+configuredChannel", personal_chat_url: "https://t.me/m/configuredPersonal" };
    const rendered = webinarThanksDesign(content)!;
    expect(rendered).not.toContain("chrome-extension://");expect(rendered).not.toContain("fbq");
    const dom = new JSDOM(rendered);
    try { expect([...dom.window.document.querySelectorAll("a")].map(a => a.href)).toEqual([content.channel_url, content.personal_chat_url]); }
    finally { dom.window.close(); }
    expect(webinarThanksDesign({ ...content, personal_chat_url: "javascript:alert(1)" })).toBeNull();
    expect(webinarThanksDesign({ ...content, design: "standard" })).toBeNull();
  });
});
