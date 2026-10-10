export const SITE_NAME = "Accelute";

export const SITE_TAGLINE = "AI Whiteboard Tutor for Every Subject";

export const LANDING_PROMPT = "What are you stuck on?";

export const SITE_DESCRIPTION =
  "Ask a question or upload a photo. Accelute teaches maths, physics, chemistry and coding with voice, a live whiteboard, lesson replay and downloadable notes.";

export const SITE_PREVIEW = {
  image: "/og-image-v3.png",
  video: "/preview-v3.mp4",
  width: 1200,
  height: 630,
  imageAlt:
    "The Accelute tutor with its dark sidebar, warm paper whiteboard, handwritten surface-area working, verified square pyramid diagram and question composer",
  videoAlt:
    "Accelute writing a square pyramid surface-area solution on its live whiteboard in the current tutor interface",
} as const;

export const SITE_KEYWORDS = [
  "AI tutor",
  "AI whiteboard tutor",
  "AI math tutor",
  "whiteboard tutor",
  "visual math learning",
  "geometry tutor",
  "physics tutor",
  "chemistry tutor",
  "coding tutor",
  "lesson replay",
  "online tutoring",
  "EdTech",
];

export function getSiteUrl(): URL {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NODE_ENV === "development"
        ? "http://localhost:3000"
        : "https://app.accelute.co");

  return new URL(configured.startsWith("http") ? configured : `https://${configured}`);
}

function getLandingUrl(): URL {
  const configured =
    process.env.NEXT_PUBLIC_LANDING_URL ??
    (process.env.NODE_ENV === "development" ? "http://localhost:5173" : "https://accelute.co");
  return new URL(configured.startsWith("http") ? configured : `https://${configured}`);
}

export function getLegalHref(path: "/terms" | "/privacy"): string {
  return getLandingHref(path);
}

export function getLandingHref(path: string): string {
  return new URL(path, getLandingUrl()).toString();
}

export const siteMetadataBase = getSiteUrl();
