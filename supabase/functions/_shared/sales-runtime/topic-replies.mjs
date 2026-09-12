// Detailed knowledge stays in model context. Only a separately reviewed short
// reply may be shown to the customer; never truncate a description into a pitch.
export function topicReplyText(fact) {
  const text = fact.reply_text;
  if (typeof text !== 'string' || !text.trim() || [...text.trim()].length > 200 ||
    /[?\uFF1F\u061F\p{Cc}<>]|https?:\/\/|www\.|[\w.%+-]+@[\w.-]+\.[a-z]{2,}|\+[0-9][0-9 ()-]{8,}|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./iu.test(text)) return null;
  return text.trim();
}
