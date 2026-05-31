import "./styles.css";

export const metadata = {
  title: "OpenRank Arena",
  description: "A closed-arena answer engine optimization benchmark for friends."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
