interface TransactionDatabase {
  run(query: string): void;
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
    database.run('ROLLBACK');
    throw error;
  }
}
