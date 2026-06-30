/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // HTML-Dokument nie cachen → neue Deploys erscheinen sofort.
        // Die gehashten /_next/static-Assets bleiben unverändert lange cachebar.
        source: "/",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
        ],
      },
    ];
  },
};
export default nextConfig;
