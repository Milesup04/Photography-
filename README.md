# 📷 Shutter Mentor

Upload a photo, instantly see the **aperture, ISO, and shutter speed** it was taken with, then get an
AI critique — written in the style of a master photographer — telling you what works and exactly how
to improve, powered by Groq's free API.

## Features

- **Drag & drop or click to upload** a photo from your device — nothing is uploaded to any server except the Groq API call.
- **EXIF reader** shows aperture, ISO, and shutter speed front and center, plus camera, lens, focal length, exposure compensation, flash, and date under "More details".
- **AI critique with vision** — the photo itself *and* its settings are sent to Groq's free `llama-4-scout` vision model, so the feedback is about *your actual image*, not just the numbers.
- **Six mentor styles** to critique through different eyes:
  - 🏔️ **Ansel Adams** — landscapes, deep depth of field, tonal range
  - 🕰️ **Henri Cartier-Bresson** — street, the decisive moment, geometry
  - 🎭 **Annie Leibovitz** — dramatic portraiture and storytelling
  - 🌏 **Steve McCurry** — vivid color, documentary and travel
  - 🖤 **Sebastião Salgado** — epic black & white documentary
  - ◻️ **Modern Minimalist** — negative space, long exposures
- Each critique includes: first impression, what your settings reveal, strengths, **specific settings to try next time**, and a practice assignment.

## Getting started

1. **Get a free Groq API key** at [console.groq.com/keys](https://console.groq.com/keys)
   (sign up is free, no card needed).
2. **Open the app**:
   - Easiest: just open `index.html` in your browser, **or**
   - Serve it locally: `python3 -m http.server 8000` then visit <http://localhost:8000>, **or**
   - Host it free on GitHub Pages (Settings → Pages → deploy from the `main` branch).
3. Paste your key in **step 1** and click **Save** — it's stored only in your browser's localStorage.
4. Upload a photo, pick a mentor style, and click **✨ Get AI Critique**.

## Tips for best results

- Use **original photos straight from your camera or phone**. Screenshots and images sent through
  WhatsApp, Instagram, etc. usually have their EXIF (camera settings) stripped — the AI will still
  critique the image, but it can't read settings that aren't there.
- The photo is downscaled to 1024px in your browser before being sent to the API, so requests stay
  fast and within free-tier limits.

## Tech

Plain HTML/CSS/JS — no build step, no dependencies to install.
[exifr](https://github.com/MikeKovarik/exifr) (bundled as `exifr.umd.js`) reads the EXIF data;
the [Groq API](https://console.groq.com/docs) (`meta-llama/llama-4-scout-17b-16e-instruct`) generates the critique.
