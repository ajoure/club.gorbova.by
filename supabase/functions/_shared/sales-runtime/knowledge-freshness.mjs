/** Keep every editorial fact tied to the current transcript revision and hash. */
export function freshKnowledgeFacts(facts, transcriptMetadata) {
  const current = new Set(transcriptMetadata.map(t =>
    `${t.source_id}:${t.source_revision}:${t.content_sha256}`));
  return facts.filter(f => f?.classification === 'sales_safe' &&
    current.has(`${f.source_id}:${f.source_revision}:${f.source_sha256}`));
}
