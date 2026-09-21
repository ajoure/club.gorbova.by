import { useCallback, useRef, useState } from "react";

type FileType = "photo" | "video" | "audio" | "voice" | "video_note" | "document" | null;
type Draft = { message: string; file: File | null; fileType: FileType };
const EMPTY: Draft = { message: "", file: null, fileType: null };
const MAX_AGE = 24 * 60 * 60 * 1000;

/** Text survives a page reload in this tab; files remain in memory only.
 * Separate operator/contact/transport keys prevent replies crossing accounts.
 */
export function useTelegramDraft(operatorId: string | undefined, contactId: string, channelKey: string) {
  const key = JSON.stringify([operatorId, contactId, channelKey]);
  const storageKey = `contact-center:telegram-draft:v1:${key}`;
  const drafts = useRef<Record<string, Draft>>({});
  const [, render] = useState(0);
  if (!drafts.current[key]) {
    let message = "";
    if (operatorId) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
        if (saved && typeof saved.message === "string" && typeof saved.at === "number" && Date.now() - saved.at < MAX_AGE) message = saved.message;
      } catch { /* Storage denial/corruption must never interrupt typing. */ }
    }
    drafts.current[key] = { ...EMPTY, message };
  }
  const change = useCallback((update: (draft: Draft) => Draft) => {
    const previous = drafts.current[key] ?? EMPTY;
    const next = update(previous);
    drafts.current[key] = next;
    if (operatorId && previous.message !== next.message) {
      try {
        if (next.message) sessionStorage.setItem(storageKey, JSON.stringify({ message: next.message, at: Date.now() }));
        else sessionStorage.removeItem(storageKey);
      } catch { /* Keep the in-memory draft if browser storage is unavailable. */ }
    }
    render(version => version + 1);
  }, [key, operatorId, storageKey]);
  const setMessage = useCallback((value: string | ((old: string) => string)) => change(draft => ({ ...draft, message: typeof value === "function" ? value(draft.message) : value })), [change]);
  const setSelectedFile = useCallback((file: File | null) => change(draft => ({ ...draft, file })), [change]);
  const setSelectedFileType = useCallback((fileType: FileType) => change(draft => ({ ...draft, fileType })), [change]);
  const draft = drafts.current[key];
  return { message: draft.message, selectedFile: draft.file, selectedFileType: draft.fileType, setMessage, setSelectedFile, setSelectedFileType };
}
