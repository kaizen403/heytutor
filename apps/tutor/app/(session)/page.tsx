/**
 * The home board renders from the shared layout and has no URL of its own
 * until the first question. Dynamic so that layout is server-rendered here too
 * rather than bailing out to the client at the `useSearchParams` boundary.
 */
export const dynamic = "force-dynamic";

export default function HomePage() {
  return null;
}
