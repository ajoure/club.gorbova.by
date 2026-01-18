import { useState, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/GlassCard";
import { Progress } from "@/components/ui/progress";
import { useTrainingModules } from "@/hooks/useTrainingModules";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { 
  ShoppingBag, 
  BookOpen, 
  Check, 
  Play, 
  ExternalLink,
  Sparkles,
  Star,
  Clock,
  Users
} from "lucide-react";

import productClubImage from "@/assets/product-club.png";
import productCourseImage from "@/assets/product-course.png";
import productConsultationImage from "@/assets/product-consultation.png";
import katerinaBusinessImage from "@/assets/katerina-business.jpg";

interface Product {
  id: string;
  title: string;
  description: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "outline";
  price: string;
  image: string;
  isPurchased: boolean;
  purchaseLink: string;
  courseSlug?: string;
  lessonCount?: number;
  completedCount?: number;
  duration?: string;
}

const products: Product[] = [
  {
    id: "1",
    title: "Клуб «Буква Закона»",
    description: "База знаний, экспертная поддержка и закрытое сообщество профессионалов",
    badge: "Хит",
    badgeVariant: "default",
    price: "от 100 BYN/мес",
    image: productClubImage,
    isPurchased: true,
    purchaseLink: "/",
    courseSlug: "club",
    lessonCount: 24,
    completedCount: 18,
    duration: "Подписка",
  },
  {
    id: "2",
    title: "Курс «Ценный бухгалтер»",
    description: "25 модулей за 7 недель: от методологии до подготовки к проверкам",
    badge: "Новинка",
    badgeVariant: "secondary",
    price: "от 590 BYN",
    image: productCourseImage,
    isPurchased: false,
    purchaseLink: "/course-accountant",
    courseSlug: "accountant-course",
    lessonCount: 25,
    duration: "7 недель",
  },
  {
    id: "5",
    title: "Бухгалтерия как бизнес",
    description: "Ежемесячный тренинг: от бухгалтера в найме к владельцу своего бизнеса",
    badge: "Старт 5 февраля",
    badgeVariant: "secondary",
    price: "250 BYN/мес",
    image: katerinaBusinessImage,
    isPurchased: false,
    purchaseLink: "/business-training",
    courseSlug: "buh-business",
    lessonCount: 12,
    completedCount: 0,
    duration: "Квест",
  },
  {
    id: "3",
    title: "Консультация эксперта",
    description: "Персональный разбор вопросов по налогам, учёту и защите бизнеса",
    badge: "Услуга",
    badgeVariant: "outline",
    price: "от 500 BYN",
    image: productConsultationImage,
    isPurchased: false,
    purchaseLink: "/consultation",
    duration: "1-2 часа",
  },
  {
    id: "4",
    title: "Мастер-класс: Налоговая оптимизация",
    description: "Практические кейсы по легальному снижению налоговой нагрузки",
    badge: "Скоро",
    badgeVariant: "outline",
    price: "290 BYN",
    image: productCourseImage,
    isPurchased: true,
    purchaseLink: "#",
    courseSlug: "tax-optimization",
    lessonCount: 8,
    completedCount: 3,
    duration: "2 недели",
  },
];

const getBadgeClasses = (badge?: string) => {
  switch (badge) {
    case "Хит":
      return "bg-primary/10 text-primary border-0";
    case "Новинка":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-0";
    case "Услуга":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-0";
    case "Скоро":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-0";
    case "Бронь":
      return "bg-amber-500 text-white border-0 font-medium shadow-md";
    case "Активно":
      return "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-0 font-medium";
    case "Старт 5 февраля":
      return "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-0";
    default:
      return "bg-primary/10 text-primary border-0";
  }
};

interface ProductCardProps {
  product: Product;
  variant: "store" | "library";
  onSwitchToLibrary: () => void;
}

function ProductCard({ product, variant, onSwitchToLibrary }: ProductCardProps) {
  const navigate = useNavigate();
  
  const progress = product.lessonCount && product.completedCount
    ? Math.round((product.completedCount / product.lessonCount) * 100)
    : 0;

  const handleAction = () => {
    if (variant === "store") {
      if (product.isPurchased) {
        onSwitchToLibrary();
      } else if (product.purchaseLink.startsWith("http")) {
        window.open(product.purchaseLink, "_blank");
      } else {
        navigate(product.purchaseLink);
      }
    } else {
      // Library variant - go to course
      navigate(`/library/${product.courseSlug || product.id}`);
    }
  };

  return (
    <GlassCard className="overflow-hidden hover:border-primary/30 hover:shadow-lg transition-all duration-300 group backdrop-blur-sm bg-card/80">
      <div className="relative h-44 overflow-hidden">
        <img 
          src={product.image} 
          alt={product.title}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
          style={product.courseSlug === "buh-business" ? { objectPosition: "center 20%", transform: "scale(1.1)" } : undefined}
        />
        {/* Gradient overlay for better text contrast */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        {product.badge && (
          <Badge 
            variant={product.badgeVariant} 
            className={`absolute top-3 right-3 ${getBadgeClasses(product.badge)} shadow-sm`}
          >
            {product.badge === "Хит" && <Star className="h-3 w-3 mr-1" />}
            {product.badge === "Новинка" && <Sparkles className="h-3 w-3 mr-1" />}
            {product.badge === "Активно" && <Check className="h-3 w-3 mr-1" />}
            {product.badge === "Бронь" && <Clock className="h-3 w-3 mr-1" />}
            {product.badge === "Старт 5 февраля" && <Clock className="h-3 w-3 mr-1" />}
            {product.badge}
          </Badge>
        )}
        {variant === "store" && product.isPurchased && product.badge !== "Бронь" && (
          <div className="absolute top-3 left-3 bg-emerald-500 text-white px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 shadow-md">
            <Check className="h-3 w-3" />
            Куплено
          </div>
        )}
      </div>
      
      <div className="p-5">
        <h3 className="text-lg font-semibold text-foreground mb-2 group-hover:text-primary transition-colors">
          {product.title}
        </h3>
        
        <p className="text-sm text-muted-foreground mb-4 line-clamp-3 min-h-[3.75rem]">
          {product.description}
        </p>

        {/* Meta info */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground mb-4">
          {product.duration && (
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {product.duration}
            </span>
          )}
          {product.lessonCount && (
            <span className="flex items-center gap-1">
              <BookOpen className="h-3 w-3" />
              {product.lessonCount} уроков
            </span>
          )}
        </div>

        {/* Progress for library view */}
        {variant === "library" && product.lessonCount && product.completedCount !== undefined && (
          <div className="mb-4">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Прогресс</span>
              <span>{product.completedCount} из {product.lessonCount}</span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>
        )}
        
        <div className="flex items-center justify-between">
          {variant === "store" && (
            <span className="text-sm font-medium text-foreground">{product.price}</span>
          )}
          
          {variant === "store" ? (
            product.isPurchased ? (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleAction}
                className="ml-auto"
              >
                <Check className="h-4 w-4 mr-1" />
                В библиотеке
              </Button>
            ) : (
              <Button 
                size="sm" 
                onClick={handleAction}
                className="ml-auto"
              >
                {product.purchaseLink.startsWith("http") ? (
                  <>
                    Купить <ExternalLink className="ml-1 h-4 w-4" />
                  </>
                ) : (
                  "Подробнее"
                )}
              </Button>
            )
          ) : (
            <Button 
              size="sm" 
              onClick={handleAction}
              className="w-full"
            >
              <Play className="h-4 w-4 mr-2" />
              {progress > 0 ? "Продолжить" : "Начать обучение"}
            </Button>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

export default function Learning() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "library" ? "library" : "store";
  const [activeTab, setActiveTab] = useState(initialTab);
  const { user } = useAuth();
  
  const { modules, loading } = useTrainingModules();
  
  // Check if user has preregistration or active subscription for buh_business
  const { data: businessTrainingAccess } = useQuery({
    queryKey: ["buh-business-access", user?.id],
    queryFn: async () => {
      if (!user?.id) return { hasPreregistration: false, hasActiveSubscription: false };
      
      // Check preregistration
      const { data: preregistration } = await supabase
        .from("course_preregistrations")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("product_code", "buh_business")
        .in("status", ["new", "contacted"])
        .maybeSingle();
      
      // Check entitlements
      const { data: entitlement } = await supabase
        .from("entitlements")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("product_code", "buh_business")
        .eq("status", "active")
        .maybeSingle();
      
      return {
        hasPreregistration: !!preregistration,
        hasActiveSubscription: !!entitlement,
      };
    },
    enabled: !!user?.id,
  });
  
  // Merge real module data with mock products
  const enrichedProducts = useMemo(() => products.map(product => {
    const matchingModule = modules.find(m => 
      m.slug === product.courseSlug || m.title.includes(product.title)
    );
    
    // Special handling for buh-business product
    if (product.courseSlug === "buh-business") {
      const hasAccess = businessTrainingAccess?.hasPreregistration || businessTrainingAccess?.hasActiveSubscription;
      return {
        ...product,
        isPurchased: hasAccess || false,
        badge: hasAccess 
          ? (businessTrainingAccess?.hasActiveSubscription ? "Активно" : "Бронь")
          : "Старт 5 февраля",
      };
    }
    
    if (matchingModule) {
      return {
        ...product,
        isPurchased: matchingModule.has_access || product.isPurchased,
        lessonCount: matchingModule.lesson_count || product.lessonCount,
        completedCount: matchingModule.completed_count || product.completedCount,
      };
    }
    return product;
  }), [modules, businessTrainingAccess]);

  const purchasedProducts = enrichedProducts.filter(p => p.isPurchased && p.courseSlug);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Обучение</h1>
          <p className="text-muted-foreground">Курсы, подписки и ваша библиотека</p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="store" className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4" />
              Все продукты
            </TabsTrigger>
            <TabsTrigger value="library" className="flex items-center gap-2">
              <BookOpen className="h-4 w-4" />
              Моя библиотека
              {purchasedProducts.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                  {purchasedProducts.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Store Tab */}
          <TabsContent value="store" className="mt-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
              {enrichedProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  variant="store"
                  onSwitchToLibrary={() => setActiveTab("library")}
                />
              ))}
            </div>
          </TabsContent>

          {/* Library Tab */}
          <TabsContent value="library" className="mt-6">
            {purchasedProducts.length === 0 ? (
              <GlassCard className="text-center py-16">
                <BookOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-xl font-semibold mb-2">Библиотека пуста</h3>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  У вас пока нет приобретённых курсов. Откройте каталог, чтобы выбрать подходящее обучение.
                </p>
                <Button onClick={() => setActiveTab("store")}>
                  <ShoppingBag className="h-4 w-4 mr-2" />
                  Перейти в каталог
                </Button>
              </GlassCard>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {purchasedProducts.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    variant="library"
                    onSwitchToLibrary={() => {}}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
