// Claude CLI provider — uses the local `claude` binary via its non-interactive
// mode (`claude -p`). No API key required; uses whatever account the user is
// signed into. Falls back to `claude --print` for older builds. Stdin is the
// prompt; stdout is the model's reply.

import { spawn } from "node:child_process";

export async function call({ prompt, model, maxTokens }) {
  // The CLI ignores maxTokens; we just leave it. Model can be passed via
  // CLAUDE_CLI_MODEL or the --model flag if the user wants a non-default.
  const args = ["-p"];
  const envModel = model || process.env.CLAUDE_CLI_MODEL;
  if (envModel) args.push("--model", envModel);

  return new Promise((resolve, reject) => {
    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (b) => { stdout += b.toString(); });
    proc.stderr.on("data", (b) => { stderr += b.toString(); });
    proc.on("error", (err) => {
      if (err.code === "ENOENT") {
        reject(new Error("`claude` CLI not found in PATH. Install Claude Code or run with --provider anthropic + ANTHROPIC_API_KEY."));
      } else {
        reject(err);
      }
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr.trim().slice(0, 400)}`));
        return;
      }
      resolve({ text: stdout, model: envModel || "claude-cli", raw: { stdout, stderr } });
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}
