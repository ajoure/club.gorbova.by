import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Package, ExternalLink, Calendar, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/GlassCard";

interface ProductCardProps {
  title: string;
  description: string;
  badge?: string;
  link: string;
  isExternal?: boolean;
  price?: string;
}

function ProductCard({ title, description, badge, link, isExternal, price }: ProductCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (isExternal) {
      window.open(link, "_blank");
    } else {
      navigate(link);
    }
  };

  return (
    <GlassCard className="p-6 hover:border-primary/30 transition-all cursor-pointer group" onClick={handleClick}>
      <div className="flex items-start justify-between mb-4">
        <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
          <Package className="text-primary" size={24} />
        </div>
        {badge && (
          <Badge variant="secondary" className="bg-primary/10 text-primary border-0">
            {badge}
          </Badge>
        )}
      </div>
      
      <h3 className="text-lg font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
        {title}
      </h3>
      
      <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
        {description}
      </p>
      
      <div className="flex items-center justify-between">
        {price && (
          <span className="text-sm font-medium text-foreground">{price}</span>
        )}
        <Button variant="ghost" size="sm" className="ml-auto group-hover:bg-primary/10 group-hover:text-primary">
          {isExternal ? (
            <>
              Перейти <ExternalLink className="ml-1 h-4 w-4" />
            </>
          ) : (
            <>
              Подробнее <ArrowRight className="ml-1 h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </GlassCard>
  );
}

export default function Products() {
  const products = [
    {
      title: "Клуб «Буква Закона»",
      description: "Закрытое сообщество для бухгалтеров и предпринимателей с доступом к базе знаний, видео-разборам и экспертной поддержке",
      badge: "Подписка",
      link: "https://club.gorbova.by",
      isExternal: true,
      price: "от 100 BYN/мес",
    },
    {
      title: "Платная консультация",
      description: "Индивидуальная консультация Катерины Горбова по вопросам налогообложения, защиты бизнеса и работы с законодательством",
      badge: "Услуга",
      link: "https://consultation.gorbova.by",
      isExternal: true,
      price: "от 500 BYN",
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Продукты</h1>
          <p className="text-muted-foreground">Выберите продукт или услугу для оформления</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {products.map((product, index) => (
            <ProductCard key={index} {...product} />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
