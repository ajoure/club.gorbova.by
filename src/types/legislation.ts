export type LegalCategory = "codes" | "acts" | "other";

export interface LegalStructureNode {
  id: string;
  kind: "title" | "section" | "chapter" | "article" | "paragraph";
  label?: string;
  text: string;
  level: number;
}

export interface LegalDocument {
  id: string;
  external_id: string;
  slug: string;
  source: "etalon" | "manual";
  source_url: string | null;
  title: string;
  doc_type: string | null;
  doc_date: string | null;
  doc_number: string | null;
  category: LegalCategory;
  status: string;
  organ: string | null;
  effective_at: string | null;
  revision_label: string | null;
  content_text: string | null;
  content_html: string | null;
  structure: LegalStructureNode[];
  checksum: string | null;
  is_published: boolean;
  last_synced_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export type LegalDocumentPreview = Pick<
  LegalDocument,
  | "slug"
  | "title"
  | "doc_type"
  | "doc_date"
  | "doc_number"
  | "category"
  | "status"
  | "organ"
  | "effective_at"
  | "revision_label"
  | "source_url"
  | "last_synced_at"
>;

export interface LegalDocumentSharePreview {
  external_id: string;
  slug: string;
  title: string;
  doc_type: string | null;
  doc_date: string | null;
  doc_number: string | null;
  category: LegalCategory;
  status: string;
  revision_label: string | null;
}

export interface LegalSearchResult {
  document_id: string;
  slug: string;
  title: string;
  category: LegalCategory;
  status: string;
  doc_date: string | null;
  doc_number: string | null;
  anchor: string;
  kind: LegalStructureNode["kind"];
  snippet: string;
  rank: number;
}

export interface LegalDocumentCollectionRow {
  collection_code: string;
  collection_title: string;
  collection_description: string;
  collection_sort_order: number;
  document_sort_order: number;
  document_id: string;
  external_id: string;
  slug: string;
  title: string;
  doc_type: string | null;
  doc_date: string | null;
  doc_number: string | null;
  category: LegalCategory;
  status: string;
  last_synced_at: string | null;
}

export interface LegalDocumentSearchResult {
  document_id: string;
  anchor: string;
  kind: LegalStructureNode["kind"];
  snippet: string;
  full_text: string;
  rank: number;
}
