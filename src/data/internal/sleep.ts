export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(resolve, Math.max(0, ms));
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortReason(signal));
      },
      { once: true },
    );
  });
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new DOMException("Aborted", "AbortError");
}
