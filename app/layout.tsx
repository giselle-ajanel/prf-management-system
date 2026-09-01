import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PRF Command Center",
  description: "Purchase request creation, approval, and finance reporting",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
