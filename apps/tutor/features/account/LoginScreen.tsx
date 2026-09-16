"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { Brand } from "@/components/brand/Brand";
import { SiteButton } from "@/components/ui/site-button";
import { getLegalHref } from "@/lib/site";
import { safeNextPath } from "@/lib/auth/publicPaths";
import { isStudentEmail } from "@/lib/auth/studentEmail";

export function LoginScreen({
  nextPath,
  googleEnabled,
  emailEnabled,
  devLoginEnabled,
  refused,
  error,
  autoGoogle,
}: {
  nextPath: string;
  googleEnabled: boolean;
  emailEnabled: boolean;
  devLoginEnabled: boolean;
  refused?: boolean;
  error?: string | null;
  autoGoogle?: boolean;
}) {
  const next = useMemo(() => safeNextPath(nextPath), [nextPath]);
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [localError, setLocalError] = useState<string | null>(error ?? null);

  const callbackUrl = next;

  const startGoogle = () => {
    void signIn("google", { callbackUrl });
  };

  useEffect(() => {
    if (!autoGoogle || !googleEnabled) return;
    void signIn("google", { callbackUrl });
  }, [autoGoogle, googleEnabled, callbackUrl]);

  const startDev = () => {
    void signIn("dev-login", { callbackUrl, name: "Local student" });
  };

  const sendMagicLink = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    if (!isStudentEmail(trimmed)) {
      setLocalError("AccessDenied");
      return;
    }
    setSending(true);
    setLocalError(null);
    try {
      const result = await signIn("resend", {
        email: email.trim(),
        callbackUrl,
        redirect: false,
      });
      if (result?.error) {
        setLocalError("Could not send the sign-in email. Check AUTH_RESEND_KEY.");
        return;
      }
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="fx-aurora-soft flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-md rounded-3xl border border-[rgba(255,255,255,0.08)] bg-[rgba(23,23,22,0.82)] p-7 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.8)]">
        <Brand size="lg" />
        <h1 className="mt-6 text-2xl font-semibold tracking-[-0.03em] text-frost">
          Sign in to Accelute
        </h1>
        <p className="mt-2 text-sm leading-6 text-[rgba(237,237,235,0.62)]">
          Student accounts only — sign in with a school Google account (.edu or .ac). The landing
          site stays public; this is the tutor.
        </p>

        {refused ? (
          <p className="mt-4 rounded-xl border border-[rgba(224,104,88,0.35)] bg-[rgba(224,104,88,0.1)] px-3 py-2 text-sm text-[#f0b4ac]">
            Accelute does not offer accounts to children under 13. Ask a parent or guardian if you need help.
          </p>
        ) : null}

        {localError ? (
          <p className="mt-4 rounded-xl border border-[rgba(224,104,88,0.35)] bg-[rgba(224,104,88,0.1)] px-3 py-2 text-sm text-[#f0b4ac]">
            {localError === "AccessDenied"
              ? "Accelute is for students. Use a school email (.edu or .ac)."
              : localError}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3">
          {googleEnabled ? (
            <SiteButton variant="ice" size="md" block onClick={startGoogle} disabled={autoGoogle}>
              {autoGoogle ? "Opening Google…" : "Continue with Google"}
            </SiteButton>
          ) : (
            <p className="rounded-xl border border-[rgba(255,255,255,0.08)] px-3 py-2 text-sm text-[rgba(237,237,235,0.62)]">
              Google sign-in is not configured. Set <code className="text-ice">AUTH_GOOGLE_ID</code> and{" "}
              <code className="text-ice">AUTH_GOOGLE_SECRET</code>, or use local-dev login.
            </p>
          )}

          {emailEnabled ? (
            sent ? (
              <p className="text-sm text-frost">Check your email for a sign-in link.</p>
            ) : (
              <form onSubmit={sendMagicLink} className="flex flex-col gap-2">
                <label className="text-xs text-[rgba(237,237,235,0.55)]" htmlFor="login-email">
                  Email magic link
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@school.edu"
                  className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.25)] px-3 py-2.5 text-sm text-frost outline-none focus:border-sky-500"
                />
                <SiteButton type="submit" variant="sky" size="md" block disabled={sending}>
                  {sending ? "Sending…" : "Email me a link"}
                </SiteButton>
              </form>
            )
          ) : null}

          {devLoginEnabled ? (
            <SiteButton variant="ghost" size="md" block onClick={startDev}>
              Continue as local student
            </SiteButton>
          ) : null}
        </div>

        <p className="mt-6 text-xs leading-5 text-[rgba(237,237,235,0.45)]">
          By continuing you agree to the{" "}
          <a className="text-sky-300 underline-offset-2 hover:underline" href={getLegalHref("/terms")}>
            Terms
          </a>{" "}
          and{" "}
          <a className="text-sky-300 underline-offset-2 hover:underline" href={getLegalHref("/privacy")}>
            Privacy Policy
          </a>
          . Under 13 is not allowed. Ages 13–17 need a guardian email.
        </p>
      </div>
    </main>
  );
}
