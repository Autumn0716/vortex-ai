function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(
    `Non-Error value thrown: ${
      typeof error === 'string' ? error : JSON.stringify(error, null, 2) ?? String(error)
    }`,
  );
}

export function wrapErrorWithContext(context: string, error: unknown): Error {
  const normalized = asError(error);
  return new Error(context, { cause: normalized });
}

export function formatErrorDetails(error: unknown): string {
  const lines: string[] = [];
  let current: Error | undefined = asError(error);
  let depth = 0;

  while (current) {
    const prefix = depth === 0 ? 'Error' : `Cause ${depth}`;
    lines.push(`${prefix}: ${current.name}: ${current.message}`);
    current = current.cause instanceof Error ? current.cause : undefined;
    depth += 1;
  }

  return lines.join('\n');
}
