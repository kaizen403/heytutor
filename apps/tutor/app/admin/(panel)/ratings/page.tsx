import type { Metadata } from "next";
import { RatingsView } from "@/features/admin/ratings/RatingsView";

export const metadata: Metadata = {
  title: "Ratings · Admin",
};

export default function AdminRatingsPage() {
  return <RatingsView />;
}
