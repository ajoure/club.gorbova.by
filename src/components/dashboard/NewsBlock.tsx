import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GlassCard } from "@/components/ui/GlassCard";
import { ExternalLink, AlertTriangle, FileText, MessageSquare } from "lucide-react";

interface NewsItem {
  id: string;
  title: string;
  summary?: string;
  position?: string;
  source: string;
  sourceUrl: string;
}

// Mock data for Belarus
const belarusDigest: NewsItem[] = [
  {
    id: "by-1",
    title: "Изменения в Налоговый кодекс Республики Беларусь",
    summary: "Внесены уточнения в порядок исчисления НДС при экспорте услуг",
    source: "pravo.by",
    sourceUrl: "https://pravo.by",
  },
  {
    id: "by-2",
    title: "О порядке применения упрощенной системы налогообложения",
    summary: "Разъяснения по применению УСН для субъектов малого бизнеса",
    source: "pravo.by",
    sourceUrl: "https://pravo.by",
  },
];

const belarusComments: NewsItem[] = [
  {
    id: "by-c-1",
    title: "Письмо МНС о порядке заполнения декларации",
    position: "Разъяснение особенностей отражения льгот в налоговой декларации",
    source: "МНС РБ",
    sourceUrl: "https://nalog.gov.by",
  },
];

const belarusUrgent: NewsItem[] = [
  {
    id: "by-u-1",
    title: "Продлён срок подачи отчётности за 4 квартал",
    source: "nalog.gov.by",
    sourceUrl: "https://nalog.gov.by",
  },
  {
    id: "by-u-2",
    title: "Новые формы документов для ИП с 01.02.2025",
    source: "pravo.by",
    sourceUrl: "https://pravo.by",
  },
];

// Mock data for Russia
const russiaDigest: NewsItem[] = [
  {
    id: "ru-1",
    title: "Федеральный закон о внесении изменений в НК РФ",
    summary: "Изменения в части налогообложения цифровых активов",
    source: "consultant.ru",
    sourceUrl: "https://consultant.ru",
  },
  {
    id: "ru-2",
    title: "Новый порядок применения налоговых вычетов",
    summary: "Упрощение процедуры получения социальных вычетов",
    source: "nalog.ru",
    sourceUrl: "https://nalog.ru",
  },
];

const russiaComments: NewsItem[] = [
  {
    id: "ru-c-1",
    title: "Письмо Минфина о порядке учёта расходов",
    position: "Разъяснение по вопросам признания расходов на рекламу",
    source: "Минфин РФ",
    sourceUrl: "https://minfin.gov.ru",
  },
];

const russiaUrgent: NewsItem[] = [
  {
    id: "ru-u-1",
    title: "ЕНС: изменения в порядке уплаты налогов с 2025",
    source: "nalog.ru",
    sourceUrl: "https://nalog.ru",
  },
];

function NewsCard({ item, type }: { item: NewsItem; type: "digest" | "comments" | "urgent" }) {
  return (
    <div className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground line-clamp-2">{item.title}</h4>
          {type === "digest" && item.summary && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.summary}</p>
          )}
          {type === "comments" && item.position && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.position}</p>
          )}
          <p className="text-[10px] text-muted-foreground/70 mt-1.5">{item.source}</p>
        </div>
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 p-1.5 rounded-md hover:bg-primary/10 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
        </a>
      </div>
    </div>
  );
}

export function NewsBlock() {
  const [country, setCountry] = useState<string>("by");

  const data = country === "by" 
    ? { digest: belarusDigest, comments: belarusComments, urgent: belarusUrgent }
    : { digest: russiaDigest, comments: russiaComments, urgent: russiaUrgent };

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

          <TabsContent value="digest" className="mt-3 space-y-2">
            {data.digest.map((item) => (
              <NewsCard key={item.id} item={item} type="digest" />
            ))}
          </TabsContent>

          <TabsContent value="comments" className="mt-3 space-y-2">
            {data.comments.map((item) => (
              <NewsCard key={item.id} item={item} type="comments" />
            ))}
          </TabsContent>

          <TabsContent value="urgent" className="mt-3 space-y-2">
            {data.urgent.map((item) => (
              <NewsCard key={item.id} item={item} type="urgent" />
            ))}
          </TabsContent>
        </Tabs>
      </div>
    </GlassCard>
  );
}
