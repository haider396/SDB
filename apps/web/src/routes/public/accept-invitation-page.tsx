/**
 * Public invitation acceptance (UX 1.1, POST /auth/accept-invitation).
 *
 * The invite email links here with ?token=…; the invitee sets their name,
 * timezone, and password. The API sets the password server-side (the token
 * is single-use), so on success we send them to /login with a success
 * banner rather than trying to sign them in from here.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { MailOpen } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { AcceptInvitationBodySchema } from "@sdb/contracts";
import { EmptyState } from "@/components/patterns/empty-state";
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
import { NativeSelect } from "@/components/ui/native-select";
import { PasswordInput } from "@/components/ui/password-input";
import { ApiError, apiFetch } from "@/lib/api-client";
import { usePageTitle } from "@/lib/use-page-title";
import {
  timezoneOptions,
  viewerTimezone,
} from "@/features/pipeline/interview-time";
import logoUrl from "@/assets/logo.png";

/** Contracts schema minus the token (from the URL), plus the confirm field. */
const acceptFormSchema = AcceptInvitationBodySchema.omit({ token: true })
  .extend({
    fullName: z.string().min(1, "Enter your full name"),
    timezone: z.string().min(1, "Choose your timezone"),
    password: z.string().min(8, "Use at least 8 characters"),
    confirmPassword: z.string().min(1, "Re-enter your password"),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match",
  });

type AcceptFormValues = z.infer<typeof acceptFormSchema>;

const INVALID_TOKEN_MESSAGE =
  "This invitation link is no longer valid — it may have expired or already been used. Ask your SDB contact to re-invite you and use the fresh link from that email.";

export function AcceptInvitationPage() {
  usePageTitle("Accept your invitation");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AcceptFormValues>({
    resolver: zodResolver(acceptFormSchema),
    mode: "onBlur",
    defaultValues: { timezone: viewerTimezone() },
  });

  if (token === "") {
    return (
      <div className="mx-auto flex min-h-screen max-w-content items-center justify-center p-8">
        <div className="w-full max-w-lg">
          <EmptyState
            icon={MailOpen}
            title="This invitation link is incomplete"
            description="The link is missing its invitation token. Open the link from your invitation email again, or ask your SDB contact to re-invite you."
          />
        </div>
      </div>
    );
  }

  async function onSubmit(values: AcceptFormValues) {
    setFormError(null);
    try {
      await apiFetch<{ accepted: boolean }>("/auth/accept-invitation", {
        method: "POST",
        auth: false,
        body: {
          token,
          fullName: values.fullName,
          timezone: values.timezone,
          password: values.password,
        },
      });
    } catch (cause) {
      setFormError(
        cause instanceof ApiError && cause.status === 422
          ? INVALID_TOKEN_MESSAGE
          : "Something went wrong setting up your account. Please try again.",
      );
      return;
    }
    // Your account is ready — prompt them to sign in with the new password.
    navigate("/login", {
      replace: true,
      state: {
        notice:
          "Your account is ready — sign in with your email and new password.",
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
              Accept your invitation
            </h1>
          </CardTitle>
          <CardDescription>
            Set up your Staffing Done Better Portal account
          </CardDescription>
        </CardHeader>
        <CardContent>
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
              <Label htmlFor="invite-full-name">Full name</Label>
              <Input
                id="invite-full-name"
                autoComplete="name"
                aria-invalid={errors.fullName ? true : undefined}
                aria-describedby={
                  errors.fullName ? "invite-full-name-error" : undefined
                }
                {...register("fullName")}
              />
              {errors.fullName ? (
                <p id="invite-full-name-error" className="text-sm text-danger-text">
                  {errors.fullName.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite-timezone">Timezone</Label>
              <NativeSelect
                id="invite-timezone"
                aria-invalid={errors.timezone ? true : undefined}
                aria-describedby={
                  errors.timezone ? "invite-timezone-error" : undefined
                }
                {...register("timezone")}
              >
                {timezoneOptions().map((zone) => (
                  <option key={zone} value={zone}>
                    {zone}
                  </option>
                ))}
              </NativeSelect>
              {errors.timezone ? (
                <p id="invite-timezone-error" className="text-sm text-danger-text">
                  {errors.timezone.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite-password">Password</Label>
              <PasswordInput
                id="invite-password"
                autoComplete="new-password"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={
                  errors.password
                    ? "invite-password-error"
                    : "invite-password-hint"
                }
                {...register("password")}
              />
              {errors.password ? (
                <p id="invite-password-error" className="text-sm text-danger-text">
                  {errors.password.message}
                </p>
              ) : (
                <p id="invite-password-hint" className="text-xs text-neutral-500">
                  At least 8 characters.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite-confirm-password">Confirm password</Label>
              <PasswordInput
                id="invite-confirm-password"
                autoComplete="new-password"
                aria-invalid={errors.confirmPassword ? true : undefined}
                aria-describedby={
                  errors.confirmPassword
                    ? "invite-confirm-password-error"
                    : undefined
                }
                {...register("confirmPassword")}
              />
              {errors.confirmPassword ? (
                <p
                  id="invite-confirm-password-error"
                  className="text-sm text-danger-text"
                >
                  {errors.confirmPassword.message}
                </p>
              ) : null}
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Setting up your account…" : "Create my account"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
