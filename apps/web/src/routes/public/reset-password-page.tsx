/**
 * Reset password landing (UX 1.6). Supabase delivers a recovery session via
 * the URL hash; supabase-js processes it automatically on load and announces
 * PASSWORD_RECOVERY / SIGNED_IN. We wait for that session, then set the new
 * password with auth.updateUser, sign the recovery session out, and hand
 * over to /login with a success banner.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PasswordInput } from "@/components/ui/password-input";
import {
  getSupabase,
  onAuthEvent,
  signOut,
  updatePassword,
} from "@/lib/auth";
import { usePageTitle } from "@/lib/use-page-title";
import logoUrl from "@/assets/logo.png";

const resetSchema = z
  .object({
    password: z.string().min(8, "Use at least 8 characters"),
    confirmPassword: z.string().min(1, "Re-enter your password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type ResetValues = z.infer<typeof resetSchema>;

type RecoveryState = "checking" | "ready" | "invalid";

/** How long to wait for supabase-js to process the URL hash. */
const RECOVERY_TIMEOUT_MS = 4000;

export function ResetPasswordPage() {
  usePageTitle("Set a new password");
  const navigate = useNavigate();
  const [recovery, setRecovery] = useState<RecoveryState>("checking");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    // An error in the hash (expired/used link) means no session will arrive.
    if (/error=|error_code=/.test(window.location.hash)) {
      setRecovery("invalid");
      return;
    }
    let active = true;
    const unsubscribe = onAuthEvent((event, session) => {
      if (!active) return;
      if (event === "PASSWORD_RECOVERY" || session !== null) {
        setRecovery("ready");
      }
    });
    void getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (active && data.session !== null) setRecovery("ready");
      });
    const timer = window.setTimeout(() => {
      if (active) {
        setRecovery((state) => (state === "checking" ? "invalid" : state));
      }
    }, RECOVERY_TIMEOUT_MS);
    return () => {
      active = false;
      unsubscribe();
      window.clearTimeout(timer);
    };
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    mode: "onBlur",
  });

  async function onSubmit(values: ResetValues) {
    setFormError(null);
    try {
      await updatePassword(values.password);
    } catch {
      setFormError(
        "Could not update your password. The reset link may have expired — request a new one and try again.",
      );
      return;
    }
    // Drop the recovery session so the next sign-in is a clean one.
    try {
      await signOut();
    } catch {
      // Non-fatal — the password change already succeeded.
    }
    navigate("/login", {
      replace: true,
      state: {
        notice: "Your password has been updated — sign in with your new password.",
      },
    });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-page p-8">
      <img
        src={logoUrl}
        alt="Business Done Better"
        className="mb-8 h-12 w-auto"
      />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight text-brand-navy-ink">
              Set a new password
            </h1>
          </CardTitle>
          <CardDescription>Staffing Done Better Portal</CardDescription>
        </CardHeader>
        <CardContent>
          {recovery === "checking" ? (
            <LoadingSkeleton
              variant="card"
              rows={1}
              label="Checking your reset link…"
            />
          ) : recovery === "invalid" ? (
            <div className="space-y-4">
              <p
                role="alert"
                className="rounded-md bg-danger-subtle px-4 py-3 text-sm text-danger-text"
              >
                This reset link is invalid or has expired. Request a new one
                and use it within an hour.
              </p>
              <Button asChild className="w-full">
                <Link to="/forgot-password">Request a new link</Link>
              </Button>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={(event) => void handleSubmit(onSubmit)(event)}
              className="space-y-5"
            >
              {formError !== null ? (
                <div
                  role="alert"
                  className="rounded-md bg-danger-subtle px-4 py-3 text-sm text-danger-text"
                >
                  {formError}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="reset-password">New password</Label>
                <PasswordInput
                  id="reset-password"
                  autoComplete="new-password"
                  aria-invalid={errors.password ? true : undefined}
                  aria-describedby={
                    errors.password ? "reset-password-error" : "reset-password-hint"
                  }
                  {...register("password")}
                />
                {errors.password ? (
                  <p id="reset-password-error" className="text-sm text-danger-text">
                    {errors.password.message}
                  </p>
                ) : (
                  <p id="reset-password-hint" className="text-xs text-neutral-500">
                    At least 8 characters.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reset-confirm-password">
                  Confirm new password
                </Label>
                <PasswordInput
                  id="reset-confirm-password"
                  autoComplete="new-password"
                  aria-invalid={errors.confirmPassword ? true : undefined}
                  aria-describedby={
                    errors.confirmPassword
                      ? "reset-confirm-password-error"
                      : undefined
                  }
                  {...register("confirmPassword")}
                />
                {errors.confirmPassword ? (
                  <p
                    id="reset-confirm-password-error"
                    className="text-sm text-danger-text"
                  >
                    {errors.confirmPassword.message}
                  </p>
                ) : null}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Updating…" : "Update password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
