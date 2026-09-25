import type { Metadata } from "next";
import "./globals.css";
import "./operations.css";
import "./assistant.css";
import "./workspace-design.css";
import "./work-queue.css";
import "./review-workspace.css";
import "./outlook.css";
import "./release-workspace.css";
import "./workspace-shared.css";
import "./ui.css";

export const metadata: Metadata = {
  title: "CargoGuard | Shipping document verification",
  description:
    "Compare shipping instructions and draft bills of lading with traceable evidence and human review. Built for the Averis x Monash Hackathon.",
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
      <body className="antialiased">
        <a className="skip-content" href="#main-content">
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
