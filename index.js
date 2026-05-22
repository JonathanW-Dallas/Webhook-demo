const express = require("express");
const crypto = require("crypto");

const app = express();

// ─── Config ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const GITHUB_SECRET = process.env.GITHUB_WEBHOOK_SECRET; // set in GitHub webhook settings
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;  // Slack Incoming Webhook URL

// ─── Middleware ─────────────────────────────────────────────────────────────
// Raw body needed for HMAC signature verification
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));

// ─── Signature Verification ──────────────────────────────────────────────────
function verifyGitHubSignature(req) {
  if (!GITHUB_SECRET) return true; // skip if secret not configured (dev mode)
  const sig = req.headers["x-hub-signature-256"];
  if (!sig) return false;
  const hmac = crypto.createHmac("sha256", GITHUB_SECRET);
  hmac.update(req.rawBody);
  const expected = `sha256=${hmac.digest("hex")}`;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// ─── Slack Message Builders ──────────────────────────────────────────────────

function buildPushMessage(payload) {
  const { repository, pusher, commits, ref, compare } = payload;
  const branch = ref.replace("refs/heads/", "");
  const commitLines = commits.slice(0, 5).map(c =>
    `• <${c.url}|${c.id.slice(0, 7)}> ${c.message.split("\n")[0]} — _${c.author.name}_`
  ).join("\n");
  const extra = commits.length > 5 ? `\n_…and ${commits.length - 5} more_` : "";

  return {
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `:arrow_up: *Push to \`${branch}\`* in <${repository.html_url}|${repository.full_name}>` } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*Pushed by*\n${pusher.name}` },
        { type: "mrkdwn", text: `*Commits*\n${commits.length}` },
      ]},
      { type: "section", text: { type: "mrkdwn", text: commitLines + extra } },
      { type: "actions", elements: [
        { type: "button", text: { type: "plain_text", text: "View Diff" }, url: compare }
      ]},
      { type: "divider" }
    ]
  };
}

function buildPRMessage(payload) {
  const { action, pull_request: pr, repository } = payload;
  const actionEmoji = { opened: ":tada:", closed: pr.merged ? ":merged:" : ":x:", reopened: ":recycle:", synchronize: ":arrows_counterclockwise:" };
  const emoji = actionEmoji[action] || ":bell:";
  const status = action === "closed" && pr.merged ? "merged" : action;

  return {
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${emoji} *PR ${status}:* <${pr.html_url}|${pr.title}>` } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*Repo*\n<${repository.html_url}|${repository.full_name}>` },
        { type: "mrkdwn", text: `*Author*\n<${pr.user.html_url}|${pr.user.login}>` },
        { type: "mrkdwn", text: `*Branch*\n\`${pr.head.ref}\` → \`${pr.base.ref}\`` },
        { type: "mrkdwn", text: `*Changes*\n+${pr.additions} / -${pr.deletions}` },
      ]},
      pr.body ? { type: "section", text: { type: "mrkdwn", text: `_${pr.body.slice(0, 200)}${pr.body.length > 200 ? "…" : ""}_` } } : null,
      { type: "actions", elements: [
        { type: "button", text: { type: "plain_text", text: "Open PR" }, url: pr.html_url }
      ]},
      { type: "divider" }
    ].filter(Boolean)
  };
}

function buildIssueMessage(payload) {
  const { action, issue, repository } = payload;
  const actionEmoji = { opened: ":bug:", closed: ":white_check_mark:", reopened: ":recycle:", labeled: ":label:" };
  const emoji = actionEmoji[action] || ":bell:";
  const labels = issue.labels.map(l => `\`${l.name}\``).join(" ") || "_none_";

  return {
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: `${emoji} *Issue ${action}:* <${issue.html_url}|${issue.title}>` } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*Repo*\n<${repository.html_url}|${repository.full_name}>` },
        { type: "mrkdwn", text: `*Opened by*\n<${issue.user.html_url}|${issue.user.login}>` },
        { type: "mrkdwn", text: `*Labels*\n${labels}` },
        { type: "mrkdwn", text: `*#*\n${issue.number}` },
      ]},
      issue.body ? { type: "section", text: { type: "mrkdwn", text: `_${issue.body.slice(0, 200)}${issue.body.length > 200 ? "…" : ""}_` } } : null,
      { type: "actions", elements: [
        { type: "button", text: { type: "plain_text", text: "View Issue" }, url: issue.html_url }
      ]},
      { type: "divider" }
    ].filter(Boolean)
  };
}

// ─── Slack Sender ────────────────────────────────────────────────────────────
async function sendToSlack(message) {
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Slack error ${res.status}: ${text}`);
  }
}

// ─── Webhook Route ───────────────────────────────────────────────────────────
app.post("/webhook/github", async (req, res) => {
  // 1. Verify signature
  if (!verifyGitHubSignature(req)) {
    console.warn("Invalid GitHub signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = req.headers["x-github-event"];
  const payload = req.body;
  let message;

  try {
    // 2. Build the right Slack message
    if (event === "push") {
      if (!payload.commits?.length) return res.status(200).send("ok"); // ignore empty pushes
      message = buildPushMessage(payload);
    } else if (event === "pull_request") {
      message = buildPRMessage(payload);
    } else if (event === "issues") {
      message = buildIssueMessage(payload);
    } else {
      // Unknown event — acknowledge and skip
      return res.status(200).json({ message: `Event '${event}' ignored` });
    }

    // 3. Send to Slack
    await sendToSlack(message);
    console.log(`✓ Forwarded '${event}' to Slack`);
    res.status(200).json({ ok: true, event });
  } catch (err) {
    console.error("Error handling webhook:", err);
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(PORT, () => console.log(`GitHub→Slack webhook listening on :${PORT}`));
