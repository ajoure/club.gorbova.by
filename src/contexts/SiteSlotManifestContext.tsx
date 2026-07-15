/**
 * SiteSlotManifestContext — carries the resolved slot manifest from
 * SitePageBySlug down to nested HtmlSection blocks. Null when the page has
 * no dynamic slots or product data has not yet resolved.
 */
import { createContext, useContext } from "react";
import type { SiteSlotManifest } from "@/lib/siteSlotManifest";

export const SiteSlotManifestContext = createContext<SiteSlotManifest | null>(null);

export function useSiteSlotManifest(): SiteSlotManifest | null {
  return useContext(SiteSlotManifestContext);
}
