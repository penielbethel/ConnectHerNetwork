const callSuppressions: Map<string, number> = new Map();

export function suppressIncomingFrom(peer: string, ms: number = 5000): void {
  try {
    if (!peer) return;
    const until = Date.now() + Math.max(ms, 1000);
    callSuppressions.set(peer, until);
    setTimeout(() => {
      try {
        const exp = callSuppressions.get(peer);
        if (typeof exp === 'number' && exp <= Date.now()) {
          callSuppressions.delete(peer);
        }
      } catch (_) {}
    }, ms + 100);
  } catch (_) {}
}

export function isSuppressed(peer?: string): boolean {
  try {
    if (!peer) return false;
    const exp = callSuppressions.get(peer);
    return typeof exp === 'number' && exp > Date.now();
  } catch (_) {
    return false;
  }
}