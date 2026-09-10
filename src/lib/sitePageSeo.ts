/** Apply configured public-page metadata, restoring the previous route on exit. */
export function applySitePageSeo(settings: Record<string, unknown>): () => void {
  const title = typeof settings.title === "string" ? settings.title.trim() : "";
  const description = typeof settings.description === "string" ? settings.description.trim() : "";
  const previousTitle = document.title;
  const restore: Array<() => void> = [];

  if (title) document.title = title;
  const fields = [
    ["name", "description", description],
    ["property", "og:title", title],
    ["property", "og:description", description],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
  ];
  for (const [attribute, key, value] of fields) {
    if (!value) continue;
    const existing = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
    const meta = existing ?? document.createElement("meta");
    const previous = meta.getAttribute("content");
    if (!existing) {
      meta.setAttribute(attribute, key);
      document.head.appendChild(meta);
    }
    meta.content = value;
    restore.push(() => {
      if (!existing) meta.remove();
      else if (previous === null) meta.removeAttribute("content");
      else meta.content = previous;
    });
  }
  return () => {
    if (title) document.title = previousTitle;
    restore.forEach((fn) => fn());
  };
}
