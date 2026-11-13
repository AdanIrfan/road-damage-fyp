import type { ReactNode } from "react";

/** Centered card layout for login, registration and verification. */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2 text-slate-900">
        <span className="flex size-9 items-center justify-center rounded-lg bg-blue-600 text-lg font-bold text-white" aria-hidden="true">
          R
        </span>
        <span className="text-lg font-semibold">Road Damage Reporting</span>
      </div>
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle !== undefined && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
      {footer !== undefined && <div className="mt-6 text-sm text-slate-600">{footer}</div>}
    </div>
  );
}
