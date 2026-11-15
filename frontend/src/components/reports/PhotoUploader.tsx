import { useId, useRef, useState, type ChangeEvent } from "react";
import { errorMessage } from "../../lib/api";
import { Alert, Spinner } from "../ui";

const ALLOWED_TYPES = ["image/jpeg", "image/png"];
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Uploads photos one at a time (each its own request). Checks type and size first for quick
 * feedback; the server checks the real content and the per-attempt limit.
 */
export function PhotoUploader({
  label,
  count,
  max,
  onUpload,
}: {
  label: string;
  /** Photos already uploaded for the current attempt. */
  count: number;
  max: number;
  onUpload: (file: File) => Promise<void>;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const remaining = Math.max(0, max - count);

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])].slice(0, remaining);
    event.target.value = "";
    setError(undefined);
    for (const file of files) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setError("Choose JPEG or PNG photos.");
        return;
      }
      if (file.size > MAX_BYTES) {
        setError("A photo is larger than 10 MB.");
        return;
      }
    }
    setBusy(true);
    try {
      for (const file of files) {
        await onUpload(file);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={ALLOWED_TYPES.join(",")}
          multiple
          disabled={busy || remaining === 0}
          onChange={(e) => void handleFiles(e)}
          className="block text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-60"
        />
        {busy && <Spinner className="size-5 text-blue-600" />}
      </div>
      <p className="text-xs text-slate-500">
        {count} of {max} photos for this attempt · JPEG or PNG, up to 10 MB each
        {remaining === 0 && " · limit reached"}
      </p>
      {error !== undefined && <Alert>{error}</Alert>}
    </div>
  );
}
