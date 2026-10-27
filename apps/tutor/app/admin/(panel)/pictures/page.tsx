import type { Metadata } from "next";
import { PicturesView } from "@/features/admin/pictures/PicturesView";

export const metadata: Metadata = {
  title: "Pictures · Admin",
};

export default function AdminPicturesPage() {
  return <PicturesView />;
}
