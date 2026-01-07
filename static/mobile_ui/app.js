/* ============================================================
   // NOTE: Camera is used as invisible input only (no UI preview)
app.js (FIXED)
   - Critical fix: rewritten startLiveAnalysis() to remove the
     "Missing catch or finally after try" fatal syntax error.
   - No API keys needed. No backend changes here.
   ============================================================ */

   (() => {
    // ---------- ORIGINAL FILE CONTENT START ----------
    // NOTE: Everything below is your original file, except the
    // startLiveAnalysis() block which was rewritten cleanly.
    // ----------
    
    // If your file had "use strict" keep it if present
    // 'use strict';
    
    // ---- (BEGIN: original content) ----
    // (The easiest and safest approach here is to keep the original file as-is,
    //  and only replace the broken function block. So below I paste the full
    //  corrected file content generated from your uploaded app.js.)
    
    // ======= ORIGINAL CONTENT FROM YOUR UPLOADED FILE =======
    
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let analyzingNow = false;
    let voiceAllowed = true;
    let currentAudio = null;
    
    // Flags
    let analysisTriggered = false;
    let analysisStarted = false;
    
    // UI helpers
    function showLoading(show) {
      const spinner = document.getElementById("loadingSpinner");
      if (!spinner) return;
      spinner.style.display = show ? "flex" : "none";
    }
    
    // Validation message helpers (used by live analysis)
    function showValidationMessage(message, blocking = false) {
    // disabled: no visible error UI allowed
    return;
    
      const el = document.getElementById("validationMessage");
      if (!el) return;
      el.textContent = message || "";
      el.style.display = message ? "block" : "none";
      el.dataset.blocking = blocking ? "1" : "0";
    }
    
    function hideValidationMessage() {
    return;
    
      const el = document.getElementById("validationMessage");
      if (!el) return;
      el.textContent = "";
      el.style.display = "none";
      el.dataset.blocking = "0";
    }
    
    // Audio controls
    function stopCurrentAudio() {
      try {
        if (currentAudio) {
          currentAudio.pause();
          currentAudio.currentTime = 0;
          currentAudio = null;
        }
      } catch (e) {}
    }
    
    function playVoice(url) {
      // IMPORTANT: Check voiceAllowed before playing
      if (!voiceAllowed) {
        console.log("🔇 Voice blocked (restart)");
        analyzingNow = false;
        return;
      }
    
      stopCurrentAudio();
    
      const audio = new Audio(url);
      currentAudio = audio;
    
      audio.onended = () => {
        analyzingNow = false;
        currentAudio = null;
      };
    
      audio.onerror = (e) => {
        console.error("🔊 Audio playback error:", e);
        analyzingNow = false;
        currentAudio = null;
      };
    
      audio.play().catch((e) => {
        console.error("🔊 Audio play() rejected:", e);
        analyzingNow = false;
        currentAudio = null;
      });
    }
    
    // Recording
    window.startRecording = async function startRecording() {
      if (isRecording) return;
    
      try {
        let audioStream = null;
    
        // Try to reuse audio track from camera stream
        const cam = document.getElementById("cam");
        if (cam && cam.srcObject) {
          const existingStream = cam.srcObject;
          const audioTracks = existingStream.getAudioTracks();
          if (audioTracks.length > 0 && audioTracks[0].readyState === "live") {
            console.log("✅ Reusing audio track from camera stream");
            audioStream = new MediaStream([audioTracks[0]]);
          }
        }
    
        // If no reused stream — request mic
        if (!audioStream) {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const micTracks = micStream.getAudioTracks();
          audioStream = new MediaStream(micTracks);
        }
    
        mediaRecorder = new MediaRecorder(audioStream);
        audioChunks = [];
    
        mediaRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            audioChunks.push(event.data);
          }
        };
    
        mediaRecorder.onstop = async () => {
          const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
          await sendAudioToBackend(audioBlob);
        };
    
        mediaRecorder.start();
        isRecording = true;
        window.isRecording = true;
    
        console.log("🎤 Recording started");
      } catch (e) {
        console.error("🔥 startRecording crashed:", e);
        isRecording = false;
        window.isRecording = false;
      }
    };
    
    window.stopRecording = function stopRecording() {
      if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        window.isRecording = false;
        console.log("🛑 Recording stopped");
      }
    };
    
    async function sendAudioToBackend(audioBlob) {
      showLoading(true);
    
      try {
        const formData = new FormData();
        formData.append("audio", audioBlob, "voice.webm");
    
        const response = await fetch("/analyze-audio", {
          method: "POST",
          body: formData,
        });
    
        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }
    
        const data = await response.json();
    
        // Render assistant response
        if (data && data.reply) {
          const el = document.getElementById("responseText");
          if (el) el.textContent = data.reply;
        }
    
        // Product recommendations
        if (data && data.recommendations) {
          const cleanedRecommendations = cleanRecommendationsForUI(data.recommendations);
          if (typeof productManager !== "undefined" && productManager) {
            pm.addProducts(cleanedRecommendations);
          } else {
            console.error("❌ productManager is not defined! Available:", {
              windowProductManager: typeof window.productManager,
              globalProductManager: typeof productManager,
            });
          }
        } else {
          console.log("ℹ️ No recommendations in response - clearing products");
          if (typeof productManager !== "undefined" && productManager) {
            productManager.clear();
          }
        }
      } catch (error) {
        console.error("❌ Backend error:", error);
      } finally {
        showLoading(false);
      }
    }
    
    async function askRunova(question) {
      showLoading(true);
    
      try {
        const response = await fetch("/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: question,
            context: window.memory?.getAllData() || {},
          }),
        });
    
        if (!response.ok) {
          throw new Error(`Server error: ${response.status}`);
        }
    
        const data = await response.json();
    
        if (data && data.reply) {
          const el = document.getElementById("responseText");
          if (el) el.textContent = data.reply;
        }
    
        if (data && data.audio_url) {
          playAudio(data.audio_url);
        } else {
          console.warn("⚠️ No audio_url from ElevenLabs - audio will not play");
        }
      } catch (error) {
        console.error("❌ Backend error:", error);
      } finally {
        showLoading(false);
      }
    }
    
    function playAudio(audioUrl) {
      console.log("🎵 playAudio called with:", audioUrl);
    
      if (!voiceAllowed) {
        console.log("🔇 Voice blocked (restart)");
        analyzingNow = false;
        return;
      }
    
      const fullUrl = audioUrl.startsWith("http") ? audioUrl : `${window.location.origin}${audioUrl}`;
      console.log("🔗 Full audio URL:", fullUrl);
      playVoice(fullUrl);
    }
    
    function playElevenLabsAudio(audio_url) {
      if (!voiceAllowed) {
        console.log("🔇 Voice blocked (restart)");
        analyzingNow = false;
        return;
      }
    
      const fullUrl = audio_url.startsWith("http") ? audio_url : `${window.location.origin}${audio_url}`;
      console.log("🔊 Playing ElevenLabs audio:", fullUrl);
      playVoice(fullUrl);
    }
    
    // ---------- Skin analysis rendering ----------
    function renderSkinAnalysis(data) {
      if (!data) return;
    
      // store raw metrics for UI
      if (data.metrics) {
        window.__RAW_SKIN_METRICS__ = data.metrics;
      } else if (data.skin_report && data.skin_report.metrics) {
        window.__RAW_SKIN_METRICS__ = data.skin_report.metrics;
      }
    
      // update UI if you have elements
      const metrics = getUiMetrics();
      document.querySelectorAll("[data-skin-metric]").forEach((el) => {
        const key = el.dataset.skinMetric;
        if (metrics[key] != null) {
          el.textContent = metrics[key];
        }
      });
    
      // summary text
      if (data.summary) {
        const el = document.getElementById("skinSummary");
        if (el) el.textContent = data.summary;
      }
    }
    
    function getUiMetrics() {
      return window.__RAW_SKIN_METRICS__ || {};
    }
    
    // ---------- Quality + analysis ----------
    async function handleAnalyzeSkinClick() {
      let qualityTimeout = null;
      analysisTriggered = false;
      let analysisStarted = false;
    
      if (analyzingNow && !analysisTriggered) {
        console.warn("⚠️ Analysis already running");
        return;
      }
      if (analyzingNow) return;
      analyzingNow = true;
    
      try {
        const video = document.getElementById("cam");
    
        if (!video) {
          console.error("Video element not found");
          analyzingNow = false;
          return;
        }
    
        // Use QualityGate if available (via bridge)
        if (window.__RUNOVA__?.fatal) {
          console.warn("⚠️ QualityGate fatal, proceeding with analysis");
          await performRealAnalysis(video);
          analyzingNow = false;
          return;
        }
    
        const qg = window.__RUNOVA__?.qualityGate;
        if (!qg) {
          console.warn("⚠️ QualityGate not available, proceeding with analysis");
          await performRealAnalysis(video);
          analyzingNow = false;
          return;
        }
    
        // Ensure overlay exists
        if (!qg.overlay) {
          console.warn("⚠️ QualityGate overlay missing, creating now...");
          qg.createUIOverlay();
        }
    
        // Verify overlay is in DOM
        const overlayInDOM = document.getElementById("qualityGateOverlay");
        if (!overlayInDOM && qg.overlay) {
          console.warn("⚠️ Overlay exists but not in DOM, recreating...");
          const cameraPreview = document.getElementById("cameraPreview");
          if (cameraPreview && qg.overlay) {
            cameraPreview.appendChild(qg.overlay);
          }
        }
    
        // Show badges
        qg.showBadges();
    
        // Wait for green badges OR timeout
        let done = false;
        const start = Date.now();
    
        const tick = async () => {
          if (done) return;
    
          const state = qg.getState?.() || {};
          const allGreen = !!state.allGreen;
    
          if (allGreen) {
            done = true;
            qg.hideBadges();
            await performRealAnalysis(video);
            return;
          }
    
          if (Date.now() - start > 5000) {
            done = true;
            qg.hideBadges();
            await performRealAnalysis(video);
            return;
          }
    
          requestAnimationFrame(tick);
        };
    
        requestAnimationFrame(tick);
      } catch (e) {
        console.error("Analyze failed:", e);
    
        const qgError = window.__RUNOVA__?.qualityGate;
        if (qgError) {
          qgError.hideBadges();
        }
      }
    }
    
    async function performRealAnalysis(video) {
      try {
        let canvas =
          document.getElementById("cameraCanvas") ||
          document.getElementById("camera-canvas") ||
          document.getElementById("cameraPreview");
    
        // If canvas doesn't exist, create it
        if (!canvas || canvas.tagName.toLowerCase() !== "canvas") {
          const c = document.createElement("canvas");
          c.id = "cameraCanvas";
          c.style.display = "none";
          document.body.appendChild(c);
          canvas = c;
        }
    
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
    
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
        const imageData = canvas.toDataURL("image/jpeg", 0.9);
    
        // Your backend expects multipart "image" for /skin-analyze (per your mirror.html)
        const blob = await (await fetch(imageData)).blob();
        const form = new FormData();
        form.append("image", blob, "frame.jpg");
    
        const response = await fetch("/skin-analyze", {
          method: "POST",
          body: form,
        });
    
        if (!response.ok) {
          throw new Error(`Skin analyze error: ${response.status}`);
        }
    
        const data = await response.json();
    
        renderSkinAnalysis(data);
    
        if (data.audio_url) {
          playElevenLabsAudio(data.audio_url);
        } else {
          console.warn("⚠️ No audio_url from ElevenLabs - audio will not play");
        }
      } catch (e) {
        console.error("Real analysis failed:", e);
      } finally {
        analysisTriggered = false;
        analyzingNow = false;
      }
    }
    
    // Legacy function name for backwards compatibility
    async function captureAndAnalyzeFace() {
      return handleAnalyzeSkinClick();
    }
    
    async function generateAndPlayAudio(text) {
      try {
        const response = await fetch("/generate-audio", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text }),
        });
    
        if (!response.ok) {
          throw new Error(`Audio generation error: ${response.status}`);
        }
    
        const data = await response.json();
        if (data.audio_url) {
          playAudio(data.audio_url);
        } else {
          console.warn("⚠️ No audio_url from ElevenLabs - audio will not play");
        }
      } catch (error) {
        console.error("❌ Audio generation failed:", error);
      }
    }
    
    /**
     * Live camera feed analysis - processes frames continuously
     */
    let liveAnalysisActive = false;
    let liveAnalysisInterval = null;
    let frameCounter = 0;
    let lastAnalysisResult = null;
    
    // ================================
    // ✅ FIXED FUNCTION (REWRITTEN)
    // ================================
    async function startLiveAnalysis(options = {}) {
      const {
        interval = 2000,        // ms between frames
        throttle = true,        // backend may throttle
        generateAudio = false,  // skip audio for speed
        onResult = null         // optional callback(data)
      } = options;
    
      if (liveAnalysisActive) {
        console.log("⚠️ Live analysis already active");
        analyzingNow = false;
        return;
      }
    
      // camera element (support both ids)
      const cam = document.getElementById("cam") || document.getElementById("cameraVideo");
      if (!cam) {
        console.error("❌ Camera element not found (#cam or #cameraVideo)");
        showValidationMessage("Camera not found. Please refresh the page.");
        liveAnalysisActive = false;
        analyzingNow = false;
        return;
      }
    
      if (!window.faceDetectionManager) {
        console.error("❌ Face detection manager not available");
        showValidationMessage("Face detection not available. Please refresh the page.");
        liveAnalysisActive = false;
        analyzingNow = false;
        return;
      }
    
      liveAnalysisActive = true;
      frameCounter = 0;
    
      // Prevent multiple overlapping frames
      let frameInFlight = false;
    
      liveAnalysisInterval = setInterval(async () => {
        if (!liveAnalysisActive) return;
        if (frameInFlight) return;
    
        frameInFlight = true;
        analyzingNow = true;
    
        try {
          // Validation gate (lighting, distance, face present, etc.)
          const validation = await window.faceDetectionManager.validateForAnalysis(cam);
          if (!validation.valid) {
            console.warn(`⚠️ Frame ${frameCounter + 1} validation failed:`, validation.message);
            showValidationMessage(validation.message, false);
            return;
          }
    
          hideValidationMessage();
    
          // Detect face + crop ROI for speed/quality
          const faceResult = await window.faceDetectionManager.detectFace(cam);
          if (!faceResult.detected || !faceResult.boundingBox) {
            console.warn(`⚠️ Frame ${frameCounter + 1}: No face detected`);
            return;
          }
    
          const roiCanvas = document.createElement("canvas");
          window.faceDetectionManager.cropFaceROI(cam, faceResult.boundingBox, roiCanvas);
    
          const imageDataUrl = roiCanvas.toDataURL("image/jpeg", 0.85);
          const base64Image = imageDataUrl.split(",")[1];
    
          frameCounter += 1;
          const frameId = `frame_${frameCounter}_${Date.now()}`;
    
          const response = await fetch("/youcam/analyze-live", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              image: base64Image,
              frame_id: frameId,
              throttle: throttle,
              generate_audio: generateAudio
            }),
          });
    
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
            console.error(`❌ Live analysis error (frame ${frameCounter}):`, errorData.error || response.status);
            return;
          }
    
          const data = await response.json();
          lastAnalysisResult = data;
    
          // Render if available
          if (typeof renderSkinAnalysis === "function") {
            try { renderSkinAnalysis(data); } catch (_) {}
          }
    
          // Products
          if (data && data.recommendations && typeof productManager !== "undefined" && productManager) {
            try {
              const cleaned = cleanRecommendationsForUI(data.recommendations);
              productManager.addProducts(cleaned);
            } catch (e) {
              console.warn("⚠️ Product update failed:", e);
            }
          }
    
          // Optional audio
          if (generateAudio && data && data.audio_url) {
            playElevenLabsAudio(data.audio_url);
          }
    
          // Callback
          if (onResult && typeof onResult === "function") {
            try { onResult(data); } catch (e) { console.warn("⚠️ onResult callback failed:", e); }
          }
        } catch (error) {
          console.error("❌ Error processing live frame:", error);
        } finally {
          frameInFlight = false;
          analyzingNow = false;
        }
      }, interval);
    
      console.log(`✅ Live analysis started (interval: ${interval}ms, throttle: ${throttle})`);
    }
    
    function stopLiveAnalysis() {
      if (!liveAnalysisActive) {
        console.log("⚠️ Live analysis not active");
        analyzingNow = false;
        return;
      }
    
      liveAnalysisActive = false;
    
      if (liveAnalysisInterval) {
        clearInterval(liveAnalysisInterval);
        liveAnalysisInterval = null;
      }
    
      console.log("🛑 Live analysis stopped");
      analyzingNow = false;
    }
    
    function getLiveAnalysisStatus() {
      return {
        active: liveAnalysisActive,
        frameCounter,
        lastResult: lastAnalysisResult,
      };
    }
    
    // DOM ready
    document.addEventListener("DOMContentLoaded", () => {
      console.log("🚨 REAL TEMPLATE LOADED");
    
      // Wire Analyze button if exists
      const analyzeBtn = document.getElementById("analyzeSkinBtn") || document.getElementById("analyzeBtn");
      if (analyzeBtn) {
        analyzeBtn.addEventListener("click", () => {
          handleAnalyzeSkinClick();
        });
      }
    });
    
    // Expose
    window.askRunova = askRunova;
    window.playAudio = playAudio;
    window.showLoading = showLoading;
    window.captureAndAnalyzeFace = captureAndAnalyzeFace;
    window.getUiMetrics = getUiMetrics;
    window.generateAndPlayAudio = generateAndPlayAudio;
    window.startLiveAnalysis = startLiveAnalysis;
    window.stopLiveAnalysis = stopLiveAnalysis;
    window.getLiveAnalysisStatus = getLiveAnalysisStatus;
    window.showValidationMessage = showValidationMessage;
    window.hideValidationMessage = hideValidationMessage;
    
    // ---- (END: original content) ----
    
    // ----------------------------------------------------------------
    // AUTOMATIC CAMERA BOOTSTRAP
    // - Adds minimal, robust logic to request and attach camera stream automatically
    // - Does not remove or rewrite the rest of the file (keeps original code intact)
    // ----------------------------------------------------------------
    (function autoStartCameraBootstrap() {
      // Guard: only run in browser
      if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return;
      }
    
      // Keep global reference for reuse
      window.__cameraStream__ = window.__cameraStream__ || null;
      let attempts = 0;
      const maxAttempts = 6;
      const attemptDelayMs = 1500;
    
      function attachStreamToVideoElements(stream) {
        if (!stream) return;
        // ids we want to attach to (support legacy and new)
        const ids = ['cameraVideo', 'cam'];
        ids.forEach((id) => {
          try {
            const el = document.getElementById(id) || document.querySelector(`video#${id}`);
            if (el) {
              try {
                if (el.srcObject !== stream) el.srcObject = stream;
              } catch (e) {
                // fallback to object URL if necessary
                try { el.src = URL.createObjectURL(stream); } catch (ee) {}
              }
              el.muted = true;
              el.playsInline = true;
              // try to play, ignore rejection
              try { el.play().catch(()=>{}); } catch (e) {}
            }
          } catch (e) {}
        });
    
        // Also attach to overlay video if helper created it
        try {
          const overlay = document.getElementById('android-camera-overlay');
          if (overlay) {
            try {
              if (overlay.srcObject !== stream) overlay.srcObject = stream;
            } catch (e) {
              try { overlay.src = URL.createObjectURL(stream); } catch (ee) {}
            }
            overlay.muted = true;
            overlay.playsInline = true;
            try { overlay.play().catch(()=>{}); } catch (e) {}
          }
        } catch (e) {}
      }
    
      // helper: monitor a MediaStream and attach ended handlers to prevent flash
      function monitorStreamForStops(stream) {
        try {
          if (!stream || !stream.getTracks) return;
          const overlay = document.getElementById('android-camera-overlay');
          // attach ended listeners to tracks
          stream.getTracks().forEach((t) => {
            try {
              // avoid reassigning handlers
              if (t.__runova_onended_attached) return;
              t.__runova_onended_attached = true;
              t.addEventListener('ended', function() {
                try {
                  // when any track ends, show last captured frame (if available) or keep black background
                  if (overlay) {
                    // if overlay has last snapshot
                    var last = overlay.dataset && overlay.dataset.__last_frame;
                    if (last) {
                      overlay.style.backgroundImage = "url('" + last + "')";
                      overlay.style.backgroundSize = 'cover';
                      // DO NOT toggle visibility/opacity — keep overlay shown to avoid flicker
                      overlay.style.visibility = 'visible';
                      overlay.style.opacity = '1';
                    } else {
                      // keep black background to avoid white flash
                      overlay.style.background = 'black';
                      overlay.style.visibility = 'visible';
                      overlay.style.opacity = '1';
                    }
                    try { overlay.pause(); } catch(e){}
                  }
                } catch(e){}
              });
            } catch(e){}
          });
        } catch(e){}
      }
    
      async function start() {
        // Already have active stream
        if (window.__cameraStream__ && window.__cameraStream__.active) {
          attachStreamToVideoElements(window.__cameraStream__);
          // monitor to avoid flicker on stop
          monitorStreamForStops(window.__cameraStream__);
          return;
        }
        attempts += 1;
        try {
          // Request video only; keep audio off by default to avoid permission noise
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
          window.__cameraStream__ = stream;
          console.log("autoStartCameraBootstrap: got stream", stream);
          attachStreamToVideoElements(stream);
          // Monitor stream tracks so stopping doesn't cause white flash
          monitorStreamForStops(stream);
        } catch (err) {
          console.warn("autoStartCameraBootstrap: getUserMedia failed (attempt " + attempts + ")", err);
          if (attempts < maxAttempts) {
            setTimeout(start, attemptDelayMs * attempts); // exponential-ish backoff
          } else {
            // final fallback: try again when page becomes visible
            document.addEventListener('visibilitychange', function onVis() {
              if (document.visibilityState === 'visible') {
                document.removeEventListener('visibilitychange', onVis);
                attempts = 0;
                start();
              }
            });
          }
        }
      }
    
      // Ensure newly created video elements get the stream attached
      function observeVideoNodes() {
        try {
          const mo = new MutationObserver((mutations) => {
            for (const m of mutations) {
              for (const n of m.addedNodes) {
                if (!n) continue;
                if (n.nodeType === 1 && n.tagName === 'VIDEO') {
                  // attach immediately if we have stream
                  if (window.__cameraStream__ && window.__cameraStream__.active) {
                    attachStreamToVideoElements(window.__cameraStream__);
                  } else {
                    // try to start camera if not started yet
                    start();
                  }
                }
              }
            }
          });
          mo.observe(document.documentElement || document, { childList: true, subtree: true });
          // keep it alive for the session (no disconnect)
        } catch (e) {
          // ignore
        }
      }
    
      // Kick off on DOM ready or immediately if ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
          start();
          observeVideoNodes();
        });
      } else {
        start();
        observeVideoNodes();
      }
    
      // If tab becomes visible again, ensure stream present
      document.addEventListener('visibilitychange', function() {
        if (document.visibilityState === 'visible') {
          start();
        } else {
          // optional: consider stopping tracks to release camera on background (not doing here)
        }
      });
    })();
    
    // ----------------------------------------------------------------
    // Append a small, robust fullscreen helper here so the behavior
    // is applied from this static script (guarantees the code is served).
    // This avoids needing to rely on a template edit that may not be deployed.
    // ----------------------------------------------------------------
    
    ;(function addEnsureFullscreenToAppJs() {
      try {
        // prevent double-init if script re-executes
        if (window.__runova_ensure_init) return;
        window.__runova_ensure_init = true;
        // Read UA and force flags
        var ua = navigator.userAgent || navigator.vendor || window.opera || '';
        var qs = (typeof URLSearchParams !== 'undefined') ? new URLSearchParams(window.location.search) : null;
        var forceFlag = (qs && qs.get('force_fullscreen') === '1') || localStorage.getItem('force_fullscreen') === '1';
    
        // detect common Android / WebView markers
        var isAndroidUA = /Android/i.test(ua);
        var isAndroidWebView = /(wv|; wv|WebView)/i.test(ua) || (isAndroidUA && !/Chrome\/\d+/i.test(ua));
    
        // additional heuristics for kiosk / wrapped apps (catch custom UAs that may not contain 'Android')
        var kioskMarkers = /kiosk|runova|embedded|inapp|webview|wv/i.test(ua);
    
        // Final decision: apply if native detection matches, or force flag set, or kiosk markers found
        // ALSO enable on localhost/127.0.0.1 so dev and wrapped apps which serve locally get fullscreen automatically.
        var isLocalhost = (window.location && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'));
        var shouldApply = isAndroidUA || isAndroidWebView || forceFlag || kioskMarkers || isLocalhost;
    
        // If forcing via flag, ensure the CSS class is present so styles apply.
        if (forceFlag && !document.documentElement.classList.contains('is-android')) {
          document.documentElement.classList.add('is-android');
          try { console.log('runova: force_fullscreen active'); } catch (e) {}
        }
    
        /**
         * New approach (refined):
         * - Create an overlay video that covers viewport (does NOT remove original app DOM).
         * - Robustly reuse original stream when possible; if not, fall back to src/currentSrc.
         * - Ensure UI controls are explicitly promoted (inline styles) so missing CSS/404 won't hide them.
         * - Do NOT set original parent's display:none — instead restore visibility if another script hid it.
         * - Persist overlay across reloads (localStorage + recreate observer).
         * - Prevent white-flash: keep overlay hidden until the overlay video fires "playing".
         * - When stream stops, keep last frame as background so screen doesn't blink.
         * - Add debounce & single-init guards to avoid multiple toggles.
         */
    
        // overlay state & debounce guards
        var __runova_overlay_state = {
          initialized: false,
          revealed: false,
          recreateDebounce: null,
          recreateDebounceMs: 400, // small debounce window to avoid rapid re-create
        };
    
        function createOverlayRoot() {
          // idempotent: if already created and initialized, return existing
          try {
            var existingRoot = document.getElementById('android-camera-root');
            if (existingRoot) {
              // mark initialized so other flows know
              __runova_overlay_state.initialized = true;
              return existingRoot;
            }
    
            var root = document.createElement('div');
            root.id = 'android-camera-root';
            Object.assign(root.style, {
              position: 'fixed',
              top: '0',
              left: '0',
              width: '100vw',
              height: '100vh',
              zIndex: '1000',
              pointerEvents: 'none',
              overflow: 'hidden',
              background: 'black'
            });
    
            var overlay = document.createElement('video');
            overlay.id = 'android-camera-overlay';
            overlay.setAttribute('autoplay', '');
            overlay.setAttribute('playsinline', '');
            overlay.muted = true;
            overlay.style.display = 'block';
            Object.assign(overlay.style, {
              position: 'fixed',
              top: '0',
              left: '0',
              width: '100vw',
              height: '100vh',
              objectFit: 'cover',
              transform: 'scaleX(-1)',
              zIndex: '1001',
              pointerEvents: 'none',
              background: 'black',
              visibility: 'hidden',
              opacity: '0',
              transition: 'opacity 200ms linear'
            });
    
            // revealOverlay with guard: run only once per initialization unless explicitly reset
            var revealOverlay = function(force) {
              try {
                if (__runova_overlay_state.revealed && !force) return;
                overlay.style.visibility = 'visible';
                overlay.style.opacity = '1';
                __runova_overlay_state.revealed = true;
                // keep root background transparent after reveal
                try { root.style.background = 'transparent'; } catch(e){}
              } catch(e){}
            };
    
            // On playing: capture last frame (but do not repeatedly toggle visibility)
            overlay.addEventListener('playing', function() {
              try {
                // capture snapshot once (avoid heavy repeating)
                if (!overlay.dataset.__last_frame) {
                  try {
                    var c = document.createElement('canvas');
                    c.width = overlay.videoWidth || overlay.clientWidth || 640;
                    c.height = overlay.videoHeight || overlay.clientHeight || 480;
                    var ctx = c.getContext('2d');
                    ctx.drawImage(overlay, 0, 0, c.width, c.height);
                    overlay.dataset.__last_frame = c.toDataURL('image/png');
                  } catch(e){}
                }
                // reveal overlay (idempotent)
                revealOverlay(false);
              } catch(e){}
            });
    
            // loadeddata fallback
            overlay.addEventListener('loadeddata', function() {
              try { setTimeout(function(){ revealOverlay(false); }, 10); } catch(e){}
            });
    
            // fallback: reveal after moderate timeout if playing not fired
            setTimeout(function() {
              try {
                if (overlay && overlay.readyState >= 3) revealOverlay(false);
              } catch(e){}
            }, 1500);
    
            root.appendChild(overlay);
            document.body.appendChild(root);
    
            // Hide the small in-page video(s) but keep them (do not remove)
            try {
              var smallIds = ['cameraVideo', 'cam'];
              smallIds.forEach(function(id){
                try {
                  var sv = document.getElementById(id);
                  if (sv && sv !== overlay) {
                    sv.style.visibility = 'hidden';
                    sv.style.pointerEvents = 'none';
                    sv.dataset.__hidden_by_runova = '1';
                  }
                } catch(e){}
              });
            } catch(e){}
    
            __runova_overlay_state.initialized = true;
            return root;
          } catch (e) {
            console.warn('createOverlayRoot error', e);
            return null;
          }
        }
    
        function attachStreamToOverlayIfNeeded() {
          try {
            var overlay = document.getElementById('android-camera-overlay');
            if (!overlay) return;
            var originalVideo = document.getElementById('cameraVideo') || document.getElementById('cam') || document.querySelector('video');
            var streamToAttach = null;
            if (originalVideo && originalVideo.srcObject) {
              streamToAttach = originalVideo.srcObject;
            } else if (window.__cameraStream__ && window.__cameraStream__.active) {
              streamToAttach = window.__cameraStream__;
            }
    
            // If already attached same stream, do nothing
            try {
              if (streamToAttach && overlay.srcObject === streamToAttach) {
                // ensure playing but do not toggle visibility
                try { overlay.play().catch(()=>{}); } catch(e){}
                return;
              }
            } catch(e){}
    
            // Attach new stream if available
            if (streamToAttach) {
              try {
                overlay.srcObject = streamToAttach;
                overlay.muted = true;
                overlay.playsInline = true;
                // remove any frozen background, but do not toggle visibility if already revealed
                if (overlay.dataset && overlay.dataset.__last_frame) {
                  // keep last_frame as fallback but remove background image
                  overlay.style.backgroundImage = '';
                }
                overlay.play().catch(()=>{});
              } catch (e) {
                try { overlay.src = streamToAttach.currentSrc || URL.createObjectURL(streamToAttach); overlay.play().catch(()=>{}); } catch(er){}
              }
    
              // attach ended handlers with guard
              try {
                (streamToAttach.getTracks()||[]).forEach(function(t){
                  try {
                    if (!t.__runova_onended_attached) {
                      t.__runova_onended_attached = true;
                      t.addEventListener('ended', function() {
                        try {
                          // on stop: freeze overlay by setting background to last frame and removing srcObject,
                          // but DO NOT change visibility nor opacity to avoid flicker.
                          var last = overlay.dataset && overlay.dataset.__last_frame;
                          if (last) {
                            overlay.style.backgroundImage = "url('" + last + "')";
                            overlay.style.backgroundSize = 'cover';
                          } else {
                            overlay.style.background = 'black';
                          }
                          try { overlay.srcObject = null; } catch(e){}
                          try { overlay.pause(); } catch(e){}
                          // keep overlay visible (do not toggle visibility) so no flash happens
                          overlay.style.visibility = 'visible';
                          overlay.style.opacity = '1';
                        } catch(e){}
                      });
                    }
                  } catch(e){}
                });
              } catch(e){}
            } else {
              // no stream: keep overlay visible but with last frame (so no flicker)
              var last = overlay.dataset && overlay.dataset.__last_frame;
              if (last) {
                overlay.style.backgroundImage = "url('" + last + "')";
                overlay.style.backgroundSize = 'cover';
                overlay.style.visibility = 'visible';
                overlay.style.opacity = '1';
              } else {
                overlay.style.background = 'black';
                overlay.style.visibility = 'visible';
                overlay.style.opacity = '1';
              }
              try { overlay.srcObject = null; } catch(e){}
              try { overlay.pause(); } catch(e){}
            }
    
            // Hide small in-page videos idempotently
            try {
              var smallIds = ['cameraVideo', 'cam'];
              smallIds.forEach(function(id){
                try {
                  var sv = document.getElementById(id);
                  if (sv && sv !== overlay) {
                    sv.style.visibility = 'hidden';
                    sv.style.pointerEvents = 'none';
                    sv.dataset.__hidden_by_runova = '1';
                  }
                } catch(e){}
              });
            } catch(e){}
          } catch (e) {}
        }
    
        // debounce-safe recreation watcher
        function watchOverlayPersistence() {
          try {
            var body = document.body;
            if (!body) return;
            var mo = new MutationObserver(function(muts) {
              for (var m of muts) {
                for (var n of m.removedNodes) {
                  if (!n) continue;
                  try {
                    if (n && n.id === 'android-camera-root') {
                      if (__runova_overlay_state.recreateDebounce) {
                        clearTimeout(__runova_overlay_state.recreateDebounce);
                        __runova_overlay_state.recreateDebounce = null;
                      }
                      __runova_overlay_state.recreateDebounce = setTimeout(function() {
                        try {
                          createOverlayRoot();
                          attachStreamToOverlayIfNeeded();
                          promoteUiElements(true);
                        } catch(e){}
                      }, __runova_overlay_state.recreateDebounceMs);
                    }
                  } catch(e){}
                }
              }
            });
            mo.observe(body, { childList: true, subtree: false });
            // keep observer live
          } catch (e) {}
        }
    
        // Ensure UI buttons are above the overlay and interactive
        function promoteUiElements(tryRestoreParents) {
          try {
            var uiIds = [
              'restartButton',
              'micButton',
              'analyzeSkinBtn',
              'analyzeBtn',
              'scanSunscreenBtn',
              'statusText',
              'skinResultsPanel',
              'recommendationsSection',
              'cameraPreview',
              'qualityGateOverlay',
              'loadingOverlay',
              'bottom-controls'
            ];
    
            uiIds.forEach(function(id) {
              try {
                var el = document.getElementById(id);
                if (!el) el = document.querySelector('.' + id);
                if (!el) return;
                el.style.zIndex = '11000';
                el.style.pointerEvents = 'auto';
                if (getComputedStyle(el).display === 'none') el.style.display = 'block';
                var pos = getComputedStyle(el).position;
                if (pos === 'static' || !el.style.position) el.style.position = 'relative';
              } catch(e){}
            });
    
            try {
              var uiLayer = document.querySelector('.ui-layer') || document.querySelector('.app-root') || document.querySelector('.mirror-frame') || document.querySelector('.mobile-container') || document.querySelector('.camera-section');
              if (uiLayer) {
                uiLayer.style.zIndex = '11001';
                uiLayer.style.pointerEvents = 'auto';
                if (getComputedStyle(uiLayer).display === 'none') uiLayer.style.display = 'block';
                if (!uiLayer.style.position) uiLayer.style.position = 'relative';
              }
            } catch (e) {}
    
            if (tryRestoreParents) {
              try {
                var possibleParents = document.querySelectorAll('.mobile-container, .app-root, .mirror-frame, .ui-layer, #app, body > div, .camera-section');
                possibleParents.forEach(function(p) {
                  if (!p) return;
                  try {
                    if (p.style && (p.style.display === 'none' || p.style.visibility === 'hidden')) {
                      p.style.display = p.style.display === 'none' ? 'block' : p.style.display;
                      p.style.visibility = 'visible';
                    }
                    if (!p.style.zIndex || Number(p.style.zIndex) < 10000) p.style.zIndex = '11000';
                    if (!p.style.pointerEvents || p.style.pointerEvents === 'none') p.style.pointerEvents = 'auto';
                  } catch (ee) {}
                });
              } catch (ee) {}
            }
          } catch (e) {}
        }
    
        function ensureFullScreenVideo() {
          try {
            // create overlay root if missing
            var root = createOverlayRoot();
            attachStreamToOverlayIfNeeded();
            promoteUiElements(true);
            watchOverlayPersistence();
          } catch (e) {
            console.warn('ensureFullScreenVideo error', e);
          }
        }
    
        function initEnsure() {
          if (!shouldApply) {
            // Not an Android/kiosk environment and no force flag set — skip.
            return;
          }
    
          // Ensure the class is present so the CSS rules take effect even if detection didn't add it earlier.
          if (!document.documentElement.classList.contains('is-android')) {
            document.documentElement.classList.add('is-android');
          }
    
          // NOTE: removed forcing of document background here to avoid repeated toggles/multiple flashes.
          // We rely on overlay being created quickly and remaining visible with last-frame fallback.
    
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', ensureFullScreenVideo);
          } else {
            ensureFullScreenVideo();
          }
    
          // Also observe for dynamically added video elements (watch any <video> nodes)
          try {
            var observer = new MutationObserver(function(mutations) {
              for (var m of mutations) {
                for (var n of m.addedNodes) {
                  if (!n) continue;
                  try {
                    if (n.nodeType === 1 && (n.tagName === 'VIDEO' || (n.querySelector && n.querySelector('#cameraVideo')))) {
                      // Re-attach stream to overlay if video added/recreated
                      attachStreamToOverlayIfNeeded();
                      promoteUiElements();
                    }
                  } catch (e) {}
                }
              }
            });
            observer.observe(document.documentElement || document, { childList: true, subtree: true });
          } catch (e) {}
    
          // If camera stream becomes available later, attach to overlay
          try {
            var tries = 0;
            var maxTries = 10;
            var tInterval = setInterval(function() {
              attachStreamToOverlayIfNeeded();
              tries++;
              if (tries > maxTries) clearInterval(tInterval);
            }, 500);
          } catch(e){}
        }
    
        initEnsure();
      } catch (e) {
        console.error('addEnsureFullscreenToAppJs error', e);
      }
    })();
    
    // ----------------------------------------------------------------
    // ADD: Bottom "white line" control bar (reload | mic | Analyze skin | Scan sunscreen)
    // This injects a small, centered white bar with 4 controls. The first two are icon-only.
    // It doesn't remove existing elements; it simply overlays them and wires to existing handlers.
    // ----------------------------------------------------------------
    (function addBottomControlBar() {
      try {
        if (window.__runova_bottom_bar_added) return;
        window.__runova_bottom_bar_added = true;
    
        function createSVG(iconName) {
          if (iconName === 'reload') {
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M21 12a9 9 0 10-2.64 6.12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M21 3v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`;
          } else if (iconName === 'mic') {
            return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M19 10V12C19 15.87 15.87 19 12 19C8.13 19 5 15.87 5 12V10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="12" y1="19" x2="12" y2="23" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>`;
          }
          return '';
        }
    
        function createBar() {
          if (document.getElementById('runova-bottom-bar')) return;
    
          const bar = document.createElement('div');
          bar.id = 'runova-bottom-bar';
          // Inline style so it works even if styles.css is missing
          Object.assign(bar.style, {
            position: 'fixed',
            bottom: '16px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(255,255,255,0.98)',
            borderRadius: '999px',
            padding: '6px',
            display: 'flex',
            gap: '6px',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '12050',
            boxShadow: '0 6px 18px rgba(0,0,0,0.18)',
            pointerEvents: 'auto',
            minWidth: '220px',
            maxWidth: '92%',
            boxSizing: 'border-box'
          });
    
          // small style for icon buttons
          const iconBtnStyle = {
            width: '36px',
            height: '36px',
            borderRadius: '50%',
            background: 'white',
            border: '1px solid rgba(0,0,0,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            padding: '6px',
            boxSizing: 'border-box'
          };
    
          // reload icon-only button
          const reloadBtn = document.createElement('button');
          reloadBtn.type = 'button';
          reloadBtn.id = 'runova-reload-btn';
          reloadBtn.innerHTML = createSVG('reload');
          Object.assign(reloadBtn.style, iconBtnStyle);
          reloadBtn.setAttribute('aria-label', 'Reload');
          reloadBtn.title = 'Reload';
          reloadBtn.addEventListener('click', function() {
            try {
              // gentle reload: re-request camera stream if available, otherwise full reload
              if (window.__cameraStream__ && window.__cameraStream__.active) {
                // stop tracks briefly then restart to refresh stream
                try {
                  window.__cameraStream__.getTracks().forEach(t => { try { t.stop(); } catch(e){} });
                } catch(e){}
                // trigger start sequence after small delay
                setTimeout(function() {
                  try { if (typeof startLiveAnalysis === 'function') startLiveAnalysis(); } catch(e){}
                  try { if (typeof window.startRecording === 'function') {} } catch(e){}
                  // Also call auto-start reinit (if present)
                  try {
                    var evt = new Event('visibilitychange');
                    document.dispatchEvent(evt);
                  } catch(e){}
                }, 250);
              }
              // still do a soft reload of the page to ensure everything resets
              location.reload();
            } catch (e) {
              try { location.reload(); } catch (e) {}
            }
          });
    
          // mic icon-only button (toggles recording)
          const micBtn = document.createElement('button');
          micBtn.type = 'button';
          micBtn.id = 'runova-mic-btn';
          micBtn.innerHTML = createSVG('mic');
          Object.assign(micBtn.style, iconBtnStyle);
          micBtn.setAttribute('aria-label', 'Toggle microphone');
          micBtn.title = 'Mic';
          function updateMicVisual(active) {
            if (active) {
              micBtn.style.background = '#FF3B30';
              micBtn.style.color = 'white';
              micBtn.style.borderColor = '#FF3B30';
            } else {
              micBtn.style.background = 'white';
              micBtn.style.color = 'inherit';
              micBtn.style.borderColor = 'rgba(0,0,0,0.08)';
            }
          }
          updateMicVisual(false);
          micBtn.addEventListener('click', function() {
            try {
              if (window.isRecording) {
                if (typeof window.stopRecording === 'function') window.stopRecording();
                updateMicVisual(false);
              } else {
                if (typeof window.startRecording === 'function') window.startRecording();
                updateMicVisual(true);
              }
            } catch (e) {
              console.error('Mic toggle failed', e);
            }
          });
    
          // text button: Analyze skin
          const analyzeTextBtn = document.createElement('button');
          analyzeTextBtn.type = 'button';
          analyzeTextBtn.id = 'runova-analyze-text-btn';
          analyzeTextBtn.textContent = 'Analyze skin';
          Object.assign(analyzeTextBtn.style, {
            padding: '8px 10px',
            borderRadius: '8px',
            background: 'white',
            border: '1px solid rgba(0,0,0,0.08)',
            cursor: 'pointer',
            fontSize: '13px'
          });
          analyzeTextBtn.addEventListener('click', function() {
            try {
              if (typeof handleAnalyzeSkinClick === 'function') handleAnalyzeSkinClick();
              // also attempt legacy button if present
              var existing = document.getElementById('analyzeSkinBtn') || document.getElementById('analyzeBtn');
              if (existing) {
                try { existing.click(); } catch(e){}
              }
            } catch (e) { console.error(e); }
          });
    
          // text button: Scan sunscreen
          const scanTextBtn = document.createElement('button');
          scanTextBtn.type = 'button';
          scanTextBtn.id = 'runova-scan-text-btn';
          scanTextBtn.textContent = 'Scan sunscreen';
          Object.assign(scanTextBtn.style, {
            padding: '8px 10px',
            borderRadius: '8px',
            background: 'white',
            border: '1px solid rgba(0,0,0,0.08)',
            cursor: 'pointer',
            fontSize: '13px'
          });
          scanTextBtn.addEventListener('click', function() {
            try {
              var existing = document.getElementById('scanSunscreenBtn') || document.querySelector('.scan-sunscreen-button');
              if (existing) {
                try { existing.click(); return; } catch(e){}
              }
              // if not found, dispatch custom event or call captureAndAnalyzeFace as a fallback
              if (typeof captureAndAnalyzeFace === 'function') captureAndAnalyzeFace();
            } catch (e) { console.error(e); }
          });
    
          // Assemble: small left icons then text buttons
          bar.appendChild(reloadBtn);
          bar.appendChild(micBtn);
          // small separator
          const sep = document.createElement('div');
          sep.style.width = '8px';
          bar.appendChild(sep);
          bar.appendChild(analyzeTextBtn);
          bar.appendChild(scanTextBtn);
    
          // Make the bar keyboard-focusable and allow dragging small vertical offset (optional)
          bar.tabIndex = -1;
    
          document.body.appendChild(bar);
    
          // Ensure bar stays above overlay UI
          setTimeout(function() {
            try {
              var b = document.getElementById('runova-bottom-bar');
              if (b) b.style.zIndex = '12050';
            } catch(e){}
          }, 50);
    
          // Expose toggles for external use
          window.__runova_bottom_bar = {
            element: bar,
            setMicActive: updateMicVisual
          };
        }
    
        // create on DOM ready (also after a short delay to let overlay init)
        function initBottomBar() {
          try {
            createBar();
          } catch (e) {
            console.error('create bottom bar failed', e);
          }
        }
    
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', initBottomBar);
          // also run again after short delay (some DOM manipulations may happen after)
          setTimeout(initBottomBar, 800);
        } else {
          initBottomBar();
        }
      } catch (e) {
        console.error('addBottomControlBar error', e);
      }
    })();
    
    // ----------------------------------------------------------------
    // REMOVE legacy "ugly" buttons from DOM (keep this as JS-only change so we don't edit HTML).
    // This will remove old buttons by id/class and guard against re-insertion for a short time.
    // ----------------------------------------------------------------
    (function removeLegacyButtons() {
      try {
        if (window.__runova_removed_legacy_buttons) return;
        window.__runova_removed_legacy_buttons = true;
    
        const legacyIds = [
          'restartButton', 'micButton', 'analyzeSkinBtn', 'analyzeBtn',
          'scanSunscreenBtn', 'skinResultsClose'
        ];
        const legacyClasses = [
          'restart-scan-button', 'mic-button', 'analyze-button', 'scan-sunscreen-button', 'bottom-controls'
        ];
    
        function removeOnce() {
          try {
            legacyIds.forEach((id) => {
              try {
                const el = document.getElementById(id);
                if (el && el.parentNode) {
                  el.parentNode.removeChild(el);
                }
              } catch (e) {}
            });
            legacyClasses.forEach((cls) => {
              try {
                const list = document.querySelectorAll('.' + cls);
                list.forEach((el) => {
                  try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch(e){}
                });
              } catch (e) {}
            });
            // Also remove any inline legacy bottom-controls wrapper that might be present
            try {
              const bc = document.querySelector('.bottom-controls');
              if (bc && bc.parentNode) bc.parentNode.removeChild(bc);
            } catch (e) {}
          } catch (e) {}
        }
    
        // Run a few times: on DOMContentLoaded, after short delays, and while mutation observer watches for reinserts.
        function scheduleRemovals() {
          try {
            removeOnce();
            setTimeout(removeOnce, 250);
            setTimeout(removeOnce, 800);
            setTimeout(removeOnce, 2000);
          } catch (e) {}
        }
    
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', scheduleRemovals);
        } else {
          scheduleRemovals();
        }
    
        // Observe short-lived mutations and remove reinserts for 6 seconds
        try {
          const start = Date.now();
          const mo = new MutationObserver((mutations) => {
            if (Date.now() - start > 6000) {
              try { mo.disconnect(); } catch(e){}
              return;
            }
            for (const m of mutations) {
              for (const n of m.addedNodes) {
                try {
                  if (!n) continue;
                  if (n.nodeType !== 1) continue;
                  const nid = n.id || '';
                  if (legacyIds.indexOf(nid) !== -1) {
                    try { n.parentNode && n.parentNode.removeChild(n); } catch(e){}
                  }
                  const cl = Array.from(n.classList || []);
                  if (cl.some(c => legacyClasses.indexOf(c) !== -1)) {
                    try { n.parentNode && n.parentNode.removeChild(n); } catch(e){}
                  }
                  // also check children
                  try {
                    legacyIds.forEach(id => {
                      const child = n.querySelector && n.querySelector('#' + id);
                      if (child && child.parentNode) child.parentNode.removeChild(child);
                    });
                    legacyClasses.forEach(cls => {
                      const childs = n.querySelectorAll && n.querySelectorAll('.' + cls);
                      (childs || []).forEach(ch => { try { ch.parentNode && ch.parentNode.removeChild(ch); } catch(e){} });
                    });
                  } catch(e){}
                } catch(e){}
              }
            }
          });
          mo.observe(document.documentElement || document, { childList: true, subtree: true });
          // keep observer for 6s then disconnect automatically (to avoid long-term performance cost)
          setTimeout(function(){ try{ mo.disconnect(); }catch(e){} }, 6500);
        } catch (e) {}
    
      } catch (e) {
        console.error('removeLegacyButtons error', e);
      }
    })();
    
    // ----------------------------------------------------------------
    // REMOVE 'Skin analysis' UI (user request).
    // This JavaScript-only change removes the skin analysis panel/title and guards
    // against short-term reinsertion so your overlay remains clean. Does not delete other code.
    // ----------------------------------------------------------------
    (function removeSkinAnalysisUI() {
      try {
        if (window.__runova_removed_skin_ui) return;
        window.__runova_removed_skin_ui = true;
    
        const idsToRemove = [
          'skinResultsPanel',   // panel wrapper used in index.html
          'skin-results',       // alternate id used elsewhere
          'cameraPreview'       // sometimes contains quality overlay + skin UI
        ];
        const classesToRemove = [
          'skin-results-title',
          'skin-results-grid',
          'skin-results',
          'skin-results-panel',
          'skin-results-header',
          'skin-results-close',
          'skin-results-grid'
        ];
        // generic text nodes that contain "Skin analysis" - remove their parent elements
        function removeTextNodesMatching(text) {
          try {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
              try {
                if (!node.nodeValue) continue;
                if (node.nodeValue.trim().toLowerCase().indexOf(text) !== -1) {
                  const parent = node.parentElement;
                  if (parent && parent.parentNode) {
                    parent.parentNode.removeChild(parent);
                  }
                }
              } catch (e) {}
            }
          } catch (e) {}
        }
    
        function removeOnce() {
          try {
            idsToRemove.forEach(id => {
              try {
                const el = document.getElementById(id);
                if (el && el.parentNode) el.parentNode.removeChild(el);
              } catch(e){}
            });
            classesToRemove.forEach(cls => {
              try {
                const list = document.querySelectorAll('.' + cls);
                (list || []).forEach(el => { try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch(e){} });
              } catch(e){}
            });
            // also remove any visible elements that contain the exact text
            removeTextNodesMatching('skin analysis');
          } catch (e) {}
        }
    
        function scheduleRemovals() {
          try {
            removeOnce();
            setTimeout(removeOnce, 150);
            setTimeout(removeOnce, 600);
            setTimeout(removeOnce, 1800);
          } catch (e) {}
        }
    
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', scheduleRemovals);
        } else {
          scheduleRemovals();
        }
    
        // watch for reinsertion for short window (6s)
        try {
          const start = Date.now();
          const mo = new MutationObserver((mutations) => {
            if (Date.now() - start > 6000) {
              try { mo.disconnect(); } catch(e){}
              return;
            }
            for (const m of mutations) {
              for (const n of m.addedNodes) {
                try {
                  if (!n || n.nodeType !== 1) continue;
                  const nid = n.id || '';
                  if (idsToRemove.indexOf(nid) !== -1) {
                    try { n.parentNode && n.parentNode.removeChild(n); } catch(e){}
                  }
                  const cls = Array.from(n.classList || []);
                  if (cls.some(c => classesToRemove.indexOf(c) !== -1)) {
                    try { n.parentNode && n.parentNode.removeChild(n); } catch(e){}
                  }
                  // text-match children
                  try {
                    const textNodes = n.querySelectorAll && n.querySelectorAll('*');
                    (textNodes || []).forEach(el => {
                      try {
                        if ((el.textContent || '').trim().toLowerCase().indexOf('skin analysis') !== -1) {
                          el.parentNode && el.parentNode.removeChild(el);
                        }
                      } catch(err){}
                    });
                  } catch(err){}
                } catch(e){}
              }
            }
          });
          mo.observe(document.documentElement || document, { childList: true, subtree: true });
          setTimeout(function(){ try{ mo.disconnect(); }catch(e){} }, 6500);
        } catch (e) {}
      } catch (e) {
        console.error('removeSkinAnalysisUI error', e);
      }
    })();
    
   })();