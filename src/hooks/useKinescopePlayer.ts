/**
 * Hook for managing Kinescope IFrame API player with reliable seek+autoplay
 * Loads the Kinescope player script once and provides controlled playback
 */

import { useEffect, useRef, useCallback } from "react";

// Global promise for script loading (singleton pattern)
let scriptLoadPromise: Promise<void> | null = null;

// Kinescope Player Factory types (from their API docs)
interface KinescopePlayer {
  seekTo(seconds: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  mute(): Promise<void>;
  unmute(): Promise<void>;
  setCurrentTime(seconds: number): Promise<void>;
  getCurrentTime(): Promise<number>;
  destroy(): void;
  on(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback: (...args: any[]) => void): void;
}

interface KinescopePlayerFactory {
  create(containerId: string, options: { url: string; size?: { width: string; height: string } }): Promise<KinescopePlayer>;
}

declare global {
  interface Window {
    Kinescope?: {
      IframePlayer?: {
        create(containerId: string, options: { url: string; size?: { width: string; height: string } }): Promise<KinescopePlayer>;
      };
    };
  }
}

/**
 * Load Kinescope IFrame API script (once globally)
 */
function loadKinescopeScript(): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve, reject) => {
    // Check if already loaded
    if (window.Kinescope?.IframePlayer) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://player.kinescope.io/latest/iframe.player.js";
    script.async = true;
    script.onload = () => {
      // Wait a tick for Kinescope to initialize
      setTimeout(() => {
        if (window.Kinescope?.IframePlayer) {
          resolve();
        } else {
          reject(new Error("Kinescope IframePlayer not available after script load"));
        }
      }, 100);
    };
    script.onerror = () => reject(new Error("Failed to load Kinescope player script"));
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

interface UseKinescopePlayerOptions {
  videoId: string;
  containerId: string;
  autoplayTimecode?: number | null;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Hook to create and manage a Kinescope player instance
 */
export function useKinescopePlayer({
  videoId,
  containerId,
  autoplayTimecode,
  onReady,
  onError,
}: UseKinescopePlayerOptions) {
  const playerRef = useRef<KinescopePlayer | null>(null);
  const lastTimecodeRef = useRef<number | null>(null);
  const isInitializedRef = useRef(false);

  // Seek to timecode and play
  const seekAndPlay = useCallback(async (seconds: number) => {
    const player = playerRef.current;
    if (!player) return;

    try {
      // Mute first to bypass autoplay restrictions, then seek and play
      await player.mute();
      await player.seekTo(seconds);
      await player.play();
      // Unmute after a short delay (user can also unmute manually)
      setTimeout(() => {
        player.unmute().catch(() => {
          // Ignore unmute errors - might be blocked by browser
        });
      }, 500);
    } catch (err) {
      console.warn("[Kinescope] seekAndPlay error:", err);
    }
  }, []);

  // Initialize player
  useEffect(() => {
    if (!videoId || !containerId) return;

    let isMounted = true;
    let player: KinescopePlayer | null = null;

    const initPlayer = async () => {
      try {
        await loadKinescopeScript();

        if (!isMounted) return;

        const factory = window.Kinescope?.IframePlayer;
        if (!factory) {
          throw new Error("Kinescope IframePlayer not available");
        }

        // Clear container
        const container = document.getElementById(containerId);
        if (container) {
          container.innerHTML = "";
        }

        // Create player
        player = await factory.create(containerId, {
          url: `https://kinescope.io/${videoId}`,
          size: { width: "100%", height: "100%" },
        });

        if (!isMounted) {
          player.destroy();
          return;
        }

        playerRef.current = player;
        isInitializedRef.current = true;

        // If autoplay timecode was set, seek and play immediately
        if (autoplayTimecode != null && autoplayTimecode > 0) {
          lastTimecodeRef.current = autoplayTimecode;
          // Small delay to ensure player is fully ready
          setTimeout(() => {
            seekAndPlay(autoplayTimecode);
          }, 300);
        }

        onReady?.();
      } catch (err) {
        console.error("[Kinescope] Player init error:", err);
        onError?.(err as Error);
      }
    };

    initPlayer();

    return () => {
      isMounted = false;
      if (player) {
        try {
          player.destroy();
        } catch {
          // ignore
        }
      }
      playerRef.current = null;
      isInitializedRef.current = false;
    };
  }, [videoId, containerId]); // Don't include autoplayTimecode here - we handle changes separately

  // Handle timecode changes (after initial mount)
  useEffect(() => {
    if (!isInitializedRef.current) return;
    if (autoplayTimecode == null || autoplayTimecode === lastTimecodeRef.current) return;

    lastTimecodeRef.current = autoplayTimecode;
    seekAndPlay(autoplayTimecode);
  }, [autoplayTimecode, seekAndPlay]);

  return {
    player: playerRef.current,
    seekAndPlay,
  };
}

/**
 * Extract Kinescope video ID from various URL formats
 */
export function extractKinescopeVideoId(url: string): string | null {
  if (!url) return null;
  
  // Match patterns:
  // https://kinescope.io/embed/abc123
  // https://kinescope.io/abc123
  // kinescope.io/abc123
  const match = url.match(/kinescope\.io\/(?:embed\/)?([a-zA-Z0-9]+)/);
  return match?.[1] || null;
}
