const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Same-origin proxy: the browser only ever talks to :3000, so the session cookie
  // is first-party and OAuth callbacks can come back through the dashboard origin.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` },
      // Bull Board needs the session cookie, which lives on this origin.
      { source: '/admin/queues', destination: `${BACKEND_URL}/admin/queues` },
      { source: '/admin/queues/:path*', destination: `${BACKEND_URL}/admin/queues/:path*` },
    ];
  },
  images: { remotePatterns: [{ protocol: 'https', hostname: 'lh3.googleusercontent.com' }] },
};

export default nextConfig;
