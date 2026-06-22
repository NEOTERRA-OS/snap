import "./globals.css";

export const metadata = {
  title: "NEOS Snap",
  description: "Beleg- & Spesenerfassung mit Übergabe an ERPNext",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "NEOS Snap" },
};

export const viewport = {
  themeColor: "#2C3C2B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
