import { useEffect, useState } from "react";
import { api } from "../../lib/api";

interface AiHealth {
  status: "online" | "offline" | "not_configured";
  modelLoaded: boolean | null;
}

const POLL_INTERVAL_MS = 60_000;

/**
 * Tells administrators whether the AI analysis service is reachable and its model is loaded.
 * The backend asks the AI service; the browser never talks to it and learns no address or secret.
 * While the AI service is down, reports are still saved (marked "analysis unavailable").
 */
export function AiStatusPill({ className = "" }: { className?: string }) {
  const [health, setHealth] = useState<AiHealth | "unknown">();

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      api
        .get<{ ai: AiHealth }>("/api/v1/admin/system-status")
        .then((result) => {
          if (!cancelled) setHealth(result.ai);
        })
        .catch(() => {
          if (!cancelled) setHealth("unknown");
        });
    };
    check();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") check();
    }, POLL_INTERVAL_MS);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, []);

  if (health === undefined) return null;
  const view =
    health === "unknown"
      ? { dot: "bg-ink-400", text: "AI service status unknown" }
      : health.status === "online" && health.modelLoaded === true
        ? { dot: "bg-sev-low", text: "AI service online · model loaded" }
        : health.status === "online"
          ? { dot: "bg-sev-medium", text: "AI service online · model not loaded" }
          : health.status === "offline"
            ? { dot: "bg-danger-700", text: "AI service offline · reports are saved without analysis" }
            : { dot: "bg-ink-400", text: "AI service not configured" };
  return (
    <div role="status" className={`inline-flex min-h-10 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 text-xs font-medium text-ink-600 ${className}`}>
      <span className={`size-2 shrink-0 rounded-full ${view.dot}`} aria-hidden="true" />
      {view.text}
    </div>
  );
}
