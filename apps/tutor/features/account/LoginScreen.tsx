"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { signIn } from "next-auth/react";
import { KeyRound } from "lucide-react";
import { Brand } from "@/components/brand/Brand";
import { GoogleMark } from "@/components/brand/GoogleMark";
import { SiteButton } from "@/components/ui/site-button";
import { getLegalHref } from "@/lib/site";
import { safeNextPath } from "@/lib/auth/publicPaths";
import { SIGNUP_INTENT_COPY, signupIntent } from "@/lib/auth/signupIntent";

const ERROR_COPY: Record<string, string> = {
  AccessDenied: "Google did not share an email address, so we could not sign you in. Try again or use another Google account.",
  Configuration: "Google sign-in hit a server configuration error. Try again in a moment.",
  OAuthCallbackError: "Google sign-in was cancelled or timed out. Try again.",
  OAuthSignin: "We could not reach Google. Check your connection and try again.",
};

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
  const intent = signupIntent(next);
  const intentCopy = intent ? SIGNUP_INTENT_COPY[intent] : null;
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [redirecting, setRedirecting] = useState(Boolean(autoGoogle && googleEnabled));
  const [localError, setLocalError] = useState<string | null>(error ?? null);

  const callbackUrl = next;
  const canSignIn = googleEnabled || devLoginEnabled;

  const failSignIn = () => {
    setRedirecting(false);
    setLocalError("OAuthSignin");
  };

  const start = () => {
    setLocalError(null);
    setRedirecting(true);
    const request = googleEnabled
      ? signIn("google", { callbackUrl })
      : signIn("dev-login", { callbackUrl, name: "Local learner" });
    request.catch(failSignIn);
  };

  useEffect(() => {
    if (!autoGoogle || !googleEnabled) return;
    signIn("google", { callbackUrl }).catch(() => {
      setRedirecting(false);
      setLocalError("OAuthSignin");
    });
  }, [autoGoogle, googleEnabled, callbackUrl]);

  useEffect(() => {
    // Back from Google restores this page from the cache with the button still disabled.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setRedirecting(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const sendMagicLink = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setSending(true);
    setLocalError(null);
    try {
      const result = await signIn("resend", {
        email: trimmed,
        callbackUrl,
        redirect: false,
      });
      if (result?.error) {
        setLocalError("Could not send the sign-in email. Try again in a moment.");
        return;
      }
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  const steps = ["Sign in with Google", "Tell us about you", intentCopy?.lastStep ?? "Ask your first question"];

  return (
    <main className="fx-aurora-soft flex min-h-dvh flex-col items-center justify-center px-5 py-12">
      <div className="animate-fade-up w-full max-w-md rounded-3xl border border-[rgba(255,255,255,0.08)] bg-[rgba(23,23,22,0.82)] p-7 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.8)] sm:p-8">
        <Brand size="lg" />
        <h1 className="mt-7 text-2xl font-semibold tracking-[-0.03em] text-frost">
          {intentCopy?.loginTitle ?? "Welcome to Accelute"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[rgba(237,237,235,0.62)]">
          {intentCopy?.loginBody ??
            "Your AI whiteboard tutor. Sign in or create an account with any Google account, school or personal."}
        </p>

        {refused ? (
          <p role="alert" className="mt-5 rounded-xl border border-[rgba(224,104,88,0.35)] bg-[rgba(224,104,88,0.1)] px-3 py-2 text-sm text-[#f0b4ac]">
            Accelute does not offer accounts to children under 13. Ask a parent or guardian if you need help.
          </p>
        ) : null}

        {localError ? (
          <p role="alert" className="mt-5 rounded-xl border border-[rgba(224,104,88,0.35)] bg-[rgba(224,104,88,0.1)] px-3 py-2 text-sm text-[#f0b4ac]">
            {ERROR_COPY[localError] ?? localError}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3">
          {canSignIn ? (
            <SiteButton variant="ice" size="md" block onClick={start} disabled={redirecting}>
              {googleEnabled ? <GoogleMark /> : <KeyRound className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />}
              {googleEnabled
                ? redirecting ? "Opening Google…" : "Continue with Google"
                : redirecting ? "Signing in…" : "Continue with local login"}
            </SiteButton>
          ) : (
            <p className="rounded-xl border border-[rgba(255,255,255,0.08)] px-3 py-2 text-sm text-[rgba(237,237,235,0.62)]">
              Google sign-in is not configured. Set <code className="text-ice">AUTH_GOOGLE_ID</code> and{" "}
              <code className="text-ice">AUTH_GOOGLE_SECRET</code>, or use local-dev login.
            </p>
          )}

          {emailEnabled ? (
            sent ? (
              <p role="status" className="rounded-xl border border-[rgba(255,255,255,0.08)] px-3 py-2.5 text-sm text-frost">
                Check your inbox for a sign-in link.
              </p>
            ) : (
              <form onSubmit={sendMagicLink} className="flex flex-col gap-2">
                <div className="my-1 flex items-center gap-3 text-xs text-[rgba(237,237,235,0.4)]">
                  <span className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
                  or use email
                  <span className="h-px flex-1 bg-[rgba(255,255,255,0.08)]" />
                </div>
                <label className="sr-only" htmlFor="login-email">
                  Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  className="rounded-xl border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.25)] px-3 py-2.5 text-sm text-frost outline-none focus:border-sky-500"
                />
                <SiteButton type="submit" variant="ghost" size="md" block disabled={sending}>
                  {sending ? "Sending…" : "Email me a sign-in link"}
                </SiteButton>
              </form>
            )
          ) : null}
        </div>

        <ol className="mt-7 grid grid-cols-3 gap-2 border-t border-[rgba(255,255,255,0.06)] pt-5" aria-label="What happens next">
          {steps.map((step, index) => (
            <li key={step} className="flex flex-col gap-1.5">
              <span
                className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold ${
                  index === 0
                    ? "bg-sky-500 text-[#0b1620]"
                    : "border border-[rgba(255,255,255,0.14)] text-[rgba(237,237,235,0.55)]"
                }`}
              >
                {index + 1}
              </span>
              <span className="text-xs leading-4 text-[rgba(237,237,235,0.6)]">{step}</span>
            </li>
          ))}
        </ol>

        <p className="mt-6 text-xs leading-5 text-[rgba(237,237,235,0.45)]">
          New here? Signing in creates your account. By continuing you agree to the{" "}
          <a className="text-sky-300 underline-offset-2 hover:underline" href={getLegalHref("/terms")}>
            Terms
          </a>{" "}
          and{" "}
          <a className="text-sky-300 underline-offset-2 hover:underline" href={getLegalHref("/privacy")}>
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </main>
  );
}
