import { layout, prepare, type PreparedText } from '@chenglou/pretext';

const PREPARED_CACHE = new Map<string, PreparedText>();

export const PRETEXT_MESSAGE_FONT = '400 14px Inter';
export const PRETEXT_MESSAGE_LINE_HEIGHT = 22;

function getPrepared(text: string, font: string) {
  const cacheKey = `${font}::${text}`;
  const cached = PREPARED_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }

  const prepared = prepare(text, font, { whiteSpace: 'pre-wrap' });
  PREPARED_CACHE.set(cacheKey, prepared);
  return prepared;
}

export function stripMarkdownForMeasurement(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' code block ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' image ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~>#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function estimateMessageCardHeight(options: {
  content: string;
  width: number;
  toolsCount?: number;
  font?: string;
  lineHeight?: number;
  chromeOffset?: number;
}) {
  const {
    content,
    width,
    toolsCount = 0,
    font = PRETEXT_MESSAGE_FONT,
    lineHeight = PRETEXT_MESSAGE_LINE_HEIGHT,
    chromeOffset = 82,
  } = options;

  const safeWidth = Math.max(80, Math.floor(width));
  const measuredText = stripMarkdownForMeasurement(content || ' ');
  if (!measuredText) {
    return chromeOffset + toolsCount * 28;
  }

  const prepared = getPrepared(measuredText, font);
  const { height } = layout(prepared, safeWidth, lineHeight);
  return Math.max(84, Math.ceil(height + chromeOffset + toolsCount * 28));
}

export function clearPretextMeasurementCache() {
  PREPARED_CACHE.clear();
}
