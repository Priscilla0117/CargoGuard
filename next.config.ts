import type { NextConfig } from "next";
import { outlookFraming } from "./lib/microsoft-manifest";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@libsql/client", "libsql", "unpdf"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
      {
        source: "/((?!outlook/?$).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
      {
        source: "/outlook",
        headers: outlookFraming(process.env.CARGO_MS_ADDIN_ENABLED === "true"),
      },
    ];
  },
};

export default nextConfig;
