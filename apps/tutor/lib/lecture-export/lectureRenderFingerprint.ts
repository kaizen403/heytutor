import { sourceFingerprint } from "@/lib/lecture-export/sourceRenderFingerprint";

/** Next replaces this literal with the exact build's rendering-source SHA256. */
const injected = process.env.NEXT_PUBLIC_LECTURE_RENDER_HASH;
const isHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

// A browser without build injection may still download normally, but cannot
// read/write either memory or IndexedDB cache. There is no reusable fallback key.
export const LECTURE_RENDER_FINGERPRINT: string | null = isHash(injected) ? injected : sourceFingerprint();
export const LECTURE_PAGE_CACHE_REVISION = LECTURE_RENDER_FINGERPRINT ? `render-${LECTURE_RENDER_FINGERPRINT}` : "uncached";
