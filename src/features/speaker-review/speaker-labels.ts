import type { Speaker } from "../../domain/model";

/** Match rendered whitespace without changing the saved name or inferring identity. */
function renderedName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** A full source ID distinguishes same-name entries even when their UUID prefixes match. */
export function speakerChoice(speaker: Speaker, allSpeakers: readonly Speaker[]): { label: string; duplicateName: boolean } {
  const name = renderedName(speaker.name);
  const duplicate = allSpeakers.some(other => other.id !== speaker.id && renderedName(other.name).toLowerCase() === name.toLowerCase());
  return { label: duplicate ? `${name} · ID: ${speaker.id}` : name, duplicateName: duplicate };
}
