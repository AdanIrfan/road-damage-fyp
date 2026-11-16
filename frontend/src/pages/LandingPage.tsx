import { BellRing, Camera, ClipboardCheck, MapPin, ScanSearch, ShieldCheck, Users, Wrench } from "lucide-react";
import { Link } from "react-router";
import { Brand } from "../components/Brand";
import { buttonClass } from "../components/ui";

const STEPS = [
  { icon: Camera, title: "1. Report", text: "Take a photo with your phone, or upload one and mark the place on a map. It takes about a minute." },
  { icon: ScanSearch, title: "2. Analysis and review", text: "The photo is analysed automatically for visible damage, then an administrator checks every report and decides." },
  { icon: Wrench, title: "3. Repair, tracked", text: "An engineer is assigned, records the work with photos, and an administrator confirms the repair." },
] as const;

const ROLES = [
  { icon: Users, title: "Citizens", text: "Report damage, see what was detected, and follow each report from submission to a confirmed repair." },
  { icon: ClipboardCheck, title: "Administrators", text: "Review reports with photo, location check and detections, assign engineers and confirm completed repairs." },
  { icon: Wrench, title: "Maintenance engineers", text: "See assigned jobs on a phone, update progress, add repair photos and message administrators." },
] as const;

const FEATURES = [
  { icon: MapPin, title: "Location you can check", text: "Device GPS for live photos; for gallery photos the location stored in the picture is compared with the place you select." },
  { icon: BellRing, title: "Updates at each step", text: "In-app notifications and SMS when a report is accepted, delayed, not accepted or repaired." },
  { icon: ShieldCheck, title: "Private by design", text: "Photos are only shown to you, administrators and the assigned engineer. Location data is removed from the copies that are displayed." },
] as const;

/** Public home page for visitors who are not logged in. */
export function LandingPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-ink-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Brand onDark />
          <nav className="flex items-center gap-2" aria-label="Account">
            <Link to="/login" className="flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-white hover:bg-ink-800">
              Log in
            </Link>
            <Link to="/register" className={buttonClass("primary", "md")}>
              Create account
            </Link>
          </nav>
        </div>
        <div className="mx-auto max-w-6xl px-4 pt-10 pb-14 sm:px-6 sm:pt-16 sm:pb-20">
          <p className="inline-flex rounded-full bg-ink-800 px-3 py-1 text-xs font-semibold tracking-wide text-road-400">Road damage reporting and maintenance</p>
          <h1 className="mt-4 max-w-3xl text-3xl leading-tight font-bold tracking-tight text-white sm:text-5xl">Report road damage. Follow it until it is repaired.</h1>
          <p className="mt-4 max-w-2xl text-base text-ink-on-dark sm:text-lg">
            Potholes and cracks are often reported late or not at all. This system gives citizens a simple way to report them, helps administrators
            sort and assign the work, and lets engineers record each repair.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/register" className={buttonClass("primary", "lg")}>
              Report road damage
            </Link>
            <Link to="/login" className="inline-flex min-h-12 items-center rounded-lg px-5 text-base font-semibold text-white ring-1 ring-ink-700 ring-inset hover:bg-ink-800">
              I already have an account
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-14 px-4 py-12 sm:px-6 sm:py-16">
        <section aria-labelledby="how">
          <h2 id="how" className="text-2xl font-bold tracking-tight text-ink-900">
            How it works
          </h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.title} className="rounded-xl border border-ink-150 bg-white p-5">
                <span className="flex size-11 items-center justify-center rounded-xl bg-ink-900 text-road-400" aria-hidden="true">
                  <step.icon className="size-5" strokeWidth={1.6} />
                </span>
                <h3 className="mt-4 text-base font-bold text-ink-900">{step.title}</h3>
                <p className="mt-1 text-sm text-ink-600">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="roles">
          <h2 id="roles" className="text-2xl font-bold tracking-tight text-ink-900">
            Built for three roles
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {ROLES.map((role) => (
              <div key={role.title} className="rounded-xl border border-ink-150 bg-white p-5">
                <role.icon className="size-6 text-cobalt-600" strokeWidth={1.6} aria-hidden="true" />
                <h3 className="mt-3 text-base font-bold text-ink-900">{role.title}</h3>
                <p className="mt-1 text-sm text-ink-600">{role.text}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-ink-500">Citizens create their own account. Engineer and administrator accounts are created by the road authority.</p>
        </section>

        <section aria-labelledby="features" className="grid gap-4 md:grid-cols-3">
          <h2 id="features" className="sr-only">
            What you can rely on
          </h2>
          {FEATURES.map((feature) => (
            <div key={feature.title} className="flex gap-3">
              <feature.icon className="mt-0.5 size-5 shrink-0 text-ink-900" strokeWidth={1.6} aria-hidden="true" />
              <div>
                <h3 className="text-sm font-bold text-ink-900">{feature.title}</h3>
                <p className="mt-0.5 text-sm text-ink-600">{feature.text}</p>
              </div>
            </div>
          ))}
        </section>

        <section aria-labelledby="ai" className="rounded-xl border border-ink-150 bg-white p-5 shadow-[inset_0_3px_0_var(--color-road-400)] sm:p-6">
          <h2 id="ai" className="text-base font-bold text-ink-900">
            About the automatic analysis
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-ink-600">
            Each photo is checked by a trained detection model for four kinds of damage: potholes, alligator cracks, longitudinal cracks and transverse
            cracks. It can miss damage or mark something that is not damage, and the severity it suggests is an estimate, not an engineering assessment.
            That is why an administrator reviews every report, and no report is ever rejected automatically.
          </p>
        </section>
      </main>

      <footer className="border-t border-ink-150 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-ink-500 sm:px-6">
          AI-Powered Road Infrastructure Damage Detection, Severity Assessment and Maintenance Management System · Final Year Project
        </div>
      </footer>
    </div>
  );
}
