import { GeistSans } from "geist/font/sans";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${GeistSans.variable} admin-theme dark min-h-screen`}>
      {children}
    </div>
  );
}
