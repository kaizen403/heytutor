import { Suspense } from "react";
import { TutorSessionPage } from "@/features/tutor-session";

/**
 * Shared by `/` and `/c/{id}`. Holding the session here is what lets the home
 * board claim its URL mid-lesson: the layout outlives the page swap, so the
 * whiteboard, audio, and the turn in flight all survive the move to `/c/{id}`.
 *
 * The boundary is for `useSearchParams` (`?q=`, `?replay=1`, `?embed=1`); both
 * routes render dynamically, so it never actually falls back.
 */
export default function SessionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <TutorSessionPage />
      </Suspense>
      {children}
    </>
  );
}
