import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { GlassCard } from "@/components/ui/GlassCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  GraduationCap, 
  ShoppingBag, 
  BookOpen, 
  ExternalLink, 
  ArrowRight,
  Play,
  CheckCircle2,
  Lock,
  Video,
  FileText,
  Headphones
} from "lucide-react";
import { useTrainingModules } from "@/hooks/useTrainingModules";
import { Skeleton } from "@/components/ui/skeleton";

import productClubImage from "@/assets/product-club.png";
import productCourseImage from "@/assets/product-course.png";
import productConsultationImage from "@/assets/product-consultation.png";

// Products catalog (from Products.tsx)
const products = [
  {
    id: "club",
    title: "Клуб «Буква Закона»",
    description: "База знаний, экспертная поддержка и закрытое сообщество профессионалов",
    badge: "Подписка",
    link: "/",
    isExternal: false,
    price: "от 100 BYN/мес",
    image: productClubImage,
  },
  {
    id: "course",
    title: "Курс «Ценный бухгалтер»",
    description: "25 модулей за 7 недель: от методологии до подготовки к проверкам",
    badge: "Курс",
    link: "/course-accountant",
    isExternal: false,
    price: "от 590 BYN",
    image: productCourseImage,
  },
  {
    id: "consultation",
    title: "Консультация эксперта",
    description: "Персональный разбор вопросов по налогам, учёту и защите бизнеса",
    badge: "Услуга",
    link: "/consultation",
    isExternal: false,
    price: "от 500 BYN",
    image: productConsultationImage,
  },
];

// Content type icons
const contentTypeIcons: Record<string, React.ElementType> = {
  'video': Video,
  'audio': Headphones,
  'text': FileText,
  'mixed': Play,
};

interface ProductCardProps {
  product: typeof products[0];
  isPurchased?: boolean;
}

function ProductCard({ product, isPurchased = false }: ProductCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (isPurchased) {
      navigate('/learning?tab=my-library');
    } else if (product.isExternal) {
      window.open(product.link, "_blank");
    } else {
      navigate(product.link);
    }
  };

  const getBadgeClasses = () => {
    switch (product.badge) {
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
          src={product.image} 
          alt={product.title}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        {product.badge && (
          <Badge className={`absolute top-3 right-3 ${getBadgeClasses()}`}>
            {product.badge}
          </Badge>
        )}
        {isPurchased && (
          <div className="absolute top-3 left-3">
            <Badge className="bg-emerald-500 text-white gap-1">
              <CheckCircle2 className="w-3 h-3" />
              Куплено
            </Badge>
          </div>
        )}
      </div>
      
      <div className="p-6">
        <h3 className="text-lg font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
          {product.title}
        </h3>
        
        <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
          {product.description}
        </p>
        
        <div className="flex items-center justify-between">
          {!isPurchased && product.price && (
            <span className="text-sm font-medium text-foreground">{product.price}</span>
          )}
          <Button 
            variant={isPurchased ? "default" : "ghost"} 
            size="sm" 
            className={`${isPurchased ? '' : 'ml-auto'} group-hover:bg-primary/10 group-hover:text-primary`}
          >
            {isPurchased ? (
              <>
                В библиотеку <ArrowRight className="ml-1 h-4 w-4" />
              </>
            ) : product.isExternal ? (
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

function LibraryModuleCard({ module }: { module: any }) {
  const navigate = useNavigate();
  const Icon = contentTypeIcons[module.content_type] || Play;

  const handleClick = () => {
    if (module.has_access) {
      navigate(`/library/${module.slug}`);
    }
  };

  return (
    <GlassCard 
      className={`${module.has_access ? 'hover:border-primary/30 cursor-pointer' : 'opacity-60'} transition-all group`}
      onClick={handleClick}
    >
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
          module.has_access 
            ? 'bg-gradient-to-br from-primary/20 to-accent/20 group-hover:from-primary/30 group-hover:to-accent/30' 
            : 'bg-muted'
        } transition-colors`}>
          {module.has_access ? (
            <Icon className="w-6 h-6 text-primary" />
          ) : (
            <Lock className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold mb-1 ${module.has_access ? 'text-foreground group-hover:text-primary' : 'text-muted-foreground'} transition-colors`}>
            {module.title}
          </h3>
          {module.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
              {module.description}
            </p>
          )}
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">
              {module.lessons_count || 0} уроков
            </span>
            {module.has_access && module.progress !== undefined && module.progress > 0 && (
              <div className="flex items-center gap-2 flex-1 max-w-32">
                <Progress value={module.progress} className="h-1.5" />
                <span className="text-xs text-muted-foreground">{module.progress}%</span>
              </div>
            )}
            {!module.has_access && module.required_tariffs && (
              <Badge variant="outline" className="text-xs">
                {module.required_tariffs}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

export default function Learning() {
  const [searchParams, setSearchParams] = useSearchParams();
  const currentTab = searchParams.get("tab") || "catalog";
  const { modules, loading: isLoading } = useTrainingModules();
  
  // Mock purchased products (in real app, fetch from entitlements)
  const [purchasedProducts] = useState<string[]>([]);

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value });
  };

  const accessibleModules = modules.filter(m => m.has_access);

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center">
            <GraduationCap className="w-7 h-7 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Обучение</h1>
            <p className="text-muted-foreground">Курсы, продукты и ваша библиотека</p>
          </div>
        </div>

        <Tabs value={currentTab} onValueChange={handleTabChange}>
          <TabsList className="mb-6">
            <TabsTrigger value="catalog" className="gap-2">
              <ShoppingBag className="w-4 h-4" />
              Все продукты
            </TabsTrigger>
            <TabsTrigger value="my-library" className="gap-2">
              <BookOpen className="w-4 h-4" />
              Моя библиотека
            </TabsTrigger>
          </TabsList>

          <TabsContent value="catalog" className="space-y-6">
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {products.map((product) => (
                <ProductCard 
                  key={product.id} 
                  product={product} 
                  isPurchased={purchasedProducts.includes(product.id)}
                />
              ))}
            </div>
          </TabsContent>

          <TabsContent value="my-library" className="space-y-6">
            {isLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <GlassCard key={i}>
                    <div className="flex items-start gap-4">
                      <Skeleton className="w-12 h-12 rounded-xl" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-3/4" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-3 w-1/4" />
                      </div>
                    </div>
                  </GlassCard>
                ))}
              </div>
            ) : accessibleModules.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {accessibleModules.map((module) => (
                  <LibraryModuleCard key={module.id} module={module} />
                ))}
              </div>
            ) : (
              <GlassCard className="text-center py-16">
                <BookOpen className="w-16 h-16 text-muted-foreground/50 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-foreground mb-2">Библиотека пуста</h3>
                <p className="text-muted-foreground max-w-md mx-auto mb-6">
                  У вас пока нет доступных курсов. Приобретите продукт, чтобы начать обучение.
                </p>
                <Button onClick={() => setSearchParams({ tab: 'catalog' })}>
                  Перейти к продуктам
                </Button>
              </GlassCard>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
