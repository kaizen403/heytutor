import NextAuth, { type NextAuthConfig } from "next-auth";

if (!process.env.AUTH_SECRET && process.env.NODE_ENV !== "production") {
  process.env.AUTH_SECRET = "dev-only-accelute-auth-secret";
}
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import Resend from "next-auth/providers/resend";
import { cookies } from "next/headers";
import { HTUTOR_UID_COOKIE } from "@/lib/cookies";
import { isAdminEmail } from "@/lib/auth/admins";
import { isAllowedLoginEmail } from "@/lib/auth/studentEmail";
import { HTUTOR_LOGIN_ROLE_COOKIE, isLoginRole, type LoginRole } from "@/lib/auth/loginRole";
import { findOrCreateSignedInUser } from "@/lib/auth/signedInUser";

const googleId = process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID;
const googleSecret = process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
const resendKey = process.env.AUTH_RESEND_KEY ?? process.env.RESEND_API_KEY;
const emailFrom = process.env.AUTH_EMAIL_FROM ?? "Accelute <hi@accelute.co>";

export function isGoogleAuthConfigured(): boolean {
  return Boolean(googleId && googleSecret);
}

export function isEmailAuthConfigured(): boolean {
  // Resend/magic-link needs an Auth.js database adapter. Production login is
  // Google-only until that adapter exists. Set AUTH_EMAIL_LOGIN=1 to opt in.
  return Boolean(resendKey) && process.env.AUTH_EMAIL_LOGIN === "1";
}

export function isDevLoginEnabled(): boolean {
  return process.env.AUTH_DEV_LOGIN === "1" && process.env.NODE_ENV !== "production";
}

async function anonymousCookieId(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get(HTUTOR_UID_COOKIE)?.value ?? null;
  } catch {
    return null;
  }
}

async function loginRoleFromCookie(): Promise<LoginRole | null> {
  try {
    const store = await cookies();
    const value = store.get(HTUTOR_LOGIN_ROLE_COOKIE)?.value;
    return isLoginRole(value) ? value : null;
  } catch {
    return null;
  }
}

const providers: NextAuthConfig["providers"] = [];

if (isGoogleAuthConfigured()) {
  providers.push(
    Google({
      clientId: googleId,
      clientSecret: googleSecret,
    }),
  );
}

if (isEmailAuthConfigured()) {
  providers.push(
    Resend({
      apiKey: resendKey,
      from: emailFrom,
    }),
  );
}

if (isDevLoginEnabled()) {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Local student",
      credentials: {
        name: { label: "Name", type: "text" },
      },
      async authorize(credentials) {
        const name =
          typeof credentials?.name === "string" && credentials.name.trim()
            ? credentials.name.trim()
            : "Local student";
        const user = await findOrCreateSignedInUser(
          {
            email: "dev@localhost",
            name,
            emailVerified: new Date(),
          },
          await anonymousCookieId(),
        );
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  );
}

const authConfig = {
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  providers,
  callbacks: {
    async signIn({ user }) {
      if (!user.email && user.id) return true;
      if (!user.email && !isDevLoginEnabled()) return false;
      if (
        user.email &&
        !(await isAdminEmail(user.email)) &&
        !isAllowedLoginEmail(user.email, undefined, await loginRoleFromCookie()) &&
        !(isDevLoginEnabled() && user.email === "dev@localhost")
      ) {
        return false;
      }
      const signedIn = await findOrCreateSignedInUser(
        {
          email: user.email,
          name: user.name,
          image: user.image,
          emailVerified: user.email ? new Date() : null,
        },
        await anonymousCookieId(),
      );
      user.id = signedIn.id;
      user.name = signedIn.name;
      user.image = signedIn.image;
      user.email = signedIn.email;
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.email = typeof token.email === "string" ? token.email : session.user.email;
        session.user.name = typeof token.name === "string" ? token.name : session.user.name;
        session.user.image = typeof token.picture === "string" ? token.picture : session.user.image;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
