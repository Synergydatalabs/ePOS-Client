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
      // 2026-10-09: iframe-embed support for the public pay / embed routes.
      // Partners (e.g. Korean merchants embedding our KakaoPay checkout on
      // their own site) need these pages served from indianbeans.com inside
      // an <iframe> on their domain. Default Next.js sends X-Frame-Options:
      // SAMEORIGIN which blocks cross-origin embedding — override to allow
      // ANY ancestor. (frame-ancestors * is intentionally permissive here;
      // if a specific merchant allowlist is ever required, swap the wildcard
      // for a space-separated list of their domains.)
      {
        source: '/l/:slug*',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: 'frame-ancestors *;' },
        ],
      },
      {
        source: '/pay/invoice/:id*',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: 'frame-ancestors *;' },
        ],
      },
      {
        source: '/pay/embed/:id*',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: 'frame-ancestors *;' },
        ],
      },
      {
        source: '/paddle-checkout',
        headers: [
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
          { key: 'Content-Security-Policy', value: 'frame-ancestors *;' },
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
