// scanner.js — camera capture that samples an N x N grid of sticker colors.
//
// Size-agnostic: the grid dimension is a parameter, not hard-coded to 2x2. If the
// camera is unavailable or denied, start() returns false and the app falls back
// to manual color entry — the rest of the flow is identical.

export function createScanner({ video, gridN }) {
  let stream = null;
  let track = null;
  let torchOn = false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.muted = true;
      await video.play().catch(() => {});
      track = stream.getVideoTracks()[0] || null;
      torchOn = false;
      return true;
    } catch (err) {
      stream = null;
      track = null;
      return false;
    }
  }

  function stop() {
    if (track && torchOn) {
      // best-effort turn the light off before releasing
      track.applyConstraints({ advanced: [{ torch: false }] }).catch(() => {});
      torchOn = false;
    }
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null;
    }
    track = null;
    video.srcObject = null;
  }

  // Torch / flash is only available on some devices (typically the rear camera
  // on Android). Returns false when unsupported so the UI can hide the control.
  function hasTorch() {
    if (!track || !track.getCapabilities) return false;
    try {
      return track.getCapabilities().torch === true;
    } catch {
      return false;
    }
  }

  async function setTorch(on) {
    if (!track) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] });
      torchOn = on;
      return true;
    } catch {
      return false;
    }
  }

  function isTorchOn() {
    return torchOn;
  }

  // Sample the centered square reticle into gridN*gridN averaged colors, in
  // reading order (row-major). Returns array of [r,g,b] or null if no frame yet.
  function sample() {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    canvas.width = vw;
    canvas.height = vh;
    ctx.drawImage(video, 0, 0, vw, vh);

    // The reticle is a centered square covering 60% of the smaller dimension.
    const side = Math.min(vw, vh) * 0.6;
    const x0 = (vw - side) / 2;
    const y0 = (vh - side) / 2;
    const cell = side / gridN;
    const patch = Math.max(4, Math.floor(cell * 0.4));

    const out = [];
    for (let r = 0; r < gridN; r++) {
      for (let c = 0; c < gridN; c++) {
        const cx = x0 + cell * (c + 0.5);
        const cy = y0 + cell * (r + 0.5);
        const data = ctx.getImageData(
          Math.floor(cx - patch / 2),
          Math.floor(cy - patch / 2),
          patch,
          patch
        ).data;
        let R = 0,
          G = 0,
          B = 0,
          n = 0;
        for (let i = 0; i < data.length; i += 4) {
          R += data[i];
          G += data[i + 1];
          B += data[i + 2];
          n++;
        }
        out.push([Math.round(R / n), Math.round(G / n), Math.round(B / n)]);
      }
    }
    return out;
  }

  function isActive() {
    return !!stream;
  }

  // The active camera's facing mode: 'user' (front / selfie — its preview reads
  // mirrored), 'environment' (rear), or null when unknown. The app uses this to
  // decide whether to mirror the preview and flip the turn guidance.
  function facingMode() {
    if (!track || !track.getSettings) return null;
    try {
      return track.getSettings().facingMode || null;
    } catch {
      return null;
    }
  }

  return { start, stop, sample, isActive, hasTorch, setTorch, isTorchOn, facingMode };
}
