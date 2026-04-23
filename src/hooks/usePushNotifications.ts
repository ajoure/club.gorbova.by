import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type PushState = "unsupported" | "ios-safari" | "denied" | "prompt" | "subscribed" | "loading";

// In-memory cache for VAPID key
let cachedVapidKey: string | null = null;

function isIOSSafari(): boolean {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isStandalone = (window.navigator as any).standalone === true;
  // In standalone (PWA) mode, Push may be available on iOS 16.4+
  if (isStandalone) return false;
  return isIOS;
}

async function fetchVapidKey(): Promise<string | null> {
  if (cachedVapidKey) return cachedVapidKey;

  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

    const res = await fetch(`${supabaseUrl}/functions/v1/get-vapid-key`, {
      headers: {
        'apikey': anonKey,
      },
    });

    if (!res.ok) {
      console.error("[Push] Failed to fetch VAPID key, status:", res.status);
      return null;
    }

    const data = await res.json();
    if (data.key) {
      cachedVapidKey = data.key;
      console.log("[Push] VAPID key fetched successfully");
      return data.key;
    }
    console.error("[Push] VAPID key response missing 'key' field");
    return null;
  } catch (err) {
    console.error("[Push] Error fetching VAPID key:", err);
    return null;
  }
}

export function usePushNotifications() {
  const { user } = useAuth();
  const [state, setState] = useState<PushState>("loading");

  // Check current state on mount
  useEffect(() => {
    // iOS Safari (not standalone PWA) — special state
    if (isIOSSafari()) {
      console.log("[Push] iOS Safari detected (not standalone PWA)");
      setState("ios-safari");
      return;
    }

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.warn("[Push] Service Worker or PushManager not supported");
      setState("unsupported");
      return;
    }

    if (!("Notification" in window)) {
      console.warn("[Push] Notification API not supported");
      setState("unsupported");
      return;
    }

    if (Notification.permission === "denied") {
      console.warn("[Push] Notifications denied by user");
      setState("denied");
      return;
    }

    // Check if already subscribed
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        console.log("[Push] Current subscription:", sub ? "active" : "none");
        setState(sub ? "subscribed" : "prompt");
      });
    });
  }, []);

  // Register SW on mount
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.log("[Push] SW registered, scope:", reg.scope);
        })
        .catch((err) => {
          console.error("[Push] SW registration failed:", err);
        });
    }
  }, []);

  const subscribe = useCallback(async () => {
    if (!user?.id) {
      console.warn("[Push] No user ID, cannot subscribe");
      toast.error("Необходимо авторизоваться");
      return false;
    }

    setState("loading");
    try {
      // Step 1: Fetch VAPID key from edge function
      const vapidKey = await fetchVapidKey();
      if (!vapidKey) {
        console.error("[Push] VAPID key not available");
        toast.error("Push-уведомления не настроены: не удалось получить VAPID ключ");
        setState("prompt");
        return false;
      }
      console.log("[Push] Step 1: VAPID key obtained");

      // Step 2: Request permission
      const permission = await Notification.requestPermission();
      console.log("[Push] Step 2: Permission result:", permission);
      if (permission !== "granted") {
        setState("denied");
        toast.error("Разрешите уведомления в настройках браузера");
        return false;
      }

      // Step 3: Get SW registration
      const reg = await navigator.serviceWorker.ready;
      console.log("[Push] Step 3: SW ready");

      // Step 4: Subscribe to push
      const subscription = await (reg as any).pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      console.log("[Push] Step 4: Push subscription created:", subscription.endpoint);

      const json = subscription.toJSON();

      // Step 5: Save to DB
      const { error } = await supabase.from("push_subscriptions" as any).upsert(
        {
          user_id: user.id,
          endpoint: json.endpoint!,
          p256dh: json.keys!.p256dh,
          auth: json.keys!.auth,
        },
        { onConflict: "endpoint" }
      );

      if (error) {
        console.error("[Push] Step 5: DB save error:", error.message, error.details, error.hint);
        toast.error(`Ошибка сохранения подписки: ${error.message}`);
        setState("prompt");
        return false;
      }

      console.log("[Push] Step 5: Subscription saved to DB successfully");
      setState("subscribed");
      return true;
    } catch (err: any) {
      console.error("[Push] Subscribe error:", err);
      toast.error(`Ошибка подписки: ${err?.message || "неизвестная ошибка"}`);
      setState("prompt");
      return false;
    }
  }, [user?.id]);

  const unsubscribe = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await supabase
          .from("push_subscriptions" as any)
          .delete()
          .eq("endpoint", sub.endpoint);

        await sub.unsubscribe();
        console.log("[Push] Unsubscribed successfully");
      }
      setState("prompt");
    } catch (err) {
      console.error("[Push] Unsubscribe error:", err);
    }
  }, []);

  return { state, subscribe, unsubscribe };
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
