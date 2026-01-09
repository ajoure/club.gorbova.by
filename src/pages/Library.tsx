import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { useTrainingModules } from "@/hooks/useTrainingModules";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, BookOpen, Video, FileText, Music, Files, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

const contentTypeIcons = {
  video: Video,
  audio: Music,
  article: FileText,
  document: Files,
  mixed: BookOpen,
};

export default function Library() {
  const { modules, loading } = useTrainingModules();
  const navigate = useNavigate();

  const accessibleModules = modules.filter(m => m.is_active);

  const handleModuleClick = (module: typeof modules[0]) => {
    if (module.has_access) {
      navigate(`/library/${module.slug}`);
    }
  };

  return (
    <DashboardLayout>
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground mb-2">База знаний</h1>
          <p className="text-muted-foreground">
            Обучающие материалы, разборы и полезная информация для участников клуба
          </p>
        </div>

        {/* Modules Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="overflow-hidden">
                <Skeleton className="h-40 w-full" />
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-full mt-2" />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : accessibleModules.length === 0 ? (
          <Card className="text-center py-12">
            <CardContent>
              <BookOpen className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-xl font-semibold mb-2">Материалы пока не добавлены</h3>
              <p className="text-muted-foreground">
                Скоро здесь появятся обучающие материалы
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {accessibleModules.map((module) => {
              const progress = module.lesson_count && module.lesson_count > 0
                ? Math.round(((module.completed_count || 0) / module.lesson_count) * 100)
                : 0;

              return (
                <Card
                  key={module.id}
                  className={`overflow-hidden transition-all duration-300 group ${
                    module.has_access
                      ? "cursor-pointer hover:shadow-lg hover:-translate-y-1"
                      : "opacity-75"
                  }`}
                  onClick={() => handleModuleClick(module)}
                >
                  {/* Cover Image or Gradient */}
                  <div
                    className={`h-40 relative bg-gradient-to-br ${module.color_gradient || "from-pink-500 to-fuchsia-600"}`}
                  >
                    {module.cover_image ? (
                      <img
                        src={module.cover_image}
                        alt={module.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <BookOpen className="h-16 w-16 text-white/50" />
                      </div>
                    )}
                    
                    {/* Overlay for locked modules */}
                    {!module.has_access && (
                      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center">
                        <div className="text-center">
                          <Lock className="h-10 w-10 mx-auto mb-2 text-muted-foreground" />
                          <p className="text-sm text-muted-foreground font-medium">
                            Доступно для тарифов:
                          </p>
                          <p className="text-sm text-foreground">
                            {module.accessible_tariffs?.join(", ") || "Премиум"}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Lesson count badge */}
                    <Badge
                      variant="secondary"
                      className="absolute top-3 right-3 bg-background/80 backdrop-blur-sm"
                    >
                      {module.lesson_count || 0} уроков
                    </Badge>
                  </div>

                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg group-hover:text-primary transition-colors">
                        {module.title}
                      </CardTitle>
                      {module.has_access && (
                        <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                      )}
                    </div>
                    {module.description && (
                      <CardDescription className="line-clamp-2">
                        {module.description}
                      </CardDescription>
                    )}
                  </CardHeader>

                  {module.has_access && module.lesson_count && module.lesson_count > 0 && (
                    <CardContent className="pt-0">
                      <div className="flex items-center gap-3">
                        <Progress value={progress} className="flex-1 h-2" />
                        <span className="text-sm text-muted-foreground whitespace-nowrap">
                          {module.completed_count || 0} / {module.lesson_count}
                        </span>
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
