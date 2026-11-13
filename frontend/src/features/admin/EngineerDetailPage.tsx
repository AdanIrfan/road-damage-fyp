import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { Alert, Badge, Button, Card, Spinner, TextField } from "../../components/ui";
import { ApiError, errorMessage, type FieldErrors } from "../../lib/api";
import type { User } from "../../lib/types";
import { firstError, formatDate, statusLabel, statusTone } from "../../utils/format";
import { engineersApi } from "./engineersApi";

export function EngineerDetailPage() {
  const { id = "" } = useParams();
  const [engineer, setEngineer] = useState<User>();
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
    return () => {
      cancelled = true;
    };
  }, [id]);

  function apply(updated: User, message: string) {
    setEngineer(updated);
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
    <Link to="/admin/engineers" className="text-sm font-medium text-blue-600 hover:text-blue-700">
      ← All engineers
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
      <div className="flex justify-center py-16 text-blue-600">
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
          <h1 className="text-2xl font-semibold text-slate-900">{engineer.fullName}</h1>
          <p className="mt-1 text-sm text-slate-500">Maintenance engineer · created {formatDate(engineer.createdAt)}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={statusTone[engineer.status]}>{statusLabel[engineer.status]}</Badge>
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
    </div>
  );
}
