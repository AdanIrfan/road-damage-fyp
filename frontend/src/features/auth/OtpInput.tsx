import { useRef, type ClipboardEvent, type KeyboardEvent } from "react";

const LENGTH = 6;

/**
 * Six boxes for the SMS code. Typing moves forward, Backspace moves back, and a pasted or
 * auto-filled code ("one-time-code") fills every box at once. The value is a plain digit string,
 * exactly what the single text field used to produce.
 */
export function OtpInput({ value, onChange, invalid = false, labelId }: { value: string; onChange: (code: string) => void; invalid?: boolean; labelId: string }) {
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length: LENGTH }, (_, index) => value[index] ?? "");

  const focusBox = (index: number) => boxes.current[Math.max(0, Math.min(LENGTH - 1, index))]?.focus();

  function setFrom(index: number, typed: string) {
    const clean = typed.replace(/\D/g, "");
    if (clean === "") return;
    // More than one digit arrives when the browser auto-fills or the user pastes into a box.
    const next = (value.slice(0, index) + clean + value.slice(index + clean.length)).slice(0, LENGTH);
    onChange(next);
    focusBox(index + clean.length);
  }

  function onKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace") {
      event.preventDefault();
      if (digits[index] !== "") onChange(value.slice(0, index) + value.slice(index + 1));
      else if (index > 0) {
        onChange(value.slice(0, index - 1) + value.slice(index));
        focusBox(index - 1);
      }
    } else if (event.key === "ArrowLeft") focusBox(index - 1);
    else if (event.key === "ArrowRight") focusBox(index + 1);
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, LENGTH);
    if (pasted === "") return;
    onChange(pasted);
    focusBox(pasted.length);
  }

  return (
    <div role="group" aria-labelledby={labelId} className="flex justify-between gap-2">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          value={digit}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          aria-label={`Digit ${index + 1} of ${LENGTH}`}
          aria-invalid={invalid}
          onChange={(event) => setFrom(index, event.target.value)}
          onKeyDown={(event) => onKeyDown(index, event)}
          onPaste={onPaste}
          onFocus={(event) => event.target.select()}
          className={`h-14 w-full min-w-0 rounded-lg border bg-white text-center font-mono text-2xl font-medium text-ink-900 outline-none transition-colors focus:border-cobalt-600 focus:ring-2 focus:ring-cobalt-100 ${
            invalid ? "border-danger-700" : digit !== "" ? "border-ink-900" : "border-ink-300"
          }`}
        />
      ))}
    </div>
  );
}
