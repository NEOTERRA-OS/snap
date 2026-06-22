import "./globals.css";

export const metadata = {
  title: "NEOS Snap",
  description: "Beleg- & Spesenerfassung mit Übergabe an ERPNext",
};

export default function RootLayout({ children }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
