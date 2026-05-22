/**
 * Patch docProps/core.xml inside a PizZip-loaded DOCX archive.
 *
 * Reason: rendered DOCX inherits <dc:title>, <dc:creator>, <cp:lastModifiedBy>,
 * <dc:subject>, <dc:description>, <cp:keywords> from the original template
 * file. When a template was first saved years ago in Word with a different
 * filename (e.g. "Клиенты - январь - 01-2019"), that title persists in
 * every generated document and shows up in browser tabs / PDF metadata.
 *
 * This helper normalises core.xml on the fly so each generated document
 * carries its actual rendered file name as <dc:title>.
 *
 * Used by:
 *   - canonical-document-generate-strict
 *   - ai-generate-document
 *   - generate-from-template
 */

type PizZipLike = {
  file(path: string): { asText(): string } | null;
  file(path: string, content: string): unknown;
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function setOrInsertTag(xml: string, tag: string, value: string): string {
  // Matches both empty self-closing and content forms.
  const reFull = new RegExp(`<${tag}(\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "i");
  const reSelf = new RegExp(`<${tag}(\\s[^>]*)?/>`, "i");
  const replacement = `<${tag}>${value}</${tag}>`;
  if (reFull.test(xml)) return xml.replace(reFull, replacement);
  if (reSelf.test(xml)) return xml.replace(reSelf, replacement);
  // Insert before </cp:coreProperties>.
  return xml.replace(/<\/cp:coreProperties>/i, `${replacement}</cp:coreProperties>`);
}

function buildMinimalCoreXml(props: {
  title: string;
  creator: string;
  nowIso: string;
}): string {
  const t = escapeXml(props.title);
  const c = escapeXml(props.creator);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${t}</dc:title>
<dc:subject></dc:subject>
<dc:creator>${c}</dc:creator>
<cp:keywords></cp:keywords>
<dc:description></dc:description>
<cp:lastModifiedBy>${c}</cp:lastModifiedBy>
<cp:revision>1</cp:revision>
<dcterms:created xsi:type="dcterms:W3CDTF">${props.nowIso}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${props.nowIso}</dcterms:modified>
</cp:coreProperties>`;
}

export function patchDocxCoreProps(
  zip: PizZipLike,
  props: { title?: string; creator?: string },
): void {
  const title = (props.title || "Document").trim() || "Document";
  const creator = (props.creator || "Gorbova Club").trim() || "Gorbova Club";
  const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const entry = zip.file("docProps/core.xml") as { asText(): string } | null;
  if (!entry) {
    zip.file("docProps/core.xml", buildMinimalCoreXml({ title, creator, nowIso }));
    return;
  }

  let xml = entry.asText();
  const tTitle = escapeXml(title);
  const tCreator = escapeXml(creator);

  xml = setOrInsertTag(xml, "dc:title", tTitle);
  xml = setOrInsertTag(xml, "dc:creator", tCreator);
  xml = setOrInsertTag(xml, "cp:lastModifiedBy", tCreator);
  xml = setOrInsertTag(xml, "dc:subject", "");
  xml = setOrInsertTag(xml, "dc:description", "");
  xml = setOrInsertTag(xml, "cp:keywords", "");
  xml = setOrInsertTag(xml, "dcterms:modified", nowIso);

  zip.file("docProps/core.xml", xml);
}
