import { useState } from "react";
import { Bot, Copy, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage as ChatMessageType } from "@/hooks/useAiChat";

interface ChatMessageProps {
  message: ChatMessageType;
}

const markdownComponents = {
  h1: ({ children }: any) => (
    <h1 className="text-lg font-bold mt-4 mb-2 pb-1 border-b border-border/40 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: any) => (
    <h2 className="text-base font-semibold mt-3 mb-1.5 pb-0.5 border-b border-border/20 first:mt-0">{children}</h2>
  ),
  h3: ({ children }: any) => (
    <h3 className="text-sm font-semibold mt-2 mb-1 first:mt-0">{children}</h3>
  ),
  p: ({ children }: any) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }: any) => <ul className="list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
  li: ({ children }: any) => <li className="text-sm">{children}</li>,
  strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
  table: ({ children }: any) => (
    <div className="overflow-x-auto my-2 -mx-1 rounded-lg border border-border/40">
      <table className="min-w-full text-xs border-collapse">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: any) => <thead className="bg-muted/60">{children}</thead>,
  tr: ({ children }: any) => (
    <tr className="even:bg-muted/30">{children}</tr>
  ),
  th: ({ children }: any) => (
    <th className="px-2.5 py-1.5 text-left font-semibold border-b border-border/30 whitespace-nowrap">{children}</th>
  ),
  td: ({ children }: any) => (
    <td className="px-2.5 py-1.5 border-b border-border/20">{children}</td>
  ),
  hr: () => <hr className="my-3 border-border/30" />,
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 border-primary/30 pl-3 my-2 text-muted-foreground italic">{children}</blockquote>
  ),
};

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback silent
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleCopy}
      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
    >
      {copied ? (
        <>
          <Check className="h-3 w-3 text-green-500" />
          <span>Скопировано</span>
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" />
          <span>Копировать</span>
        </>
      )}
    </Button>
  );
}

export function ChatMessageBubble({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const scenarioLabel = message.metadata?.launcher_title_snapshot || message.metadata?.prompt_title_snapshot;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] sm:max-w-[70%] ${isUser ? "" : ""}`}>
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? "bg-primary text-primary-foreground rounded-br-md"
              : "bg-muted rounded-bl-md"
          }`}
        >
          {!isUser && (
            <div className="flex items-center gap-2 mb-2">
              <div className="p-1 rounded-full bg-primary/10">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <span className="text-xs font-medium text-primary">gorbova AI</span>
              {scenarioLabel && (
                <Badge variant="secondary" className="text-[10px]">{scenarioLabel}</Badge>
              )}
            </div>
          )}
          {message.metadata?.file_names && message.metadata.file_names.length > 0 && isUser && (
            <div className="flex flex-wrap gap-1 mb-2">
              {message.metadata.file_names.map((fn, i) => (
                <Badge key={i} variant="outline" className="text-[10px]">📎 {fn}</Badge>
              ))}
            </div>
          )}
          {isUser ? (
            <div className="text-sm whitespace-pre-wrap">{message.content}</div>
          ) : (
            <div className="text-sm prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </div>
        {!isUser && message.id !== "welcome" && (
          <div className="flex justify-start mt-1 ml-1">
            <CopyButton content={message.content} />
          </div>
        )}
      </div>
    </div>
  );
}
