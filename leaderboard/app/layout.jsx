import "./styles.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "OpenRank Arena · An AEO benchmark",
  description: "A closed-arena Answer Engine Optimization benchmark for a five-person friend group.",
  openGraph: {
    title: "OpenRank Arena",
    description: "Take an underdog page stuck at #10. Rewrite, tune, schema. Beat your friends in AI-judged duels.",
    type: "website"
  }
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
