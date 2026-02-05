 import { useNavigate } from "react-router-dom";
 import { useQuery } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { Badge } from "@/components/ui/badge";
 import { Skeleton } from "@/components/ui/skeleton";
 import { Users, ChevronRight, BookOpen } from "lucide-react";
 import type { TrainingModule } from "@/hooks/useTrainingModules";
 
 interface ProgressTabContentProps {
   modules: TrainingModule[];
 }
 
 export function ProgressTabContent({ modules }: ProgressTabContentProps) {
   const navigate = useNavigate();
 
   // Fetch kvest lessons with progress counts
   const { data: kvestLessons, isLoading } = useQuery({
     queryKey: ["kvest-lessons-progress"],
     queryFn: async () => {
       // Get all kvest lessons
       const { data: lessons, error } = await supabase
         .from("training_lessons")
         .select(`
           id,
           title,
           module_id,
           completion_mode,
           training_modules!inner(id, title)
         `)
         .eq("completion_mode", "kvest")
         .order("sort_order");
 
       if (error) throw error;
 
       // Get progress counts for each lesson
       const lessonIds = lessons?.map(l => l.id) || [];
       if (lessonIds.length === 0) return [];
 
       const { data: progressData, error: progressError } = await supabase
         .from("lesson_progress_state")
         .select("lesson_id, completed_at")
         .in("lesson_id", lessonIds);
 
       if (progressError) throw progressError;
 
       // Aggregate counts per lesson
       const progressMap = new Map<string, { total: number; completed: number }>();
       progressData?.forEach(p => {
         const current = progressMap.get(p.lesson_id) || { total: 0, completed: 0 };
         current.total++;
         if (p.completed_at) current.completed++;
         progressMap.set(p.lesson_id, current);
       });
 
       return lessons?.map(lesson => ({
         ...lesson,
         moduleName: (lesson.training_modules as any)?.title || "Без модуля",
         studentCount: progressMap.get(lesson.id)?.total || 0,
         completedCount: progressMap.get(lesson.id)?.completed || 0,
       })) || [];
     },
   });
 
   if (isLoading) {
     return (
       <div className="space-y-4 mt-4">
         {[1, 2, 3].map(i => (
           <Skeleton key={i} className="h-20 w-full rounded-xl" />
         ))}
       </div>
     );
   }
 
   if (!kvestLessons?.length) {
     return (
       <div className="mt-4 relative overflow-hidden rounded-2xl backdrop-blur-xl bg-card/60 dark:bg-card/40 border border-border/50 shadow-lg p-12 text-center">
         <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent pointer-events-none" />
         <div className="relative">
           <Users className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
           <h3 className="text-xl font-semibold mb-2">Нет квест-уроков</h3>
           <p className="text-muted-foreground">
             Создайте урок с режимом прохождения "Квест" для отслеживания прогресса учеников
           </p>
         </div>
       </div>
     );
   }
 
   return (
     <div className="space-y-3 mt-4">
       <p className="text-sm text-muted-foreground mb-4">
         Уроки с режимом "Квест" — отслеживайте прогресс учеников
       </p>
       {kvestLessons.map(lesson => (
         <Card 
           key={lesson.id} 
           className="group hover:shadow-md transition-all cursor-pointer"
           onClick={() => navigate(`/admin/training-lessons/${lesson.module_id}/progress/${lesson.id}`)}
         >
           <CardContent className="p-4 flex items-center justify-between">
             <div className="flex items-center gap-3">
               <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                 <BookOpen className="h-5 w-5 text-primary" />
               </div>
               <div>
                 <h4 className="font-medium">{lesson.title}</h4>
                 <p className="text-sm text-muted-foreground">{lesson.moduleName}</p>
               </div>
             </div>
             <div className="flex items-center gap-4">
               <div className="text-right">
                 <div className="flex items-center gap-2">
                   <Badge variant="secondary" className="font-normal">
                     <Users className="h-3 w-3 mr-1" />
                     {lesson.studentCount}
                   </Badge>
                   <Badge variant="default" className="font-normal">
                     ✓ {lesson.completedCount}
                   </Badge>
                 </div>
               </div>
               <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
             </div>
           </CardContent>
         </Card>
       ))}
     </div>
   );
 }