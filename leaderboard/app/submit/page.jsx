import { scenarioList } from "../../lib/scenarios.mjs";

export const metadata = {
  title: "Submit to OpenRank Arena",
  description: "Submit your AEO-optimized page for any arena scenario."
};

export default function SubmitPage() {
  return (
    <main>
      <section className="hero">
        <div className="heroCopy">
          <p className="eyebrow">Submit</p>
          <h1>Drop your optimized page.</h1>
          <p>
            Pick a scenario, upload a zip of your page, and your submission goes live at
            <code> /players/&lt;your-name&gt;/&lt;scenario&gt;</code>. Submit as many times as you want — every
            upload becomes a new version and the latest wins on the leaderboard.
          </p>
          <p style={{ marginTop: 12 }}>
            <strong>Never submitted before?</strong>{" "}
            <a href="/#start" style={{ color: "var(--clay-dark)" }}>One-click clone the baseline →</a>{" "}
            or grab a starter zip from a scenario card on the home page.
          </p>
        </div>
      </section>

      <section>
        <div className="sectionHead">
          <div>
            <p className="eyebrow">What to include</p>
            <h2>Zip contents</h2>
          </div>
          <span>at minimum: index.html</span>
        </div>
        <div className="rulesGrid">
          <article>
            <strong>index.html (required)</strong>
            <p>The visible page. Use real semantic HTML, real meta tags, real headings. This is what judges and crawlers read.</p>
          </article>
          <article>
            <strong>llms.txt (recommended)</strong>
            <p>A plain-text summary of the page. Served at <code>/players/&lt;you&gt;/&lt;scenario&gt;/llms.txt</code>.</p>
          </article>
          <article>
            <strong>JSON-LD inside index.html</strong>
            <p>schema.org Product / LocalBusiness / SoftwareApplication. Helps AI engines parse claims.</p>
          </article>
          <article>
            <strong>assets/ folder</strong>
            <p>Images, css, anything else. Served at <code>/players/&lt;you&gt;/&lt;scenario&gt;/assets/&lt;file&gt;</code>. Use alt text.</p>
          </article>
          <article>
            <strong>robots.txt (optional)</strong>
            <p>If you want to control crawlers per-page.</p>
          </article>
          <article>
            <strong>meta.json (optional)</strong>
            <p>Structured metadata if you don't want to embed it in HTML.</p>
          </article>
        </div>
      </section>

      <section>
        <div className="sectionHead">
          <div>
            <p className="eyebrow">Upload</p>
            <h2>New submission</h2>
          </div>
          <span>any number of submissions</span>
        </div>

        <form className="submitForm" action="/api/submit" method="post" encType="multipart/form-data">
          <label>
            Your name (becomes your URL slug)
            <input name="name" required placeholder="e.g. sumeet, alice, bob" pattern="^[a-zA-Z0-9_-]+$" />
          </label>
          <label>
            Scenario
            <select name="scenario" required>
              {scenarioList.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <label>
            Zip file (must contain index.html)
            <input name="zip" type="file" accept=".zip" required />
          </label>
          <label className="checkboxRow">
            <input name="isPasswordProtected" type="checkbox" />
            Password-protect this submission (only viewers with the password see it)
          </label>
          <label>
            Submission password (only if checked above)
            <input name="submissionPassword" type="password" placeholder="optional viewer password" />
          </label>
          <label>
            Note (optional, max 280 chars)
            <input name="note" maxLength={280} placeholder="What did you try? e.g. 'tightened headings, added FAQ section'" />
          </label>
          <button type="submit">Upload submission</button>
        </form>
      </section>
    </main>
  );
}
