import "./styles.css";
import { Analytics } from "@vercel/analytics/next";

export const metadata = {
  title: "OpenRank Arena · An AEO benchmark",
  description:
    "An Answer Engine Optimization benchmark. Rewrite an underdog page, compete head-to-head against other versions, and an LLM judge picks the winner. Elo ratings track who's actually shipping better AEO.",
  openGraph: {
    title: "OpenRank Arena · An AEO benchmark",
    description:
      "Beat the page ranked #10. Rewrite, tune, schema. Anonymized matches with Elo ratings track who's shipping the best AEO work.",
    type: "website",
    url: "https://openrank-arena.vercel.app"
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenRank Arena",
    description: "An AEO benchmark. Rewrite an underdog page. Beat the rest."
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
