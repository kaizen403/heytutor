const LANDING_FRAME_ORIGINS = ["https://accelute.co", "https://www.accelute.co"];

function frameAncestors(env: NodeJS.ProcessEnv = process.env): string {
  const origins = new Set<string>(["'self'", ...LANDING_FRAME_ORIGINS]);
  const configured = env.NEXT_PUBLIC_LANDING_URL?.trim();
  if (configured) {
    try {
      origins.add(new URL(configured).origin);
    } catch {
      /* ignore unparseable landing URL */
    }
  }
  if (env.NODE_ENV !== "production") {
    origins.add("http://localhost:5173");
  }
  return `frame-ancestors ${[...origins].join(" ")}`;
}

/**
 * CSP is deliberately compatible with Next.js inline bootstrapping and the
 * JSON-LD script in `app/layout.tsx`. Framing is limited to this origin plus
 * the public landing site (the `?embed=1` showcase).
 */
export function contentSecurityPolicy(env: NodeJS.ProcessEnv = process.env): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    frameAncestors(env),
  ].join("; ");
}

export function securityHeaderEntries(
  env: NodeJS.ProcessEnv = process.env,
): Array<{ key: string; value: string }> {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self), payment=(), usb=()" },
  ];
}

export function applySecurityHeaders(
  headers: { set(name: string, value: string): void },
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const { key, value } of securityHeaderEntries(env)) {
    headers.set(key, value);
  }
}
