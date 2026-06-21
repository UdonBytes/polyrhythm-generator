# Polyrhythm Generator

A static HTML, CSS, and JavaScript polyrhythm editor built for Netlify. It uses the Web Audio API for live playback and client-side WAV export, with no build step or package installation required.

## Run locally

Serve the repository root with any static server. For example:

```text
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Deploy on Netlify

Connect this repository to Netlify and leave the build command blank. The included `netlify.toml` publishes the repository root and supplies basic security headers.
