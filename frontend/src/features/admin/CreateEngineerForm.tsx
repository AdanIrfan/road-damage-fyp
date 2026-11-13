import { useState, type FormEvent } from "react";
import { Alert, Button, TextField } from "../../components/ui";
import { ApiError, errorMessage, type FieldErrors } from "../../lib/api";
import type { User } from "../../lib/types";
import { firstError } from "../../utils/format";
import { engineersApi } from "./engineersApi";

const empty = { fullName: "", mobileNumber: "", temporaryPassword: "" };

export function CreateEngineerForm({ onCreated, onCancel }: { onCreated: (engineer: User) => void; onCancel: () => void }) {
  const [form, setForm] = useState(empty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const update = (field: keyof typeof empty) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setFieldErrors({});
    try {
      const { engineer } = await engineersApi.create(form);
      setForm(empty);
      onCreated(engineer);
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error !== undefined && <Alert>{error}</Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        <TextField label="Full name" value={form.fullName} onChange={update("fullName")} error={firstError(fieldErrors, "fullName")} required />
        <TextField label="Mobile number" type="tel" placeholder="+1 202 555 0143" value={form.mobileNumber} onChange={update("mobileNumber")} error={firstError(fieldErrors, "mobileNumber")} required />
        <TextField
          label="Temporary password"
          type="password"
          autoComplete="new-password"
          hint="Give it to the engineer privately. They must change it at first login."
          value={form.temporaryPassword}
          onChange={update("temporaryPassword")}
          error={firstError(fieldErrors, "temporaryPassword")}
          required
        />
      </div>
      <div className="flex gap-3">
        <Button type="submit" loading={submitting}>
          Create engineer
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
