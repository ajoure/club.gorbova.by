import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { createDrmPilotController, type PilotPermit, type PilotPlayer, type PilotSnapshot } from "@/lib/video/drmPilotController";

interface PilotFactory {
  create(id: string, options: Record<string, unknown>): Promise<PilotPlayer>;
}
let loadingFactory: Promise<PilotFactory> | undefined;
function loadFactory(): Promise<PilotFactory> {
  const current = window.Kinescope?.IframePlayer as unknown as PilotFactory | undefined;
  if (current) return Promise.resolve(current);
  if (loadingFactory) return loadingFactory;
  loadingFactory = new Promise<PilotFactory>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://player.kinescope.io/latest/iframe.player.js";
    script.async = true;
    const timer = setTimeout(() => { script.remove(); reject(new Error("pilot_sdk_unavailable")); }, 15000);
    script.onload = () => {
      clearTimeout(timer);
      const factory = window.Kinescope?.IframePlayer as unknown as PilotFactory | undefined;
      if (factory) resolve(factory); else reject(new Error("pilot_sdk_unavailable"));
    };
    script.onerror = () => { clearTimeout(timer); script.remove(); reject(new Error("pilot_sdk_unavailable")); };
    document.head.appendChild(script);
  }).catch(error => { loadingFactory = undefined; throw error; });
  return loadingFactory;
}

const labels = { loading: "Подготовка просмотра", ready: "Доступ подтверждён", renewing: "Обновление доступа",
  denied: "Доступ не подтверждён. Можно повторить проверку.", expired: "Доступ истёк. Повторите проверку.", closed: "Просмотр закрыт" };

export default function VideoDrmPilot() {
  const { user } = useAuth();
  const userId = user?.id;
  const host = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<ReturnType<typeof createDrmPilotController>>();
  const [mediaKey, setMediaKey] = useState("synthetic-vod");
  const [status, setStatus] = useState<keyof typeof labels>("loading");
  const [renewals, setRenewals] = useState(0);
  const [lastRenewal, setLastRenewal] = useState<{ before: PilotSnapshot; after: PilotSnapshot }>();

  useEffect(() => {
    if (!userId || !host.current) return;
    const container = host.current;
    const mount = document.createElement("div");
    mount.style.cssText = "width:100%;height:100%";
    container.appendChild(mount);
    let alive = true;
    let lastPosition = 0;
    let resumeKey = "";
    let restored = false;
    let restoring = false;
    let lastSave = 0;
    const save = () => {
      if (!resumeKey || !restored || !Number.isFinite(lastPosition)) return;
      try { localStorage.setItem(resumeKey, String(lastPosition)); } catch { /* optional persistence */ }
    };
    const controller = createDrmPilotController({
      async getPermit() {
        const { data, error } = await supabase.functions.invoke("video-pilot-token", { body: { mediaKey } });
        if (error || !data || data.mediaKey !== mediaKey) throw new Error("pilot_denied");
        return data as PilotPermit;
      },
      async createPlayer(permit) {
        const factory = await loadFactory();
        if (!alive) throw new Error("pilot_closed");
        const iframe = document.createElement("iframe");
        iframe.id = `video-drm-pilot-${crypto.randomUUID()}`;
        iframe.title = "Тестовое защищённое видео";
        iframe.setAttribute("allow", "autoplay; fullscreen; encrypted-media; picture-in-picture");
        iframe.allowFullscreen = true;
        iframe.style.cssText = "width:100%;height:100%;border:0";
        mount.appendChild(iframe);
        const player = await factory.create(iframe.id, {
          url: `https://kinescope.io/embed/${permit.playerId}`,
          size: { width: "100%", height: "100%" },
          behavior: { autoPlay: false, playsInline: true, preload: "none",
            localStorage: { time: false, quality: "item", textTrack: "item" } },
          playlist: [{ drm: { auth: { token: permit.token } } }],
        });
        if (!player.Events?.Loaded || !player.Events.TimeUpdate || !player.Events.Pause) {
          await player.destroy();
          throw new Error("pilot_sdk_unavailable");
        }
        if (permit.mediaType === "vod") {
          // The position belongs to this user AND this asset. Never use max(time).
          resumeKey = `video-drm-pilot:${userId}:${permit.playerId}`;
          try {
            const saved = Number(localStorage.getItem(resumeKey));
            lastPosition = Number.isFinite(saved) && saved >= 0 ? saved : 0;
          } catch { lastPosition = 0; }
          player.on(player.Events.Loaded, () => {
            void (async () => {
              if (restored || restoring || !alive) return;
              restoring = true;
              try {
                const duration = await player.getDuration();
                if (alive && lastPosition > 0 && Number.isFinite(duration) && duration > 0)
                  await player.seekTo(Math.min(lastPosition, Math.max(0, duration - 0.1)));
                restored = true;
              } finally { restoring = false; }
            })().catch(() => {
              if (alive) { setStatus("denied"); void player.pause().catch(() => {}); }
            });
          });
          player.on(player.Events.TimeUpdate, event => {
            if (!restored || !alive || !Number.isFinite(event.data?.currentTime)) return;
            lastPosition = Math.max(0, event.data!.currentTime!);
            if (Date.now() - lastSave >= 5000) { save(); lastSave = Date.now(); }
          });
          const persistCurrent = () => {
            void player.getCurrentTime().then(time => {
              if (alive && restored && Number.isFinite(time)) { lastPosition = Math.max(0, time); save(); }
            }).catch(() => {});
          };
          player.on(player.Events.Pause, persistCurrent);
          if (player.Events.Seeked) player.on(player.Events.Seeked, persistCurrent);
        }
        return player;
      },
      onStatus: value => { if (alive) setStatus(value); },
      onRenewed: (before, after) => { if (alive) { setRenewals(n => n + 1); setLastRenewal({ before, after }); } },
    });
    controllerRef.current = controller;
    setRenewals(0); setLastRenewal(undefined);
    void controller.refresh();
    const visibility = () => {
      if (document.visibilityState === "visible") void controller.refresh(); else save();
    };
    const wake = () => { void controller.refresh(); };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pageshow", wake);
    window.addEventListener("pagehide", save);
    return () => {
      save(); alive = false;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("pagehide", save);
      controllerRef.current = undefined;
      void controller.close().finally(() => { mount.remove(); });
    };
  }, [userId, mediaKey]);

  return <main className="mx-auto max-w-5xl space-y-5 px-4 py-8">
    <h1 className="text-2xl font-semibold">Проверка защиты видео</h1>
    <p>Изолированный пилот на тестовом материале. Боевые записи здесь не используются.</p>
    <label className="flex flex-wrap items-center gap-3">Материал
      <select className="rounded border p-2" value={mediaKey} onChange={event => setMediaKey(event.target.value)}>
        <option value="synthetic-vod">Тестовая запись</option><option value="synthetic-live">Тестовый эфир</option>
      </select>
    </label>
    <div ref={host} className="aspect-video w-full overflow-hidden rounded-lg bg-black" />
    <p role="status">{labels[status]}</p>
    <button className="rounded border px-4 py-2" onClick={() => void controllerRef.current?.refresh()}>Повторить проверку доступа</button>
    <p>Проверьте паузу, перемотку, скорость, качество и субтитры. После возвращения к записи должно сохраняться место остановки.</p>
    <details className="rounded border p-3"><summary>Результат обновления доступа</summary>
      <p>Обновлений без пересоздания плеера: {renewals}</p>
      {lastRenewal && <p>Позиция: {lastRenewal.before.time?.toFixed(1) ?? "нет данных"} → {lastRenewal.after.time?.toFixed(1) ?? "нет данных"} с.
        Пауза: {lastRenewal.before.paused === null ? "нет данных" : String(lastRenewal.before.paused)} → {lastRenewal.after.paused === null ? "нет данных" : String(lastRenewal.after.paused)}.
        Скорость: {lastRenewal.before.speed ?? "нет данных"} → {lastRenewal.after.speed ?? "нет данных"}.</p>}
      <p>Субтитры, качество, полноэкранный режим и PiP проверяются также в самом плеере.</p>
    </details>
  </main>;
}
