import { Lock, Phone, UserRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { Alert, Button, TextField } from "../../components/ui";
import { AuthLayout } from "../../layouts/AuthLayout";
import { ApiError, errorMessage, type FieldErrors } from "../../lib/api";
import { firstError } from "../../utils/format";
import { authApi, type RegisterInput } from "./authApi";

const emptyForm: RegisterInput = { fullName: "", mobileNumber: "", password: "", confirmPassword: "" };

export function RegisterPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<RegisterInput>(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const update = (field: keyof RegisterInput) => (event: { target: { value: string } }) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(undefined);
    // Quick client-side check for a better experience; the server validates everything again.
    if (form.password !== form.confirmPassword) {
      setFieldErrors({ confirmPassword: ["Passwords do not match."] });
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const result = await authApi.register(form);
      navigate(`/verify?mobile=${encodeURIComponent(result.mobileNumber)}`, {
        state: { resendAvailableAt: result.resendAvailableAt, notice: "We sent a 6-digit code to your mobile number." },
      });
    } catch (err) {
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Create a citizen account"
      subtitle="Report road damage and follow its repair. You will verify your mobile number by SMS."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-cobalt-600 hover:text-cobalt-700">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {error !== undefined && <Alert>{error}</Alert>}
        <TextField label="Full name" autoComplete="name" icon={<UserRound className="size-[18px]" />} value={form.fullName} onChange={update("fullName")} error={firstError(fieldErrors, "fullName")} required />
        <TextField
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          placeholder="+92 300 1234567"
          hint="Include your country code. We send a 6-digit code to this number."
          icon={<Phone className="size-[18px]" />}
          value={form.mobileNumber}
          onChange={update("mobileNumber")}
          error={firstError(fieldErrors, "mobileNumber")}
          required
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          icon={<Lock className="size-[18px]" />}
          value={form.password}
          onChange={update("password")}
          error={firstError(fieldErrors, "password")}
          required
        />
        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          icon={<Lock className="size-[18px]" />}
          value={form.confirmPassword}
          onChange={update("confirmPassword")}
          error={firstError(fieldErrors, "confirmPassword")}
          required
        />
        <Button type="submit" size="lg" loading={submitting} className="w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
