import type { Database, QueryExecResult, SqlValue } from './db-core';

type SqlRow = Record<string, unknown>;

export function mapRows<T = SqlRow>(result: QueryExecResult[]): T[] {
  if (result.length === 0) {
    return [];
  }

  const entry = result[0]!;
  return entry.values.map((row) => {
    const obj: SqlRow = {};
    entry.columns.forEach((column, index) => {
      obj[column] = row[index];
    });
    return obj as T;
  });
}

export function toBoolean(value: unknown): boolean {
  return value === 1 || value === '1' || value === true;
}

export function getScalar(database: Database, query: string, params: SqlValue[] = []): unknown {
  const result = database.exec(query, params);
  if (result.length === 0 || result[0]!.values.length === 0) {
    return null;
  }

  return result[0]!.values[0]![0];
}
