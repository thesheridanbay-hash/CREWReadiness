import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Serve images as-is (no Next optimizer). Generated course/lesson art is
   * served through the authed media proxy (/api/media/[id]); the optimizer's
   * server-side fetch carries no auth cookie and 401s, breaking those images.
   * Our images are icon-sized so optimization adds little, and this also keeps
   * us off the free-tier image-optimization cap.
   */
  images: { unoptimized: true },
  headers: async () => [
    {
      source: "/api/(.*)",
      headers: [
        {
          key: "Access-Control-Allow-Origin",
          value: "*",
        },
        {
          key: "Access-Control-Allow-Methods",
          value: "GET, POST, PUT, DELETE, OPTIONS",
        },
        {
          key: "Access-Control-Allow-Headers",
          value: "Content-Type, Authorization",
        },
        {
          key: "Content-Range",
          value: "bytes : 0-9/*",
        },
      ],
    },
  ],
};

export default nextConfig;
