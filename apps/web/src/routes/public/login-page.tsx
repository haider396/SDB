/**
 * Login — email/password via Supabase Auth directly in the browser
 * (docs/04-API.md §2: the API does not proxy login). On success, /auth/me
 * resolves the role and the user is redirected to /admin or /client.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
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
import { signInWithPassword } from "@/lib/auth";
import { fetchMe, homePathFor, ME_QUERY_KEY } from "@/lib/permissions";
import { queryClient } from "@/lib/query-client";

const loginSchema = z.object({
  email: z.string().min(1, "Enter your email address").email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

type LoginValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    mode: "onBlur", // inline validation on blur, not per keystroke (05 §4.4)
  });

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    try {
      await signInWithPassword(values.email, values.password);
    } catch {
      setFormError("That email and password combination did not work. Check both and try again.");
      return;
    }

    try {
      const me = await queryClient.fetchQuery({
        queryKey: ME_QUERY_KEY,
        queryFn: fetchMe,
      });
      navigate(homePathFor(me), { replace: true });
    } catch {
      setFormError(
        "Signed in, but your profile could not be loaded. Please try again.",
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-page p-8">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            <h1 className="text-2xl font-semibold tracking-tight text-brand-navy-ink">
              Sign in
            </h1>
          </CardTitle>
          <CardDescription>Staffing Done Better Portal</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Submit stays enabled regardless of validation state (05 §4.4);
              it is disabled only while the request is in flight. */}
          <form
            noValidate
            onSubmit={(event) => void handleSubmit(onSubmit)(event)}
            className="space-y-5"
          >
            {formError ? (
              <div
                role="alert"
                className="rounded-md bg-danger-subtle px-4 py-3 text-sm text-danger-text"
              >
                {formError}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? "email-error" : undefined}
                {...register("email")}
              />
              {errors.email ? (
                <p id="email-error" className="text-sm text-danger-text">
                  {errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? "password-error" : undefined}
                {...register("password")}
              />
              {errors.password ? (
                <p id="password-error" className="text-sm text-danger-text">
                  {errors.password.message}
                </p>
              ) : null}
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
