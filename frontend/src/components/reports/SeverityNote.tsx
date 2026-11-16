/** Shown wherever an estimated severity appears (CLAUDE.md §6). */
export function SeverityNote() {
  return (
    <p className="text-xs text-ink-500">
      The severity is an automatic estimate based on the size, number and confidence of the detected damage. It is not an
      engineering assessment; an administrator reviews every report.
    </p>
  );
}
