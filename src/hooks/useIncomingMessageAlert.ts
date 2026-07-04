import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useUnifiedInboxFlag } from "@/hooks/useContactCenterFeatureFlag";

/**
 * Global hook: plays a notification sound when a new incoming telegram message arrives.
 * Should be mounted once in AdminLayout so it works on any admin page.
 */
export function useIncomingMessageAlert() {
  const audioContextRef = useRef<AudioContext | null>(null);

  // Initialize AudioContext on first user gesture to comply with browser autoplay policy
  useEffect(() => {
    const initAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      audioContextRef.current.resume();
      document.removeEventListener('click', initAudio);
      document.removeEventListener('touchstart', initAudio);
    };
    document.addEventListener('click', initAudio, { once: true });
    document.addEventListener('touchstart', initAudio, { once: true });
    return () => {
      document.removeEventListener('click', initAudio);
      document.removeEventListener('touchstart', initAudio);
    };
  }, []);

  const [unifiedEnabled] = useUnifiedInboxFlag();

  useEffect(() => {
    const channel = supabase
      .channel("global-incoming-alert")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "telegram_messages",
          filter: "direction=eq.incoming",
        },
        (payload) => {
          console.log("[Alert] New incoming Telegram message:", payload.new?.id);
          playNotificationSound();
        }
      )
      .subscribe((status) => {
        console.log("[Alert] Global incoming alert channel:", status);
      });

    // Extra звук для unified inbox: Instagram incoming + новые сообщения тикетов
    // (клиент пишет админу). Только при включённом флаге — не задваивает звук
    // моно-лент, у которых своего звука нет.
    const unifiedChannel = unifiedEnabled
      ? supabase
          .channel("global-incoming-alert-unified")
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "instagram_messages",
              filter: "direction=eq.incoming",
            },
            (payload) => {
              console.log("[Alert] New incoming Instagram message:", payload.new?.id);
              playNotificationSound();
            },
          )
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "ticket_messages" },
            (payload) => {
              // Звук только если это НЕ внутренняя админская заметка.
              const row = payload.new as { is_internal?: boolean } | null;
              if (row?.is_internal) return;
              console.log("[Alert] New ticket_message:", (payload.new as any)?.id);
              playNotificationSound();
            },
          )
          .subscribe()
      : null;

    return () => {
      supabase.removeChannel(channel);
      if (unifiedChannel) supabase.removeChannel(unifiedChannel);
    };
  }, [unifiedEnabled]);

  async function playNotificationSound() {
    try {
      // Reuse or create AudioContext
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;

      // Resume if suspended (browser autoplay policy)
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      // Simple two-tone notification sound
      const now = ctx.currentTime;

      // First tone
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = "sine";
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.3, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);

      // Second tone
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = "sine";
      osc2.frequency.setValueAtTime(1200, now + 0.15);
      gain2.gain.setValueAtTime(0.3, now + 0.15);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.15);
      osc2.stop(now + 0.35);
    } catch (err) {
      console.warn("[Alert] Could not play notification sound:", err);
    }
  }
}
