import { useEffect, useId, useState, type FormEvent } from "react";
import { Dialog } from "../../components/Dialog";
import { Alert, Button, Spinner } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import type { AdminActionResult, EngineerSuggestion } from "../../lib/reportTypes";
import { adminReportsApi } from "./adminReportsApi";

/**
 * Pick an engineer for an accepted report. Suggestions follow the agreed formula (active
 * engineers, fewest open jobs first); the admin makes the final choice.
 */
export function AssignEngineerDialog({
  reportId,
  isReassignment,
  onAssigned,
  onClose,
}: {
  reportId: string;
  isReassignment: boolean;
  onAssigned: (result: AdminActionResult) => void;
  onClose: () => void;
}) {
  const reasonId = useId();
  const [engineers, setEngineers] = useState<EngineerSuggestion[]>();
  const [selected, setSelected] = useState<string>();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    adminReportsApi
      .suggestions(reportId)
      .then(({ engineers: list }) => {
        if (cancelled) return;
        setEngineers(list);
        setSelected(list.find((e) => !e.isCurrent)?.id);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (selected === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      onAssigned(await adminReportsApi.assign(reportId, selected, reason.trim()));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Dialog title={isReassignment ? "Reassign report" : "Assign engineer"} onClose={busy ? () => undefined : onClose}>
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        {isReassignment && (
          <Alert tone="info">
            Reassigning starts a new repair attempt for the new engineer. Earlier photos and notes are kept as evidence, and the new engineer must
            upload their own photos before completing.
          </Alert>
        )}
        {engineers === undefined && error === undefined && (
          <div className="flex justify-center py-6 text-blue-600">
            <Spinner />
          </div>
        )}
        {engineers !== undefined && engineers.length === 0 && <Alert>No active engineer accounts. Create or activate an engineer first.</Alert>}
        {engineers !== undefined && engineers.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Engineers (fewest open jobs first)</legend>
            {engineers.map((engineer) => (
              <label
                key={engineer.id}
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm ${
                  selected === engineer.id ? "border-blue-500 bg-blue-50" : "border-slate-200"
                } ${engineer.isCurrent ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <input
                  type="radio"
                  name="engineer"
                  className="mt-1"
                  value={engineer.id}
                  checked={selected === engineer.id}
                  disabled={engineer.isCurrent}
                  onChange={() => setSelected(engineer.id)}
                />
                <span>
                  <span className="font-medium text-slate-900">{engineer.fullName}</span>
                  <span className="block text-slate-500">
                    {engineer.openJobs} open job{engineer.openJobs === 1 ? "" : "s"}
                    {engineer.isCurrent && " · currently assigned"}
                  </span>
                  {engineer.mustChangePassword && (
                    <span className="block text-xs text-amber-700">Has not replaced the temporary password yet (cannot open jobs until then).</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div>
          <label htmlFor={reasonId} className="block text-sm font-medium text-slate-700">
            Reason <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id={reasonId}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        {error !== undefined && <Alert>{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={selected === undefined}>
            {isReassignment ? "Reassign" : "Assign"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
