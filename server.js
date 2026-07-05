import express from "express";
import crypto from "node:crypto";
import { createLink, getLink, listLinks, recordVisit, updateVisitGeo, listVisits } from "./db.js";

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

// Best-effort device/OS/browser description from the user-agent string.
// (A device's *personal* name, e.g. "Miles's iPhone", is never exposed to a
// website by any browser, so it cannot be shown.)
function parseDevice(ua) {
  if (!ua) return { icon: "❔", label: "Unknown" };
  let os = null, device = null, browser = null, icon = "💻";

  if (/iPhone/.test(ua)) { device = "iPhone"; os = "iOS"; icon = "📱"; }
  else if (/iPad/.test(ua)) { device = "iPad"; os = "iPadOS"; icon = "📱"; }
  else if (/Android/.test(ua)) {
    os = "Android"; icon = /Mobile/.test(ua) ? "📱" : "📱";
    const m = ua.match(/Android[^;]*;\s*([^;)]+?)\s*(?:Build|\))/);
    if (m && m[1] && !/^wv$/i.test(m[1].trim())) device = m[1].trim();
  }
  else if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X/.test(ua)) { os = "macOS"; icon = "🖥️"; }
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\//.test(ua) || /Opera/.test(ua)) browser = "Opera";
  else if (/SamsungBrowser/.test(ua)) browser = "Samsung Internet";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  const label = [device, os, browser].filter(Boolean).join(" · ") || "Unknown device";
  return { icon, label };
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

// Private / loopback / reserved addresses can't be geolocated.
function isPrivateIp(ip) {
  if (!ip) return true;
  const v = ip.replace(/^::ffff:/i, "");
  return (
    v === "::1" ||
    /^127\./.test(v) ||
    /^10\./.test(v) ||
    /^192\.168\./.test(v) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v) ||
    /^169\.254\./.test(v) ||
    /^f[cd]/i.test(v) ||
    v === "unknown"
  );
}

// Approximate location from IP via a free, keyless service (city/region/country
// level — this is standard analytics data, not a precise address). Best-effort:
// returns null on any failure so a visit is still logged without location.
async function lookupGeo(ip) {
  if (isPrivateIp(ip)) return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "visit-logger" },
    });
    clearTimeout(timer);
    const j = await res.json();
    if (!j || j.success === false) return null;
    return {
      city: j.city || null,
      region: j.region || null,
      country: j.country || null,
      isp: j.connection?.isp || j.connection?.org || null,
    };
  } catch {
    return null;
  }
}

// Optional global webhook that receives every visit (in addition to any
// per-link webhook). Handy if you want all links reporting to one place.
const GLOBAL_WEBHOOK = process.env.WEBHOOK_URL || null;

// POST a visit to a webhook URL. Formats a readable message for Discord and
// Slack; sends a plain JSON payload to anything else. Best-effort.
async function sendWebhook(url, visit) {
  if (!url) return;
  const location = [visit.city, visit.region, visit.country].filter(Boolean).join(", ") || "unknown";
  const text = [
    `New visit on "${visit.label || visit.code}"`,
    `Time: ${visit.time}`,
    `IP: ${visit.ip}`,
    `Location: ${location}${visit.isp ? ` (${visit.isp})` : ""}`,
    `Device: ${visit.device}`,
    `Referrer: ${visit.referer || "—"}`,
  ].join("\n");

  let body;
  if (/discord(app)?\.com\/api\/webhooks/i.test(url)) body = { content: text };
  else if (/hooks\.slack\.com/i.test(url)) body = { text };
  else body = { event: "visit", location, ...visit };

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
  } catch {
    // Best-effort; a failed webhook never affects the visitor.
  }
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
      <label>Webhook URL <span class="muted">(optional)</span>
        <input name="webhookUrl" type="url" placeholder="https://discord.com/api/webhooks/..." />
        <small class="muted">Each visit is also POSTed here as it happens. Works with Discord, Slack, or your own server.</small>
      </label>
      <button type="submit">Create link</button>
    </form>
    <p><a href="/dashboard">→ View dashboard</a></p>
  `));
});

app.post("/links", requireAdmin, (req, res) => {
  const label = (req.body.label || "").trim().slice(0, 200);
  const redirectUrl = (req.body.redirectUrl || "").trim().slice(0, 2000);
  const webhookUrl = (req.body.webhookUrl || "").trim().slice(0, 2000);
  if (redirectUrl && !/^https?:\/\//i.test(redirectUrl)) {
    return res.status(400).send(page("Error",
      `<h1>Invalid redirect URL</h1><p>It must start with http:// or https://.</p><p><a href="/">← Back</a></p>`));
  }
  if (webhookUrl && !/^https?:\/\//i.test(webhookUrl)) {
    return res.status(400).send(page("Error",
      `<h1>Invalid webhook URL</h1><p>It must start with http:// or https://.</p><p><a href="/">← Back</a></p>`));
  }
  let code;
  do { code = newCode(); } while (getLink(code));
  createLink({ code, label, redirectUrl, webhookUrl });
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
  const location = (v) => {
    const parts = [v.city, v.region, v.country].filter(Boolean);
    if (!parts.length) return '<span class="muted">—</span>';
    let out = esc(parts.join(", "));
    if (v.isp) out += `<br /><small class="muted">${esc(v.isp)}</small>`;
    return out;
  };
  const rows = visits.length
    ? visits.map((v) => {
        const d = parseDevice(v.userAgent);
        return `
        <tr>
          <td>${esc(new Date(v.createdAt).toLocaleString())}</td>
          <td><code>${esc(v.ip)}</code></td>
          <td>${location(v)}</td>
          <td title="${esc(v.userAgent || "")}">${d.icon} ${esc(d.label)}</td>
          <td>${esc(v.referer || "—")}</td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="5" class="muted">No visits recorded yet.</td></tr>`;
  res.send(page(link.label || link.code, `
    <p><a href="/dashboard">← Dashboard</a></p>
    <h1>${esc(link.label || link.code)}</h1>
    <p class="card">Your link: <a href="${esc(fullUrl)}">${esc(fullUrl)}</a>
      <br /><small class="muted">Share this. Every visit appears below.
      ${link.redirectUrl ? `Visitors are redirected to <b>${esc(link.redirectUrl)}</b>.` : "Visitors see a simple confirmation page."}</small></p>
    <table>
      <thead><tr><th>Time</th><th>IP address</th><th>Location</th><th>Device</th><th>Referrer</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `));
});

// ---- Public visit endpoint -------------------------------------------------
app.get("/v/:code", (req, res) => {
  const link = getLink(req.params.code);
  if (!link) return res.status(404).send(page("Not found", `<h1>Link not found</h1>`));

  const ip = clientIp(req);
  const userAgent = req.get("user-agent");
  const referer = req.get("referer");
  const visitId = recordVisit({ code: link.code, ip, userAgent, referer });

  // Resolve location, then fire any webhooks — all in the background so nothing
  // delays the visitor's redirect.
  (async () => {
    const geo = (await lookupGeo(ip)) || {};
    if (geo.city || geo.region || geo.country || geo.isp) updateVisitGeo(visitId, geo);
    const payload = {
      code: link.code,
      label: link.label,
      time: new Date().toISOString(),
      ip,
      city: geo.city || null,
      region: geo.region || null,
      country: geo.country || null,
      isp: geo.isp || null,
      device: parseDevice(userAgent).label,
      userAgent: userAgent || null,
      referer: referer || null,
    };
    if (link.webhookUrl) await sendWebhook(link.webhookUrl, payload);
    if (GLOBAL_WEBHOOK && GLOBAL_WEBHOOK !== link.webhookUrl) await sendWebhook(GLOBAL_WEBHOOK, payload);
  })().catch(() => {});

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
