/** Display label for a user: name, then email, then a short id. */
export function userLabel(input: {
  userId: string;
  name: string | null;
  email: string | null;
}): string {
  const name = input.name?.trim();
  if (name) return name;
  if (input.email) return input.email;
  return input.userId.slice(0, 8);
}
