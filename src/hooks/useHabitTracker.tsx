import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { addDays, format, differenceInDays, startOfDay, parseISO } from "date-fns";

export interface HabitChallenge {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  duration_days: number;
  unit_label: string | null;
  target_value: number | null;
  color: string | null;
  icon: string | null;
  start_date: string;
  is_active: boolean;
  created_at: string;
}

export interface HabitDailyLog {
  id: string;
  challenge_id: string;
  user_id: string;
  log_date: string;
  is_completed: boolean;
  value: number | null;
  notes: string | null;
}

export interface ChallengeWithStats extends HabitChallenge {
  logs: HabitDailyLog[];
  currentDay: number;
  completedDays: number;
  currentStreak: number;
  endDate: string;
  isToday: boolean;
  todayLog: HabitDailyLog | null;
}

export interface CreateChallengeInput {
  title: string;
  description?: string;
  duration_days: number;
  unit_label?: string;
  target_value?: number;
  color?: string;
  icon?: string;
  start_date?: string;
}

export function useHabitChallenges() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: challenges, isLoading, error } = useQuery({
    queryKey: ["habit-challenges", user?.id],
    queryFn: async (): Promise<ChallengeWithStats[]> => {
      const { data: challengesData, error: challengesError } = await supabase
        .from("habit_challenges")
        .select("*")
        .eq("user_id", user?.id || "")
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (challengesError) throw challengesError;
      if (!challengesData?.length) return [];

      // Get all logs for these challenges
      const challengeIds = challengesData.map(c => c.id);
      const { data: logs } = await supabase
        .from("habit_daily_logs")
        .select("*")
        .in("challenge_id", challengeIds)
        .order("log_date");

      const today = format(new Date(), "yyyy-MM-dd");

      return challengesData.map(challenge => {
        const challengeLogs = logs?.filter(l => l.challenge_id === challenge.id) || [];
        const completedLogs = challengeLogs.filter(l => l.is_completed);
        
        const startDate = parseISO(challenge.start_date);
        const endDate = addDays(startDate, challenge.duration_days - 1);
        const currentDay = Math.min(
          differenceInDays(new Date(), startDate) + 1,
          challenge.duration_days
        );

        // Calculate streak
        let currentStreak = 0;
        const sortedCompletedDates = completedLogs
          .map(l => l.log_date)
          .sort((a, b) => b.localeCompare(a));

        for (let i = 0; i < sortedCompletedDates.length; i++) {
          const expectedDate = format(addDays(new Date(), -i), "yyyy-MM-dd");
          if (sortedCompletedDates[i] === expectedDate) {
            currentStreak++;
          } else {
            break;
          }
        }

        const todayLog = challengeLogs.find(l => l.log_date === today) || null;

        return {
          ...challenge,
          logs: challengeLogs,
          currentDay: Math.max(1, currentDay),
          completedDays: completedLogs.length,
          currentStreak,
          endDate: format(endDate, "yyyy-MM-dd"),
          isToday: currentDay >= 1 && currentDay <= challenge.duration_days,
          todayLog,
        };
      });
    },
    enabled: !!user?.id,
  });

  const createChallenge = useMutation({
    mutationFn: async (input: CreateChallengeInput) => {
      const { data, error } = await supabase
        .from("habit_challenges")
        .insert({
          user_id: user?.id,
          title: input.title,
          description: input.description || null,
          duration_days: input.duration_days,
          unit_label: input.unit_label || "раз",
          target_value: input.target_value || null,
          color: input.color || "emerald",
          icon: input.icon || "Target",
          start_date: input.start_date || format(new Date(), "yyyy-MM-dd"),
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["habit-challenges"] });
      toast.success("Челлендж создан!");
    },
    onError: () => {
      toast.error("Не удалось создать челлендж");
    },
  });

  const logDay = useMutation({
    mutationFn: async ({
      challengeId,
      date,
      isCompleted,
      value,
      notes,
    }: {
      challengeId: string;
      date: string;
      isCompleted: boolean;
      value?: number;
      notes?: string;
    }) => {
      const { data, error } = await supabase
        .from("habit_daily_logs")
        .upsert({
          challenge_id: challengeId,
          user_id: user?.id,
          log_date: date,
          is_completed: isCompleted,
          value: value ?? null,
          notes: notes ?? null,
        }, {
          onConflict: "challenge_id,log_date",
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["habit-challenges"] });
    },
    onError: () => {
      toast.error("Не удалось сохранить запись");
    },
  });

  const deleteChallenge = useMutation({
    mutationFn: async (challengeId: string) => {
      const { error } = await supabase
        .from("habit_challenges")
        .delete()
        .eq("id", challengeId)
        .eq("user_id", user?.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["habit-challenges"] });
      toast.success("Челлендж удалён");
    },
    onError: () => {
      toast.error("Не удалось удалить челлендж");
    },
  });

  const archiveChallenge = useMutation({
    mutationFn: async (challengeId: string) => {
      const { error } = await supabase
        .from("habit_challenges")
        .update({ is_active: false })
        .eq("id", challengeId)
        .eq("user_id", user?.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["habit-challenges"] });
      toast.success("Челлендж архивирован");
    },
    onError: () => {
      toast.error("Не удалось архивировать челлендж");
    },
  });

  return {
    challenges,
    isLoading,
    error,
    createChallenge,
    logDay,
    deleteChallenge,
    archiveChallenge,
  };
}
