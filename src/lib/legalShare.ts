export const getLegalSharePath = (ref: string, anchor?: string | null) =>
  `/l/${encodeURIComponent(ref)}${anchor ? `/${encodeURIComponent(anchor)}` : ""}`;

export const getLegalShareUrl = (ref: string, anchor?: string | null) => {
  return `https://gorbova.by${getLegalSharePath(ref, anchor)}`;
};

export const getLegalDocumentPath = (slug: string, anchor?: string | null) =>
  `/knowledge/laws/${encodeURIComponent(slug)}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;

export const getLegalAnchorLabel = (anchor?: string | null) => {
  if (!anchor?.startsWith("art-")) return null;
  const match = anchor.match(/^art-([^-]+(?:-[^-]+)*?)(?:-par-(\d+))?$/);
  if (!match) return null;
  const article = match[1].split("-").join(".");
  return match[2]
    ? `Статья ${article}, абзац ${match[2]}`
    : `Статья ${article}`;
};

export const getLegalOgImageUrl = (ref: string, anchor?: string | null) => {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const query = new URLSearchParams({ ref });
  if (anchor) query.set("anchor", anchor);
  return `${base}/functions/v1/legal-og-image?${query.toString()}`;
};

export const buildLegalShareText = (
  title: string,
  url: string,
  anchor?: string | null,
) => {
  const label = getLegalAnchorLabel(anchor);
  return `${label ? `${label}. ` : ""}${title}\n${url}`;
};
