import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GlassCard } from "@/components/ui/GlassCard";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, AlertTriangle, FileText, MessageSquare, Loader2, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface NewsItem {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  source: string;
  source_url: string | null;
  created_at: string;
}

interface NewsDetailDialogProps {
  item: NewsItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function NewsDetailDialog({ item, open, onOpenChange }: NewsDetailDialogProps) {
  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="text-lg leading-tight pr-6">{item.title}</DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-4 pr-4">
            {/* Full content or summary */}
            <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
              {item.content || item.summary || "Содержимое отсутствует"}
            </div>
          </div>
        </ScrollArea>

        {/* Footer with source */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="text-xs text-muted-foreground">
            <span>{item.source}</span>
            {item.created_at && (
              <span className="ml-2">
                • {format(new Date(item.created_at), "d MMMM yyyy", { locale: ru })}
              </span>
            )}
          </div>
          {item.source_url && (
            <Button variant="outline" size="sm" asChild>
              <a href={item.source_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Источник
              </a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NewsCard({ 
  item, 
  type, 
  onClick 
}: { 
  item: NewsItem; 
  type: "digest" | "comments" | "urgent";
  onClick: () => void;
}) {
  return (
    <div 
      className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground line-clamp-2 group-hover:text-primary transition-colors">
            {item.title}
          </h4>
          {(type === "digest" || type === "comments") && item.summary && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.summary}</p>
          )}
          <p className="text-[10px] text-muted-foreground/70 mt-1.5">{item.source}</p>
        </div>
        {item.source_url && (
          <a
            href={item.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 p-1.5 rounded-md hover:bg-primary/10 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
          </a>
        )}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-6 text-center text-muted-foreground text-sm">
      {message}
    </div>
  );
}

export function NewsBlock() {
  const [country, setCountry] = useState<string>("by");
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);

  // Fetch news from database
  const { data: allNews, isLoading } = useQuery({
    queryKey: ["news-content"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news_content")
        .select("id, title, summary, content, source, source_url, country, category, created_at")
        .eq("is_published", true)
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
  });

  // Filter news by country and category
  const getNewsForCategory = (cat: string) => {
    if (!allNews) return [];
    return allNews
      .filter((n) => n.country === country && n.category === cat)
      .slice(0, 5); // Limit to 5 items per category
  };

  const digest = getNewsForCategory("digest");
  const comments = getNewsForCategory("comments");
  const urgent = getNewsForCategory("urgent");

  return (
    <>
      <GlassCard className="p-4 md:p-6">
        <div className="space-y-4">
          {/* Country Selector */}
          <div className="flex items-center justify-between">
            <h3 className="text-base md:text-lg font-semibold text-foreground">Новости права</h3>
            <ToggleGroup 
              type="single" 
              value={country} 
              onValueChange={(v) => v && setCountry(v)}
              className="bg-muted/70 p-0.5 rounded-lg border border-border/30"
            >
              <ToggleGroupItem 
                value="by" 
                className="text-xs px-3 py-1.5 font-medium text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:font-semibold data-[state=on]:shadow-sm transition-all"
              >
                Беларусь
              </ToggleGroupItem>
              <ToggleGroupItem 
                value="ru" 
                className="text-xs px-3 py-1.5 font-medium text-muted-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:font-semibold data-[state=on]:shadow-sm transition-all"
              >
                Россия
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Content Tabs */}
          <Tabs defaultValue="digest" className="w-full">
            <TabsList className="w-full grid grid-cols-3 h-9">
              <TabsTrigger value="digest" className="text-xs gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Дайджест</span>
              </TabsTrigger>
              <TabsTrigger value="comments" className="text-xs gap-1.5">
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Комментарии</span>
              </TabsTrigger>
              <TabsTrigger value="urgent" className="text-xs gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Срочно</span>
              </TabsTrigger>
            </TabsList>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <TabsContent value="digest" className="mt-3 space-y-2">
                  {digest.length > 0 ? (
                    digest.map((item) => (
                      <NewsCard 
                        key={item.id} 
                        item={item} 
                        type="digest" 
                        onClick={() => setSelectedNews(item)}
                      />
                    ))
                  ) : (
                    <EmptyState message="Нет новостей в дайджесте" />
                  )}
                </TabsContent>

                <TabsContent value="comments" className="mt-3 space-y-2">
                  {comments.length > 0 ? (
                    comments.map((item) => (
                      <NewsCard 
                        key={item.id} 
                        item={item} 
                        type="comments" 
                        onClick={() => setSelectedNews(item)}
                      />
                    ))
                  ) : (
                    <EmptyState message="Нет комментариев госорганов" />
                  )}
                </TabsContent>

                <TabsContent value="urgent" className="mt-3 space-y-2">
                  {urgent.length > 0 ? (
                    urgent.map((item) => (
                      <NewsCard 
                        key={item.id} 
                        item={item} 
                        type="urgent" 
                        onClick={() => setSelectedNews(item)}
                      />
                    ))
                  ) : (
                    <EmptyState message="Срочных новостей нет" />
                  )}
                </TabsContent>
              </>
            )}
          </Tabs>
        </div>
      </GlassCard>

      {/* News Detail Dialog */}
      <NewsDetailDialog
        item={selectedNews}
        open={!!selectedNews}
        onOpenChange={(open) => !open && setSelectedNews(null)}
      />
    </>
  );
}
