import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";

type StageKey = "audit" | "awareness" | "intention" | "goal" | "task" | "plan" | "action" | "reflection";

interface BalanceWheelData {
  stage: StageKey;
  value: number;
  notes: string | null;
}

const defaultValues: Record<StageKey, number> = {
  audit: 5,
  awareness: 5,
  intention: 5,
  goal: 5,
  task: 5,
  plan: 5,
  action: 5,
  reflection: 5,
};

export function useBalanceWheel() {
  const { user } = useAuth();
  const [values, setValues] = useState<Record<StageKey, number>>(defaultValues);
  const [notes, setNotes] = useState<Record<StageKey, string>>({} as Record<StageKey, string>);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) {
      setValues(defaultValues);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("balance_wheel_data")
      .select("stage, value, notes")
      .eq("user_id", user.id);

    if (error) {
      console.error("Error fetching balance wheel data:", error);
    } else if (data && data.length > 0) {
      const newValues = { ...defaultValues };
      const newNotes: Record<string, string> = {};
      
      data.forEach((item: BalanceWheelData) => {
        newValues[item.stage] = item.value;
        if (item.notes) {
          newNotes[item.stage] = item.notes;
        }
      });
      
      setValues(newValues);
      setNotes(newNotes as Record<StageKey, string>);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateValue = async (stage: StageKey, value: number) => {
    if (!user) return false;

    setValues(prev => ({ ...prev, [stage]: value }));
    setSaving(true);

    const { error } = await supabase
      .from("balance_wheel_data")
      .upsert(
        { 
          user_id: user.id, 
          stage, 
          value,
          notes: notes[stage] || null
        },
        { onConflict: "user_id,stage" }
      );

    setSaving(false);

    if (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось сохранить данные",
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const updateNotes = async (stage: StageKey, noteText: string) => {
    if (!user) return false;

    setNotes(prev => ({ ...prev, [stage]: noteText }));
    setSaving(true);

    const { error } = await supabase
      .from("balance_wheel_data")
      .upsert(
        { 
          user_id: user.id, 
          stage, 
          value: values[stage],
          notes: noteText || null
        },
        { onConflict: "user_id,stage" }
      );

    setSaving(false);

    if (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось сохранить заметки",
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  return {
    values,
    notes,
    loading,
    saving,
    updateValue,
    updateNotes,
    refetch: fetchData,
  };
}
