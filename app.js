const TRACK_TYPES = [
  { id: "high", name: "High woodblock", short: "High", sample: "assets/woodblock_high.wav", color: "#59a7ff", defaultBeats: 2, gain: 1 },
  { id: "low", name: "Low woodblock", short: "Low", sample: "assets/woodblock_low.wav", color: "#ff665e", defaultBeats: 3, gain: 1 },
  { id: "tambourine", name: "Tambourine", short: "Tamb.", sample: "assets/tambourine.wav", color: "#f4c84a", defaultBeats: 4, gain: 1.35 },
  { id: "hihat", name: "Open hi-hat", short: "Hi-hat", sample: "assets/hihat_open.wav", color: "#61d69a", defaultBeats: 5, gain: 1 },
];

const state = {
  bpm: 120,
  tracks: TRACK_TYPES.slice(0, 2).map(makeTrack),
  view: "timeline",
  guides: 0,
  playing: false,
  startedAt: 0,
  pausedAt: 0,
  nextMeasureAt: 0,
};

let audioContext;
let masterGain;
let sampleBuffers = new Map();
let activeSources = new Set();
let scheduledEvents = new Map();
let schedulerTimer;
let animationFrame;

const elements = {
  tempo: document.querySelector("#tempo"),
  tempoOutput: document.querySelector("#tempo-output"),
  play: document.querySelector("#play-button"),
  addTrack: document.querySelector("#add-track"),
  visualization: document.querySelector("#visualization"),
  download: document.querySelector("#download-button"),
};

function makeTrack(type) {
  return { ...type, beats: type.defaultBeats, volume: 1, muted: Array(type.defaultBeats).fill(false) };
}

function measureSeconds() {
  return 4 * 60 / state.bpm;
}

function updateTempoDisplay() {
  elements.tempoOutput.textContent = `${state.bpm} BPM`;
  const percent = (state.bpm - 40) / 200 * 100;
  elements.tempo.style.background = `linear-gradient(90deg, var(--accent) ${percent}%, #333946 ${percent}%)`;
}

function setTempoPreservingPhase(bpm) {
  const oldDuration = measureSeconds();
  const now = audioContext?.currentTime ?? 0;
  const position = state.playing
    ? Math.max(0, now - state.startedAt) % oldDuration
    : state.pausedAt % oldDuration;
  const phase = oldDuration ? position / oldDuration : 0;

  state.bpm = bpm;
  const newDuration = measureSeconds();
  state.pausedAt = phase * newDuration;
  if (state.playing) {
    state.startedAt = now - state.pausedAt;
    cancelFutureScheduledEvents(now);
    scheduler();
  }
  updateTempoDisplay();
  updateVisualization();
}

function setBeatCount(track, count) {
  track.beats = Math.max(1, Math.min(32, count));
  track.muted = Array(track.beats).fill(false);
  renderAll();
  restartIfPlaying();
}

function applyTypedBeatCount(input) {
  const track = state.tracks[Number(input.dataset.beatInput)];
  if (!track) return;
  const candidate = input.value.trim();
  const value = Number(candidate);
  const isValid = /^\d+$/.test(candidate) && Number.isInteger(value) && value >= 1 && value <= 32;

  if (!isValid) {
    input.value = track.beats;
    input.setAttribute("aria-invalid", "true");
    return;
  }

  input.removeAttribute("aria-invalid");
  if (value !== track.beats) setBeatCount(track, value);
}

function renderVisualization() {
  elements.visualization.innerHTML = state.view === "timeline" ? timelineMarkup() : clockMarkup();
  elements.addTrack.hidden = state.tracks.length === TRACK_TYPES.length;
  updateVisualization();
}

function trackHeaderMarkup(track, trackIndex) {
  return `<div class="inline-track-head">
      <span class="track-dot"></span>
      <strong class="track-name">${track.name}</strong>
      <button class="reset-track" data-reset="${trackIndex}" type="button" ${track.muted.some(Boolean) ? "" : "disabled"} aria-label="Reset muted beats for ${track.name}">Reset mutes</button>
      ${state.tracks.length > 1 ? `<button class="remove-track" type="button" data-remove="${trackIndex}" aria-label="Remove ${track.name}">✕</button>` : ""}
    </div>`;
}

function trackControlRowMarkup(track, trackIndex) {
  return `<div class="inline-control-row">
      <span class="mini-label">Beats</span>
      <div class="stepper">
        <button type="button" data-step="-1" data-track-index="${trackIndex}" aria-label="Decrease ${track.name} beats">−</button>
        <input class="beat-number-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${track.beats}" data-beat-input="${trackIndex}" aria-label="${track.name} beat count">
        <button type="button" data-step="1" data-track-index="${trackIndex}" aria-label="Increase ${track.name} beats">＋</button>
      </div>
      <label class="volume-control"><span class="mini-label">Vol</span><input type="range" min="0" max="100" value="${Math.round(track.volume * 100)}" data-volume="${trackIndex}" aria-label="${track.name} volume"></label>
    </div>`;
}

function trackControlsMarkup(track, trackIndex) {
  return `<div class="inline-track-controls" style="--track-color:${track.color}">${trackHeaderMarkup(track, trackIndex)}${trackControlRowMarkup(track, trackIndex)}</div>`;
}

function panelControlRowMarkup(track, trackIndex) {
  return `<div class="panel-control-row" style="--track-color:${track.color}">
    <div class="control-track-name"><span class="track-dot"></span><strong>${track.name}</strong></div>
    <div class="control-beats"><span class="mini-label">Beats</span><div class="stepper">
      <button type="button" data-step="-1" data-track-index="${trackIndex}" aria-label="Decrease ${track.name} beats">−</button>
      <input class="beat-number-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${track.beats}" data-beat-input="${trackIndex}" aria-label="${track.name} beat count">
      <button type="button" data-step="1" data-track-index="${trackIndex}" aria-label="Increase ${track.name} beats">＋</button>
    </div></div>
    <label class="volume-control"><span class="mini-label">Vol</span><input type="range" min="0" max="100" value="${Math.round(track.volume * 100)}" data-volume="${trackIndex}" aria-label="${track.name} volume"></label>
    <button class="reset-track" data-reset="${trackIndex}" type="button" ${track.muted.some(Boolean) ? "" : "disabled"} aria-label="Reset muted beats for ${track.name}">Reset mutes</button>
    ${state.tracks.length > 1 ? `<button class="remove-track" type="button" data-remove="${trackIndex}" aria-label="Remove ${track.name}">✕</button>` : ""}
  </div>`;
}

function timelineMarkup() {
  const sharedGuides = state.guides > 0
    ? Array.from({ length: state.guides - 1 }, (_, i) => `<i class="shared-guide" style="left:${(i + 1) / state.guides * 100}%"></i>`).join("")
    : "";
  return `<div class="timeline">
    <div class="timeline-map">
      <div class="playhead-lane"><i class="shared-start-boundary"></i>${sharedGuides}<i class="shared-playhead"></i></div>
      ${state.tracks.map(track => `<article class="timeline-row" style="--track-color:${track.color}">
        <div class="timeline-track-label"><span class="track-dot"></span><strong>${track.name}</strong></div>
        <div class="timeline-rail">${track.muted.map((muted, i) => `<button class="beat-marker ${i === 0 ? "downbeat" : ""} ${muted ? "muted" : ""}" data-marker="${track.id}-${i}" data-map-track="${track.id}" data-map-beat="${i}" style="left:${i / track.beats * 100}%" type="button" aria-pressed="${muted}" aria-label="${muted ? "Unmute" : "Mute"} ${track.name} beat ${i + 1}" title="${muted ? "Unmute" : "Mute"} beat ${i + 1}"></button>`).join("")}</div>
      </article>`).join("")}
    </div>
    <div class="track-controls-panel" aria-label="Track controls">${state.tracks.map(panelControlRowMarkup).join("")}</div>
  </div>`;
}

function polar(angle, radius) {
  const radians = (angle - 90) * Math.PI / 180;
  return [150 + Math.cos(radians) * radius, 150 + Math.sin(radians) * radius];
}

function clockMarkup() {
  const radii = state.tracks.length === 2 ? [82, 122] : state.tracks.length === 3 ? [62, 92, 122] : [48, 73, 98, 123];
  const guideLines = Array.from({ length: state.guides }, (_, i) => {
    const [x, y] = polar(i * 360 / state.guides, 132);
    return `<line class="clock-guide" x1="150" y1="150" x2="${x}" y2="${y}"/>`;
  }).join("");
  return `<div class="clock-layout"><div class="clock-track-list">${state.tracks.map((track, trackIndex) => trackControlsMarkup(track, trackIndex)).join("")}</div><svg class="clock" viewBox="0 0 300 300" role="img" aria-label="Animated polyrhythm clock">
    ${guideLines}
    ${state.tracks.map((track, trackIndex) => `<circle class="clock-ring" cx="150" cy="150" r="${radii[trackIndex]}"/>${track.muted.map((muted, beatIndex) => {
      const angle = beatIndex * 360 / track.beats;
      const [x1, y1] = polar(angle, radii[trackIndex] - 9);
      const [x2, y2] = polar(angle, radii[trackIndex] + 9);
      return `<g class="clock-beat" data-map-track="${track.id}" data-map-beat="${beatIndex}" role="button" tabindex="0" aria-pressed="${muted}" aria-label="${muted ? "Unmute" : "Mute"} ${track.name} beat ${beatIndex + 1}">
        <line class="clock-hit" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>
        <line class="clock-tick ${muted ? "muted" : ""}" data-marker="${track.id}-${beatIndex}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${track.color}"/>
      </g>`;
    }).join("")}`).join("")}
    <line id="clock-hand" class="clock-hand" x1="150" y1="150" x2="150" y2="16"/>
    <circle class="clock-center" cx="150" cy="150" r="5"/>
  </svg></div>`;
}

function renderAll() {
  updateTempoDisplay();
  renderVisualization();
}

async function prepareAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.58;
    masterGain.connect(audioContext.destination);
  }
  if (sampleBuffers.size === TRACK_TYPES.length + 1) return;
  const samples = [...TRACK_TYPES.map(track => [track.id, track.sample]), ["downbeat", "assets/downbeat.wav"]];
  await Promise.all(samples.map(async ([id, url]) => {
    if (sampleBuffers.has(id)) return;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url}`);
    sampleBuffers.set(id, await audioContext.decodeAudioData(await response.arrayBuffer()));
  }));
}

function playSample(id, time, gainValue = 1) {
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  source.buffer = sampleBuffers.get(id);
  gain.gain.value = gainValue;
  source.connect(gain).connect(masterGain);
  activeSources.add(source);
  source.addEventListener("ended", () => activeSources.delete(source), { once: true });
  source.start(time);
  return source;
}

function scheduleAudioEvent(key, sampleId, time, gainValue, details) {
  if (scheduledEvents.has(key)) return;
  const source = playSample(sampleId, time, gainValue);
  const event = { source, time, ...details };
  scheduledEvents.set(key, event);
  source.addEventListener("ended", () => {
    if (scheduledEvents.get(key)?.source === source) scheduledEvents.delete(key);
  }, { once: true });
}

function scheduler() {
  if (!state.playing || !audioContext) return;
  const now = audioContext.currentTime;
  const horizon = now + .1;
  const duration = measureSeconds();
  const firstMeasure = Math.max(0, Math.floor((now - state.startedAt) / duration));
  const lastMeasure = Math.max(firstMeasure, Math.floor((horizon - state.startedAt) / duration));

  scheduledEvents.forEach((event, key) => {
    if (event.time < now - .25) scheduledEvents.delete(key);
  });

  for (let measureIndex = firstMeasure; measureIndex <= lastMeasure; measureIndex++) {
    const measureStart = state.startedAt + measureIndex * duration;
    if (measureStart >= now && measureStart <= horizon && state.tracks.some(track => !track.muted[0])) {
      scheduleAudioEvent(`downbeat:${measureIndex}`, "downbeat", measureStart, 1.6, { type: "downbeat" });
    }
    state.tracks.forEach(track => {
      track.muted.forEach((muted, beatIndex) => {
        const beatTime = measureStart + beatIndex * duration / track.beats;
        if (!muted && beatTime >= now && beatTime <= horizon) {
          scheduleAudioEvent(
            `beat:${measureIndex}:${track.id}:${track.beats}:${beatIndex}`,
            track.id,
            beatTime,
            track.gain * track.volume,
            { type: "beat", trackId: track.id, beatIndex },
          );
        }
      });
    });
  }
}

async function startPlayback(offset = 0) {
  try {
    elements.play.disabled = true;
    await prepareAudio();
    // Keep the gesture call synchronous; some browsers delay the resume promise
    // while a tab is backgrounded even though scheduled audio is still accepted.
    audioContext.resume().catch(error => console.warn("Audio context could not resume yet.", error));
    const now = audioContext.currentTime + .06;
    state.startedAt = now - offset;
    state.playing = true;
    state.pausedAt = offset;
    scheduledEvents.clear();
    clearInterval(schedulerTimer);
    scheduler();
    schedulerTimer = setInterval(scheduler, 25);
    elements.play.classList.add("playing");
    elements.play.querySelector(".play-label").textContent = "Pause";
    animate();
  } catch (error) {
    console.error(error);
    alert("The percussion samples could not be loaded. Try refreshing the page.");
  } finally {
    elements.play.disabled = false;
  }
}

function pausePlayback() {
  state.pausedAt = Math.max(0, audioContext.currentTime - state.startedAt) % measureSeconds();
  state.playing = false;
  clearInterval(schedulerTimer);
  cancelAnimationFrame(animationFrame);
  activeSources.forEach(source => {
    try { source.stop(); } catch (error) { /* The source already ended. */ }
  });
  activeSources.clear();
  scheduledEvents.clear();
  elements.play.classList.remove("playing");
  elements.play.querySelector(".play-label").textContent = "Play";
  updateVisualization();
}

function restartIfPlaying() {
  if (!state.playing) return;
  pausePlayback();
  state.pausedAt = 0;
  startPlayback();
}

function refreshPlaybackAtCurrentPosition() {
  if (!state.playing) return;
  const position = playbackPosition();
  pausePlayback();
  state.pausedAt = position;
  startPlayback(position);
}

function toggleMutedBeat(trackId, beatIndex) {
  const track = state.tracks.find(item => item.id === trackId);
  if (!track || beatIndex < 0 || beatIndex >= track.beats) return;
  track.muted[beatIndex] = !track.muted[beatIndex];
  updateMuteMarkerVisual(track, beatIndex);
  if (!state.playing) return;
  if (track.muted[beatIndex]) cancelScheduledBeat(track.id, beatIndex);
  scheduler();
}

function updateMuteMarkerVisual(track, beatIndex) {
  const muted = track.muted[beatIndex];
  const interactive = elements.visualization.querySelector(`[data-map-track="${track.id}"][data-map-beat="${beatIndex}"]`);
  const marker = elements.visualization.querySelector(`[data-marker="${track.id}-${beatIndex}"]`);
  marker?.classList.toggle("muted", muted);
  interactive?.setAttribute("aria-pressed", String(muted));
  interactive?.setAttribute("aria-label", `${muted ? "Unmute" : "Mute"} ${track.name} beat ${beatIndex + 1}`);
  interactive?.setAttribute("title", `${muted ? "Unmute" : "Mute"} beat ${beatIndex + 1}`);
  const reset = elements.visualization.querySelector(`[data-reset="${state.tracks.indexOf(track)}"]`);
  if (reset) reset.disabled = !track.muted.some(Boolean);
}

function cancelScheduledBeat(trackId, beatIndex) {
  const now = audioContext.currentTime;
  scheduledEvents.forEach((event, key) => {
    const isMutedBeat = event.type === "beat" && event.trackId === trackId && event.beatIndex === beatIndex;
    const isUnusedDownbeat = beatIndex === 0 && event.type === "downbeat" && !state.tracks.some(track => !track.muted[0]);
    if ((isMutedBeat || isUnusedDownbeat) && event.time > now) {
      try { event.source.stop(); } catch (error) { /* The source already ended. */ }
      scheduledEvents.delete(key);
    }
  });
}

function cancelFutureScheduledEvents(now) {
  scheduledEvents.forEach((event, key) => {
    if (event.time > now) {
      try { event.source.stop(); } catch (error) { /* The source already ended. */ }
      scheduledEvents.delete(key);
    }
  });
}

function playbackPosition() {
  if (!state.playing || !audioContext) return state.pausedAt;
  return Math.max(0, audioContext.currentTime - state.startedAt) % measureSeconds();
}

function updateVisualization() {
  const duration = measureSeconds();
  const position = playbackPosition();
  const progress = duration ? position / duration : 0;
  const playhead = document.querySelector(".shared-playhead");
  if (playhead) playhead.style.left = `${progress * 100}%`;
  const hand = document.querySelector("#clock-hand");
  if (hand) hand.style.transform = `rotate(${progress * 360}deg)`;

  document.querySelectorAll("[data-marker]").forEach(marker => marker.classList.remove("active"));
  if (!state.playing) return;
  state.tracks.forEach(track => {
    track.muted.forEach((muted, index) => {
      const beatPosition = index * duration / track.beats;
      const distance = Math.abs(position - beatPosition);
      const wrapped = Math.min(distance, duration - distance);
      if (!muted && wrapped < Math.min(.07, duration / track.beats / 3)) {
        document.querySelector(`[data-marker="${track.id}-${index}"]`)?.classList.add("active");
      }
    });
  });
}

function animate() {
  updateVisualization();
  if (state.playing) animationFrame = requestAnimationFrame(animate);
}

async function exportWav() {
  const oldLabel = elements.download.textContent;
  elements.download.disabled = true;
  elements.download.textContent = "Rendering…";
  try {
    await prepareAudio();
    const sampleRate = 44100;
    const loops = 4;
    const duration = measureSeconds();
    const totalFrames = Math.ceil(duration * loops * sampleRate);
    const offline = new OfflineAudioContext(1, totalFrames, sampleRate);
    const outputGain = offline.createGain();
    outputGain.gain.value = .58;
    outputGain.connect(offline.destination);
    const add = (buffer, when, gainValue) => {
      const source = offline.createBufferSource();
      const gain = offline.createGain();
      source.buffer = buffer;
      gain.gain.value = gainValue;
      source.connect(gain).connect(outputGain);
      source.start(when);
    };
    for (let loop = 0; loop < loops; loop++) {
      const start = loop * duration;
      if (state.tracks.some(track => !track.muted[0])) add(sampleBuffers.get("downbeat"), start, 1.6);
      state.tracks.forEach(track => track.muted.forEach((muted, index) => {
        if (!muted) add(sampleBuffers.get(track.id), start + index * duration / track.beats, track.gain * track.volume);
      }));
    }
    const rendered = await offline.startRendering();
    const blob = encodeWav(rendered.getChannelData(0), sampleRate);
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `polyrhythm-${state.tracks.map(track => track.beats).join("x")}-${state.bpm}bpm.wav`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } catch (error) {
    console.error(error);
    alert("The WAV could not be rendered. Please try again.");
  } finally {
    elements.download.disabled = false;
    elements.download.textContent = oldLabel;
  }
}

function encodeWav(samples, sampleRate) {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const scale = peak > .8 ? .8 / peak : 1;
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE");
  write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample * scale)) * 0x7fff, true));
  return new Blob([buffer], { type: "audio/wav" });
}

elements.tempo.addEventListener("input", event => {
  setTempoPreservingPhase(Number(event.target.value));
});
elements.play.addEventListener("click", () => state.playing ? pausePlayback() : startPlayback(state.pausedAt));
elements.addTrack.addEventListener("click", () => {
  const next = TRACK_TYPES.find(type => !state.tracks.some(track => track.id === type.id));
  if (next) state.tracks.push(makeTrack(next));
  renderAll();
  restartIfPlaying();
});
elements.download.addEventListener("click", exportWav);

elements.visualization.addEventListener("click", event => {
  const target = event.target.closest("button");
  if (target?.dataset.step) {
    const track = state.tracks[Number(target.dataset.trackIndex)];
    setBeatCount(track, track.beats + Number(target.dataset.step));
    return;
  } else if (target?.dataset.reset !== undefined) {
    const track = state.tracks[Number(target.dataset.reset)];
    track.muted.fill(false);
    track.muted.forEach((_, beatIndex) => updateMuteMarkerVisual(track, beatIndex));
    if (state.playing) scheduler();
    return;
  } else if (target?.dataset.remove !== undefined) {
    state.tracks.splice(Number(target.dataset.remove), 1);
    renderAll(); restartIfPlaying();
    return;
  }
  const marker = event.target.closest("[data-map-track]");
  if (!marker) return;
  toggleMutedBeat(marker.dataset.mapTrack, Number(marker.dataset.mapBeat));
});

elements.visualization.addEventListener("input", event => {
  if (event.target.dataset.beatInput !== undefined) {
    event.target.removeAttribute("aria-invalid");
    return;
  }
  if (event.target.dataset.volume === undefined) return;
  state.tracks[Number(event.target.dataset.volume)].volume = Number(event.target.value) / 100;
});

elements.visualization.addEventListener("change", event => {
  if (event.target.dataset.beatInput !== undefined) {
    applyTypedBeatCount(event.target);
    return;
  }
  if (event.target.dataset.volume !== undefined) refreshPlaybackAtCurrentPosition();
});

elements.visualization.addEventListener("focusout", event => {
  if (event.target.dataset.beatInput !== undefined) applyTypedBeatCount(event.target);
});

elements.visualization.addEventListener("keydown", event => {
  if (event.target.dataset.beatInput !== undefined) {
    if (event.key === "Enter") {
      event.preventDefault();
      applyTypedBeatCount(event.target);
    }
    return;
  }
  if (event.key !== "Enter" && event.key !== " ") return;
  const marker = event.target.closest("[data-map-track]");
  if (!marker) return;
  event.preventDefault();
  toggleMutedBeat(marker.dataset.mapTrack, Number(marker.dataset.mapBeat));
});

document.querySelectorAll(".view-button").forEach(button => button.addEventListener("click", () => {
  state.view = button.dataset.view;
  document.querySelectorAll(".view-button").forEach(item => item.classList.toggle("active", item === button));
  renderVisualization();
}));
document.querySelectorAll(".guide-button").forEach(button => button.addEventListener("click", () => {
  state.guides = Number(button.dataset.guides);
  document.querySelectorAll(".guide-button").forEach(item => item.classList.toggle("active", item === button));
  renderVisualization();
}));

renderAll();
