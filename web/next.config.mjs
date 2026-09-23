/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    // Product photos uploaded from the admin console live in the Neon object
    // storage bucket; next/image refuses any host that is not listed here.
    remotePatterns: [{ protocol: 'https', hostname: '**.storage.*.aws.neon.tech' }],
  },
  async headers() {
    return [
      {
        // Without an explicit max-age of 0, a cached service worker can pin an
        // old one for hours after a deploy, so a shipped fix never reaches the
        // people already using the app.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=3600' }],
      },
    ];
  },
};

export default nextConfig;
