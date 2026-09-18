import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Lesson videos are uploaded via a Server Action; raise the default
      // body limit so a real (if modest) video file doesn't get rejected.
      // A production deployment behind a real object-storage provider would
      // instead upload directly to that provider and skip the app server.
      bodySizeLimit: "500mb",
    },
  },
};

export default nextConfig;
