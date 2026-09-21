const DEFAULT_CHUNK_SIZE = 60_000;

/** Splits extracted statement text without cutting a row when possible. */
export function splitBankStatementText(
  text: string,
  maxChars = DEFAULT_CHUNK_SIZE,
): string[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let current = "";
  for (const line of normalized.split("\n")) {
    if (line.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let offset = 0; offset < line.length; offset += maxChars) {
        chunks.push(line.slice(offset, offset + maxChars));
      }
      continue;
    }

    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxChars) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
