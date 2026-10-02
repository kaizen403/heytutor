const LANDING_FRAME_ORIGINS = ["https://accelute.co", "https://www.accelute.co"];

function landingOrigins(env: NodeJS.ProcessEnv): string[] {
  const origins = new Set<string>(LANDING_FRAME_ORIGINS);
  const configured = env.NEXT_PUBLIC_LANDING_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (["https:", "http:"].includes(url.protocol)) origins.add(url.origin);
    } catch {
      /* ignore unparseable landing URL */
    }
  }
  if (env.NODE_ENV !== "production") {
    origins.add("http://localhost:5173");
  }
  return [...origins];
}

function frameAncestors(env: NodeJS.ProcessEnv): string {
  return `frame-ancestors 'self' ${landingOrigins(env).join(" ")}`;
}

/** Next.js receives the same per-request nonce as the response policy. */
export function contentSecurityPolicy(env: NodeJS.ProcessEnv = process.env, nonce?: string): string {
  // Next's dev runtime evaluates the react-refresh bundle. Production stays closed.
  const scriptSrc =
    env.NODE_ENV === "production"
      ? `script-src 'self'${nonce ? ` 'nonce-${nonce}' 'strict-dynamic'` : ""} https://checkout.razorpay.com`
      : "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // Google sign-in stores the avatar on *.googleusercontent.com. Without
    // that host the sidebar/profile <img> is blocked and renders as an empty ring.
    "img-src 'self' data: blob: https://*.googleusercontent.com https://*.ggpht.com",
    "font-src 'self'",
    // blob: and data: are the lecture clips still held in this tab. Replay
    // plays them through media-src; the download reads the same URLs with
    // fetch, which is connect-src. Without them here the file is silence.
    // Browser errors post to this origin's /monitoring tunnel, so Sentry's
    // ingest host stays off connect-src.
    `connect-src 'self' blob: data: https://api.razorpay.com https://checkout.razorpay.com ${landingOrigins(env).map(origin => `${origin}/api/region`).join(" ")}`,
    "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com",
    // data: covers the tiny unlock/silence WAV used to start WebAudio.
    "media-src 'self' blob: data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    frameAncestors(env),
  ].join("; ");
}

export function securityHeaderEntries(
  env: NodeJS.ProcessEnv = process.env,
  nonce?: string,
): Array<{ key: string; value: string }> {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env, nonce) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=(), usb=()" },
  ];
}

export function applySecurityHeaders(
  headers: { set(name: string, value: string): void },
  env: NodeJS.ProcessEnv = process.env,
  nonce?: string,
): void {
  for (const { key, value } of securityHeaderEntries(env, nonce)) {
    headers.set(key, value);
  }
}
