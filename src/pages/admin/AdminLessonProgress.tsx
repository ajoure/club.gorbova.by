 import { useState } from "react";
 import { useParams, useNavigate, Link } from "react-router-dom";
 import { useQuery } from "@tanstack/react-query";
 import { supabase } from "@/integrations/supabase/client";
 import { AdminLayout } from "@/components/layout/AdminLayout";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { Badge } from "@/components/ui/badge";
 import { Skeleton } from "@/components/ui/skeleton";
 import {
   Table,
   TableBody,
   TableCell,
   TableHead,
   TableHeader,
   TableRow,
 } from "@/components/ui/table";
 import { ArrowLeft, ChevronRight, Eye, Users } from "lucide-react";
 import { format } from "date-fns";
 import { ru } from "date-fns/locale";
import { StudentProgressModal } from "@/components/admin/trainings/StudentProgressModal";
import type { LessonProgressRecord as ModalRecord, LessonBlock as ModalBlock } from "@/components/admin/trainings/StudentProgressModal";

type LessonProgressRecord = ModalRecord;
type LessonBlock = ModalBlock;
 
 const roleLabels: Record<string, string> = {
   executor: "Исполнитель",
   freelancer: "Фрилансер",
   entrepreneur: "Предприниматель",
 };
 
 export default function AdminLessonProgress() {
   const { moduleId, lessonId } = useParams<{ moduleId: string; lessonId: string }>();
   const navigate = useNavigate();
   const [selectedRecord, setSelectedRecord] = useState<LessonProgressRecord | null>(null);
 
   // Fetch lesson info
   const { data: lesson, isLoading: lessonLoading } = useQuery({
     queryKey: ["admin-lesson", lessonId],
     queryFn: async () => {
       const { data, error } = await supabase
         .from("training_lessons")
         .select("*, training_modules(title)")
         .eq("id", lessonId)
         .single();
       if (error) throw error;
       return data;
     },
     enabled: !!lessonId,
   });
 
   // Fetch lesson blocks for displaying step titles
   const { data: lessonBlocks } = useQuery({
     queryKey: ["lesson-blocks", lessonId],
     queryFn: async () => {
       const { data, error } = await supabase
         .from("lesson_blocks")
         .select("*")
         .eq("lesson_id", lessonId)
         .order("sort_order");
       if (error) throw error;
       return data;
     },
     enabled: !!lessonId,
   });
 
   // Fetch all progress records for this lesson
   const { data: progressRecords, isLoading: progressLoading } = useQuery({
     queryKey: ["lesson-progress-admin", lessonId],
     queryFn: async () => {
       const { data, error } = await supabase
         .from("lesson_progress_state")
        .select("*")
         .eq("lesson_id", lessonId)
         .order("updated_at", { ascending: false });
 
       if (error) throw error;
      
      // Fetch profiles separately
      const userIds = data.map(r => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);
      
      const profileMap = new Map(profiles?.map(p => [p.id, p]) || []);
      
      return data.map(record => ({
        ...record,
        profiles: profileMap.get(record.user_id) || null,
      })) as LessonProgressRecord[];
     },
     enabled: !!lessonId,
   });
 
   if (lessonLoading) {
     return (
       <AdminLayout>
         <div className="container mx-auto px-4 py-6 max-w-6xl">
           <Skeleton className="h-8 w-48 mb-4" />
           <Skeleton className="h-64 w-full" />
         </div>
       </AdminLayout>
     );
   }
 
   if (!lesson) {
     return (
       <AdminLayout>
         <div className="container mx-auto px-4 py-6 max-w-6xl text-center">
           <h1 className="text-2xl font-bold mb-4">Урок не найден</h1>
           <Button onClick={() => navigate(`/admin/training-lessons/${moduleId}`)}>
             <ArrowLeft className="mr-2 h-4 w-4" />
             Назад
           </Button>
         </div>
       </AdminLayout>
     );
   }
 
   return (
     <AdminLayout>
       <div className="container mx-auto px-4 py-6 max-w-6xl">
         {/* Breadcrumb */}
         <div className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
           <Link to="/admin/training-modules" className="hover:text-foreground transition-colors">
             Тренинги
           </Link>
           <ChevronRight className="h-4 w-4" />
           <Link 
             to={`/admin/training-lessons/${moduleId}`} 
             className="hover:text-foreground transition-colors"
           >
             {(lesson as any).training_modules?.title || "Модуль"}
           </Link>
           <ChevronRight className="h-4 w-4" />
           <span className="text-foreground">Прогресс</span>
         </div>
 
         {/* Header */}
         <div className="flex items-center justify-between mb-6">
           <div>
             <h1 className="text-2xl font-bold flex items-center gap-2">
               <Users className="h-6 w-6" />
               Прогресс учеников
             </h1>
             <p className="text-muted-foreground">Урок: {lesson.title}</p>
           </div>
           <Button 
             variant="outline" 
             onClick={() => navigate(`/admin/training-lessons/${moduleId}`)}
           >
             <ArrowLeft className="mr-2 h-4 w-4" />
             К урокам
           </Button>
         </div>
 
         {/* Stats summary */}
         <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
           <Card>
             <CardContent className="pt-4">
               <div className="text-2xl font-bold">{progressRecords?.length || 0}</div>
               <p className="text-sm text-muted-foreground">Всего учеников</p>
             </CardContent>
           </Card>
           <Card>
             <CardContent className="pt-4">
              <div className="text-2xl font-bold text-primary">
                 {progressRecords?.filter(r => r.completed_at).length || 0}
               </div>
               <p className="text-sm text-muted-foreground">Завершили</p>
             </CardContent>
           </Card>
           <Card>
             <CardContent className="pt-4">
              <div className="text-2xl font-bold text-primary/80">
                 {progressRecords?.filter(r => (r.state_json as any)?.pointA_completed).length || 0}
               </div>
               <p className="text-sm text-muted-foreground">Точка А</p>
             </CardContent>
           </Card>
           <Card>
             <CardContent className="pt-4">
              <div className="text-2xl font-bold text-primary/60">
                 {progressRecords?.filter(r => (r.state_json as any)?.pointB_completed).length || 0}
               </div>
               <p className="text-sm text-muted-foreground">Точка B</p>
             </CardContent>
           </Card>
         </div>
 
         {/* Progress Table */}
         <Card>
           <CardHeader>
             <CardTitle>Список учеников</CardTitle>
           </CardHeader>
           <CardContent>
             {progressLoading ? (
               <div className="space-y-2">
                 {[1, 2, 3].map(i => (
                   <Skeleton key={i} className="h-12 w-full" />
                 ))}
               </div>
             ) : !progressRecords?.length ? (
               <div className="text-center py-8 text-muted-foreground">
                 <Users className="h-12 w-12 mx-auto mb-4 opacity-50" />
                 <p>Пока никто не начал прохождение</p>
               </div>
             ) : (
               <Table>
                 <TableHeader>
                   <TableRow>
                     <TableHead>Ученик</TableHead>
                     <TableHead>Роль</TableHead>
                     <TableHead className="text-center">Точка А</TableHead>
                     <TableHead className="text-center">Точка B</TableHead>
                     <TableHead>Статус</TableHead>
                     <TableHead>Обновлено</TableHead>
                     <TableHead></TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {progressRecords.map(record => {
                     const state = record.state_json as any;
                     const profile = record.profiles as any;
                     
                     return (
                       <TableRow key={record.id}>
                         <TableCell>
                           <div>
                             <p className="font-medium">
                               {profile?.full_name || "—"}
                             </p>
                             <p className="text-sm text-muted-foreground">
                               {profile?.email}
                             </p>
                           </div>
                         </TableCell>
                         <TableCell>
                           {state?.role ? (
                             <Badge variant="outline">
                               {roleLabels[state.role] || state.role}
                             </Badge>
                           ) : (
                             <span className="text-muted-foreground">—</span>
                           )}
                         </TableCell>
                         <TableCell className="text-center">
                           {state?.pointA_completed ? (
                            <Badge variant="default">✓</Badge>
                           ) : (
                             <span className="text-muted-foreground">—</span>
                           )}
                         </TableCell>
                         <TableCell className="text-center">
                           {state?.pointB_completed ? (
                            <Badge variant="default">✓</Badge>
                           ) : (
                             <span className="text-muted-foreground">—</span>
                           )}
                         </TableCell>
                         <TableCell>
                           <Badge 
                             variant={record.completed_at ? "default" : "secondary"}
                           >
                             {record.completed_at ? "Завершён" : "В процессе"}
                           </Badge>
                         </TableCell>
                         <TableCell className="text-sm text-muted-foreground">
                           {format(new Date(record.updated_at), "dd MMM yyyy, HH:mm", { locale: ru })}
                         </TableCell>
                         <TableCell>
                           <Button
                             variant="ghost"
                             size="sm"
                             onClick={() => setSelectedRecord(record)}
                           >
                             <Eye className="h-4 w-4 mr-1" />
                             Просмотр
                           </Button>
                         </TableCell>
                       </TableRow>
                     );
                   })}
                 </TableBody>
               </Table>
             )}
           </CardContent>
         </Card>
 
         {/* Detail Modal */}
         <StudentProgressModal
           record={selectedRecord}
          lessonBlocks={(lessonBlocks || []) as LessonBlock[]}
           open={!!selectedRecord}
           onClose={() => setSelectedRecord(null)}
         />
       </div>
     </AdminLayout>
   );
 }