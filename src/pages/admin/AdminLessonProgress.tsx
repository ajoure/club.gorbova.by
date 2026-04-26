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
import { ArrowLeft, ChevronRight, Eye, Users, MessageSquare, Download, CheckCircle2, Layers, BarChart3, MessageCircle } from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { StudentProgressModal } from "@/components/admin/trainings/StudentProgressModal";
import type { LessonProgressRecord as ModalRecord, LessonBlock as ModalBlock } from "@/components/admin/trainings/StudentProgressModal";
import { ContactDetailSheet } from "@/components/admin/ContactDetailSheet";
import {
  getInteractiveBlocks,
  getBlockLabel,
  resolveProgressValue,
  type BlockMeta,
} from "@/lib/blockProgressResolver";
import { logTrainingEvent } from "@/lib/auditTrainingActions";
import { toast } from "sonner";

type LessonProgressRecord = ModalRecord;
type LessonBlock = ModalBlock;

export default function AdminLessonProgress() {
  const { moduleId, lessonId } = useParams<{ moduleId: string; lessonId: string }>();
  const navigate = useNavigate();
  const [selectedRecord, setSelectedRecord] = useState<LessonProgressRecord | null>(null);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<any>(null);

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

  // Fetch lesson blocks (batch, single query)
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

  // Fetch all progress records (batch, single query).
  // Compatibility layer: kvest lessons write lesson_progress_state, manual lessons write user_lesson_progress.
  const { data: progressRecords, isLoading: progressLoading } = useQuery({
    queryKey: ["lesson-progress-admin", lessonId],
    queryFn: async () => {
      const { data: stateRows, error: stateError } = await supabase
        .from("lesson_progress_state")
        .select("*")
        .eq("lesson_id", lessonId)
        .order("updated_at", { ascending: false });

      if (stateError) throw stateError;

      const { data: manualRows, error: manualError } = await supabase
        .from("user_lesson_progress")
        .select("id, user_id, lesson_id, response, completed_at, created_at, updated_at")
        .eq("lesson_id", lessonId)
        .not("response", "is", null)
        .order("updated_at", { ascending: false });

      if (manualError) throw manualError;

      const byUser = new Map<string, LessonProgressRecord & { progress_sources?: string[] }>();

      (stateRows || []).forEach((record: any) => {
        byUser.set(record.user_id, {
          ...record,
          progress_sources: ["lesson_progress_state"],
        });
      });

      (manualRows || []).forEach((row: any) => {
        const existing = byUser.get(row.user_id);
        const completedAt = row.completed_at || null;
        if (existing) {
          const manualNewer = new Date(row.updated_at) > new Date(existing.updated_at);
          // «Свежее по updated_at побеждает» — снятие завершения в manual-блоке
          // не должно оставлять старый completed_at от kvest-прогресса.
          const nextCompletedAt = manualNewer
            ? completedAt
            : (existing.completed_at || completedAt);
          byUser.set(row.user_id, {
            ...existing,
            updated_at: manualNewer ? row.updated_at : existing.updated_at,
            completed_at: nextCompletedAt,
            progress_sources: Array.from(
              new Set([...(existing.progress_sources || []), "user_lesson_progress"])
            ),
          });
          return;
        }

        byUser.set(row.user_id, {
          id: `manual:${row.lesson_id}:${row.user_id}`,
          user_id: row.user_id,
          lesson_id: row.lesson_id,
          state_json: {},
          completed_at: completedAt,
          created_at: row.created_at,
          updated_at: row.updated_at,
          profiles: null,
          progress_sources: ["user_lesson_progress"],
        } as LessonProgressRecord & { progress_sources?: string[] });
      });

      const merged = Array.from(byUser.values()).sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      
      const userIds = merged.map(r => r.user_id);
      if (userIds.length === 0) {
        return [] as LessonProgressRecord[];
      }
      
      // Batch fetch profiles
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, email, full_name, phone, telegram_username, telegram_user_id, avatar_url, status, created_at, last_seen_at")
        .in("user_id", userIds);
      
      const profileMap = new Map(profiles?.map(p => [p.user_id, p]) || []);
      
      return merged.map(record => ({
        ...record,
        profiles: profileMap.get(record.user_id) || null,
      })) as LessonProgressRecord[];
    },
    enabled: !!lessonId,
  });

  // Batch fetch all block responses for all users in this lesson (no N+1)
  const { data: blockResponsesMap } = useQuery({
    queryKey: ["lesson-block-responses-admin", lessonId],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_lesson_progress")
        .select("user_id, block_id, response")
        .eq("lesson_id", lessonId)
        .not("response", "is", null);

      const map: Record<string, Record<string, any>> = {};
      data?.forEach((r: any) => {
        if (!map[r.user_id]) map[r.user_id] = {};
        map[r.user_id][r.block_id] = r.response;
      });
      return map;
    },
    enabled: !!lessonId,
  });

  // Batch fetch feedback tickets for this lesson (no N+1)
  const { data: feedbackMap } = useQuery({
    queryKey: ["lesson-feedback-admin", lessonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ticket_training_context")
        .select("lesson_id, support_tickets!inner(id, user_id, status, has_unread_user, updated_at, category)")
        .eq("lesson_id", lessonId!)
        .eq("support_tickets.category", "training_feedback");

      if (error) throw error;

      const map: Record<string, { ticketId: string; hasUnreadUser: boolean; lastUpdated: string; status: string }> = {};
      data?.forEach((row: any) => {
        const ticket = row.support_tickets;
        if (!ticket) return;
        const userId = ticket.user_id;
        // Keep the most recent ticket per user
        if (!map[userId] || new Date(ticket.updated_at) > new Date(map[userId].lastUpdated)) {
          map[userId] = {
            ticketId: ticket.id,
            hasUnreadUser: ticket.has_unread_user,
            lastUpdated: ticket.updated_at,
            status: ticket.status,
          };
        }
      });
      return map;
    },
    enabled: !!lessonId,
  });

  // Derive interactive columns from lesson blocks
  const interactiveBlocks = getInteractiveBlocks((lessonBlocks || []) as BlockMeta[]);

  // Helper: resolve response for a user+block, checking both user_lesson_progress and state_json
  const getUserBlockResponse = (record: LessonProgressRecord, block: BlockMeta) => {
    // Primary: user_lesson_progress responses
    const responses = blockResponsesMap?.[record.user_id] || {};
    if (responses[block.id] !== undefined) return responses[block.id];

    // Fallback: legacy state_json fields
    const state = record.state_json as Record<string, unknown> | null;
    if (!state) return null;

    if (block.block_type === "quiz_survey" || block.block_type === "role_description") {
      if (state.role) return { role: state.role, selected: state.role };
    }
    if (block.block_type === "diagnostic_table") {
      if (state.pointA_rows && (state.pointA_rows as unknown[]).length > 0)
        return { rows: state.pointA_rows };
      if (state.pointA_v2_rows && (state.pointA_v2_rows as unknown[]).length > 0)
        return { rows: state.pointA_v2_rows };
    }
    if (block.block_type === "sequential_form") {
      if (state.pointB_answers && Object.keys(state.pointB_answers as object).length > 0)
        return { answers: state.pointB_answers, completed: state.pointB_completed };
    }
    return null;
  };

  // Stats
  const totalStudents = progressRecords?.length || 0;
  const completedStudents = progressRecords?.filter(r => r.completed_at).length || 0;
  const totalInteractive = interactiveBlocks.length;
  const hasExternalProductWorkshop = interactiveBlocks.some((b) => b.block_type === "external_product_workshop");
  const manualStudents = progressRecords?.filter((r) => ((r as any).progress_sources || []).includes("user_lesson_progress")).length || 0;
  const savedResponseUsers = Object.keys(blockResponsesMap || {}).length;
  const answeredCounts = progressRecords?.map(r => {
    let count = 0;
    for (const block of interactiveBlocks) {
      const resp = getUserBlockResponse(r, block);
      const resolved = resolveProgressValue(block.block_type, resp, block.content);
      if (resolved.hasResponse) count++;
    }
    return count;
  }) || [];
  const avgAnswered = totalStudents > 0
    ? Math.round(answeredCounts.reduce((s, c) => s + c, 0) / totalStudents)
    : 0;

  // Dev-only invariant: один user_id = одна строка
  if (typeof window !== "undefined" && progressRecords) {
    const uniq = new Set(progressRecords.map((r) => r.user_id));
    if (uniq.size !== progressRecords.length) {
      console.warn("[AdminLessonProgress] duplicate user rows detected", {
        rows: progressRecords.length,
        unique: uniq.size,
      });
    }
  }

  const csvEscape = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (/[",\r\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const exportProgressCsv = () => {
    if (!progressRecords?.length) {
      toast.warning("Нет данных для экспорта");
      return;
    }
    const headers = [
      "student_name",
      "email",
      "status",
      "updated_at",
      "progress_source",
      ...interactiveBlocks.map((b) => getBlockLabel(b)),
    ];
    const lines: string[] = [headers.map(csvEscape).join(",")];
    for (const record of progressRecords) {
      const profile = (record as any).profiles as any;
      const sources = ((record as any).progress_sources || []) as string[];
      const status = record.completed_at ? "Завершён" : "В процессе";
      const row: string[] = [
        csvEscape(profile?.full_name || ""),
        csvEscape(profile?.email || ""),
        csvEscape(status),
        csvEscape(record.updated_at),
        csvEscape(sources.join("+")),
      ];
      for (const block of interactiveBlocks) {
        const resp = getUserBlockResponse(record, block);
        const resolved = resolveProgressValue(block.block_type, resp, block.content);
        if (block.block_type === "external_product_workshop") {
          const r = (resp as any) || {};
          const st = r.state || r;
          const ct = Array.isArray(st?.client_types) ? st.client_types.filter((x: any) => x?.name?.trim()).length : 0;
          const pf = Array.isArray(st?.portfolio_pricing) ? st.portfolio_pricing.length : 0;
          const completed = !!st?.completed_at;
          const importSrc = st?.import_meta?.source_lesson_id || "";
          row.push(
            csvEscape(
              `client_types=${ct}; portfolio=${pf}; completed=${completed ? "yes" : "no"}; import_source=${importSrc}`
            )
          );
        } else {
          row.push(csvEscape(resolved.summary || ""));
        }
      }
      lines.push(row.join(","));
    }
    // UTF-8 BOM for Excel
    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    a.href = url;
    a.download = `lesson-progress-${lessonId}-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    void logTrainingEvent("training.lesson_progress.exported", null, {
      lesson_id: lessonId || null,
      source: "teacher",
      format: "csv",
      rows: progressRecords.length,
    });
    toast.success("CSV скачан");
  };

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
          <Button onClick={() => navigate(`/admin/training-modules/${moduleId}/lessons`)}>
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
            to={`/admin/training-modules/${moduleId}/lessons`} 
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
            onClick={() => navigate(`/admin/training-modules/${moduleId}/lessons`)}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            К урокам
          </Button>
        </div>

        {/* Stats summary — dynamic */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{totalStudents}</div>
              <p className="text-sm text-muted-foreground">Всего учеников</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-primary">{completedStudents}</div>
              <p className="text-sm text-muted-foreground">Завершили</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-primary/80">{totalInteractive}</div>
              <p className="text-sm text-muted-foreground">Интерактивных блоков</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-primary/60">{avgAnswered}</div>
              <p className="text-sm text-muted-foreground">Ответов (в среднем)</p>
            </CardContent>
          </Card>
        </div>

        {hasExternalProductWorkshop && (
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="text-base">Proof-панели по manual-прогрессу</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">SQL proof</div>
                <div className="font-semibold">{manualStudents} из user_lesson_progress</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">UI proof ученика</div>
                <div className="font-semibold">{completedStudents} завершили</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">UI proof преподавателя</div>
                <div className="font-semibold">{totalStudents} видны в таблице</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                <div className="text-xs text-muted-foreground">Reload proof</div>
                <div className="font-semibold">{savedResponseUsers} ответов загружено</div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Progress Table — dynamic columns with horizontal scroll */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle>Список учеников</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={exportProgressCsv}
              disabled={!progressRecords?.length}
            >
              <Download className="h-4 w-4 mr-1.5" /> Экспорт CSV
            </Button>
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background z-10 min-w-[180px]">Ученик</TableHead>
                      {interactiveBlocks.map((block) => (
                        <TableHead
                          key={block.id}
                          className="text-center min-w-[120px] max-w-[180px]"
                          title={getBlockLabel(block)}
                        >
                          <span className="line-clamp-2 text-xs">
                            {getBlockLabel(block)}
                          </span>
                        </TableHead>
                      ))}
                      <TableHead className="text-center min-w-[100px]">💬 Связь</TableHead>
                      <TableHead className="min-w-[90px]">Статус</TableHead>
                      <TableHead className="min-w-[130px]">Обновлено</TableHead>
                      <TableHead className="min-w-[90px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {progressRecords.map(record => {
                      const profile = record.profiles as any;
                      const feedback = feedbackMap?.[record.user_id];
                      const sources = ((record as any).progress_sources || []) as string[];
                      
                      return (
                        <TableRow key={record.id}>
                          {/* Sticky student name column */}
                          <TableCell className="sticky left-0 bg-background z-10">
                            <div>
                              <button
                                className="font-medium text-left hover:underline hover:text-primary cursor-pointer"
                                onClick={() => {
                                  if (profile) {
                                    setSelectedContact({
                                      id: profile.id,
                                      user_id: profile.user_id,
                                      email: profile.email,
                                      full_name: profile.full_name,
                                      first_name: null,
                                      last_name: null,
                                      phone: profile.phone || null,
                                      telegram_username: profile.telegram_username || null,
                                      telegram_user_id: profile.telegram_user_id || null,
                                      avatar_url: profile.avatar_url || null,
                                      status: profile.status || "active",
                                      created_at: profile.created_at,
                                      last_seen_at: profile.last_seen_at || null,
                                      duplicate_flag: null,
                                      deals_count: 0,
                                      last_deal_at: null,
                                    });
                                    setContactSheetOpen(true);
                                  }
                                }}
                              >
                                {profile?.full_name || "—"}
                              </button>
                              <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                                {profile?.email}
                              </p>
                              {sources.includes("user_lesson_progress") && (
                                <Badge variant="outline" className="mt-1 text-[10px]">
                                  manual
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          {/* Dynamic interactive block columns */}
                          {interactiveBlocks.map((block) => {
                            const resp = getUserBlockResponse(record, block);
                            const resolved = resolveProgressValue(block.block_type, resp, block.content);
                            return (
                              <TableCell key={block.id} className="text-center">
                                {resolved.hasResponse ? (
                                  <Badge
                                    variant={resolved.isCorrect === false ? "destructive" : "default"}
                                    className="text-xs max-w-[160px] truncate"
                                    title={resolved.summary}
                                  >
                                    {resolved.summary}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-sm">—</span>
                                )}
                              </TableCell>
                            );
                          })}

                          {/* Feedback column */}
                          <TableCell className="text-center">
                            {feedback ? (
                              <div className="flex flex-col items-center gap-1">
                                <Badge
                                  variant={feedback.hasUnreadUser ? "default" : "outline"}
                                  className="text-xs cursor-pointer"
                                  onClick={() => setSelectedRecord(record)}
                                >
                                  <MessageSquare className="h-3 w-3 mr-1" />
                                  {feedback.hasUnreadUser ? "Новое" : "Есть"}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">
                                  {format(new Date(feedback.lastUpdated), "dd.MM HH:mm", { locale: ru })}
                                </span>
                              </div>
                            ) : (
                              <span className="text-muted-foreground text-sm">—</span>
                            )}
                          </TableCell>

                          {/* Status */}
                          <TableCell>
                            <Badge 
                              variant={record.completed_at ? "default" : "secondary"}
                            >
                              {record.completed_at ? "Завершён" : "В процессе"}
                            </Badge>
                          </TableCell>

                          {/* Updated at */}
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(record.updated_at), "dd MMM yyyy, HH:mm", { locale: ru })}
                          </TableCell>

                          {/* Actions */}
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
              </div>
            )}
          </CardContent>
        </Card>

        {/* Detail Modal */}
        <StudentProgressModal
          record={selectedRecord}
          lessonBlocks={(lessonBlocks || []) as LessonBlock[]}
          open={!!selectedRecord}
          onClose={() => setSelectedRecord(null)}
          blockResponses={selectedRecord ? blockResponsesMap?.[selectedRecord.user_id] ?? {} : {}}
          lessonId={lessonId}
          lessonTitle={lesson?.title}
          moduleId={moduleId}
        />

        {/* Contact Detail Sheet */}
        <ContactDetailSheet
          contact={selectedContact}
          open={contactSheetOpen}
          onOpenChange={setContactSheetOpen}
        />
      </div>
    </AdminLayout>
  );
}
