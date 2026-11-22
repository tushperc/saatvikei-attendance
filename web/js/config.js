// Filled in after the backend is deployed (see README).
// API_URL: the Apps Script web app URL ending in /exec. Add ?demo to any page URL to use fake data instead.
// GOOGLE_CLIENT_ID: the OAuth Web client ID used for owner sign-in.
window.APP_CONFIG = {
  API_URL: new URLSearchParams(location.search).has('demo') ? 'mock' : 'https://script.google.com/macros/s/AKfycbzhTrlDqkNsGethjA43141p50FHT3Aovsq3rnc87_71LzEz0AydvN8kTcDgVDC9IpOvRQ/exec',
  GOOGLE_CLIENT_ID: '492099140026-acdaoal2pefo2a9mpr4dm38hh1f068g9.apps.googleusercontent.com',
  FACE_LIB: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.esm.js',
  FACE_MODELS: 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/'
};
