import { useState, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Send,
  Mail,
  MessageCircle,
  Users,
  Filter,
  Loader2,
  History,
  CheckCircle,
  XCircle,
  Sparkles,
  Eye,
  ChevronRight,
  Image,
  Video,
  Music,
  Circle,
  X,
  Paperclip,
  AlertTriangle,
  ExternalLink,
  MousePointerClick,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { BroadcastTemplatesSection } from "./BroadcastTemplatesSection";

import { TokenizedRichInput } from "@/components/admin/TokenizedRichInput";

type AudienceMode = "purchased" | "active_access";

interface AudienceRule {
  product_id: string;     // "" = любой продукт
  tariff_ids: string[];   // [] = все тарифы
  mode: AudienceMode;
}

interface BroadcastFilters {
  include: AudienceRule[];
  exclude: AudienceRule[];
  club_ids: string[];
  club_membership: "current" | "ever" | "any";
  bot_ids: string[];      // [] = primary bot
  channels?: ("telegram" | "email")[];
}

interface AudiencePreview {
  telegramCount: number;
  emailCount: number;
  totalCount: number;
  users: Array<{
    id: string;
    full_name: string | null;
    email: string | null;
    telegram_username: string | null;
    has_telegram: boolean;
    has_email: boolean;
  }>;
}

const EMPTY_RULE: AudienceRule = { product_id: "", tariff_ids: [], mode: "purchased" };

type MediaType = "photo" | "video" | "audio" | "video_note" | null;

interface MediaFile {
  type: MediaType;
  file: File;
  preview?: string;
}

export function BroadcastsTabContent() {
  const queryClient = useQueryClient();
  const [mainTab, setMainTab] = useState<"templates" | "quick">("templates");
  const [activeTab, setActiveTab] = useState<"telegram" | "email">("telegram");
  const [message, setMessage] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
const [includeButton, setIncludeButton] = useState(true);
  const [buttonText, setButtonText] = useState("Открыть платформу");
  const [buttonUrl, setButtonUrl] = useState("https://club.gorbova.by/products");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mediaFile, setMediaFile] = useState<MediaFile | null>(null);
  const [selectedBroadcast, setSelectedBroadcast] = useState<Record<string, unknown> | null>(null);


  const fileInputRef = useRef<HTMLInputElement>(null);

  const [filters, setFilters] = useState<BroadcastFilters>({
    include: [],
    exclude: [],
    club_ids: [],
    club_membership: "current",
    bot_ids: [],
  });

  // Build RPC payload (channels derived from active tab)
  const rpcFilters = useMemo(() => ({
    channels: ["telegram", "email"],
    include: filters.include,
    exclude: filters.exclude,
    club_ids: filters.club_ids,
    club_membership: filters.club_membership,
  }), [filters]);

  // cf warning: check if message/email contains cf.product tokens
  const hasCfTokens = useMemo(() => {
    const allText = message + emailSubject + emailBody;
    return allText.includes('{{cf.product.');
  }, [message, emailSubject, emailBody]);

  // Single product context for {{cf.product.*}} resolution:
  // only when there's exactly one include rule with a concrete product_id
  const productContextId = useMemo(() => {
    const concreteIncludes = filters.include.filter((r) => r.product_id);
    return concreteIncludes.length === 1 ? concreteIncludes[0].product_id : null;
  }, [filters.include]);

  const showCfWarning = hasCfTokens && !productContextId;

  // All product_ids referenced in include/exclude (for tariff fetch)
  const referencedProductIds = useMemo(() => {
    const ids = new Set<string>();
    [...filters.include, ...filters.exclude].forEach((r) => {
      if (r.product_id) ids.add(r.product_id);
    });
    return Array.from(ids);
  }, [filters]);

  // Fetch products
  const { data: products } = useQuery({
    queryKey: ["broadcast-products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products_v2")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  // Fetch tariffs for any referenced products
  const { data: tariffs } = useQuery({
    queryKey: ["broadcast-tariffs", referencedProductIds],
    queryFn: async () => {
      if (referencedProductIds.length === 0) return [];
      const { data } = await supabase
        .from("tariffs")
        .select("id, name, product_id")
        .in("product_id", referencedProductIds)
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: referencedProductIds.length > 0,
  });

  // Fetch telegram clubs
  const { data: clubs } = useQuery({
    queryKey: ["broadcast-clubs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("telegram_clubs")
        .select("id, club_name")
        .eq("is_active", true)
        .order("club_name");
      return data || [];
    },
  });

  // Fetch active telegram bots
  const { data: bots } = useQuery({
    queryKey: ["broadcast-bots"],
    queryFn: async () => {
      const { data } = await (supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => {
            eq: (c: string, v: string) => {
              order: (c: string, o: { ascending: boolean }) => Promise<{ data: Array<{ id: string; bot_name: string; bot_username: string; is_primary: boolean }> | null }>;
            };
          };
        };
      })
        .from("telegram_bots")
        .select("id, bot_name, bot_username, is_primary")
        .eq("status", "active")
        .order("bot_name", { ascending: true });
      return data || [];
    },
  });

  // Audience preview via RPC (single source of truth, used by edge funcs too)
  const { data: audience, isLoading: audienceLoading } = useQuery({
    queryKey: ["broadcast-audience-rpc", rpcFilters],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("resolve_broadcast_audience", {
        _filters: rpcFilters as unknown as Record<string, unknown>,
      });
      if (error) {
        console.error("[broadcast] audience rpc error", error);
        return { telegramCount: 0, emailCount: 0, totalCount: 0, users: [] } as AudiencePreview;
      }
      const r = (data ?? {}) as Record<string, unknown>;
      return {
        telegramCount: Number(r.telegram_count || 0),
        emailCount: Number(r.email_count || 0),
        totalCount: Number(r.total_count || 0),
        users: (r.users as AudiencePreview["users"]) || [],
      } satisfies AudiencePreview;
    },
    refetchInterval: false,
  });

  // Fetch broadcast history
  const { data: history } = useQuery({
    queryKey: ["broadcast-history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_logs")
        .select("*")
        .in("action", ["telegram_mass_broadcast", "email_mass_broadcast"])
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
  });
  // Fetch broadcast history
  const { data: history } = useQuery({
    queryKey: ["broadcast-history"],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_logs")
        .select("*")
        .in("action", ["telegram_mass_broadcast", "email_mass_broadcast"])
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
  });

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, type: MediaType) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const maxSize = type === "video" ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error(`Файл слишком большой. Максимум: ${type === "video" ? "50" : "10"} МБ`);
      return;
    }

    let preview: string | undefined;
    if (type === "photo" || type === "video") {
      preview = URL.createObjectURL(file);
    }

    setMediaFile({ type, file, preview });
  };

  const removeMedia = () => {
    if (mediaFile?.preview) {
      URL.revokeObjectURL(mediaFile.preview);
    }
    setMediaFile(null);
  };

  // Send Telegram broadcast
  const sendTelegramMutation = useMutation({
    mutationFn: async () => {
      if (mediaFile) {
        const formData = new FormData();
        formData.append("message", message.trim().replace(/\[\[align:(left|center|right)\]\]/g, ""));
        formData.append("include_button", String(includeButton));
        if (includeButton) {
          formData.append("button_text", buttonText);
          formData.append("button_url", buttonUrl);
        }
        formData.append("filters", JSON.stringify(filters));
        formData.append("media_type", mediaFile.type || "");
        formData.append("media", mediaFile.file);

        const { data: { session } } = await supabase.auth.getSession();
        
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-mass-broadcast`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session?.access_token}`,
            },
            body: formData,
          }
        );

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || "Failed to send broadcast");
        }

        return response.json();
      }

      const { data, error } = await supabase.functions.invoke("telegram-mass-broadcast", {
        body: {
          message: message.trim().replace(/\[\[align:(left|center|right)\]\]/g, ""),
          include_button: includeButton,
          button_text: includeButton ? buttonText : undefined,
          button_url: includeButton ? buttonUrl : undefined,
          filters,
          product_context_id: productContextId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Отправлено: ${data.sent}, ошибок: ${data.failed}`);
      setMessage("");
      removeMedia();
      queryClient.invalidateQueries({ queryKey: ["broadcast-history"] });
    },
    onError: (error) => {
      toast.error("Ошибка отправки: " + (error as Error).message);
    },
  });

  // Send Email broadcast
  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("email-mass-broadcast", {
        body: {
          subject: emailSubject.trim(),
          html: emailBody.trim(),
          filters,
          product_context_id: productContextId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Отправлено: ${data.sent}, ошибок: ${data.failed}`);
      setEmailSubject("");
      setEmailBody("");
      queryClient.invalidateQueries({ queryKey: ["broadcast-history"] });
    },
    onError: (error) => {
      toast.error("Ошибка отправки: " + (error as Error).message);
    },
  });

  // Send test message to admin
  const sendTestMutation = useMutation<unknown, Error, void>({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: bots } = await (supabase as any)
        .from("telegram_bots")
        .select("id")
        .eq("status", "active")
        .limit(1);
      
      if (!bots?.length) throw new Error("Нет активного бота");
      
      const { data, error } = await supabase.functions.invoke("telegram-send-test", {
        body: {
          botId: bots[0].id,
          messageText: message.trim().replace(/\[\[align:(left|center|right)\]\]/g, ""),
          buttonText: includeButton ? buttonText : undefined,
          buttonUrl: includeButton ? buttonUrl : undefined,
          product_context_id: productContextId,
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Тестовое сообщение отправлено вам в Telegram");
    },
    onError: (error) => {
      toast.error("Ошибка: " + error.message);
    },
  });

  const handleSend = () => {
    if (activeTab === "telegram") {
      if (!message.trim() && !mediaFile) {
        toast.error("Введите текст сообщения или добавьте медиа");
        return;
      }
      sendTelegramMutation.mutate();
    } else {
      if (!emailSubject.trim() || !emailBody.trim()) {
        toast.error("Заполните тему и текст письма");
        return;
      }
      sendEmailMutation.mutate();
    }
  };

  const isSendDisabled =
    (activeTab === "telegram" && !message.trim() && !mediaFile) ||
    (activeTab === "email" && (!emailSubject.trim() || !emailBody.trim())) ||
    sendTelegramMutation.isPending ||
    sendEmailMutation.isPending;

  return (
    <div className="container max-w-6xl py-6 space-y-6 overflow-auto h-full">
      {/* Main Tabs: Templates vs Quick Send */}
      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as "templates" | "quick")}>
        <TabsList>
          <TabsTrigger value="templates">📋 Шаблоны</TabsTrigger>
          <TabsTrigger value="quick">⚡ Быстрая рассылка</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-6">
          <BroadcastTemplatesSection />
        </TabsContent>

        <TabsContent value="quick" className="mt-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Channel Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "telegram" | "email")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="telegram" className="gap-2">
                <MessageCircle className="h-4 w-4" />
                Telegram
                {audience && (
                  <Badge variant="secondary" className="ml-1">
                    {audience.telegramCount}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="email" className="gap-2">
                <Mail className="h-4 w-4" />
                Email
                {audience && (
                  <Badge variant="secondary" className="ml-1">
                    {audience.emailCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="telegram" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Telegram-рассылка</CardTitle>
                  <CardDescription>
                    Сообщение будет отправлено всем пользователям с привязанным Telegram
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Media attachment */}
                  {mediaFile ? (
                    <div className="relative rounded-lg border p-3 bg-muted/50">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-1 right-1 h-6 w-6"
                        onClick={removeMedia}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                      <div className="flex items-center gap-3">
                        {mediaFile.type === "photo" && mediaFile.preview && (
                          <img
                            src={mediaFile.preview}
                            alt="Preview"
                            className="w-20 h-20 object-cover rounded"
                          />
                        )}
                        {mediaFile.type === "video" && (
                          <div className="w-20 h-20 bg-muted rounded flex items-center justify-center">
                            <Video className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        {mediaFile.type === "audio" && (
                          <div className="w-20 h-20 bg-muted rounded flex items-center justify-center">
                            <Music className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        {mediaFile.type === "video_note" && (
                          <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center">
                            <Circle className="h-8 w-8 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{mediaFile.file.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {(mediaFile.file.size / 1024 / 1024).toFixed(2)} МБ
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="file"
                          ref={fileInputRef}
                          className="hidden"
                          accept="image/*,video/*,audio/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const type = file.type.startsWith("image/")
                                ? "photo"
                                : file.type.startsWith("video/")
                                ? "video"
                                : file.type.startsWith("audio/")
                                ? "audio"
                                : null;
                              if (type) {
                                handleFileSelect(e, type);
                              }
                            }
                          }}
                        />
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="gap-2">
                              <Paperclip className="h-4 w-4" />
                              Вложение
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-40 p-2" align="start">
                            <div className="space-y-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = "image/*";
                                    fileInputRef.current.click();
                                  }
                                }}
                              >
                                <Image className="h-4 w-4" />
                                Фото
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = "video/*";
                                    fileInputRef.current.click();
                                  }
                                }}
                              >
                                <Video className="h-4 w-4" />
                                Видео
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = "audio/*";
                                    fileInputRef.current.click();
                                  }
                                }}
                              >
                                <Music className="h-4 w-4" />
                                Аудио
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="w-full justify-start gap-2"
                                onClick={() => {
                                  if (fileInputRef.current) {
                                    fileInputRef.current.accept = "video/mp4";
                                    fileInputRef.current.click();
                                  }
                                }}
                              >
                                <Circle className="h-4 w-4" />
                                Кружок
                              </Button>
                            </div>
                          </PopoverContent>
                        </Popover>
                        <span className="text-xs text-muted-foreground">
                          до 10 МБ, видео до 50 МБ
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Текст сообщения {mediaFile && "(подпись)"}</Label>
                    <TokenizedRichInput
                      value={message}
                      onChange={setMessage}
                      placeholder="Введите текст сообщения для рассылки..."
                      rows={6}
                    />
                    {showCfWarning && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          Для подстановки полей продукта выберите конкретный продукт в фильтре справа.
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>


                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="includeButton"
                        checked={includeButton}
                        onCheckedChange={setIncludeButton}
                      />
                      <Label htmlFor="includeButton" className="cursor-pointer">
                        Добавить кнопку-ссылку
                      </Label>
                    </div>
                  </div>

                  {includeButton && (
                    <div className="space-y-3 pl-4 border-l-2 border-muted">
                      <div className="space-y-2">
                        <Label>Текст кнопки</Label>
                        <Input
                          value={buttonText}
                          onChange={(e) => setButtonText(e.target.value)}
                          placeholder="Открыть платформу"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>URL кнопки</Label>
                        <Input
                          value={buttonUrl}
                          onChange={(e) => setButtonUrl(e.target.value)}
                          placeholder="https://club.gorbova.by/products"
                        />
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="email" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg">Email-рассылка</CardTitle>
                  <CardDescription>
                    Письмо будет отправлено на указанные email-адреса
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Тема письма</Label>
                    <TokenizedRichInput
                      value={emailSubject}
                      onChange={setEmailSubject}
                      placeholder="Тема письма..."
                      singleLine
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Текст письма (HTML)</Label>
                    <TokenizedRichInput
                      value={emailBody}
                      onChange={setEmailBody}
                      placeholder="<h1>Заголовок</h1><p>Текст письма...</p>"
                      rows={8}
                      allowAlign
                    />
                  </div>

                  {showCfWarning && (
                    <Alert variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Для подстановки полей продукта выберите конкретный продукт в фильтре справа.
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>

          {/* Send Buttons */}
          <div className="flex gap-2">
            {activeTab === "telegram" && (
              <Button
                variant="outline"
                onClick={() => sendTestMutation.mutate()}
                disabled={!message.trim() || sendTestMutation.isPending}
              >
                {sendTestMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                🧪 Тест себе
              </Button>
            )}
            <Button
              size="lg"
              className="flex-1 gap-2"
              onClick={handleSend}
              disabled={isSendDisabled}
            >
              {(sendTelegramMutation.isPending || sendEmailMutation.isPending) ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Отправка...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Отправить {activeTab === "telegram" ? "в Telegram" : "на Email"}
                  {audience && (
                    <Badge variant="secondary" className="ml-2">
                      {activeTab === "telegram" ? audience.telegramCount : audience.emailCount} получателей
                    </Badge>
                  )}
                </>
              )}
            </Button>
          </div>

          {/* History */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="h-5 w-5" />
                История рассылок
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history?.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Пока нет отправленных рассылок
                </p>
              ) : (
                <div className="space-y-3">
                  {history?.map((item) => {
                    const meta = item.meta as Record<string, unknown> | null;
                    const sent = Number(meta?.sent || 0);
                    const failed = Number(meta?.failed || 0);
                    const isTelegram = item.action === "telegram_mass_broadcast";

                    return (
                      <button
                        key={item.id}
                        onClick={() => setSelectedBroadcast({ ...item, _meta: meta })}
                        className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors w-full text-left cursor-pointer"
                      >
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                            isTelegram ? "bg-blue-100 text-blue-600" : "bg-orange-100 text-orange-600"
                          }`}
                        >
                          {isTelegram ? (
                            <MessageCircle className="h-5 w-5" />
                          ) : (
                            <Mail className="h-5 w-5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {String(meta?.message_preview || meta?.subject || "Рассылка")
                              .replace(/[,\s]*\{\{(?:\w+(?:\.\w+)*)\}\}[,\s]*/g, ' ')
                              .replace(/\s{2,}/g, ' ')
                              .trim() || "Рассылка"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(item.created_at), "dd MMM yyyy, HH:mm", {
                              locale: ru,
                            })}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="gap-1">
                            <CheckCircle className="h-3 w-3 text-green-500" />
                            {sent}
                          </Badge>
                          {failed > 0 && (
                            <Badge variant="outline" className="gap-1">
                              <XCircle className="h-3 w-3 text-red-500" />
                              {failed}
                            </Badge>
                          )}
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Filters & Preview */}
        <div className="space-y-6">
          {/* Filters */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Filter className="h-5 w-5" />
                Фильтры аудитории
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="activeSubscription" className="cursor-pointer text-sm">
                  Только с активной подпиской
                </Label>
                <Switch
                  id="activeSubscription"
                  checked={filters.hasActiveSubscription}
                  onCheckedChange={(v) =>
                    setFilters((f) => ({ ...f, hasActiveSubscription: v }))
                  }
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Продукт</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start font-normal">
                      {filters.productIds.length === 0
                        ? "Все продукты"
                        : `Выбрано: ${filters.productIds.length}`}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3" align="start">
                    <div className="space-y-2">
                      {products?.map((p) => (
                        <label key={p.id} className="flex items-center gap-2 cursor-pointer">
                          <Checkbox
                            checked={filters.productIds.includes(p.id)}
                            onCheckedChange={(checked) => {
                              setFilters((f) => {
                                const next = checked
                                  ? [...f.productIds, p.id]
                                  : f.productIds.filter((id) => id !== p.id);
                                // Remove tariffs that no longer belong to selected products
                                const validTariffIds = f.tariffIds.filter((tid) =>
                                  tariffs?.some((t) => t.id === tid && next.includes(t.product_id))
                                );
                                return { ...f, productIds: next, tariffIds: validTariffIds };
                              });
                            }}
                          />
                          <span className="text-sm">{p.name}</span>
                        </label>
                      ))}
                      {(products?.length ?? 0) === 0 && (
                        <p className="text-sm text-muted-foreground">Нет активных продуктов</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {filters.productIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {filters.productIds.map((pid) => {
                      const name = products?.find((p) => p.id === pid)?.name;
                      return (
                        <Badge key={pid} variant="secondary" className="text-xs gap-1">
                          {name}
                          <button
                            onClick={() =>
                              setFilters((f) => ({
                                ...f,
                                productIds: f.productIds.filter((id) => id !== pid),
                                tariffIds: f.tariffIds.filter((tid) =>
                                  tariffs?.some((t) => t.id === tid && t.product_id !== pid)
                                ),
                              }))
                            }
                            className="ml-0.5 hover:text-destructive"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                )}
              </div>

              {filters.productIds.length > 0 && tariffs && tariffs.length > 0 && (
                <div className="space-y-2">
                  <Label>Тариф</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="w-full justify-start font-normal">
                        {filters.tariffIds.length === 0
                          ? "Все тарифы"
                          : `Выбрано: ${filters.tariffIds.length}`}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-3" align="start">
                      <ScrollArea className="max-h-60">
                        <div className="space-y-3">
                          {filters.productIds.map((pid) => {
                            const productName = products?.find((p) => p.id === pid)?.name;
                            const productTariffs = tariffs?.filter((t) => t.product_id === pid) || [];
                            if (productTariffs.length === 0) return null;
                            return (
                              <div key={pid}>
                                {filters.productIds.length > 1 && (
                                  <p className="text-xs font-medium text-muted-foreground mb-1">
                                    {productName}
                                  </p>
                                )}
                                <div className="space-y-2">
                                  {productTariffs.map((t) => (
                                    <label key={t.id} className="flex items-center gap-2 cursor-pointer">
                                      <Checkbox
                                        checked={filters.tariffIds.includes(t.id)}
                                        onCheckedChange={(checked) => {
                                          setFilters((f) => ({
                                            ...f,
                                            tariffIds: checked
                                              ? [...f.tariffIds, t.id]
                                              : f.tariffIds.filter((id) => id !== t.id),
                                          }));
                                        }}
                                      />
                                      <span className="text-sm">{t.name}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </PopoverContent>
                  </Popover>
                  {filters.tariffIds.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {filters.tariffIds.map((tid) => {
                        const name = tariffs?.find((t) => t.id === tid)?.name;
                        return (
                          <Badge key={tid} variant="outline" className="text-xs gap-1">
                            {name}
                            <button
                              onClick={() =>
                                setFilters((f) => ({
                                  ...f,
                                  tariffIds: f.tariffIds.filter((id) => id !== tid),
                                }))
                              }
                              className="ml-0.5 hover:text-destructive"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <Label>Telegram-клуб</Label>
                <Select
                  value={filters.clubId || "all"}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, clubId: v === "all" ? "" : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Все клубы" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все клубы</SelectItem>
                    {clubs?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.club_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {/* Audience Summary */}
              <div className="rounded-lg bg-gradient-to-br from-primary/10 to-primary/5 p-4 space-y-3">
                <h4 className="font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Аудитория
                </h4>
                {audienceLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Подсчёт...
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <MessageCircle className="h-4 w-4 text-blue-500" />
                        Telegram
                      </span>
                      <span className="font-medium">{audience?.telegramCount || 0}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-orange-500" />
                        Email
                      </span>
                      <span className="font-medium">{audience?.emailCount || 0}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Preview Button */}
              <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
                <SheetTrigger asChild>
                  <Button variant="outline" className="w-full gap-2">
                    <Eye className="h-4 w-4" />
                    Просмотр получателей
                  </Button>
                </SheetTrigger>
                <SheetContent>
                  <SheetHeader>
                    <SheetTitle>Получатели рассылки</SheetTitle>
                    <SheetDescription>
                      Первые 50 из {audience?.totalCount || 0} получателей
                    </SheetDescription>
                  </SheetHeader>
                  <ScrollArea className="h-[calc(var(--app-height)-150px)] mt-4">
                    <div className="space-y-2">
                      {audience?.users.map((user) => (
                        <div
                          key={user.id}
                          className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {user.full_name || "Без имени"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {user.email || "—"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            {user.has_telegram && (
                              <MessageCircle className="h-4 w-4 text-blue-500" />
                            )}
                            {user.has_email && <Mail className="h-4 w-4 text-orange-500" />}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </SheetContent>
              </Sheet>
            </CardContent>
          </Card>

          {/* Tips */}
          <Card className="border-dashed">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="space-y-2 text-sm">
                  <p className="font-medium">Советы по рассылкам</p>
                  <ul className="space-y-1 text-muted-foreground">
                    <li className="flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      Персонализируйте сообщения
                    </li>
                    <li className="flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      Не отправляйте слишком часто
                    </li>
                    <li className="flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      Добавляйте призыв к действию
                    </li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
        </TabsContent>
      </Tabs>

      {/* Broadcast detail dialog */}
      <Dialog open={!!selectedBroadcast} onOpenChange={(open) => !open && setSelectedBroadcast(null)}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedBroadcast?.action === "telegram_mass_broadcast" ? (
                <MessageCircle className="h-5 w-5" />
              ) : (
                <Mail className="h-5 w-5" />
              )}
              Детали рассылки
            </DialogTitle>
          </DialogHeader>
          {selectedBroadcast && (() => {
            const m = (selectedBroadcast._meta || selectedBroadcast.meta) as Record<string, unknown> | null;
            const fullText = String(m?.message_template || m?.message_preview || m?.subject || "—");
            const btnText = m?.button_text as string | null;
            const btnUrl = m?.button_url as string | null;
            const includeBtn = m?.include_button as boolean | undefined;
            const filtersData = m?.filters as Record<string, unknown> | null;
            const sentCount = Number(m?.sent || 0);
            const failedCount = Number(m?.failed || 0);
            return (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Дата</p>
                  <p className="text-sm">
                    {format(new Date(selectedBroadcast.created_at as string), "dd MMMM yyyy, HH:mm", { locale: ru })}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Текст сообщения</p>
                  <div className="rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
                    {fullText}
                  </div>
                </div>

                {includeBtn && btnText && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Кнопка</p>
                    <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
                      <MousePointerClick className="h-4 w-4 shrink-0" />
                      <span className="font-medium">{btnText}</span>
                      {btnUrl && (
                        <a href={btnUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-primary hover:underline flex items-center gap-1 text-xs">
                          <ExternalLink className="h-3 w-3" />
                          Ссылка
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex gap-4">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Отправлено</p>
                    <Badge variant="outline" className="gap-1">
                      <CheckCircle className="h-3 w-3 text-green-500" />
                      {sentCount}
                    </Badge>
                  </div>
                  {failedCount > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Ошибки</p>
                      <Badge variant="outline" className="gap-1">
                        <XCircle className="h-3 w-3 text-red-500" />
                        {failedCount}
                      </Badge>
                    </div>
                  )}
                </div>

                {filtersData && Object.keys(filtersData).length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Фильтры</p>
                    <div className="rounded-lg bg-muted p-3 text-xs space-y-1">
                      {(filtersData.productIds as string[])?.length > 0 && (
                        <p>Продукты: {(filtersData.productIds as string[]).length} шт.</p>
                      )}
                      {(filtersData.tariffIds as string[])?.length > 0 && (
                        <p>Тарифы: {(filtersData.tariffIds as string[]).length} шт.</p>
                      )}
                      {filtersData.hasActiveSubscription && <p>Только с активной подпиской</p>}
                      {filtersData.clubId && <p>Клуб: задан</p>}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
