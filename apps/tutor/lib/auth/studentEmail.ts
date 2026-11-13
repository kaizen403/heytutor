/**
 * A login email is academic when a domain label is exactly `edu` or `ac`
 * (mit.edu, ox.ac.uk, iitb.ac.in, uni.edu.au). `education.com` and Gmail do
 * not pass. Onboarding uses this only to preselect the college card.
 */
export function isStudentEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return false;
  const labels = trimmed
    .slice(at + 1)
    .split(".")
    .filter(Boolean);
  if (labels.length < 2) return false;
  return labels.includes("edu") || labels.includes("ac");
}

/** School and personal accounts both sign in; the role is asked in onboarding. */
export function isAllowedLoginEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  return at > 0 && at < trimmed.length - 1;
}
