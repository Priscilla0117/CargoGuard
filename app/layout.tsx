import type { Metadata } from "next";
import "./globals.css";
import "./operations.css";

export const metadata: Metadata = {
  title: "CargoGuard | Shipping document verification",
  description: "Compare shipping instructions and draft bills of lading with traceable evidence and human review. Built for the Averis x Monash Hackathon.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
