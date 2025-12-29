import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";

interface WebhookUrlDisplayProps {
  instanceId: string;
  provider: string;
}

export function WebhookUrlDisplay({ instanceId, provider }: WebhookUrlDisplayProps) {
  const [copied, setCopied] = useState(false);

  // Generate webhook URL based on provider
  const getWebhookUrl = () => {
    const baseUrl = import.meta.env.VITE_SUPABASE_URL;
    
    switch (provider) {
      case "amocrm":
        return `${baseUrl}/functions/v1/amocrm-webhook`;
      case "bepaid":
        return `${baseUrl}/functions/v1/bepaid-webhook`;
      case "getcourse":
        return `${baseUrl}/functions/v1/getcourse-webhook?instance_id=${instanceId}`;
      default:
        return null;
    }
  };

  const webhookUrl = getWebhookUrl();

  if (!webhookUrl) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast.success("URL скопирован");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Webhook URL</Label>
      <div className="flex gap-2">
        <Input
          value={webhookUrl}
          readOnly
          className="font-mono text-xs"
        />
        <Button
          variant="outline"
          size="icon"
          onClick={handleCopy}
          className="shrink-0"
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Используйте этот URL для получения уведомлений от {provider}
      </p>
    </div>
  );
}
