import type { ReactNode } from "react";

function trimSentenceEnding(value: string): string {
  let end = value;
  const brackets: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  while (end) {
    const last = end.at(-1)!;
    if (/[.,!?;:»]/.test(last)) {
      end = end.slice(0, -1);
      continue;
    }
    const opening = brackets[last];
    if (opening && end.split(last).length > end.split(opening).length) {
      end = end.slice(0, -1);
      continue;
    }
    break;
  }
  return end;
}

/** Linkify plain addresses without interpreting customer text as HTML/Markdown. */
export function TicketMessageText({ text }: { text: string }) {
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const address = trimSentenceEnding(match[0]);
    try {
      const parsed = new URL(address);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) continue;
    } catch {
      continue;
    }
    const start = match.index!;
    content.push(text.slice(cursor, start));
    content.push(
      <a key={start} href={address} target="_blank" rel="noopener noreferrer"
        className="underline underline-offset-2 break-all">
        {address}
      </a>,
    );
    cursor = start + address.length;
  }
  content.push(text.slice(cursor));
  return <p className="text-sm whitespace-pre-wrap break-words">{content}</p>;
}
