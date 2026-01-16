import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GlassCard } from "@/components/ui/GlassCard";
import { ExternalLink, AlertTriangle, FileText, MessageSquare, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface NewsItem {
  id: string;
  title: string;
  summary: string | null;
  source: string;
  source_url: string | null;
}

function NewsCard({ item, type }: { item: NewsItem; type: "digest" | "comments" | "urgent" }) {
  return (
    <div className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground line-clamp-2">{item.title}</h4>
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

  // Fetch news from database
  const { data: allNews, isLoading } = useQuery({
    queryKey: ["news-content"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("news_content")
        .select("id, title, summary, source, source_url, country, category")
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
                    <NewsCard key={item.id} item={item} type="digest" />
                  ))
                ) : (
                  <EmptyState message="Нет новостей в дайджесте" />
                )}
              </TabsContent>

              <TabsContent value="comments" className="mt-3 space-y-2">
                {comments.length > 0 ? (
                  comments.map((item) => (
                    <NewsCard key={item.id} item={item} type="comments" />
                  ))
                ) : (
                  <EmptyState message="Нет комментариев госорганов" />
                )}
              </TabsContent>

              <TabsContent value="urgent" className="mt-3 space-y-2">
                {urgent.length > 0 ? (
                  urgent.map((item) => (
                    <NewsCard key={item.id} item={item} type="urgent" />
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
  );
}
