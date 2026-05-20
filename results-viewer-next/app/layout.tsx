import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Child Safety SSH Results Viewer",
  description: "Static benchmark results explorer",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

