import type { NextConfig } from 'next';

/**
 * Security headers for every page (PRD §25.2). A Content-Security-Policy is left to the reverse
 * proxy, where the final API and web domains are known (docs/DEPLOYMENT.md §7).
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // The camera is used to scan invoices from a phone browser; nothing else is allowed.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  /**
   * Optional same-origin proxy: with API_PROXY_TARGET set (e.g. https://kavach-api.onrender.com),
   * the browser calls /kapi/... on the web app's own domain, so the SameSite=Strict refresh
   * cookie works without a shared custom domain. Pair with NEXT_PUBLIC_API_URL=/kapi and
   * COOKIE_PATH=/kapi/auth on the API.
   */
  async rewrites() {
    const target = process.env.API_PROXY_TARGET?.replace(/\/$/, '');
    return target ? [{ source: '/kapi/:path*', destination: `${target}/:path*` }] : [];
  },
};

export default nextConfig;
