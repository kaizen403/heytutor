import { safeNextPath } from "./publicPaths";

/** What a signed-out visitor was on their way to when sign-in stopped them. */
export type SignupIntent = "plus" | "credits" | "question";

export function signupIntent(nextPath: string | null | undefined): SignupIntent | null {
  const next = safeNextPath(nextPath);
  const url = new URL(next, "https://intent.invalid");
  if (url.pathname === "/usage" && url.searchParams.get("plan") === "plus") return "plus";
  if (url.pathname === "/usage" || url.pathname === "/settings/usage") return "credits";
  if (url.pathname === "/" && url.searchParams.get("q")?.trim()) return "question";
  return null;
}

export const SIGNUP_INTENT_COPY: Record<
  SignupIntent,
  { loginTitle: string; loginBody: string; onboarding: string; finish: string; lastStep: string }
> = {
  plus: {
    loginTitle: "Sign in to get Plus",
    loginBody: "Sign in or create your account, then check out. It takes about a minute.",
    onboarding: "Plus checkout opens right after setup.",
    finish: "Continue to checkout",
    lastStep: "Check out Plus",
  },
  credits: {
    loginTitle: "Sign in to add credits",
    loginBody: "Sign in or create your account, then add credits to your plan.",
    onboarding: "Your plan and credits open right after setup.",
    finish: "Continue to credits",
    lastStep: "Add credits",
  },
  question: {
    loginTitle: "Sign in to start your lesson",
    loginBody: "Your question is saved. Sign in and the tutor starts on it after a short setup.",
    onboarding: "Your question is saved. The lesson starts right after setup.",
    finish: "Start my lesson",
    lastStep: "Start your lesson",
  },
};
