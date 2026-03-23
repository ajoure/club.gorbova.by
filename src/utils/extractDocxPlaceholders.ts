/**
 * Extract {{placeholder}} tokens from a .docx file.
 * Uses mammoth to get raw text, then regex to find tokens.
 */
import mammoth from "mammoth";

export async function extractDocxPlaceholders(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const text = result.value;

  const regex = /\{\{([^}]+)\}\}/g;
  const tokens = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    tokens.add(match[1].trim());
  }

  return Array.from(tokens).sort();
}
