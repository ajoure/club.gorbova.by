export type RoomEntryIdentityDecision = "skip" | "reuse" | "prompt";

export function decideRoomEntryIdentity({
  nameRequired,
  savedDisplayName,
  hadSessionOnLoad,
  isReload,
  roomActive,
}: {
  nameRequired: boolean;
  savedDisplayName: string | null | undefined;
  hadSessionOnLoad: boolean;
  isReload: boolean;
  roomActive: boolean;
}): RoomEntryIdentityDecision {
  if (!nameRequired) return "skip";
  if (!roomActive) return "skip";
  if (savedDisplayName?.trim() && hadSessionOnLoad && isReload) return "reuse";
  return "prompt";
}
