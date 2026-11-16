import { Camera, ClipboardCheck, Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Brand } from "../components/Brand";

const STEPS = [
  { icon: Camera, title: "Report", text: "Photograph road damage and add its location." },
  { icon: ClipboardCheck, title: "Review", text: "The photo is analysed automatically and every report is checked by an administrator." },
  { icon: Wrench, title: "Repair", text: "An engineer is assigned and you can follow the progress." },
] as const;

/**
 * Login, registration, verification and forced password change. Desktop: ink brand panel beside
 * the form. Phone: a compact ink header above the form.
 */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      <aside className="bg-ink-900 px-5 py-4 lg:flex lg:w-[26rem] lg:shrink-0 lg:flex-col lg:justify-between lg:px-10 lg:py-10">
        <Link to="/" className="inline-flex rounded-lg">
          <Brand onDark />
        </Link>
        <div className="hidden lg:block">
          <h2 className="text-2xl leading-snug font-bold text-white">Road damage, reported and tracked to repair.</h2>
          <ol className="mt-8 space-y-5">
            {STEPS.map((step) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-road-400" aria-hidden="true">
                  <step.icon className="size-[18px]" strokeWidth={1.6} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-white">{step.title}</span>
                  <span className="block text-sm text-ink-on-dark">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <p className="hidden text-xs text-ink-on-dark lg:block">Severity shown in the app is an automatic estimate, not an engineering assessment.</p>
      </aside>

      <main className="flex flex-1 items-start justify-center px-4 py-8 sm:items-center sm:py-12">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-ink-150 bg-white p-6 sm:p-8">
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
            {subtitle !== undefined && <p className="mt-1 text-sm text-ink-500">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer !== undefined && <div className="mt-5 text-center text-sm text-ink-600">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
