/** A saved recap that says the file was only a microphone check, with no decisions in it. */
export function emptyRecording(
  d: { headline?: string; actions?: { item?: string; outcome?: string }[] } | null | undefined,
): boolean {
  if (!d) return false;
  const acted = (d.actions ?? []).some((a) => a && (a.item || a.outcome));
  if (acted) return false;
  return /\b(?:audio test|sound check|microphone check|mic check)\b/i.test(d.headline ?? '');
}
