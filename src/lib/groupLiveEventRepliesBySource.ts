export interface LiveEventReplySource {
  source_comment_id: string | null;
  source_question_id: string | null;
  created_at: string;
}

type ReplySourceKind = "comment" | "question";

export function groupLiveEventRepliesBySource<T extends LiveEventReplySource>(
  replies: readonly T[],
  sourceKind: ReplySourceKind,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const reply of replies) {
    const sourceId = sourceKind === "comment"
      ? reply.source_comment_id
      : reply.source_question_id;
    if (!sourceId) continue;

    const sourceReplies = grouped.get(sourceId) ?? [];
    sourceReplies.push(reply);
    grouped.set(sourceId, sourceReplies);
  }

  for (const sourceReplies of grouped.values()) {
    sourceReplies.sort(
      (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
    );
  }

  return grouped;
}
