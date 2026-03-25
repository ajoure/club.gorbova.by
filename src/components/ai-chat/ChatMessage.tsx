import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ChatMessage as ChatMessageType } from "@/hooks/useAiChat";

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessageBubble({ message }: ChatMessageProps) {
  const isUser = message.role === "user";
  const scenarioLabel = message.metadata?.launcher_title_snapshot || message.metadata?.prompt_title_snapshot;

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-3 ${
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
        <div className="text-sm whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  );
}
