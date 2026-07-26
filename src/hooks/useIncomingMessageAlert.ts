import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Global hook: plays a notification sound when a new incoming message arrives
 * across Telegram / Instagram / Support ticket channels. Should be mounted once
 * in AdminLayout so it works on any admin page.
 */
export function useIncomingMessageAlert() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const hasPushSubscriptionRef = useRef(true);

  // Initialize AudioContext on first user gesture to comply with browser autoplay policy
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      hasPushSubscriptionRef.current = false;
      return;
    }

    let cancelled = false;
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        if (!cancelled) hasPushSubscriptionRef.current = Boolean(subscription);
      })
      .catch(() => {
        if (!cancelled) hasPushSubscriptionRef.current = false;
      });

    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    // Единый канал: Telegram + Instagram incoming + клиентские сообщения в тикетах.
    // Гейт unifiedEnabled убран — звук приходит всем админам, не задваивается
    // (у моно-лент IG/Support своего звука нет).
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
          console.log("[Alert] New incoming Telegram message:", (payload.new as any)?.id);
          playNotificationSound();
          showFallbackNotification(
            "Новое сообщение в Telegram",
            getMessagePreview(payload.new),
            `tg-realtime-${(payload.new as any)?.id || "new"}`,
          );
        }
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "instagram_messages",
          filter: "direction=eq.incoming",
        },
        (payload) => {
          console.log("[Alert] New incoming Instagram message:", (payload.new as any)?.id);
          playNotificationSound();
          showFallbackNotification(
            "Новое сообщение в Instagram",
            getMessagePreview(payload.new),
            `ig-realtime-${(payload.new as any)?.id || "new"}`,
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ticket_messages" },
        (payload) => {
          const row = payload.new as { is_internal?: boolean; author_type?: string } | null;
          // Only client-authored, non-internal messages should chime.
          if (!row) return;
          if (row.is_internal) return;
          if (row.author_type && row.author_type !== "user") return;
          console.log("[Alert] New ticket_message:", (payload.new as any)?.id);
          playNotificationSound();
          showFallbackNotification(
            "Новое сообщение в техподдержке",
            getMessagePreview(payload.new),
            `ticket-realtime-${(payload.new as any)?.id || "new"}`,
          );
        },
      )
      .subscribe((status) => {
        console.log("[Alert] Global incoming alert channel:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function getMessagePreview(row: unknown): string {
    const message = row as Record<string, unknown> | null;
    const value = message?.message_text ?? message?.content ?? message?.text;
    return typeof value === "string" && value.trim()
      ? value.trim().slice(0, 120)
      : "Откройте контакт-центр, чтобы прочитать сообщение";
  }

  function showFallbackNotification(title: string, body: string, tag: string) {
    // The service-worker push is the primary path. Use the Realtime event only
    // when this browser has permission but no active PushManager subscription.
    if (hasPushSubscriptionRef.current) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    try {
      const notification = new Notification(title, {
        body,
        icon: "/favicon.ico",
        tag,
      });
      notification.onclick = () => {
        window.focus();
        window.location.assign("/admin/communication");
        notification.close();
      };
    } catch (err) {
      console.warn("[Alert] Could not show browser notification:", err);
    }
  }

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
