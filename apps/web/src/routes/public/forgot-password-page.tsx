/**
 * Forgot password (UX 1.6): email in → Supabase reset email out. The
 * confirmation is deliberately identical whether or not the address exists
 * (no account enumeration), so failures are swallowed after logging nothing.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetPasswordForEmail } from "@/lib/auth";
import { usePageTitle } from "@/lib/use-page-title";
import logoUrl from "@/assets/logo.png";

const forgotSchema = z.object({
  email: z
    .string()
    .min(1, "Enter your email address")
    .email("Enter a valid email address"),
});

type ForgotValues = z.infer<typeof forgotSchema>;

export function ForgotPasswordPage() {
  usePageTitle("Forgot password");
  const [isSent, setIsSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotValues>({
    resolver: zodResolver(forgotSchema),
    mode: "onBlur",
  });

  async function onSubmit(values: ForgotValues) {
    try {
      await resetPasswordForEmail(values.email);
    } catch {
      // Same outcome either way — never reveal whether the address exists.
    }
    setIsSent(true);
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
              Reset your password
            </h1>
          </CardTitle>
          <CardDescription>
            Enter the email you sign in with and we will send a reset link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSent ? (
            <div className="space-y-4">
              <p
                role="status"
                className="flex items-start gap-2 rounded-md bg-success-subtle px-4 py-3 text-sm text-success-text"
              >
                <MailCheck aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                If that address exists, a reset link is on its way. Check your
                inbox and spam folder.
              </p>
              <p className="text-sm text-neutral-500">
                <Link
                  to="/login"
                  className="font-medium text-brand-blue hover:underline"
                >
                  Back to sign in
                </Link>
              </p>
            </div>
          ) : (
            <form
              noValidate
              onSubmit={(event) => void handleSubmit(onSubmit)(event)}
              className="space-y-5"
            >
              <div className="space-y-1.5">
                <Label htmlFor="forgot-email">Email</Label>
                <Input
                  id="forgot-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  aria-invalid={errors.email ? true : undefined}
                  aria-describedby={
                    errors.email ? "forgot-email-error" : undefined
                  }
                  {...register("email")}
                />
                {errors.email ? (
                  <p id="forgot-email-error" className="text-sm text-danger-text">
                    {errors.email.message}
                  </p>
                ) : null}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Sending…" : "Send reset link"}
              </Button>

              <p className="text-center text-sm text-neutral-500">
                <Link
                  to="/login"
                  className="font-medium text-brand-blue hover:underline"
                >
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
