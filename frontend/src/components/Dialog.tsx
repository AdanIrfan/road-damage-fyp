import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { errorMessage } from "../lib/api";
import { Alert, Button, fieldClass } from "./ui";

/** Accessible modal shell: focus moves inside, Escape and the backdrop close it. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.querySelector<HTMLElement>("textarea, input, select, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-ink-950/50 p-4 sm:items-center" onMouseDown={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-lg font-bold text-ink-900">
          {title}
        </h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

/**
 * Asks for a reason or note and runs `onConfirm` with it. With `required`, the text cannot be
 * empty. Errors from `onConfirm` are shown inside the dialog.
 */
export function ReasonDialog({
  title,
  description,
  label,
  required,
  maxLength,
  confirmLabel,
  tone = "primary",
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  label: string;
  required: boolean;
  maxLength: number;
  confirmLabel: string;
  tone?: "primary" | "danger";
  onConfirm: (text: string) => Promise<void>;
  onClose: () => void;
}) {
  const fieldId = useId();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (required && text.trim() === "") {
      setError(`${label} is required.`);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onConfirm(text.trim());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title={title} onClose={busy ? () => undefined : onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        {description !== undefined && <p className="text-sm text-ink-600">{description}</p>}
        <div>
          <label htmlFor={fieldId} className="block text-sm font-semibold text-ink-900">
            {label} {!required && <span className="font-normal text-ink-500">(optional)</span>}
          </label>
          <textarea
            id={fieldId}
            value={text}
            maxLength={maxLength}
            rows={4}
            onChange={(e) => setText(e.target.value)}
            className={`mt-1.5 ${fieldClass}`}
          />
          <p className="mt-1 text-right font-mono text-xs text-ink-500">
            {text.length}/{maxLength}
          </p>
        </div>
        {error !== undefined && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant={tone} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
