import { useNavigate } from "react-router";
import { Alert } from "../../components/ui";
import { AuthLayout } from "../../layouts/AuthLayout";
import { useAuth } from "./AuthContext";
import { ChangePasswordForm } from "./ChangePasswordForm";

/** Shown to accounts with an admin-set temporary password until they choose their own. */
export function ChangePasswordPage() {
  const { setUser, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <AuthLayout
      title="Choose a new password"
      subtitle="Your account was created with a temporary password. Choose your own password to continue."
      footer={
        <button type="button" onClick={() => void logout()} className="font-semibold text-ink-600 hover:text-ink-900">
          Log out
        </button>
      }
    >
      <div className="space-y-4">
        <Alert tone="info">Use the temporary password you were given as the current password.</Alert>
        <ChangePasswordForm
          currentLabel="Temporary password"
          onChanged={(user) => {
            setUser(user);
            navigate("/", { replace: true });
          }}
        />
      </div>
    </AuthLayout>
  );
}
