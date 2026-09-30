import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  env: {
    CALDUN_BUILD_COMMIT: process.env.COMMIT_REF || process.env.GITHUB_SHA || 'local',
    CALDUN_BUILD_BRANCH: process.env.BRANCH || process.env.GITHUB_REF_NAME || 'local',
  },
};

export default nextConfig;
