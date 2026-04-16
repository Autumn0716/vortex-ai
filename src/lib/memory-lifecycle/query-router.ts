import type {
  MemoryQueryRoute,
  MemoryQueryRouterOptions,
  MemoryRetrievalLayer,
} from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfUtcDay(input: Date): Date {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function buildUtcDate(year: number, month: number, day: number): Date | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function normalizeExplicitColdAfterDays(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 15;
}

function isOlderThanRetentionWindow(referenceDate: Date, now: Date, retentionDays: number): boolean {
  const ageDays = (startOfUtcDay(now).getTime() - startOfUtcDay(referenceDate).getTime()) / DAY_MS;
  return ageDays > retentionDays;
}

function parseIsoDateExpression(query: string): { matchedTimeExpression: string; referenceDate: Date } | null {
  const match = query.match(/\d{4}-\d{2}-\d{2}/);
  if (!match) {
    return null;
  }

  const [yearText, monthText, dayText] = match[0].split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const referenceDate = buildUtcDate(year, month, day);

  if (!referenceDate) {
    return null;
  }

  return {
    matchedTimeExpression: match[0],
    referenceDate,
  };
}

function parseSlashDateExpression(query: string): { matchedTimeExpression: string; referenceDate: Date } | null {
  const match = query.match(/\d{4}\/\d{2}\/\d{2}/);
  if (!match) {
    return null;
  }

  const [yearText, monthText, dayText] = match[0].split('/');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const referenceDate = buildUtcDate(year, month, day);

  if (!referenceDate) {
    return null;
  }

  return {
    matchedTimeExpression: match[0],
    referenceDate,
  };
}

function parseChineseMonthDayExpression(
  query: string,
  now: Date,
): { matchedTimeExpression: string; referenceDate: Date } | null {
  const match = query.match(/\d{1,2}月\d{1,2}[日号]/);
  if (!match) {
    return null;
  }

  const parts = match[0].match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (!parts) {
    return null;
  }

  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const currentYear = now.getUTCFullYear();
  let referenceDate = buildUtcDate(currentYear, month, day);

  if (!referenceDate) {
    return null;
  }

  if (referenceDate.getTime() > now.getTime()) {
    referenceDate = buildUtcDate(currentYear - 1, month, day);
    if (!referenceDate) {
      return null;
    }
  }

  return {
    matchedTimeExpression: match[0],
    referenceDate,
  };
}

function parseRelativeExpression(query: string, now: Date): { matchedTimeExpression: string; referenceDate: Date } | null {
  if (query.includes('上个月')) {
    return {
      matchedTimeExpression: '上个月',
      referenceDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    };
  }

  if (query.includes('上上周')) {
    return {
      matchedTimeExpression: '上上周',
      referenceDate: new Date(startOfUtcDay(now).getTime() - 21 * DAY_MS),
    };
  }

  if (query.includes('去年')) {
    return {
      matchedTimeExpression: '去年',
      referenceDate: new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate())),
    };
  }

  return null;
}

function parseExplicitPastReference(
  query: string,
  now: Date,
): { matchedTimeExpression: string; referenceDate: Date } | null {
  return (
    parseIsoDateExpression(query) ??
    parseSlashDateExpression(query) ??
    parseChineseMonthDayExpression(query, now) ??
    parseRelativeExpression(query, now)
  );
}

function createDefaultRoute(matchedTimeExpression?: string): MemoryQueryRoute {
  return {
    mode: 'default',
    preferredLayers: ['hot', 'warm', 'global'],
    fallbackLayers: ['cold'],
    matchedTimeExpression,
  };
}

export function routeMemoryQuery(
  query: string,
  options: MemoryQueryRouterOptions = {},
): MemoryQueryRoute {
  const now = options.now ? new Date(options.now) : new Date();
  const explicitColdAfterDays = normalizeExplicitColdAfterDays(options.explicitColdAfterDays);
  const explicitReference = parseExplicitPastReference(query.trim(), now);

  if (
    explicitReference &&
    isOlderThanRetentionWindow(explicitReference.referenceDate, now, explicitColdAfterDays)
  ) {
    return {
      mode: 'explicit_cold',
      preferredLayers: ['cold', 'global'],
      fallbackLayers: [],
      matchedTimeExpression: explicitReference.matchedTimeExpression,
    };
  }

  return createDefaultRoute(explicitReference?.matchedTimeExpression);
}

export type { MemoryRetrievalLayer };
