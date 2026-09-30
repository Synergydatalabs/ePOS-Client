/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  typescript: {
    ignoreBuildErrors: true,
  },

  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },

  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },

  // Phase F #6e (2026-08-27): stale-bookmark redirects. Login is unified at
  // /partner/login — signup too, at /partner/signup — but users may have
  // saved role-flavoured URLs from earlier iterations. Rather than 404 them,
  // 308 them to the canonical route. Permanent + preserves method so a form
  // POST wouldn't drop the body (unlikely, but free correctness).
  async redirects() {
    return [
      { source: "/supplier/login",  destination: "/partner/login",  permanent: true },
      { source: "/supplier/signin", destination: "/partner/login",  permanent: true },
      { source: "/supplier/signup", destination: "/partner/signup", permanent: true },
      { source: "/business/login",  destination: "/partner/login",  permanent: true },
      { source: "/business/signin", destination: "/partner/login",  permanent: true },
      { source: "/business/signup", destination: "/partner/signup", permanent: true },
      // /merchant/* — some older docs referenced this term.
      { source: "/merchant/login",  destination: "/partner/login",  permanent: true },
      { source: "/merchant/signup", destination: "/partner/signup", permanent: true },
    ];
  },

  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
        ],
      },
    ];
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.s3.*.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: '*.cloudfront.net',
      },
    ],
  },

  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,

  compiler: {
    removeConsole: process.env.NODE_ENV === 'production'
      ? { exclude: ['error', 'warn'] }
      : false,
  },
};

export default nextConfig;
