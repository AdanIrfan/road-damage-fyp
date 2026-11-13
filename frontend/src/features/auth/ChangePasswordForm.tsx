import { useState, type FormEvent } from "react";
import { Alert, Button, TextField } from "../../components/ui";
import { ApiError, errorMessage, type FieldErrors } from "../../lib/api";
import type { User } from "../../lib/types";
import { firstError } from "../../utils/format";
import { profileApi } from "./authApi";

const empty = { currentPassword: "", newPassword: "", confirmNewPassword: "" };

/** Changing the password logs out other devices; this device gets a fresh session. */
export function ChangePasswordForm({ onChanged, currentLabel = "Current password" }: { onChanged: (user: User) => void; currentLabel?: string }) {
  const [form, setForm] = useState(empty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const update = (field: keyof typeof empty) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    setSuccess(false);
    if (form.newPassword !== form.confirmNewPassword) {
      setFieldErrors({ confirmNewPassword: ["Passwords do not match."] });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const { user } = await profileApi.changePassword(form);
      setForm(empty);
      setSuccess(true);
      onChanged(user);
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
      {success && <Alert tone="success">Password changed. Other devices have been logged out.</Alert>}
      <TextField label={currentLabel} type="password" autoComplete="current-password" value={form.currentPassword} onChange={update("currentPassword")} error={firstError(fieldErrors, "currentPassword")} required />
      <TextField label="New password" type="password" autoComplete="new-password" hint="At least 8 characters." value={form.newPassword} onChange={update("newPassword")} error={firstError(fieldErrors, "newPassword")} required />
      <TextField label="Confirm new password" type="password" autoComplete="new-password" value={form.confirmNewPassword} onChange={update("confirmNewPassword")} error={firstError(fieldErrors, "confirmNewPassword")} required />
      <Button type="submit" loading={submitting}>
        Change password
      </Button>
    </form>
  );
}
