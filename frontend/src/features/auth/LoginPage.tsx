import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Alert, Button, TextField } from "../../components/ui";
import { AuthLayout } from "../../layouts/AuthLayout";
import { ApiError, errorMessage, type FieldErrors } from "../../lib/api";
import { firstError } from "../../utils/format";
import { useAuth } from "./AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;

  const [mobileNumber, setMobileNumber] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setFieldErrors({});
    try {
      await login(mobileNumber, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from ?? "/", { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "ACCOUNT_NOT_VERIFIED") {
        const verifiedNumber = String(err.details?.["mobileNumber"] ?? mobileNumber);
        navigate(`/verify?mobile=${encodeURIComponent(verifiedNumber)}`, {
          state: { notice: "Your mobile number is not verified yet. Request a code to finish registration." },
        });
        return;
      }
      if (err instanceof ApiError) setFieldErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Log in"
      subtitle="Use the mobile number and password of your account."
      footer={
        <>
          New citizen?{" "}
          <Link to="/register" className="font-semibold text-blue-600 hover:text-blue-700">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {notice !== undefined && <Alert tone="success">{notice}</Alert>}
        {error !== undefined && <Alert>{error}</Alert>}
        <TextField
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          placeholder="+1 202 555 0143"
          value={mobileNumber}
          onChange={(e) => setMobileNumber(e.target.value)}
          error={firstError(fieldErrors, "mobileNumber")}
          required
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={firstError(fieldErrors, "password")}
          required
        />
        <Button type="submit" loading={submitting} className="w-full">
          Log in
        </Button>
      </form>
    </AuthLayout>
  );
}
