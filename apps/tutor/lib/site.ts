export const SITE_NAME = "Accelute";

export const SITE_TAGLINE = "AI whiteboard math tutor";

export const SITE_DESCRIPTION =
  "An AI tutor that draws on a whiteboard and explains out loud — stroke by stroke, in sync. Ask a math or physics question and watch shapes, formulas, and diagrams appear as they're taught.";

export const SITE_KEYWORDS = [
  "AI math tutor",
  "whiteboard tutor",
  "visual math learning",
  "geometry tutor",
  "physics tutor",
  "online tutoring",
  "EdTech",
];

export function getSiteUrl(): URL {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  return new URL(configured.startsWith("http") ? configured : `https://${configured}`);
}

export const siteMetadataBase = getSiteUrl();
