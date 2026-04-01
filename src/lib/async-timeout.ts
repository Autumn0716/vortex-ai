export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function withSoftTimeout<T>(
  promise: Promise<T>,
  options: {
    softTimeoutMs: number;
    hardTimeoutMs: number;
    onSoftTimeout?: () => void;
    hardTimeoutMessage: string;
  },
): Promise<T> {
  const { softTimeoutMs, hardTimeoutMs, onSoftTimeout, hardTimeoutMessage } = options;

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      globalThis.clearTimeout(softTimer);
      globalThis.clearTimeout(hardTimer);
    };

    const settle = (fn: (value?: T | unknown) => void, value?: T | unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      fn(value);
    };

    const softTimer = globalThis.setTimeout(() => {
      onSoftTimeout?.();
    }, softTimeoutMs);

    const hardTimer = globalThis.setTimeout(() => {
      settle(reject, new TimeoutError(hardTimeoutMessage));
    }, hardTimeoutMs);

    promise.then(
      (value) => {
        settle(resolve, value);
      },
      (error) => {
        settle(reject, error);
      },
    );
  });
}
