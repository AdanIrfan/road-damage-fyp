import { CircleCheck, Eye, EyeOff, Info, TriangleAlert } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { useId, useState } from "react";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
type ButtonSize = "sm" | "md" | "lg";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-cobalt-600 text-white hover:bg-cobalt-700",
  secondary: "bg-white text-ink-900 ring-1 ring-inset ring-ink-300 hover:bg-ink-100",
  danger: "bg-danger-700 text-white hover:brightness-90",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "min-h-9 px-3 text-sm",
  md: "min-h-10 px-4 text-sm",
  /** Touch-first size for the main action on mobile screens. */
  lg: "min-h-12 px-5 text-base",
};

/** Shared classes, for links that must look like buttons. */
export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  return `inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${buttonSizes[size]} ${buttonStyles[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button {...props} disabled={disabled === true || loading} className={buttonClass(variant, size, className)}>
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

/** Shared look of text inputs, selects and textareas. */
export const fieldClass =
  "block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 outline-none transition-colors placeholder:text-ink-400 focus:border-cobalt-600 focus:ring-2 focus:ring-cobalt-100 disabled:bg-ink-100";

export function TextField({
  label,
  error,
  hint,
  icon,
  type,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string | undefined; hint?: string; icon?: ReactNode }) {
  const id = useId();
  // Password fields can be revealed, so typing mistakes are easy to spot on a phone.
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  const describedBy = error !== undefined ? `${id}-error` : hint !== undefined ? `${id}-hint` : undefined;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold text-ink-900">
        {label}
      </label>
      <div className="relative">
        {icon !== undefined && (
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-500" aria-hidden="true">
            {icon}
          </span>
        )}
        <input
          id={id}
          type={isPassword && revealed ? "text" : type}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          {...props}
          className={`${fieldClass} min-h-11 ${icon !== undefined ? "pl-10" : ""} ${isPassword ? "pr-11" : ""} ${
            error !== undefined ? "border-danger-700 focus:border-danger-700 focus:ring-danger-50" : ""
          }`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            aria-label={revealed ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
            aria-pressed={revealed}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-lg text-ink-500 hover:text-ink-900"
          >
            {revealed ? <EyeOff className="size-[18px]" aria-hidden="true" /> : <Eye className="size-[18px]" aria-hidden="true" />}
          </button>
        )}
      </div>
      {error !== undefined ? (
        <p id={`${id}-error`} className="text-sm text-danger-700">
          {error}
        </p>
      ) : (
        hint !== undefined && (
          <p id={`${id}-hint`} className="text-xs text-ink-500">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "success" | "info"; children: ReactNode }) {
  const styles = {
    error: "border-danger-200 bg-danger-50 text-danger-700",
    success: "border-success-200 bg-success-50 text-success-800",
    info: "border-cobalt-100 bg-cobalt-50 text-ink-900",
  }[tone];
  const Icon = { error: TriangleAlert, success: CircleCheck, info: Info }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex gap-2.5 rounded-lg border px-4 py-3 text-sm ${styles}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Spinner({ className = "size-6" }: { className?: string }) {
  return (
    <svg className={`animate-spin text-current ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path d="M4 12a8 8 0 0 1 8-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" className="opacity-75" />
    </svg>
  );
}

export function Card({
  title,
  description,
  children,
  actions,
  flush = false,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  /** No inner padding, for tables, maps and photos that run to the card's edge. */
  flush?: boolean;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-ink-150 bg-white">
      {(title !== undefined || actions !== undefined) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div>
            {title !== undefined && <h2 className="text-base font-semibold text-ink-900">{title}</h2>}
            {description !== undefined && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={flush ? "" : title !== undefined || actions !== undefined ? "px-5 pb-5" : "p-5"}>{children}</div>
    </section>
  );
}

/** Small tinted chip for flags and account states. Report status and severity have their own indicators. */
export function Badge({ tone, children }: { tone: "green" | "red" | "amber" | "slate" | "blue"; children: ReactNode }) {
  const styles = {
    green: "bg-success-50 text-success-800 ring-success-200",
    red: "bg-danger-50 text-danger-700 ring-danger-200",
    amber: "bg-road-100 text-road-900 ring-road-400/50",
    slate: "bg-ink-100 text-ink-600 ring-ink-200",
    blue: "bg-cobalt-50 text-cobalt-700 ring-cobalt-100",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset ${styles}`}>{children}</span>;
}

/** Page title row: title, optional description, and actions on the right. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
        {description !== undefined && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Grey placeholder block shown while content loads. */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-ink-150 ${className}`} aria-hidden="true" />;
}

/** A few skeleton rows with a screen-reader "Loading" label. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" className="space-y-3">
      <span className="sr-only">Loading</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="size-12 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      {icon !== undefined && (
        <div className="mb-1 flex size-12 items-center justify-center rounded-xl bg-ink-100 text-ink-500" aria-hidden="true">
          {icon}
        </div>
      )}
      <p className="font-semibold text-ink-900">{title}</p>
      {description !== undefined && <p className="max-w-sm text-sm text-ink-500">{description}</p>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Initials in a circle. Decorative: the name is always shown next to it. */
export function Avatar({ name, dark = false }: { name: string; dark?: boolean }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${dark ? "bg-ink-700 text-white" : "bg-ink-150 text-ink-900"}`}
    >
      {initials}
    </span>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center text-cobalt-600">
      <Spinner className="size-8" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
