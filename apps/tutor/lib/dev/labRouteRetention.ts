/** Opt-in local lab stability; production and ordinary development retain Next defaults. */
export function labRouteRetention(env: Readonly<Record<string, string | undefined>> = process.env) {
  if (env.NODE_ENV !== "development" || env.LECTURE_LAB_KEEP_ROUTES_HOT !== "1") return undefined;
  return { maxInactiveAge: 3_600_000, pagesBufferLength: 100 };
}
