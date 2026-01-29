import { useNavigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ExternalLink, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
  isClub?: boolean;
  isPurchased?: boolean;
}

function ProductCard({ title, description, badge, badgeVariant = "secondary", link, isExternal, price, image, isClub, isPurchased }: ProductCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    // Club: SPA navigation to /club for logged-in users
    if (isClub) {
      navigate("/club");
      return;
    }
    
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
        <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
          {/* Purchased badge - only for club with active subscription */}
          {isClub && isPurchased && (
            <div className="bg-emerald-500/90 backdrop-blur-sm text-white px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 shadow-md">
              <Check className="h-3 w-3" />
              Куплено
            </div>
          )}
          {(!isClub || !isPurchased) && <div />}
          
          {/* Status badge */}
          {badge && (
            <Badge 
              variant={badgeVariant} 
              className={`${getBadgeClasses()}`}
            >
              {badge}
            </Badge>
          )}
        </div>
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
  const { user } = useAuth();
  
  // Check if user has active club subscription
  const { data: hasClubAccess } = useQuery({
    queryKey: ["club-access", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      
      const { data } = await supabase
        .from("subscriptions_v2")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("product_id", "11c9f1b8-0355-4753-bd74-40b42aa53616")
        .in("status", ["active", "trial"])
        .maybeSingle();
      
      return !!data;
    },
    enabled: !!user?.id,
  });

  const products = [
    {
      title: "Клуб «Буква Закона»",
      description: "База знаний, экспертная поддержка и закрытое сообщество профессионалов",
      badge: "Подписка",
      link: "https://club.gorbova.by",
      isExternal: true,
      price: "от 100 BYN/мес",
      image: productClubImage,
      isClub: true,
      isPurchased: hasClubAccess || false,
    },
    {
      title: "Курс «Ценный бухгалтер»",
      description: "25 модулей за 7 недель: от методологии до подготовки к проверкам",
      badge: "Курс",
      link: "/course-accountant",
      isExternal: false,
      price: "от 590 BYN",
      image: productCourseImage,
    },
    {
      title: "Консультация эксперта",
      description: "Персональный разбор вопросов по налогам, учёту и защите бизнеса",
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
