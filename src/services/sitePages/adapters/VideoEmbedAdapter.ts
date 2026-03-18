/**
 * VideoEmbedAdapter — anti-corruption layer for video URLs.
 * Raw URL is user input only; provider-specific parsing lives exclusively here.
 * Raw URL MUST NOT be used for internal relationships or domain logic.
 */

export type VideoProvider = "youtube" | "vimeo" | "rutube";

export interface VideoEmbedResult {
  provider: VideoProvider;
  videoId: string;
  embedUrl: string;
}

const YOUTUBE_PATTERNS = [
  /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
  /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
];

const VIMEO_PATTERN = /vimeo\.com\/(?:video\/)?(\d+)/;
const RUTUBE_PATTERN = /rutube\.ru\/video\/([a-f0-9]+)/;

export function parseVideoUrl(rawUrl: string): VideoEmbedResult | null {
  if (!rawUrl) return null;

  const trimmed = rawUrl.trim();

  for (const pattern of YOUTUBE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      return {
        provider: "youtube",
        videoId: match[1],
        embedUrl: `https://www.youtube.com/embed/${match[1]}`,
      };
    }
  }

  const vimeoMatch = trimmed.match(VIMEO_PATTERN);
  if (vimeoMatch?.[1]) {
    return {
      provider: "vimeo",
      videoId: vimeoMatch[1],
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
    };
  }

  const rutubeMatch = trimmed.match(RUTUBE_PATTERN);
  if (rutubeMatch?.[1]) {
    return {
      provider: "rutube",
      videoId: rutubeMatch[1],
      embedUrl: `https://rutube.ru/play/embed/${rutubeMatch[1]}`,
    };
  }

  return null;
}

export function isValidVideoUrl(rawUrl: string): boolean {
  return parseVideoUrl(rawUrl) !== null;
}
