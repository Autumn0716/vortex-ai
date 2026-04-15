import initSqlite, {
  type Database as SQLiteDatabase,
  type SqlValue as SQLiteSqlValue,
} from '@sqlite.org/sqlite-wasm';

export type SqlValue = SQLiteSqlValue;

export interface QueryExecResult {
  columns: string[];
  values: SqlValue[][];
}

export type SQLiteModule = Awaited<ReturnType<typeof initSqlite>>;
type SQLiteInitModule = (options?: { locateFile?: (path: string) => string }) => Promise<SQLiteModule>;

export async function initializeSqliteModule() {
  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (!isBrowser) {
    return initSqlite();
  }

  const { default: sqliteWasmUrl } = (await import('@sqlite.org/sqlite-wasm/sqlite3.wasm?url')) as {
    default: string;
  };

  return (initSqlite as SQLiteInitModule)({
    locateFile: (path) => (path === 'sqlite3.wasm' ? sqliteWasmUrl : path),
  });
}

export class Database {
  constructor(
    private readonly sqlite3: SQLiteModule,
    private readonly inner: SQLiteDatabase,
  ) {}

  exec(query: string, params: SqlValue[] = []): QueryExecResult[] {
    const stmt = this.inner.prepare(query);
    try {
      if (params.length > 0) {
        stmt.bind(params);
      }
      const columns = stmt.columnCount > 0 ? stmt.getColumnNames() : [];
      const values: SqlValue[][] = [];
      while (stmt.step()) {
        values.push(stmt.get([]) as SqlValue[]);
      }
      return columns.length > 0 || values.length > 0 ? [{ columns, values }] : [];
    } finally {
      stmt.finalize();
    }
  }

  run(query: string, params: SqlValue[] = []) {
    if (params.length > 0) {
      this.inner.exec({
        sql: query,
        bind: params,
      });
      return;
    }
    this.inner.exec(query);
  }

  export() {
    return this.sqlite3.capi.sqlite3_js_db_export(this.inner);
  }

  close() {
    this.inner.close();
  }
}
