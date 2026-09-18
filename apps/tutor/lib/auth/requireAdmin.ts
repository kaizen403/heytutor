import { auth } from "@/auth";
import { isAuthDisabled } from "@/lib/authDisabled";
import { isAdminEmail } from "./admins";

/** Same gate as `/admin`: open when auth is off, otherwise staff/admins only. */
export async function requireAdminRequest(): Promise<Response | null> {
  if (isAuthDisabled()) {
    return null;
  }
  const session = await auth();
  if (!(await isAdminEmail(session?.user?.email))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
