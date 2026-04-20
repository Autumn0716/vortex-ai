interface TransactionDatabase {
  run(query: string): void;
}

export class DatabaseTransactionError extends Error {
  constructor(
    message: string,
    options: {
      cause: unknown;
      rollbackError?: unknown;
    },
  ) {
    super(message, {
      cause: options.cause instanceof Error ? options.cause : undefined,
    });
    this.name = 'DatabaseTransactionError';
    if (options.rollbackError) {
      Object.defineProperty(this, 'rollbackError', {
        value: options.rollbackError,
        enumerable: false,
      });
    }
  }
}

export async function runDatabaseTransaction<T>(
  database: TransactionDatabase,
  callback: () => T | Promise<T>,
): Promise<T> {
  database.run('BEGIN');
  try {
    const result = await callback();
    database.run('COMMIT');
    return result;
  } catch (error) {
    try {
      database.run('ROLLBACK');
    } catch (rollbackError) {
      throw new DatabaseTransactionError('Database transaction failed and rollback also failed.', {
        cause: error,
        rollbackError,
      });
    }
    throw error;
  }
}
