import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ExternalLink, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/GlassCard";

import productClubImage from "@/assets/product-club.png";
import productCourseImage from "@/assets/product-course.png";
import productConsultationImage from "@/assets/product-consultation.png";

interface ProductCardProps {
  title: string;
  description: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "outline";
  link: string;
  isExternal?: boolean;
  price?: string;
  image: string;
}

function ProductCard({ title, description, badge, badgeVariant = "secondary", link, isExternal, price, image }: ProductCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (isExternal) {
      window.open(link, "_blank");
    } else {
      navigate(link);
    }
  };

  const getBadgeClasses = () => {
    switch (badge) {
      case "Подписка":
        return "bg-primary/10 text-primary border-0";
      case "Курс":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0";
      case "Услуга":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0";
      default:
        return "bg-primary/10 text-primary border-0";
    }
  };

  return (
    <GlassCard className="overflow-hidden hover:border-primary/30 transition-all cursor-pointer group" onClick={handleClick}>
      <div className="relative h-48 overflow-hidden">
        <img 
          src={image} 
          alt={title}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        {badge && (
          <Badge 
            variant={badgeVariant} 
            className={`absolute top-3 right-3 ${getBadgeClasses()}`}
          >
            {badge}
          </Badge>
        )}
      </div>
      
      <div className="p-6">
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
      link: "/",
      isExternal: false,
      price: "от 100 BYN/мес",
      image: productClubImage,
    },
    {
      title: "Курс «Ценный бухгалтер»",
      description: "7-недельный курс по методологии бухучета: 25 модулей, практические конференции и подготовка к проверкам",
      badge: "Курс",
      link: "/course-accountant",
      isExternal: false,
      price: "от 590 BYN",
      image: productCourseImage,
    },
    {
      title: "Платная консультация",
      description: "Индивидуальная консультация Катерины Горбова по вопросам налогообложения, защиты бизнеса и работы с законодательством",
      badge: "Услуга",
      link: "/consultation",
      isExternal: false,
      price: "от 500 BYN",
      image: productConsultationImage,
    },
  ];

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Продукты</h1>
          <p className="text-muted-foreground">Выберите продукт или услугу для оформления</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((product, index) => (
            <ProductCard key={index} {...product} />
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
