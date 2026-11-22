// On-device face check. Nothing here records video: the camera preview stays on the
// phone; only one still photo and a 128-number face "fingerprint" are sent.
// (No blink/liveness step: the owner sees every punch photo on Telegram instead.)
let faceapi = null;
let loading = null;
let stream = null;
export let simulated = false; // true only in mock/demo mode when no camera is available

export function loadModels() {
  if (loading) return loading;
  loading = (async () => {
    faceapi = await import(window.APP_CONFIG.FACE_LIB);
    const url = window.APP_CONFIG.FACE_MODELS;
    await faceapi.tf.setBackend('webgl').catch(() => faceapi.tf.setBackend('cpu'));
    await faceapi.tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(url),
      faceapi.nets.faceLandmark68Net.loadFromUri(url),
      faceapi.nets.faceRecognitionNet.loadFromUri(url)
    ]);
    return faceapi;
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

export async function startCamera(video, { allowSimulated = false } = {}) {
  simulated = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false
    });
  } catch (err) {
    if (allowSimulated) { simulated = true; return; }
    if (err && err.name === 'NotAllowedError') throw new Error('Camera permission is blocked. Allow camera access for this site in the phone settings.');
    throw new Error('Could not open the front camera.');
  }
  video.setAttribute('playsinline', '');
  video.muted = true;
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
}

export function stopCamera(video) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
}

/**
 * Watches the live preview and reports whether exactly one face is in the oval.
 * Used only to guide the person and enable the "Take photo" button.
 * Returns a stop() function.
 */
export function watchFace(video, onStatus) {
  let stopped = false;
  if (simulated) {
    onStatus({ faces: 1, centred: true });
    return () => { stopped = true; };
  }
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });
  const loop = async () => {
    if (stopped) return;
    try {
      const found = await faceapi.detectAllFaces(video, opts);
      if (stopped) return;
      onStatus({ faces: found.length, centred: found.length === 1 && isCentred(found[0].box, video) });
    } catch (e) { /* skip frame */ }
    setTimeout(loop, 150);
  };
  loop();
  return () => { stopped = true; };
}

function isCentred(box, video) {
  const w = video.videoWidth, h = video.videoHeight;
  const cx = (box.x + box.width / 2) / w, cy = (box.y + box.height / 2) / h;
  return box.width / w > 0.18 && cx > 0.2 && cx < 0.8 && cy > 0.15 && cy < 0.85;
}

/** Photo only (no face library needed). Returns a small JPEG data URL. */
export function capturePhoto(video) {
  if (simulated) {
    const c = document.createElement('canvas');
    c.width = 360; c.height = 480;
    const g = c.getContext('2d');
    g.fillStyle = '#6b5a4a'; g.fillRect(0, 0, c.width, c.height);
    g.font = '160px serif'; g.textAlign = 'center'; g.fillText('🙂', 180, 300);
    return c.toDataURL('image/jpeg', 0.7);
  }
  const scale = Math.min(1, 480 / video.videoWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * scale); c.height = Math.round(video.videoHeight * scale);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.75);
}

/** Takes one still photo, and computes the face fingerprint from it. */
export async function capture(video) {
  if (simulated) {
    const c = document.createElement('canvas');
    c.width = 360; c.height = 480;
    const g = c.getContext('2d');
    g.fillStyle = '#6b5a4a'; g.fillRect(0, 0, c.width, c.height);
    g.font = '160px serif'; g.textAlign = 'center'; g.fillText('🙂', 180, 300);
    const base = Array.from({ length: 128 }, (_, i) => Math.sin(i) * 0.1);
    return { photo: c.toDataURL('image/jpeg', 0.7), descriptor: base, faces: 1 };
  }
  const full = document.createElement('canvas');
  full.width = video.videoWidth; full.height = video.videoHeight;
  full.getContext('2d').drawImage(video, 0, 0);
  const all = await faceapi.detectAllFaces(full, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 }))
    .withFaceLandmarks().withFaceDescriptors();
  // Small JPEG for the record (about 30–50 KB)
  const scale = Math.min(1, 480 / full.width);
  const small = document.createElement('canvas');
  small.width = Math.round(full.width * scale); small.height = Math.round(full.height * scale);
  small.getContext('2d').drawImage(full, 0, 0, small.width, small.height);
  const photo = small.toDataURL('image/jpeg', 0.75);
  if (all.length !== 1) return { photo, descriptor: null, faces: all.length };
  return { photo, descriptor: Array.from(all[0].descriptor).map((x) => Math.round(x * 1e5) / 1e5), faces: 1 };
}
