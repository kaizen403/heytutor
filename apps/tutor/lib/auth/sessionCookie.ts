export function hasAuthSessionCookie(request: { cookies: { get(name: string): { value: string } | undefined } }): boolean {
  return Boolean(
    request.cookies.get("authjs.session-token")?.value ||
      request.cookies.get("__Secure-authjs.session-token")?.value,
  );
}
