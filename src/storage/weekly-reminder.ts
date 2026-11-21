const week = 7 * 24 * 60 * 60 * 1000;
const pageDismissals = new Map<string, number>();

export function noticeStorageKey(id: string) {
  return `meeting-memo-byok:notice:${id}:dismissed-at`;
}

function remainingTime(dismissedAt: number | undefined, now: number) {
  if (dismissedAt === undefined || !Number.isSafeInteger(dismissedAt) || dismissedAt < 0 || dismissedAt > now) return 0;
  return Math.max(0, week - (now - dismissedAt));
}

export function noticeReminderDelay(id: string, now = Date.now()) {
  const pageDelay = remainingTime(pageDismissals.get(id), now);
  try {
    const stored = localStorage.getItem(noticeStorageKey(id));
    if (stored === null || !/^\d+$/.test(stored)) return pageDelay;
    return Math.max(pageDelay, remainingTime(Number(stored), now));
  } catch {
    return pageDelay;
  }
}

export function shouldShowNotice(id: string, now = Date.now()) {
  return noticeReminderDelay(id, now) === 0;
}

export function dismissNotice(id: string, now = Date.now()) {
  const key = noticeStorageKey(id);
  try {
    // A write alone cannot establish a durable reminder when reads are blocked.
    localStorage.getItem(key);
    localStorage.setItem(key, String(now));
    pageDismissals.delete(id);
  } catch {
    pageDismissals.set(id, now);
  }
}
