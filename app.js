/* Shutter Mentor — EXIF reader + Groq AI photo critique */

// ---------------------------------------------------------------------------
// Photographer styles the AI mentor can critique in
// ---------------------------------------------------------------------------
const STYLES = [
  {
    id: "ansel-adams",
    emoji: "🏔️",
    name: "Ansel Adams",
    desc: "Landscape master — dramatic light, deep depth of field, the Zone System.",
    prompt:
      "You critique in the spirit of Ansel Adams: majestic landscapes, maximum sharpness front-to-back " +
      "(think f/8–f/16), tripod-based long exposures at base ISO, rich tonal range from deep shadow to " +
      "bright highlight, and previsualization of the final image. You care deeply about light quality, " +
      "tonal contrast, and technical perfection.",
  },
  {
    id: "cartier-bresson",
    emoji: "🕰️",
    name: "Henri Cartier-Bresson",
    desc: "Street & candid — the decisive moment, geometry, timing over gear.",
    prompt:
      "You critique in the spirit of Henri Cartier-Bresson: the decisive moment, geometry and composition " +
      "above all, unobtrusive candid shooting, modest apertures around f/5.6–f/8 with shutter speeds fast " +
      "enough to freeze life (1/125s+), and a belief that timing and framing matter far more than equipment. " +
      "You dislike heavy cropping and over-processing.",
  },
  {
    id: "annie-leibovitz",
    emoji: "🎭",
    name: "Annie Leibovitz",
    desc: "Portraits — bold concepts, dramatic lighting, storytelling with people.",
    prompt:
      "You critique in the spirit of Annie Leibovitz: dramatic environmental portraiture, deliberate and " +
      "sculpted lighting, wide apertures (f/2–f/4) for subject separation, strong concepts and storytelling, " +
      "and an intimate connection with the subject. You care about how light shapes the face and how the " +
      "environment tells the subject's story.",
  },
  {
    id: "steve-mccurry",
    emoji: "🌏",
    name: "Steve McCurry",
    desc: "Documentary & travel — vivid color, human eyes, cultural storytelling.",
    prompt:
      "You critique in the spirit of Steve McCurry: vivid saturated color, compelling human subjects with " +
      "engaging eyes, cultural and travel storytelling, natural light mastery, apertures around f/2.8–f/5.6 " +
      "to keep the subject sharp with gentle background separation. You look for emotional resonance and " +
      "color harmony.",
  },
  {
    id: "sebastiao-salgado",
    emoji: "🖤",
    name: "Sebastião Salgado",
    desc: "Black & white epic documentary — texture, tone, human dignity.",
    prompt:
      "You critique in the spirit of Sebastião Salgado: epic black-and-white documentary work, dramatic " +
      "skies and textures, strong tonal contrast, wide scenes with deep depth of field, and above all human " +
      "dignity and scale. You evaluate how the image would work in monochrome — tone, texture, and light — " +
      "even if it was shot in color.",
  },
  {
    id: "modern-minimalist",
    emoji: "◻️",
    name: "Modern Minimalist",
    desc: "Fine-art minimalism — negative space, clean lines, long exposures.",
    prompt:
      "You critique as a modern fine-art minimalist (in the tradition of Michael Kenna and Hiroshi Sugimoto): " +
      "negative space, simplicity, clean geometry, long exposures that smooth water and sky (ND filters, " +
      "seconds-long shutter times), low ISO, careful square or balanced compositions, and restrained " +
      "monochrome or muted palettes. You believe less is more.",
  },
];

// Groq vision-capable model (free tier)
const GROQ_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const els = {
  apiKey: document.getElementById("api-key"),
  saveKey: document.getElementById("save-key"),
  keyStatus: document.getElementById("key-status"),
  dropZone: document.getElementById("drop-zone"),
  fileInput: document.getElementById("file-input"),
  resultSection: document.getElementById("result-section"),
  preview: document.getElementById("preview"),
  aperture: document.getElementById("exif-aperture"),
  iso: document.getElementById("exif-iso"),
  shutter: document.getElementById("exif-shutter"),
  camera: document.getElementById("exif-camera"),
  lens: document.getElementById("exif-lens"),
  focal: document.getElementById("exif-focal"),
  ev: document.getElementById("exif-ev"),
  flash: document.getElementById("exif-flash"),
  date: document.getElementById("exif-date"),
  exifWarning: document.getElementById("exif-warning"),
  styleGrid: document.getElementById("style-grid"),
  analyzeBtn: document.getElementById("analyze-btn"),
  aiSection: document.getElementById("ai-section"),
  aiStatus: document.getElementById("ai-status"),
  aiOutput: document.getElementById("ai-output"),
};

let currentFile = null;
let currentExif = null;
let selectedStyle = STYLES[0];

// ---------------------------------------------------------------------------
// API key handling
// ---------------------------------------------------------------------------
function loadKey() {
  const key = localStorage.getItem("groq_api_key") || "";
  if (key) {
    els.apiKey.value = key;
    setKeyStatus("Key loaded from this browser.", true);
  }
}

function setKeyStatus(msg, ok) {
  els.keyStatus.textContent = msg;
  els.keyStatus.className = "key-status " + (ok ? "ok" : "bad");
}

els.saveKey.addEventListener("click", () => {
  const key = els.apiKey.value.trim();
  if (!key) {
    localStorage.removeItem("groq_api_key");
    setKeyStatus("Key cleared.", true);
    return;
  }
  if (!key.startsWith("gsk_")) {
    setKeyStatus("That doesn't look like a Groq key (they start with gsk_).", false);
    return;
  }
  localStorage.setItem("groq_api_key", key);
  setKeyStatus("Key saved in this browser. ✔", true);
});

// ---------------------------------------------------------------------------
// Style picker
// ---------------------------------------------------------------------------
function renderStyles() {
  els.styleGrid.innerHTML = "";
  for (const style of STYLES) {
    const card = document.createElement("div");
    card.className = "style-card" + (style.id === selectedStyle.id ? " selected" : "");
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.innerHTML =
      `<div class="style-name">${style.emoji} ${style.name}</div>` +
      `<div class="style-desc">${style.desc}</div>`;
    const select = () => {
      selectedStyle = style;
      renderStyles();
    };
    card.addEventListener("click", select);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); }
    });
    els.styleGrid.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Upload handling
// ---------------------------------------------------------------------------
els.dropZone.addEventListener("click", () => els.fileInput.click());
els.dropZone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.fileInput.click(); }
});
els.fileInput.addEventListener("change", () => {
  if (els.fileInput.files[0]) handleFile(els.fileInput.files[0]);
});

["dragover", "dragenter"].forEach((evt) =>
  els.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropZone.classList.add("dragover");
  })
);
["dragleave", "drop"].forEach((evt) =>
  els.dropZone.addEventListener(evt, (e) => {
    e.preventDefault();
    els.dropZone.classList.remove("dragover");
  })
);
els.dropZone.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  if (!file.type.startsWith("image/")) {
    alert("Please choose an image file.");
    return;
  }
  currentFile = file;

  // Preview
  els.preview.src = URL.createObjectURL(file);
  els.resultSection.classList.remove("hidden");
  els.aiSection.classList.add("hidden");
  els.aiOutput.innerHTML = "";
  els.resultSection.scrollIntoView({ behavior: "smooth" });

  // EXIF
  currentExif = null;
  try {
    currentExif = await exifr.parse(file, {
      pick: [
        "FNumber", "ISO", "ExposureTime", "ShutterSpeedValue",
        "Make", "Model", "LensModel", "FocalLength",
        "FocalLengthIn35mmFormat", "ExposureCompensation",
        "Flash", "DateTimeOriginal",
      ],
    });
  } catch (err) {
    console.warn("EXIF parse failed:", err);
  }
  showExif(currentExif || {});
}

// ---------------------------------------------------------------------------
// EXIF display
// ---------------------------------------------------------------------------
function formatShutter(exif) {
  let t = exif.ExposureTime;
  if (t == null && exif.ShutterSpeedValue != null) {
    t = Math.pow(2, -exif.ShutterSpeedValue); // APEX value fallback
  }
  if (t == null) return null;
  if (t >= 1) return `${round(t, 1)}s`;
  return `1/${Math.round(1 / t)}s`;
}

function round(n, dp) {
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

function showExif(exif) {
  const aperture = exif.FNumber != null ? `f/${round(exif.FNumber, 1)}` : null;
  const iso = exif.ISO != null ? String(exif.ISO) : null;
  const shutter = formatShutter(exif);

  els.aperture.textContent = aperture || "n/a";
  els.iso.textContent = iso || "n/a";
  els.shutter.textContent = shutter || "n/a";

  els.camera.textContent = [exif.Make, exif.Model].filter(Boolean).join(" ") || "—";
  els.lens.textContent = exif.LensModel || "—";
  els.focal.textContent = exif.FocalLength
    ? `${round(exif.FocalLength, 0)}mm` +
      (exif.FocalLengthIn35mmFormat ? ` (${exif.FocalLengthIn35mmFormat}mm equiv.)` : "")
    : "—";
  els.ev.textContent = exif.ExposureCompensation != null
    ? `${exif.ExposureCompensation > 0 ? "+" : ""}${round(exif.ExposureCompensation, 1)} EV`
    : "—";
  els.flash.textContent = exif.Flash != null
    ? (String(exif.Flash).toLowerCase().includes("fired") && !String(exif.Flash).toLowerCase().includes("did not")
        ? "Fired" : "Did not fire")
    : "—";
  els.date.textContent = exif.DateTimeOriginal
    ? new Date(exif.DateTimeOriginal).toLocaleString()
    : "—";

  if (!aperture && !iso && !shutter) {
    els.exifWarning.textContent =
      "⚠️ No camera settings were found in this photo. Screenshots and images sent through messaging or " +
      "social apps usually have EXIF data stripped. The AI can still critique the image itself.";
    els.exifWarning.classList.remove("hidden");
  } else {
    els.exifWarning.classList.add("hidden");
  }
}

// ---------------------------------------------------------------------------
// Image resize for the API (keeps request small + within Groq limits)
// ---------------------------------------------------------------------------
function fileToResizedDataUrl(file, maxDim = 1024, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read the image for AI analysis."));
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Groq critique
// ---------------------------------------------------------------------------
function buildExifSummary() {
  const e = currentExif || {};
  const parts = [];
  if (e.FNumber != null) parts.push(`Aperture: f/${round(e.FNumber, 1)}`);
  const shutter = formatShutter(e);
  if (shutter) parts.push(`Shutter speed: ${shutter}`);
  if (e.ISO != null) parts.push(`ISO: ${e.ISO}`);
  if (e.FocalLength != null) parts.push(`Focal length: ${round(e.FocalLength, 0)}mm`);
  if (e.ExposureCompensation != null) parts.push(`Exposure compensation: ${round(e.ExposureCompensation, 1)} EV`);
  if (e.Make || e.Model) parts.push(`Camera: ${[e.Make, e.Model].filter(Boolean).join(" ")}`);
  if (e.LensModel) parts.push(`Lens: ${e.LensModel}`);
  return parts.length
    ? parts.join("\n")
    : "No EXIF data available (it may have been stripped). Base your critique on the image alone.";
}

els.analyzeBtn.addEventListener("click", async () => {
  const key = (localStorage.getItem("groq_api_key") || els.apiKey.value.trim());
  if (!key) {
    setKeyStatus("Add your Groq API key first (step 1).", false);
    els.apiKey.focus();
    document.getElementById("key-section").scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (!currentFile) return;

  els.analyzeBtn.disabled = true;
  els.aiSection.classList.remove("hidden");
  els.aiStatus.classList.remove("hidden");
  els.aiOutput.innerHTML = "";
  els.aiOutput.classList.remove("error");
  document.getElementById("ai-heading").textContent =
    `Your Critique — in the style of ${selectedStyle.name}`;

  try {
    const dataUrl = await fileToResizedDataUrl(currentFile);

    const systemPrompt =
      `You are a world-class photography mentor. ${selectedStyle.prompt}\n\n` +
      "You will be shown a photograph and its camera settings (EXIF). Respond in Markdown with exactly " +
      "these sections:\n" +
      "### First Impression\nOne or two sentences reacting to the photo in your persona's voice.\n" +
      "### Reading the Settings\nExplain what the aperture, ISO, and shutter speed used tell you about how " +
      "the photo was made, and whether they suit the scene. If EXIF is missing, estimate what was likely used.\n" +
      "### What Works\n2-3 bullet points on the photo's strengths.\n" +
      "### How to Improve\n3-5 specific, actionable bullet points. Include concrete camera settings to try " +
      "next time (exact aperture, shutter speed, ISO values) consistent with your style.\n" +
      "### Try This Next\nOne short assignment the photographer can shoot this week to practice.\n\n" +
      "Be encouraging but honest, specific rather than generic, and stay in the spirit of your persona " +
      "without impersonating them as a real person.";

    const userText =
      `Here is my photo. Camera settings from EXIF:\n${buildExifSummary()}\n\n` +
      "Please critique it and tell me how to improve.";

    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.7,
        max_tokens: 1200,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const errBody = await res.json();
        if (errBody.error && errBody.error.message) detail = errBody.error.message;
      } catch (_) { /* keep HTTP status */ }
      if (res.status === 401) detail = "Invalid API key — check step 1 and save it again.";
      if (res.status === 429) detail = "Rate limit reached on the free tier — wait a minute and try again.";
      throw new Error(detail);
    }

    const data = await res.json();
    const text = data.choices && data.choices[0] && data.choices[0].message.content;
    if (!text) throw new Error("The AI returned an empty response — please try again.");
    els.aiOutput.innerHTML = renderMarkdown(text);
  } catch (err) {
    els.aiOutput.classList.add("error");
    els.aiOutput.textContent = `Something went wrong: ${err.message}`;
  } finally {
    els.aiStatus.classList.add("hidden");
    els.analyzeBtn.disabled = false;
  }
});

// ---------------------------------------------------------------------------
// Minimal safe Markdown renderer (headings, bold, italics, lists, paragraphs)
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineMd(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|\W)\*(?!\s)(.+?)(?<!\s)\*(?=\W|$)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderMarkdown(md) {
  const lines = escapeHtml(md).split(/\r?\n/);
  let html = "";
  let inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }

    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) {
      closeList();
      html += `<h3>${inlineMd(heading[1])}</h3>`;
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inlineMd(bullet[1])}</li>`;
      continue;
    }

    closeList();
    html += `<p>${inlineMd(line)}</p>`;
  }
  closeList();
  return html;
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
loadKey();
renderStyles();
