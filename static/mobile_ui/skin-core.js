/* skin-core.js
 * RUNOVA - Skin analysis core
 * No mocked values. No estimates. No smoothing.
 * All metrics returned are exactly what the YouCam API (via /youcam/analyze) returns.
 */

(function () {
    'use strict';
  
    const NS = (window.__RUNOVA__ = window.__RUNOVA__ || {});
  
    function stripDataUrlPrefix(dataUrl) {
      if (typeof dataUrl !== 'string') return null;
      const comma = dataUrl.indexOf(',');
      return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
    }
  
    function assertString(name, v) {
      if (typeof v !== 'string' || !v.trim()) {
        throw new Error(`BLOCKED: missing ${name}`);
      }
    }
  
    async function fetchJson(url, options) {
      const res = await fetch(url, options);
      const text = await res.text();
      let json;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`YouCam proxy returned non-JSON: ${text.slice(0, 200)}`);
      }
      if (!res.ok) {
        const msg = (json && (json.error || json.message)) || `HTTP ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.payload = json;
        throw err;
      }
      return json;
    }
  
    /**
     * Analyze an image via backend proxy (recommended).
     * Backend contract (app.py): POST /youcam/analyze JSON { image_base64: "<base64>" }
     * Response: { success: true, metrics: <raw_youcam_result> }
     */
    async function analyzeYouCamByBase64(imageBase64) {
      assertString('image_base64', imageBase64);
      const base64 = stripDataUrlPrefix(imageBase64);
  
      const data = await fetchJson('/youcam/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64 })
      });
  
      if (!data || data.success !== true) {
        throw new Error((data && (data.error || data.message)) || 'YouCam analyze failed');
      }
  
      // IMPORTANT: Return raw metrics as-is (no mapping, no guesses).
      return data.metrics;
    }
  
    /**
     * Capture a DOM element (video/img/canvas) into a JPEG dataURL, then analyze.
     * Returns raw YouCam result object.
     */
    async function analyzeYouCamFromElement(element, { jpegQuality = 0.92, maxWidth = 1024 } = {}) {
      if (!element) throw new Error('BLOCKED: missing element');
  
      let dataUrl;
  
      if (element instanceof HTMLCanvasElement) {
        dataUrl = element.toDataURL('image/jpeg', jpegQuality);
      } else {
        // video or img: draw onto canvas
        const w =
          element.videoWidth ||
          element.naturalWidth ||
          element.width ||
          element.clientWidth ||
          0;
        const h =
          element.videoHeight ||
          element.naturalHeight ||
          element.height ||
          element.clientHeight ||
          0;
  
        if (!w || !h) throw new Error('BLOCKED: missing element dimensions');
  
        const scale = w > maxWidth ? maxWidth / w : 1;
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
  
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (!ctx) throw new Error('BLOCKED: missing 2d context');
  
        ctx.drawImage(element, 0, 0, cw, ch);
        dataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
      }
  
      return analyzeYouCamByBase64(dataUrl);
    }
  
    /**
     * Utility: resolve a value from YouCam raw result without inventing structure.
     * - If the path exists, returns its value.
     * - Otherwise returns null.
     */
    function getPath(obj, path) {
      if (!obj || typeof obj !== 'object') return null;
      if (!path) return null;
      const parts = Array.isArray(path) ? path : String(path).split('.').filter(Boolean);
      let cur = obj;
      for (const p of parts) {
        if (cur && typeof cur === 'object' && p in cur) cur = cur[p];
        else return null;
      }
      return cur;
    }
  
    // Public API
    NS.skinCore = {
      analyzeYouCamByBase64,
      analyzeYouCamFromElement,
      getPath
    };
  })();
  