/** Report a stalled load once, unless the caller settles or disposes it first. */
export function createLoadWatchdog(onTimeout, delayMs, timers = globalThis) {
  let settled = false;
  const timer = timers.setTimeout(() => {
    if (settled) return;
    settled = true;
    onTimeout();
  }, delayMs);

  return {
    settle() {
      if (settled) return false;
      settled = true;
      timers.clearTimeout(timer);
      return true;
    },
    dispose() {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timer);
    },
  };
}
