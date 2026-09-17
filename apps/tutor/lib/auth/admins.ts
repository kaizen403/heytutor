import { prisma } from "@/lib/db/prisma";
import { isStaffEmail, normalizeEmail } from "./staff";

export async function isAdminEmail(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const normalized = normalizeEmail(email);
  if (isStaffEmail(normalized)) return true;
  const row = await prisma.admin.findUnique({
    where: { email: normalized },
    select: { email: true },
  });
  return row != null;
}
