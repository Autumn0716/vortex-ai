interface FtsDatabase {
  run(query: string, params?: unknown[]): void;
  exec(query: string, params?: unknown[]): Array<{ values: unknown[][] }>;
}

export interface Fts5TableDefinition {
  tableName: string;
  columns: string[];
}

function assertFtsIdentifier(input: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input)) {
    throw new Error(`Invalid FTS5 identifier: ${input}`);
  }
  return input;
}

export function createFts5Table(
  database: FtsDatabase,
  definition: Fts5TableDefinition,
  options?: { onError?: (error: unknown) => void },
) {
  const tableName = assertFtsIdentifier(definition.tableName);
  const columns = definition.columns.map((column) => column.trim()).filter(Boolean);
  if (!columns.length) {
    throw new Error(`FTS5 table ${tableName} requires at least one column.`);
  }

  try {
    database.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName} USING fts5(
        ${columns.join(',\n        ')}
      );
    `);
    return true;
  } catch (error) {
    options?.onError?.(error);
    return false;
  }
}

export function createFts5Tables(
  database: FtsDatabase,
  definitions: Fts5TableDefinition[],
  options?: { onError?: (error: unknown) => void },
) {
  return definitions.every((definition) => createFts5Table(database, definition, options));
}

export function hasFts5Table(database: FtsDatabase, tableName: string) {
  const safeTableName = assertFtsIdentifier(tableName);
  try {
    const rows = database.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [safeTableName],
    );
    return rows.some((result) => result.values.length > 0);
  } catch {
    return false;
  }
}
