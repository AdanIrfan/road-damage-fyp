import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, TextField } from "../components/ui";
import { useAuth, useCurrentUser } from "../features/auth/AuthContext";
import { profileApi } from "../features/auth/authApi";
import { ChangePasswordForm } from "../features/auth/ChangePasswordForm";
import { ApiError, errorMessage, type FieldErrors } from "../lib/api";
import { firstError, formatDate, roleLabel, statusLabel, statusTone } from "../utils/format";

const pageTitle = { CITIZEN: "Citizen profile", ENGINEER: "Engineer profile", ADMIN: "Administrator profile" } as const;

/** The logged-in user's own profile. Each role sees only their own account. */
export function ProfilePage() {
  const user = useCurrentUser();
  const { setUser } = useAuth();
  const [fullName, setFullName] = useState(user.fullName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    setSaved(false);
    setFieldErrors({});
    try {
      const { user: updated } = await profileApi.update(fullName);
      setUser(updated);
      setFullName(updated.fullName);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">{pageTitle[user.role]}</h1>
        <p className="mt-1 text-sm text-ink-500">Your account details and password.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Account">
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-500">Role</dt>
              <dd className="mt-1 font-medium">{roleLabel[user.role]}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Status</dt>
              <dd className="mt-1">
                <Badge tone={statusTone[user.status]}>{statusLabel[user.status]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-ink-500">Mobile number</dt>
              <dd className="mt-1 font-medium">{user.mobileNumber}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Mobile verified</dt>
              <dd className="mt-1 font-medium">{user.mobileVerifiedAt === null ? "Not verified by SMS" : formatDate(user.mobileVerifiedAt)}</dd>
            </div>
            <div>
              <dt className="text-ink-500">Member since</dt>
              <dd className="mt-1 font-medium">{formatDate(user.createdAt)}</dd>
            </div>
          </dl>
          <form onSubmit={handleSave} className="mt-6 space-y-4 border-t border-ink-100 pt-5" noValidate>
            {error !== undefined && <Alert>{error}</Alert>}
            {saved && <Alert tone="success">Profile updated.</Alert>}
            <TextField label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} error={firstError(fieldErrors, "fullName")} required />
            <Button type="submit" loading={saving} disabled={fullName.trim() === user.fullName}>
              Save changes
            </Button>
          </form>
        </Card>

        <Card title="Change password" description="Other devices will be logged out.">
          <ChangePasswordForm onChanged={setUser} />
        </Card>
      </div>
    </div>
  );
}
