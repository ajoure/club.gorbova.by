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
  getDuration(): Promise<number>;
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
  /** Callback for timeupdate events (progress tracking) */
  onTimeUpdate?: (currentTime: number, duration: number, percent: number) => void;
  /** Callback when video playback starts */
  onPlay?: () => void;
  /** Callback when video ends */
  onEnded?: () => void;
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
  onTimeUpdate,
  onPlay,
  onEnded,
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
    let observer: MutationObserver | null = null;
    let rafId: number | null = null;

    /**
     * Force all elements inside container to fill 100%
     * Called multiple times to counteract Kinescope's late style changes
     */
    const forceFill = () => {
      // Guard: exit early if unmounted or container detached from DOM
      if (!isMounted) return;
      
      const containerEl = document.getElementById(containerId);
      if (!containerEl || !containerEl.isConnected) return;

      // Force container itself
      containerEl.style.setProperty('width', '100%', 'important');
      containerEl.style.setProperty('height', '100%', 'important');

      // Force any wrapper div Kinescope might insert
      const wrapper = containerEl.firstElementChild as HTMLElement | null;
      if (wrapper && wrapper.tagName !== 'IFRAME') {
        wrapper.style.setProperty('width', '100%', 'important');
        wrapper.style.setProperty('height', '100%', 'important');
        wrapper.style.setProperty('position', 'absolute', 'important');
        wrapper.style.setProperty('inset', '0', 'important');
      }

      // Force iframe
      const iframe = containerEl.querySelector('iframe') as HTMLIFrameElement | null;
      if (iframe) {
        iframe.style.setProperty('width', '100%', 'important');
        iframe.style.setProperty('height', '100%', 'important');
        iframe.style.setProperty('position', 'absolute', 'important');
        iframe.style.setProperty('inset', '0', 'important');
        iframe.style.setProperty('display', 'block', 'important');
      }
    };

    /**
     * Throttled forceFill via requestAnimationFrame
     */
    const throttledForceFill = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        forceFill();
      });
    };

    const initPlayer = async () => {
      try {
        await loadKinescopeScript();

        if (!isMounted) return;

        const factory = window.Kinescope?.IframePlayer;
        if (!factory) {
          throw new Error("Kinescope IframePlayer not available");
        }

        // Safe DOM cleanup - remove children one by one to avoid React reconciliation conflicts
        const container = document.getElementById(containerId);
        if (container) {
          while (container.firstChild) {
            container.removeChild(container.firstChild);
          }
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
        
        // Force fill immediately
        forceFill();
        
        // Force fill again after next frame (Kinescope may change DOM)
        requestAnimationFrame(forceFill);
        
        // Force fill after delay (Kinescope sometimes changes styles later)
        // Use RAF + isMounted guard to sync with browser render cycle and prevent DOM operations after unmount
        const scheduleDelayedFill = (delay: number) => {
          setTimeout(() => {
            if (isMounted) {
              requestAnimationFrame(() => {
                if (isMounted) forceFill();
              });
            }
          }, delay);
        };
        scheduleDelayedFill(100);
        scheduleDelayedFill(300);
        scheduleDelayedFill(500);
        
        // Setup MutationObserver to catch any late style changes by Kinescope
        const containerEl = document.getElementById(containerId);
        if (containerEl) {
          observer = new MutationObserver(() => {
            // Guard: prevent DOM operations after unmount (fixes removeChild error)
            if (!isMounted) return;
            throttledForceFill();
          });
          observer.observe(containerEl, {
            attributes: true,
            attributeFilter: ['style', 'class'],
            childList: true,
            subtree: true,
          });
        }
        
        console.info(`[Kinescope ${KINESCOPE_HOOK_VERSION}] Player ready with size stabilizer:`, { videoId, containerId });

        // Subscribe to player events for progress tracking
        let cachedDuration = 0;
        
        // Listen for duration change (usually fires once on ready)
        player.on('durationchange', async () => {
          if (!isMounted) return;
          try {
            cachedDuration = await player.getDuration() || 0;
            console.info(`[Kinescope ${KINESCOPE_HOOK_VERSION}] Duration:`, cachedDuration);
          } catch {
            // Ignore errors
          }
        });
        
        // Listen for timeupdate events
        player.on('timeupdate', async () => {
          if (!isMounted) return;
          try {
            const currentTime = await player.getCurrentTime();
            // Try to get duration if not cached
            if (!cachedDuration) {
              cachedDuration = await player.getDuration() || 0;
            }
            if (cachedDuration > 0 && onTimeUpdate) {
              const percent = Math.round((currentTime / cachedDuration) * 100);
              onTimeUpdate(currentTime, cachedDuration, percent);
            }
          } catch {
            // Ignore errors
          }
        });
        
        // Listen for play event
        player.on('play', () => {
          if (!isMounted) return;
          console.info(`[Kinescope ${KINESCOPE_HOOK_VERSION}] Play event`);
          onPlay?.();
        });
        
        // Listen for ended event
        player.on('ended', () => {
          if (!isMounted) return;
          console.info(`[Kinescope ${KINESCOPE_HOOK_VERSION}] Ended event`);
          onEnded?.();
        });

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
      // FIRST: Disconnect observer to stop any pending callbacks BEFORE marking unmounted
      // This prevents race condition where observer fires between isMounted=false and disconnect()
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      
      // Cancel pending RAF
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      
      // THEN: Mark as unmounted (after observer is disconnected)
      isMounted = false;
      isReadyRef.current = false;
      
      // Finally: Destroy player
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
