import { scenarioList } from "../../lib/scenarios.mjs";

export const metadata = {
  title: "Submit · OpenRank Arena",
  description: "Upload your AEO-optimized page. Becomes a new version instantly."
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
          <a href="/submit" aria-current="page">submit</a>
        </nav>
      </header>

      <main>
        <section className="submitGrid">
          {/* ── Left column: the form ── */}
          <div>
            <p className="heroRibbon">Submit</p>
            <h1 className="submitHeadline">
              Upload your <span className="acc">page</span>.
            </h1>
            <p className="submitLede">
              Zip → upload → live. First upload registers your name. Every upload is a new version. Latest version is what duels.
            </p>

            <form
              className="submitForm2"
              action="/api/submit"
              method="post"
              encType="multipart/form-data"
            >
              <div className="formField">
                <label className="formLabel" htmlFor="sub-name">Your name</label>
                <input
                  id="sub-name"
                  name="name"
                  required
                  placeholder="alice, bob, sumeet…"
                  pattern="^[a-zA-Z0-9_-]+$"
                  autoComplete="off"
                />
              </div>

              <div className="formField">
                <label className="formLabel" htmlFor="sub-scenario">Scenario</label>
                <select id="sub-scenario" name="scenario" required defaultValue="carryon">
                  {scenarioList.map((s) => (
                    <option key={s.id} value={s.id}>{s.label}</option>
                  ))}
                </select>
              </div>

              <div className="formField">
                <label className="formLabel" htmlFor="sub-zip">Zip file</label>
                <input id="sub-zip" name="zip" type="file" accept=".zip" required />
              </div>

              <div className="formField">
                <label className="formLabel" htmlFor="sub-note">Note <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>(optional)</span></label>
                <input
                  id="sub-note"
                  name="note"
                  maxLength={280}
                  placeholder='What did you try?'
                  autoComplete="off"
                />
              </div>

              <details className="submitAdvanced">
                <summary>Advanced</summary>
                <label className="formCheck" style={{ marginTop: 12 }}>
                  <input name="isPasswordProtected" type="checkbox" />
                  Lock this version behind a password
                </label>
                <div className="formField" style={{ marginTop: 8 }}>
                  <input
                    name="submissionPassword"
                    type="password"
                    placeholder="viewer password"
                    autoComplete="off"
                  />
                </div>
              </details>

              <div>
                <button className="btn" type="submit">Upload version</button>
              </div>
            </form>
          </div>

          {/* ── Right column: zip anatomy + CLI ── */}
          <aside className="submitSide">
            <div className="zipPanel">
              <p className="zipPanelTitle">What goes in the zip</p>
              <ul className="zipList">
                <li>
                  <code>index.html</code>
                  <span className="req">required</span>
                  <p>The visible page. Real semantic HTML — headings, copy, JSON-LD inline, meta in &lt;head&gt;.</p>
                </li>
                <li>
                  <code>llms.txt</code>
                  <span className="rec">recommended</span>
                  <p>Plain-text summary for AI crawlers. Served at the page&apos;s URL + /llms.txt.</p>
                </li>
                <li>
                  <code>assets/</code>
                  <span className="rec">recommended</span>
                  <p>Images and any other static files. Reference as <code>assets/foo.jpg</code> in your HTML.</p>
                </li>
                <li>
                  <code>robots.txt</code>
                  <span className="opt">optional</span>
                  <p>Per-page crawler control. Defaults to permissive otherwise.</p>
                </li>
              </ul>
            </div>

            <div className="cliPanel">
              <p className="cliPanelTitle">Or — from your terminal</p>
              <pre>{`node harness/submit.mjs \\
  --name i-forgot-to-update-my-name \\
  --scenario carryon \\
  --dir ./my-page \\
  --note "tightened headings"`}</pre>
              <p className="cliHint">
                Or just tell <span className="em">Claude / Codex</span> &ldquo;submit my page&rdquo;.
              </p>
            </div>
          </aside>
        </section>
      </main>

      <footer className="siteFoot">
        <span>OpenRank Arena</span>
        <a className="tlink" href="/">← back</a>
      </footer>
    </div>
  );
}
