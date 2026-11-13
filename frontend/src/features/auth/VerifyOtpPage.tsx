import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { Alert, Button, TextField } from "../../components/ui";
import { AuthLayout } from "../../layouts/AuthLayout";
import { ApiError, errorMessage, type FieldErrors } from "../../lib/api";
import { firstError } from "../../utils/format";
import { authApi } from "./authApi";

function secondsUntil(iso: string | undefined): number {
  if (iso === undefined) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
}

export function VerifyOtpPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const navState = location.state as { resendAvailableAt?: string; notice?: string } | null;

  const [mobileNumber, setMobileNumber] = useState(searchParams.get("mobile") ?? "");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string | undefined>(navState?.notice);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [cooldown, setCooldown] = useState(() => secondsUntil(navState?.resendAvailableAt));

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(undefined);
    setFieldErrors({});
    try {
      await authApi.verifyOtp(mobileNumber, code);
      navigate("/login", { replace: true, state: { notice: "Your mobile number is verified. You can now log in." } });
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        const remaining = err.details?.["attemptsRemaining"];
        setError(typeof remaining === "number" ? `${err.message} ${remaining} attempt(s) left.` : err.message);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setResending(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await authApi.resendOtp(mobileNumber);
      setNotice(result.message ?? "A new code has been sent.");
      setCooldown(result.resendAvailableAt !== undefined ? secondsUntil(result.resendAvailableAt) : 60);
      setCode("");
    } catch (err) {
      if (err instanceof ApiError) {
        setFieldErrors(err.fieldErrors);
        const retryAfter = err.details?.["retryAfterSeconds"];
        if (typeof retryAfter === "number") setCooldown(retryAfter);
      }
      setError(errorMessage(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthLayout
      title="Verify your mobile number"
      subtitle="Enter the 6-digit code we sent by SMS. Codes expire after 10 minutes."
      footer={
        <Link to="/login" className="font-semibold text-blue-600 hover:text-blue-700">
          Back to log in
        </Link>
      }
    >
      <form onSubmit={handleVerify} className="space-y-4" noValidate>
        {notice !== undefined && <Alert tone="success">{notice}</Alert>}
        {error !== undefined && <Alert>{error}</Alert>}
        <TextField
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          value={mobileNumber}
          onChange={(e) => setMobileNumber(e.target.value)}
          error={firstError(fieldErrors, "mobileNumber")}
          required
        />
        <TextField
          label="Verification code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          error={firstError(fieldErrors, "code")}
          required
        />
        <Button type="submit" loading={submitting} className="w-full" disabled={code.length !== 6}>
          Verify
        </Button>
        <Button type="button" variant="secondary" className="w-full" onClick={handleResend} loading={resending} disabled={cooldown > 0 || mobileNumber === ""}>
          {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
        </Button>
      </form>
    </AuthLayout>
  );
}
