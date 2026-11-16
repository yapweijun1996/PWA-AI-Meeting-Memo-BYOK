const unsupportedMessage = "Local voice analysis requires browser support for cross-tab locking. Use a supported browser or continue without voice analysis.";

export function requireVoiceAnalysisLocks(): LockManager {
  if (typeof navigator === "undefined" || !navigator.locks) throw new Error(unsupportedMessage);
  return navigator.locks;
}

/** Hold the existing meeting job lock until analysis and its final save finish. */
export async function withVoiceAnalysisLock<T>(meetingId: string, work: () => Promise<T>): Promise<T> {
  return requireVoiceAnalysisLocks().request(`meeting-memo-job:${meetingId}`, { ifAvailable: true }, (lock) => {
    if (!lock) throw new Error("Another tab is processing this meeting.");
    return work();
  });
}
