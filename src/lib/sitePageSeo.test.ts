import { afterEach, describe, expect, it } from "vitest";
import { applySitePageSeo } from "./sitePageSeo";

const title = "Ценный бухгалтер — стань профессионалом, который понимает логику учета, умеет работать с НПА и самостоятельно принимает решения | Катерина Горбова";

afterEach(() => { document.head.innerHTML = ""; });

describe("configured site-page SEO", () => {
  it("updates the outer page title, description and sharing tags, and restores them on navigation", () => {
    document.head.innerHTML = '<title>Клуб</title><meta name="description" content="Описание клуба">';
    const cleanup = applySitePageSeo({ title, description: "Описание курса" });
    expect(document.title).toBe(title);
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute("content", "Описание курса");
    expect(document.querySelector('meta[property="og:title"]')).toHaveAttribute("content", title);
    expect(document.querySelector('meta[property="og:description"]')).toHaveAttribute("content", "Описание курса");
    cleanup();
    expect(document.title).toBe("Клуб");
    expect(document.querySelector('meta[name="description"]')).toHaveAttribute("content", "Описание клуба");
    expect(document.querySelector('meta[property="og:title"]')).toBeNull();
  });

  it("leaves existing metadata untouched for empty or invalid settings", () => {
    document.head.innerHTML = '<title>Клуб</title>';
    const cleanup = applySitePageSeo({ title: {}, description: null });
    expect(document.title).toBe("Клуб");
    expect(document.querySelector("meta")).toBeNull();
    cleanup();
  });
});
