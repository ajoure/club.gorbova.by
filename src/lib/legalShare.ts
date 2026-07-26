export const getLegalSharePath = (ref: string, anchor?: string | null) =>
  `/l/${encodeURIComponent(ref)}${anchor ? `/${encodeURIComponent(anchor)}` : ""}`;

export const getLegalShareUrl = (ref: string, anchor?: string | null) => {
  const base = import.meta.env.VITE_SUPABASE_URL;
  return `${base}/functions/v1/l/${encodeURIComponent(ref)}${
    anchor ? `/${encodeURIComponent(anchor)}` : ""
  }`;
};

export const getLegalDocumentPath = (slug: string, anchor?: string | null) =>
  `/knowledge/laws/${encodeURIComponent(slug)}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;

export const getLegalAnchorLabel = (anchor?: string | null) => {
  if (!anchor?.startsWith("art-")) return null;
  return `Статья ${anchor.slice(4).split("-").join(".")}`;
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
