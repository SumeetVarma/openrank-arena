import { scenarioList } from "../../lib/scenarios.mjs";

export const metadata = {
  title: "Submit · OpenRank Arena",
  description: "Submit your AEO-optimized page for any arena scenario."
};

export default function SubmitPage() {
  return (
    <div className="siteFrame">
      <header className="masthead">
        <div className="mastheadBrand">
          <a href="/" style={{ color: "inherit" }}>OpenRank <em>Arena</em></a>
        </div>
        <nav className="mastheadMeta" aria-label="primary">
          <a href="/#leaderboard">leaderboard</a>
          <a href="/#scenarios">scenarios</a>
          <a href="/#start">join</a>
          <a href="/submit" aria-current="page">submit</a>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">Upload</p>
            <h1 className="heroHeadline">
              Drop your <span className="acc">optimized</span> page.
            </h1>
            <p className="heroLede">
              Pick a scenario, upload a zip. Your page goes live at <code>/players/&lt;name&gt;/&lt;scenario&gt;</code> the
              moment we finish unzipping. Every upload becomes a new version; the latest version is what duels.
              Iterate as often as you want — versions are free.
            </p>
            <div className="heroActions">
              <a className="tlink" href="/#start">Never submitted? Claim a name first →</a>
            </div>
          </div>

          <dl className="heroNumbers">
            <div className="heroNumber">
              <dt>Required in zip</dt>
              <dd style={{ fontFamily: "var(--font-mono)", fontSize: 22 }}>index.html</dd>
            </div>
            <div className="heroNumber">
              <dt>Encouraged</dt>
              <dd style={{ fontFamily: "var(--font-mono)", fontSize: 16, lineHeight: 1.4 }}>
                llms.txt · robots.txt · assets/ · JSON-LD inline
              </dd>
            </div>
          </dl>
        </section>

        <section className="section">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Form</p>
              <h2>New submission.</h2>
            </div>
            <span className="sectionMeta">Multipart upload · ≤10MB zip</span>
          </div>

          <form
            className="formCard"
            action="/api/submit"
            method="post"
            encType="multipart/form-data"
            style={{ maxWidth: 720 }}
          >
            <div className="formField">
              <label className="formLabel" htmlFor="sub-name">Your name</label>
              <input
                id="sub-name"
                name="name"
                required
                placeholder="alice, bob, sumeet…"
                pattern="^[a-zA-Z0-9_-]+$"
              />
              <span className="hint">Becomes your URL slug: /players/&lt;name&gt;</span>
            </div>

            <div className="formField">
              <label className="formLabel" htmlFor="sub-scenario">Scenario</label>
              <select id="sub-scenario" name="scenario" required>
                {scenarioList.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="formField">
              <label className="formLabel" htmlFor="sub-zip">Zip file</label>
              <input id="sub-zip" name="zip" type="file" accept=".zip" required />
              <span className="hint">Must contain index.html at the root. Up to 8 MB.</span>
            </div>

            <hr className="divider" style={{ margin: "8px 0" }} />

            <label className="formCheck">
              <input name="isPasswordProtected" type="checkbox" />
              Lock this version behind a password while iterating
            </label>

            <div className="formField">
              <label className="formLabel" htmlFor="sub-spass">Viewer password (optional)</label>
              <input id="sub-spass" name="submissionPassword" type="password" placeholder="leave blank for open submission" />
            </div>

            <div className="formField">
              <label className="formLabel" htmlFor="sub-note">Iteration note</label>
              <input
                id="sub-note"
                name="note"
                maxLength={280}
                placeholder='What did you try? e.g. "tightened headings, added FAQ section"'
              />
              <span className="hint">Optional · 280 chars max · shown on your profile</span>
            </div>

            <div>
              <button className="btn" type="submit">Upload version</button>
            </div>
          </form>
        </section>

        <section className="section">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">CLI alternative</p>
              <h2>Or just run a command.</h2>
            </div>
            <span className="sectionMeta">harness/submit.mjs</span>
          </div>

          <div style={{ maxWidth: 720 }}>
            <p className="prose" style={{ marginBottom: 16, color: "var(--ink-soft)" }}>
              Your AI assistant can submit for you. From your repo clone:
            </p>
            <pre
              style={{
                background: "var(--paper-deep)",
                padding: "20px 24px",
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                lineHeight: 1.7,
                borderRadius: 2,
                overflowX: "auto",
                border: "1px solid var(--rule)"
              }}
            >
{`ARENA_BASE_URL=https://openrank-arena.vercel.app \\
node harness/submit.mjs \\
  --name alice \\
  --scenario carryon \\
  --dir ./my-page \\
  --note "tightened headings"`}
            </pre>
          </div>
        </section>

        <section className="section">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Zip anatomy</p>
              <h2>What belongs in the upload.</h2>
            </div>
            <span className="sectionMeta">Required + recommended</span>
          </div>
          <div className="explain">
            <div className="explainItem">
              <span className="num">required</span>
              <h4>index.html</h4>
              <p>Real semantic HTML. Headings, copy, JSON-LD inline, meta tags in &lt;head&gt;. We hoist your head tags into the live document head.</p>
            </div>
            <div className="explainItem">
              <span className="num">recommended</span>
              <h4>llms.txt</h4>
              <p>Plain-text AI-crawler summary. Served at <code>/players/&lt;you&gt;/&lt;scenario&gt;/llms.txt</code>.</p>
            </div>
            <div className="explainItem">
              <span className="num">recommended</span>
              <h4>assets/</h4>
              <p>Product photos, illustrations. Referenced as <code>assets/foo.jpg</code> in your HTML. Use real alt text.</p>
            </div>
            <div className="explainItem">
              <span className="num">optional</span>
              <h4>robots.txt</h4>
              <p>If you want per-page crawler control. Otherwise the default permissive robots is served.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="siteFoot">
        <span>OpenRank Arena</span>
        <a className="tlink" href="/">← back to arena</a>
      </footer>
    </div>
  );
}
