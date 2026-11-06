/** Presentation order is local to a meeting; this never establishes identity. */
export function speakerBackground(index: number): string {
  const slot = ((Math.trunc(index) % 5) + 5) % 5 + 1;
  return `var(--speaker-${slot})`;
}
