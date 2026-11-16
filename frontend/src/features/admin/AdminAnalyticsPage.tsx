import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download } from "lucide-react";
import { Alert, Button, Card, fieldClass, PageHeader, Skeleton, Spinner } from "../../components/ui";
import { damageClassLabel, locationStatusLabel, reportStatusLabel, severityLabel } from "../../components/reports/labels";
import { errorMessage } from "../../lib/api";
import type { AdminAnalytics, AnalyticsGranularity, ReportStatus, SeverityLevel } from "../../lib/reportTypes";
import { analyticsApi } from "./analyticsApi";

// Civic Ink values (see styles/index.css), so charts use the same meaning of colour as the rest of the UI.
const COLORS = {
  blue: "#2f5bea",
  sky: "#0e7490",
  green: "#0f766e",
  amber: "#e8a317",
  red: "#b42318",
  slate: "#8c96a3",
  violet: "#6d4ad6",
  ink: "#0e1a2b",
  grid: "#e3e7ed",
  axis: "#5b6675",
};

const STATUS_ORDER: ReportStatus[] = ["SUBMITTED", "UNDER_REVIEW", "ACCEPTED", "DELAYED", "REJECTED", "COMPLETED"];
const STATUS_COLOR: Record<ReportStatus, string> = {
  SUBMITTED: COLORS.sky,
  UNDER_REVIEW: COLORS.violet,
  ACCEPTED: COLORS.blue,
  DELAYED: COLORS.amber,
  REJECTED: COLORS.red,
  COMPLETED: COLORS.green,
};
const SEVERITY_ORDER: (SeverityLevel | "NONE")[] = ["HIGH", "MEDIUM", "LOW", "NONE"];
const SEVERITY_COLOR: Record<SeverityLevel | "NONE", string> = { HIGH: COLORS.red, MEDIUM: COLORS.amber, LOW: COLORS.green, NONE: COLORS.slate };

const PRESETS = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "365d", label: "Last 12 months", days: 365 },
  { id: "all", label: "All time", days: null },
] as const;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Inclusive UTC range ending today. */
function presetRange(days: number | null): { from?: string; to?: string } {
  if (days === null) return {};
  const today = new Date();
  return { from: isoDay(new Date(today.getTime() - (days - 1) * 86_400_000)), to: isoDay(today) };
}

function formatPeriod(period: string, granularity: AnalyticsGranularity): string {
  const date = new Date(`${period}T00:00:00Z`);
  if (granularity === "month") return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

/**
 * Admin analytics: every number is computed by the backend from real reports in PostgreSQL.
 * All charts use the same submission-date range. Severity is the effective severity.
 */
export function AdminAnalyticsPage() {
  const [params, setParams] = useSearchParams();
  const preset = params.get("range") ?? "30d";
  const custom = preset === "custom";
  const granularity = (params.get("granularity") ?? "") as AnalyticsGranularity | "";
  // Look up the preset first: "All time" has days = null, which must not fall back to a default.
  const presetDays = (PRESETS.find((p) => p.id === preset) ?? PRESETS[1]).days;
  const range = custom ? { from: params.get("from") ?? undefined, to: params.get("to") ?? undefined } : presetRange(presetDays);

  const [data, setData] = useState<AdminAnalytics>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);

  const key = `${range.from ?? ""}|${range.to ?? ""}|${granularity}`;
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    analyticsApi
      .get({ ...range, granularity: granularity === "" ? undefined : granularity })
      .then(({ analytics }) => {
        if (!cancelled) setData(analytics);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `key` captures every input of the request.
  }, [key]);

  const update = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(changes)) {
      if (value === undefined || value === "") next.delete(name);
      else next.set(name, value);
    }
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Based on the reports stored in the system, by submission date (UTC). Severity is the estimated severity, or the admin's correction where set."
        actions={
          <Button variant="secondary" disabled={data === undefined} onClick={() => data !== undefined && downloadCsv(data)}>
            <Download className="size-4" aria-hidden="true" />
            Export CSV
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-ink-150 bg-white px-4 py-3">
        <Select
          label="Period"
          value={preset}
          onChange={(value) => update(value === "custom" ? { range: value, from: range.from, to: range.to } : { range: value, from: undefined, to: undefined })}
          options={[...PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: "custom", label: "Custom dates" }]}
        />
        {custom && (
          <>
            <DateInput label="From" value={range.from ?? ""} onChange={(value) => update({ from: value })} />
            <DateInput label="To" value={range.to ?? ""} onChange={(value) => update({ to: value })} />
          </>
        )}
        <Select
          label="Group by"
          value={granularity}
          onChange={(value) => update({ granularity: value })}
          options={[
            { value: "", label: "Automatic" },
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
            { value: "month", label: "Month" },
          ]}
        />
        {loading && data !== undefined && <Spinner className="mb-2 size-5 text-cobalt-600" />}
      </div>

      {error !== undefined && <Alert>{error}</Alert>}
      {data === undefined ? (
        loading && (
          <div className="space-y-6" role="status">
            <span className="sr-only">Loading analytics</span>
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
        )
      ) : (
        <AnalyticsCharts data={data} />
      )}
    </div>
  );
}

function AnalyticsCharts({ data }: { data: AdminAnalytics }) {
  const empty = data.total === 0;
  const statusData = STATUS_ORDER.map((status) => ({ name: reportStatusLabel[status], value: data.byStatus[status], color: STATUS_COLOR[status] }));
  const severityData = SEVERITY_ORDER.map((level) => ({
    name: level === "NONE" ? "Not estimated" : severityLabel[level],
    value: data.bySeverity[level],
    color: SEVERITY_COLOR[level],
  }));
  const classData = data.damageClasses.byClass.map((c) => ({ name: damageClassLabel(c.className), value: c.reports }));
  const rp = data.repairProgress;
  const repairData = [
    { name: "Not assigned", value: rp.unassigned, color: COLORS.slate },
    { name: "Pending", value: rp.pending, color: COLORS.sky },
    { name: "Working", value: rp.working, color: COLORS.blue },
    { name: "Awaiting confirmation", value: rp.awaitingConfirmation, color: COLORS.amber },
    { name: "Completed", value: rp.completed, color: COLORS.green },
  ];
  const repairTotal = repairData.reduce((sum, d) => sum + d.value, 0);
  const workloadData = data.engineerWorkload.map((w) => ({
    name: w.status === "ACTIVE" ? w.fullName : `${w.fullName} (deactivated)`,
    Open: w.open,
    "Awaiting confirmation": w.awaitingConfirmation,
    Completed: w.completed,
  }));
  const locationData = data.location.byStatus
    .filter((l) => l.reports > 0 || l.status !== "NOT_CHECKED")
    .map((l) => ({ name: locationStatusLabel[l.status], "No review needed": l.reports - l.needsReview, "Needs review": l.needsReview }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Reports" value={data.total} />
        <Stat label="High severity" value={data.bySeverity.HIGH} />
        <Stat label="Location to check" value={data.location.needsReview} to="/admin/reports?needsLocationReview=true" />
        <Stat label="Repairs in progress" value={rp.pending + rp.working} />
        <Stat label="Awaiting confirmation" value={rp.awaitingConfirmation} to="/admin/reports?status=ACCEPTED&repairStatus=COMPLETED" />
        <Stat label="Repairs completed" value={rp.completed} />
      </div>

      <Card title="Turnaround" description="Time from submission, for reports submitted in this period. Each report counts once per measure (its first review, first decision and completion).">
        <dl className="grid gap-3 sm:grid-cols-3">
          <Turnaround label="To review started" stat={data.turnaround.toReview} />
          <Turnaround label="To first decision" stat={data.turnaround.toDecision} />
          <Turnaround label="To confirmed repair" stat={data.turnaround.toCompletion} />
        </dl>
      </Card>

      <ChartCard title="Reports submitted" description={`Per ${data.range.granularity}.`} empty={empty}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.overTime.map((p) => ({ name: formatPeriod(p.period, data.range.granularity), value: p.count }))} title="Reports submitted over time">
            <CartesianGrid stroke={COLORS.grid} vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: COLORS.axis }} minTickGap={16} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: COLORS.axis }} width={32} />
            <Tooltip />
            <Bar dataKey="value" name="Reports" fill={COLORS.blue} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="By status" empty={empty}>
          <SimpleBars data={statusData} label="Reports by status" />
        </ChartCard>
        <ChartCard title="By estimated severity" description="Admin-corrected severity where set, otherwise the automatic estimate." empty={empty}>
          <SimpleBars data={severityData} label="Reports by severity" />
        </ChartCard>
        <ChartCard
          title="Damage types detected"
          description={`Reports with at least one detection of each type (a report can count for several types). ${data.damageClasses.noDetections} with no damage detected, ${data.damageClasses.aiFailed} not analysed.`}
          empty={classData.length === 0}
          emptyText="No damage was detected automatically in this period."
        >
          <SimpleBars data={classData.map((d) => ({ ...d, color: COLORS.violet }))} label="Reports by damage type" />
        </ChartCard>
        <ChartCard title="Repair progress" description="Accepted and completed reports, by the state of their current repair." empty={repairTotal === 0} emptyText="No accepted reports in this period.">
          <SimpleBars data={repairData} label="Repair progress" />
        </ChartCard>
      </div>

      <ChartCard
        title="Engineer workload"
        description="Reports in this period by their current engineer. Reassignments and repeated repair attempts are not counted twice."
        empty={workloadData.length === 0}
        emptyText="There are no engineers yet."
      >
        <ResponsiveContainer width="100%" height={Math.max(200, workloadData.length * 44 + 60)}>
          <BarChart data={workloadData} layout="vertical" margin={{ left: 8, right: 16 }} title="Engineer workload">
            <CartesianGrid stroke={COLORS.grid} horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: COLORS.axis }} />
            <YAxis type="category" dataKey="name" width={128} tick={{ fontSize: 12, fill: COLORS.axis }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Open" stackId="w" fill={COLORS.blue} />
            <Bar dataKey="Awaiting confirmation" stackId="w" fill={COLORS.amber} />
            <Bar dataKey="Completed" stackId="w" fill={COLORS.green} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Location verification"
        description="Gallery uploads are compared with the photo's EXIF location; live-camera reports use browser GPS. Flagged reports are never rejected automatically."
        empty={empty}
      >
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={locationData} layout="vertical" margin={{ left: 8, right: 16 }} title="Location verification">
            <CartesianGrid stroke={COLORS.grid} horizontal={false} />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: COLORS.axis }} />
            <YAxis type="category" dataKey="name" width={128} tick={{ fontSize: 12, fill: COLORS.axis }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="No review needed" stackId="l" fill={COLORS.green} />
            <Bar dataKey="Needs review" stackId="l" fill={COLORS.amber} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

/** Horizontal bars, one colour per category. */
function SimpleBars({ data, label }: { data: { name: string; value: number; color: string }[]; label: string }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 36 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }} title={label}>
        <CartesianGrid stroke={COLORS.grid} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12, fill: COLORS.axis }} />
        <YAxis type="category" dataKey="name" width={128} tick={{ fontSize: 12, fill: COLORS.axis }} />
        <Tooltip />
        <Bar dataKey="value" name="Reports" radius={[0, 3, 3, 0]}>
          {data.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartCard({
  title,
  description,
  empty,
  emptyText = "No reports in this period.",
  children,
}: {
  title: string;
  description?: string;
  empty: boolean;
  emptyText?: string;
  children: ReactNode;
}) {
  return (
    <Card title={title} {...(description === undefined ? {} : { description })}>
      {empty ? <p className="py-10 text-center text-sm text-ink-500">{emptyText}</p> : children}
    </Card>
  );
}

/** "45 min", "6.5 h" or "3.2 d": hours are awkward to read once they pass a day. */
function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

function Turnaround({ label, stat }: { label: string; stat: AdminAnalytics["turnaround"]["toReview"] }) {
  return (
    <div className="rounded-[10px] border border-ink-150 bg-canvas px-4 py-3">
      <dt className="text-xs font-medium text-ink-500">{label}</dt>
      <dd className="mt-1">
        {stat.medianHours === null ? (
          <span className="text-sm text-ink-500">No reports reached this point yet</span>
        ) : (
          <>
            <span className="text-2xl leading-tight font-bold text-ink-900 tabular-nums">{formatHours(stat.medianHours)}</span>
            <span className="ml-1.5 text-xs text-ink-500">median</span>
            <span className="block text-xs text-ink-500">
              average {formatHours(stat.averageHours ?? stat.medianHours)} · {stat.reports} report{stat.reports === 1 ? "" : "s"}
            </span>
          </>
        )}
      </dd>
    </div>
  );
}

function Stat({ label, value, to }: { label: string; value: number; to?: string }) {
  const body = (
    <>
      <div className="text-xs font-medium text-ink-500">{label}</div>
      <div className="mt-1 text-3xl leading-tight font-bold text-ink-900 tabular-nums">{value}</div>
    </>
  );
  const className = "block rounded-xl border border-ink-150 bg-white px-4 py-3.5";
  return to === undefined ? (
    <div className={className}>{body}</div>
  ) : (
    <Link to={to} className={`${className} transition hover:border-cobalt-500`}>
      {body}
    </Link>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-xs font-semibold text-ink-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${fieldClass} min-h-10 w-auto`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="text-sm">
      <span className="mb-1 block text-xs font-semibold text-ink-600">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${fieldClass} min-h-10 w-auto`}
      />
    </label>
  );
}

/** Quotes a CSV cell when needed; cells that could be read as formulas are prefixed so spreadsheets treat them as text. */
function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Downloads exactly the numbers shown on this page (same period, same counting rules) as CSV.
 * Built in the browser from the analytics response; no extra request and no personal data.
 */
function downloadCsv(data: AdminAnalytics) {
  const rows: (string | number)[][] = [
    ["Section", "Item", "Value"],
    ["Range", "From (UTC)", data.range.from ?? "all time"],
    ["Range", "To (UTC)", data.range.to ?? "all time"],
    ["Range", "Grouped by", data.range.granularity],
    ["Totals", "Reports", data.total],
    ...data.overTime.map((p) => ["Reports submitted", p.period, p.count]),
    ...STATUS_ORDER.map((status) => ["By status", reportStatusLabel[status], data.byStatus[status]]),
    ...SEVERITY_ORDER.map((level) => ["By severity", level === "NONE" ? "Not estimated" : severityLabel[level], data.bySeverity[level]]),
    ...data.damageClasses.byClass.map((c) => ["Damage types (reports with at least one)", damageClassLabel(c.className), c.reports]),
    ["Damage types (reports with at least one)", "No damage detected", data.damageClasses.noDetections],
    ["Damage types (reports with at least one)", "Not analysed", data.damageClasses.aiFailed],
    ["Repair progress", "Not assigned", data.repairProgress.unassigned],
    ["Repair progress", "Pending", data.repairProgress.pending],
    ["Repair progress", "Working", data.repairProgress.working],
    ["Repair progress", "Awaiting confirmation", data.repairProgress.awaitingConfirmation],
    ["Repair progress", "Completed", data.repairProgress.completed],
    ...data.engineerWorkload.flatMap((w) => [
      [`Engineer workload: ${w.fullName}`, "Open", w.open],
      [`Engineer workload: ${w.fullName}`, "Awaiting confirmation", w.awaitingConfirmation],
      [`Engineer workload: ${w.fullName}`, "Completed", w.completed],
    ]),
    ...(
      [
        ["To review started", data.turnaround.toReview],
        ["To first decision", data.turnaround.toDecision],
        ["To confirmed repair", data.turnaround.toCompletion],
      ] as const
    ).flatMap(([label, stat]) => [
      [`Turnaround: ${label}`, "Reports", stat.reports],
      [`Turnaround: ${label}`, "Median hours", stat.medianHours ?? ""],
      [`Turnaround: ${label}`, "Average hours", stat.averageHours ?? ""],
    ]),
    ...data.location.byStatus.flatMap((l) => [
      [`Location: ${locationStatusLabel[l.status]}`, "Reports", l.reports],
      [`Location: ${locationStatusLabel[l.status]}`, "Needs review", l.needsReview],
    ]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  // The BOM makes Excel read the file as UTF-8.
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `road-damage-analytics_${data.range.from ?? "all"}_${data.range.to ?? "time"}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
