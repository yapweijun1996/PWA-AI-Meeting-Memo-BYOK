import { useEffect, useState } from "react";
import { getSpeakerAvatars } from "../storage/speaker-avatars";
export function useSpeakerAvatars(meetingId: string) {
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let alive = true;
    let latest = 0;
    const load = () => {
      const request = ++latest;
      void getSpeakerAvatars(meetingId).then((value) => { if (alive && request === latest) { setAvatars(value); setUnavailable(false); } }).catch(() => { if (alive && request === latest) setUnavailable(true); });
    };
    const changed = (event: Event) => { if ((event as CustomEvent<string>).detail === meetingId) load(); };
    load(); window.addEventListener("meeting-memo-avatars-changed", changed);
    return () => { alive = false; window.removeEventListener("meeting-memo-avatars-changed", changed); };
  }, [meetingId]);
  return { avatars, unavailable };
}
const colors = ["#dcebd5", "#ede2ef", "#f7e5cc", "#d9e9ed", "#f1dfd3", "#e5e2c9"];
const hair = ["#415b49", "#6b5043", "#5f536c", "#455f6a", "#866049", "#786b4c"];
export function SpeakerAvatar({ id, image, className = "speaker-avatar" }: { id: string; image?: string; className?: string }) {
  let hash = 0; for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const color = colors[hash % colors.length], shade = hair[(hash >>> 4) % hair.length];
  return <span className={className} aria-hidden="true" style={{ background: color }}>
    {image ? <img src={image} alt="" /> : <svg viewBox="0 0 48 48" focusable="false"><circle cx="24" cy="18" r="8" fill={shade} /><path d="M8 45c0-10 7-16 16-16s16 6 16 16" fill={shade} /></svg>}
  </span>;
}
