function stableSerialize(value: unknown) {
  if (value === undefined) {
    return '__undefined__';
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function describeChangedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  limit = 12,
) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes = keys
    .filter((key) => stableSerialize(before[key]) !== stableSerialize(after[key]))
    .slice(0, limit)
    .map((key) => ({
      key,
      before: before[key] ?? null,
      after: after[key] ?? null,
    }));

  return {
    changedKeys: changes.map((entry) => entry.key),
    changes,
  };
}
