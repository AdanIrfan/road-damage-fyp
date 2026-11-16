import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { Alert, Badge, Button, Card, Spinner, TextField } from "../../components/ui";
import { ApiError, errorMessage, type FieldErrors } from "../../lib/api";
import type { AdminReportListItem } from "../../lib/reportTypes";
import type { EngineerAccount, User } from "../../lib/types";
import { firstError, formatDate, statusLabel, statusTone } from "../../utils/format";
import { adminReportsApi } from "./adminReportsApi";
import { AdminReportTable } from "./AdminReportTable";
import { engineersApi } from "./engineersApi";

export function EngineerDetailPage() {
  const { id = "" } = useParams();
  const [engineer, setEngineer] = useState<EngineerAccount>();
  const [jobs, setJobs] = useState<{ open: AdminReportListItem[]; completed: AdminReportListItem[] }>();
  const [loadError, setLoadError] = useState<string>();
  const [form, setForm] = useState({ fullName: "", mobileNumber: "" });
  const [saving, setSaving] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    let cancelled = false;
    engineersApi
      .get(id)
      .then(({ engineer: loaded }) => {
        if (cancelled) return;
        setEngineer(loaded);
        setForm({ fullName: loaded.fullName, mobileNumber: loaded.mobileNumber });
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(errorMessage(err));
      });
    // Jobs come from the admin report list, filtered by this engineer.
    Promise.all([
      adminReportsApi.list({ engineerId: id, status: "ACCEPTED", pageSize: "50" }),
      adminReportsApi.list({ engineerId: id, status: "COMPLETED", pageSize: "50" }),
    ])
      .then(([open, completed]) => {
        if (!cancelled) setJobs({ open: open.items, completed: completed.items });
      })
      .catch(() => {
        if (!cancelled) setJobs({ open: [], completed: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  function apply(updated: User, message: string) {
    // Updates return the account without workload figures; keep the ones already loaded.
    setEngineer((previous) => (previous === undefined ? previous : { ...previous, ...updated }));
    setForm({ fullName: updated.fullName, mobileNumber: updated.mobileNumber });
    setNotice(message);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (engineer === undefined) return;
    setSaving(true);
    setError(undefined);
    setNotice(undefined);
    setFieldErrors({});
    try {
      const changes: { fullName?: string; mobileNumber?: string } = {};
      if (form.fullName.trim() !== engineer.fullName) changes.fullName = form.fullName;
      if (form.mobileNumber.trim() !== engineer.mobileNumber) changes.mobileNumber = form.mobileNumber;
      const { engineer: updated } = await engineersApi.update(engineer.id, changes);
      apply(updated, "Engineer details updated.");
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    if (engineer === undefined) return;
    const next = engineer.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE";
    if (next === "DEACTIVATED" && !window.confirm(`Deactivate ${engineer.fullName}? They will be logged out immediately.`)) return;
    setStatusBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const { engineer: updated } = await engineersApi.setStatus(engineer.id, next);
      apply(updated, `Account ${next === "ACTIVE" ? "activated" : "deactivated"}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStatusBusy(false);
    }
  }

  const backLink = (
    <Link to="/admin/engineers" className="text-sm font-medium text-cobalt-600 hover:text-cobalt-700">
      All engineers
    </Link>
  );

  if (loadError !== undefined) {
    return (
      <div className="space-y-4">
        {backLink}
        <Alert>{loadError}</Alert>
      </div>
    );
  }
  if (engineer === undefined) {
    return (
      <div className="flex justify-center py-16 text-cobalt-600">
        <Spinner />
      </div>
    );
  }

  const unchanged = form.fullName.trim() === engineer.fullName && form.mobileNumber.trim() === engineer.mobileNumber;

  return (
    <div className="space-y-6">
      {backLink}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">{engineer.fullName}</h1>
          <p className="mt-1 text-sm text-ink-500">Maintenance engineer · created {formatDate(engineer.createdAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={statusTone[engineer.status]}>{statusLabel[engineer.status]}</Badge>
          {engineer.status === "ACTIVE" && (
            <Link
              to={`/chat?with=${engineer.id}`}
              className="rounded-lg border border-ink-300 bg-white px-4 py-2 text-sm font-semibold text-ink-600 hover:bg-canvas"
            >
              Send message
            </Link>
          )}
          <Button variant={engineer.status === "ACTIVE" ? "danger" : "primary"} loading={statusBusy} onClick={() => void toggleStatus()}>
            {engineer.status === "ACTIVE" ? "Deactivate" : "Activate"}
          </Button>
        </div>
      </div>

      {notice !== undefined && <Alert tone="success">{notice}</Alert>}
      {error !== undefined && <Alert>{error}</Alert>}
      {engineer.mustChangePassword && <Alert tone="info">This engineer has not replaced the temporary password yet.</Alert>}

      <Card title="Details">
        <form onSubmit={handleSave} className="space-y-4" noValidate>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="Full name" value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} error={firstError(fieldErrors, "fullName")} required />
            <TextField label="Mobile number" type="tel" value={form.mobileNumber} onChange={(e) => setForm((f) => ({ ...f, mobileNumber: e.target.value }))} error={firstError(fieldErrors, "mobileNumber")} required />
          </div>
          <Button type="submit" loading={saving} disabled={unchanged}>
            Save changes
          </Button>
        </form>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Open jobs" value={engineer.workload.openJobs} />
        <Stat label="Awaiting confirmation" value={engineer.workload.awaitingConfirmation} />
        <Stat label="Completed" value={engineer.workload.completedJobs} />
      </div>

      <Card title="Assigned jobs" description="Accepted reports currently assigned to this engineer.">
        {jobs === undefined ? (
          <Spinner />
        ) : jobs.open.length === 0 ? (
          <p className="text-sm text-ink-500">No open jobs.</p>
        ) : (
          <AdminReportTable items={jobs.open} />
        )}
      </Card>
      <Card title="Completed jobs" description="Reports confirmed as completed while assigned to this engineer.">
        {jobs === undefined ? (
          <Spinner />
        ) : jobs.completed.length === 0 ? (
          <p className="text-sm text-ink-500">No completed jobs yet.</p>
        ) : (
          <AdminReportTable items={jobs.completed} />
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-ink-150 bg-white px-4 py-3">
      <div className="text-xs font-medium tracking-wider uppercase text-ink-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tracking-tight text-ink-900">{value}</div>
    </div>
  );
}
