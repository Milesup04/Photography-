import express from "express";
import crypto from "node:crypto";
import { createLink, getLink, listLinks, recordVisit, listVisits } from "./db.js";

const app = express();
const PORT = process.env.PORT || 3000;

// Trust the hosting proxy (Render, Railway, Fly, Heroku, nginx, ...) so that
// req.ip reflects the real visitor address from X-Forwarded-For instead of the
// proxy's own address.
app.set("trust proxy", true);
app.use(express.urlencoded({ extended: false }));

// ---- Admin key -------------------------------------------------------------
// Creating links and viewing the dashboard require this key. If you don't set
// one, a random key is generated at startup and printed to the console.
let ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY) {
  ADMIN_KEY = crypto.randomBytes(9).toString("base64url");
  console.log("\n  No ADMIN_KEY set. Generated a temporary one for this run:");
  console.log(`      ADMIN_KEY = ${ADMIN_KEY}`);
  console.log("  Set ADMIN_KEY in your environment to keep it stable.\n");
}

// HTTP Basic Auth for admin routes. Username is ignored; password = ADMIN_KEY.
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString();
    const password = decoded.slice(decoded.indexOf(":") + 1);
    if (
      password.length === ADMIN_KEY.length &&
      crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_KEY))
    ) {
      return next();
    }
  }
  res.set("WWW-Authenticate", 'Basic realm="Visit Logger admin"');
  return res.status(401).send("Authentication required.");
}

// ---- Helpers ---------------------------------------------------------------
const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";
function newCode(len = 7) {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <main>${body}</main>
</body>
</html>`;
}

// Pull the best available client IP. With "trust proxy" on, req.ip already
// resolves X-Forwarded-For; fall back to the socket address just in case.
function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

app.use(express.static("public"));

// ---- Home: create a tracking link (admin) ----------------------------------
app.get("/", requireAdmin, (req, res) => {
  res.send(page("Visit Logger", `
    <h1>Visit Logger</h1>
    <p class="muted">Create a link. Every visit to it is logged with IP address,
    user-agent, time, and referrer, and shown in your dashboard.</p>
    <form method="post" action="/links" class="card">
      <label>Label <span class="muted">(optional, just for you)</span>
        <input name="label" placeholder="e.g. Newsletter link" />
      </label>
      <label>Redirect visitors to <span class="muted">(optional)</span>
        <input name="redirectUrl" type="url" placeholder="https://example.com" />
        <small class="muted">Leave blank to show a simple "visit logged" page instead of redirecting.</small>
      </label>
      <button type="submit">Create link</button>
    </form>
    <p><a href="/dashboard">→ View dashboard</a></p>
  `));
});

app.post("/links", requireAdmin, (req, res) => {
  const label = (req.body.label || "").trim().slice(0, 200);
  let redirectUrl = (req.body.redirectUrl || "").trim().slice(0, 2000);
  if (redirectUrl && !/^https?:\/\//i.test(redirectUrl)) {
    return res.status(400).send(page("Error",
      `<h1>Invalid redirect URL</h1><p>It must start with http:// or https://.</p><p><a href="/">← Back</a></p>`));
  }
  let code;
  do { code = newCode(); } while (getLink(code));
  createLink({ code, label, redirectUrl });
  res.redirect(`/dashboard/${code}`);
});

// ---- Dashboard (admin) -----------------------------------------------------
app.get("/dashboard", requireAdmin, (req, res) => {
  const links = listLinks();
  const rows = links.length
    ? links.map((l) => `
        <tr>
          <td><a href="/dashboard/${esc(l.code)}">${esc(l.label || l.code)}</a></td>
          <td><code>/v/${esc(l.code)}</code></td>
          <td>${l.visitCount}</td>
          <td>${l.redirectUrl ? esc(l.redirectUrl) : '<span class="muted">— (shows logged page)</span>'}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" class="muted">No links yet.</td></tr>`;
  res.send(page("Dashboard", `
    <h1>Dashboard</h1>
    <p><a href="/">＋ Create a new link</a></p>
    <table>
      <thead><tr><th>Label</th><th>Link path</th><th>Visits</th><th>Redirect</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `));
});

app.get("/dashboard/:code", requireAdmin, (req, res) => {
  const link = getLink(req.params.code);
  if (!link) return res.status(404).send(page("Not found", `<h1>Link not found</h1><p><a href="/dashboard">← Dashboard</a></p>`));
  const visits = listVisits(link.code);
  const base = `${req.protocol}://${req.get("host")}`;
  const fullUrl = `${base}/v/${link.code}`;
  const rows = visits.length
    ? visits.map((v) => `
        <tr>
          <td>${esc(new Date(v.createdAt).toLocaleString())}</td>
          <td><code>${esc(v.ip)}</code></td>
          <td class="ua">${esc(v.userAgent)}</td>
          <td>${esc(v.referer || "—")}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" class="muted">No visits recorded yet.</td></tr>`;
  res.send(page(link.label || link.code, `
    <p><a href="/dashboard">← Dashboard</a></p>
    <h1>${esc(link.label || link.code)}</h1>
    <p class="card">Your link: <a href="${esc(fullUrl)}">${esc(fullUrl)}</a>
      <br /><small class="muted">Share this. Every visit appears below.
      ${link.redirectUrl ? `Visitors are redirected to <b>${esc(link.redirectUrl)}</b>.` : "Visitors see a simple confirmation page."}</small></p>
    <table>
      <thead><tr><th>Time</th><th>IP address</th><th>User-agent</th><th>Referrer</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `));
});

// ---- Public visit endpoint -------------------------------------------------
app.get("/v/:code", (req, res) => {
  const link = getLink(req.params.code);
  if (!link) return res.status(404).send(page("Not found", `<h1>Link not found</h1>`));

  recordVisit({
    code: link.code,
    ip: clientIp(req),
    userAgent: req.get("user-agent"),
    referer: req.get("referer"),
  });

  if (link.redirectUrl) return res.redirect(link.redirectUrl);

  res.send(page("Visit logged", `
    <div class="center">
      <h1>✓ Your visit was logged</h1>
      <p class="muted">This link records the time, IP address, and browser of each
      visit for analytics. No further action is needed.</p>
    </div>
  `));
});

app.get("/healthz", (req, res) => res.type("text").send("ok"));

app.listen(PORT, () => {
  console.log(`Visit Logger running on http://localhost:${PORT}`);
  console.log(`  Admin home:  http://localhost:${PORT}/   (Basic auth: any username, password = ADMIN_KEY)`);
});
