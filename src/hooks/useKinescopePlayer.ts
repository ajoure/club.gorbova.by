/**
 * Hook for managing Kinescope IFrame API player with reliable seek+autoplay
 * Loads the Kinescope player script once and provides controlled playback
 * 
 * PATCH v3: Added onSeekApplied callback, improved ready handling, better error visibility
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { toast } from "sonner";

// Build marker for diagnostics
const KINESCOPE_HOOK_VERSION = "v3-2026-01-30";

// Global promise for script loading (singleton pattern)
let scriptLoadPromise: Promise<void> | null = null;

// Kinescope Player types (from their API docs)
interface KinescopePlayer {
  seekTo(seconds: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  mute(): Promise<void>;
  unmute(): Promise<void>;
  setCurrentTime?(seconds: number): Promise<void>; // may not exist in all versions
  getCurrentTime(): Promise<number>;
  destroy(): void;
  on(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback: (...args: any[]) => void): void;
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
      console.info(`[Kinescope ${KINESCOPE_HOOK_VERSION}] Script already loaded`);
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
          console.info(`[Kinescope ${KINESCOPE_HOOK_VERSION}] Script loaded successfully`);
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
  /** Initial timecode for autoplay (used on first load) */
  autoplayTimecode?: number | null;
  /** Callback when player is ready */
  onReady?: () => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Callback when seek+play was successfully applied */
  onSeekApplied?: (seconds: number, nonce: number) => void;
}

interface PendingSeekRequest {
  seconds: number;
  nonce: number;
  consumed: boolean;
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
  onSeekApplied,
}: UseKinescopePlayerOptions) {
  const playerRef = useRef<KinescopePlayer | null>(null);
  const pendingSeekRef = useRef<PendingSeekRequest | null>(null);
  const isReadyRef = useRef(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  /**
   * Apply pending seek: mute → seek → play
   * Called when player is ready OR when new seek request arrives
   */
  const applyPendingSeek = useCallback(async () => {
    const player = playerRef.current;
    const pending = pendingSeekRef.current;
    
    if (!player || !pending || pending.consumed) {
      return;
    }

    const { seconds, nonce } = pending;
    console.info(`[Kinescope ${KINESCOPE_HOOK_VERSION}] Applying seek:`, { seconds, nonce });

    try {
      // Mark as consumed BEFORE async operations to prevent double-apply
      pending.consumed = true;
      setAutoplayBlocked(false);

      // Step 1: Mute to bypass autoplay restrictions
      await player.mute();
      
      // Step 2: Seek (try setCurrentTime first, fallback to seekTo)
      if (typeof player.setCurrentTime === 'function') {
        await player.setCurrentTime(seconds);
      } else {
        await player.seekTo(seconds);
      }
      
      // Step 3: Play
      await player.play();
      
      console.info(`[Kinescope ${KINESCOPE_HOOK_VERSION}] Seek+play SUCCESS:`, { seconds, nonce });
      
      // Step 4: Unmute after short delay
      setTimeout(() => {
        player.unmute().catch(() => {
          // Ignore unmute errors
        });
      }, 500);

      // Notify parent that seek was applied
      onSeekApplied?.(seconds, nonce);
      
    } catch (err) {
      console.error(`[Kinescope ${KINESCOPE_HOOK_VERSION}] Seek+play FAILED:`, err);
      
      // Show autoplay blocked banner
      setAutoplayBlocked(true);
      
      // Show toast for visibility
      toast.warning("Автозапуск заблокирован", {
        description: "Нажмите Play в плеере для воспроизведения"
      });
    }
  }, [onSeekApplied]);

  /**
   * External method to request seek+play
   */
  const seekAndPlay = useCallback(async (seconds: number, nonce?: number) => {
    const effectiveNonce = nonce ?? Date.now();
    
    // Set pending request
    pendingSeekRef.current = {
      seconds,
      nonce: effectiveNonce,
      consumed: false,
    };

    // If player is already ready, apply immediately
    if (isReadyRef.current && playerRef.current) {
      await applyPendingSeek();
    }
  }, [applyPendingSeek]);

  /**
   * Manual play (for user-initiated click on autoplay blocked banner)
   */
  const manualPlay = useCallback(async () => {
    const player = playerRef.current;
    if (!player) return;

    try {
      await player.play();
      setAutoplayBlocked(false);
    } catch (err) {
      console.error(`[Kinescope ${KINESCOPE_HOOK_VERSION}] Manual play failed:`, err);
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
        isReadyRef.current = true;
        
        // Force iframe to fill container (Kinescope API doesn't always respect 100%)
        setTimeout(() => {
          const containerEl = document.getElementById(containerId);
          if (containerEl) {
            const iframe = containerEl.querySelector('iframe');
            if (iframe) {
              iframe.style.width = '100%';
              iframe.style.height = '100%';
              iframe.style.position = 'absolute';
              iframe.style.top = '0';
              iframe.style.left = '0';
            }
          }
        }, 50);
        
        console.info(`[Kinescope ${KINESCOPE_HOOK_VERSION}] Player ready:`, { videoId, containerId });

        // If initial autoplay timecode was provided, set it as pending
        if (autoplayTimecode != null && autoplayTimecode > 0) {
          pendingSeekRef.current = {
            seconds: autoplayTimecode,
            nonce: Date.now(),
            consumed: false,
          };
        }

        // Apply any pending seek
        await applyPendingSeek();

        onReady?.();
      } catch (err) {
        console.error(`[Kinescope ${KINESCOPE_HOOK_VERSION}] Player init error:`, err);
        onError?.(err as Error);
      }
    };

    initPlayer();

    return () => {
      isMounted = false;
      isReadyRef.current = false;
      if (player) {
        try {
          player.destroy();
        } catch {
          // ignore
        }
      }
      playerRef.current = null;
    };
  }, [videoId, containerId]); // Don't include autoplayTimecode - handled via seekAndPlay

  // Handle external timecode changes (after initial mount)
  useEffect(() => {
    if (!isReadyRef.current) return;
    if (autoplayTimecode == null || autoplayTimecode <= 0) return;
    
    // Check if this is a new request (different from last consumed)
    const pending = pendingSeekRef.current;
    if (pending && pending.consumed && pending.seconds === autoplayTimecode) {
      return; // Already applied this timecode
    }

    seekAndPlay(autoplayTimecode);
  }, [autoplayTimecode, seekAndPlay]);

  return {
    player: playerRef.current,
    seekAndPlay,
    manualPlay,
    autoplayBlocked,
    isReady: isReadyRef.current,
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
  // https://kinescope.io/abc123?t=100
  // kinescope.io/abc123
  const match = url.match(/kinescope\.io\/(?:embed\/)?([a-zA-Z0-9]+)/);
  return match?.[1] || null;
}
