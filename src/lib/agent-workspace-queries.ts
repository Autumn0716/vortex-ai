import type { Database, QueryExecResult, SqlValue } from './db';

type SqlRow = Record<string, unknown>;

export function mapRows<T = SqlRow>(result: QueryExecResult[]): T[] {
  if (result.length === 0) {
    return [];
  }

  const entry = result[0]!;
  return entry.values.map((row) => {
    const mapped: SqlRow = {};
    entry.columns.forEach((column, index) => {
      mapped[column] = row[index];
    });
    return mapped as T;
  });
}

export function getScalar(database: Database, query: string, params: SqlValue[] = []): unknown {
  const result = database.exec(query, params);
  if (result.length === 0 || result[0]!.values.length === 0) {
    return null;
  }

  return result[0]!.values[0]![0];
}

export function buildLikePatterns(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => `%${part}%`);
}

export function buildMatchQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/["']/g, '').trim())
    .filter((part) => part.length > 0)
    .map((part) => `"${part}"*`)
    .join(' OR ');
}
