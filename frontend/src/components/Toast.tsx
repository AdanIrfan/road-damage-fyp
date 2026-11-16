import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type ToastTone = "success" | "error" | "info";

interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

/** Errors stay longer: they usually need reading twice. */
const DURATION_MS: Record<ToastTone, number> = { success: 4000, info: 5000, error: 8000 };
const MAX_VISIBLE = 3;

/**
 * Short confirmations of actions ("Report accepted."). Announced to screen readers through a
 * live region. Anything the user must act on stays in the page as an Alert, not a toast.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (tone: ToastTone, message: string) => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, tone, message }].slice(-MAX_VISIBLE));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DURATION_MS[tone]),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => show("success", message),
      error: (message) => show("error", message),
      info: (message) => show("info", message),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Above the mobile tab bar; bottom-right on desktop. Above Leaflet (z-index up to 1000). */}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[1100] flex flex-col items-center gap-2 px-4 lg:inset-x-auto lg:right-6 lg:bottom-6 lg:items-end" aria-live="polite">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const Icon = { success: CircleCheck, error: TriangleAlert, info: Info }[toast.tone];
  const iconColor = { success: "text-success-200", error: "text-road-400", info: "text-cobalt-100" }[toast.tone];
  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm text-white shadow-lg [animation:toast-in_150ms_ease-out]"
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${iconColor}`} aria-hidden="true" />
      <p className="min-w-0 flex-1">{toast.message}</p>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="-m-1 rounded-lg p-1 text-ink-on-dark hover:text-white">
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context === undefined) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return context;
}
