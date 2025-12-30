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
      const el = document.getElementById("validationMessage");
      if (!el) return;
      el.textContent = message || "";
      el.style.display = message ? "block" : "none";
      el.dataset.blocking = blocking ? "1" : "0";
    }
  
    function hideValidationMessage() {
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
  })();
  