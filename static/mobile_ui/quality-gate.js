console.log("🔥 quality-gate.js EXECUTED");
console.log("🔍 window check:", typeof window, window === globalThis);
console.log("🔍 window.__RUNOVA__ before:", window.__RUNOVA__);

window.__RUNOVA__ = window.__RUNOVA__ || {};
console.log("🔍 window.__RUNOVA__ after init:", window.__RUNOVA__);

/**
 * Perfect Corp Quality Gates
 * Real-time quality checks: Lighting, Head Pose, Face Distance
 * Analysis only allowed when all 3 checks are GREEN for ≥500ms
 */

class QualityGate {
    constructor() {
        this.state = 'CAMERA_READY'; // CAMERA_READY → LIVE_QUALITY_CHECKS → ALL_GREEN

        // Required green stability
        this.REQUIRED_GREEN_DURATION = 500; // ms
        this.allGreenSince = null;

        // FaceMesh instance state
        this.faceMeshReady = false; // Track if FaceMesh is initialized and ready
        this.faceMeshError = false; // Track if FaceMesh initialization failed
        this.camera = null;
        this.isRunning = false;
        this.checkInterval = null;

        // Quality states (true = good, false = not good)
        this.qualityStates = {
            lighting: false,
            pose: false,
            distance: false
        };

        this.lastBadgeStates = {
            lighting: null,
            pose: null,
            distance: null
        };

        this.badgesVisible = false;
        this.overlay = null;

        this.onQualityChange = null;

        // Debug
        console.log("✅ QualityGate constructed");
    }

    createUIOverlay() {
        // If overlay already exists, do nothing
        if (this.overlay) return;

        const overlay = document.createElement("div");
        overlay.id = "qualityGateOverlay";
        overlay.style.position = "absolute";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100%";
        overlay.style.height = "100%";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "999";

        const makeBadge = (id, label) => {
            const badge = document.createElement("div");
            badge.id = id;
            badge.style.position = "absolute";
            badge.style.padding = "8px 12px";
            badge.style.borderRadius = "12px";
            badge.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
            badge.style.fontSize = "14px";
            badge.style.fontWeight = "600";
            badge.style.color = "white";
            badge.style.background = "#888";
            badge.style.boxShadow = "0 6px 20px rgba(0,0,0,0.25)";
            badge.style.opacity = "0.95";
            badge.textContent = label;
            return badge;
        };

        const lightingBadge = makeBadge("badgeLighting", "LIGHTING");
        lightingBadge.style.top = "16px";
        lightingBadge.style.left = "16px";

        const poseBadge = makeBadge("badgePose", "POSE");
        poseBadge.style.top = "16px";
        poseBadge.style.right = "16px";

        const distanceBadge = makeBadge("badgeDistance", "DISTANCE");
        distanceBadge.style.bottom = "16px";
        distanceBadge.style.left = "16px";

        overlay.appendChild(lightingBadge);
        overlay.appendChild(poseBadge);
        overlay.appendChild(distanceBadge);

        const cameraPreview = document.getElementById("cameraPreview");
        if (cameraPreview) {
            cameraPreview.style.position = cameraPreview.style.position || "relative";
            cameraPreview.appendChild(overlay);
            console.log("✅ QualityGate overlay inserted into #cameraPreview");
        } else {
            document.body.appendChild(overlay);
            console.warn("⚠️ #cameraPreview not found; overlay appended to body");
        }

        this.overlay = overlay;
    }

    setBadgeState(badgeId, isGood) {
        const badge = document.getElementById(badgeId);
        if (!badge) return;

        // good = ocean blue, bad = grey
        badge.style.background = isGood ? "#0077FF" : "#777";
    }

    showBadges() {
        if (!this.overlay) this.createUIOverlay();
        if (!this.overlay) return;

        this.overlay.style.display = "block";
        this.badgesVisible = true;
    }

    hideBadges() {
        if (!this.overlay) return;
        this.overlay.style.display = "none";
        this.badgesVisible = false;
    }

    // ====== Quality checks (lighting, pose, distance) ======

    checkLighting(imageData) {
        // Basic brightness + contrast check (HSV V channel)
        const data = imageData.data;

        let sum = 0;
        let sumSq = 0;
        let count = 0;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i] / 255;
            const g = data[i + 1] / 255;
            const b = data[i + 2] / 255;

            // approximate V in HSV as max(r,g,b)
            const v = Math.max(r, g, b);
            sum += v;
            sumSq += v * v;
            count++;
        }

        const meanV = sum / count;
        const stdV = Math.sqrt(sumSq / count - meanV * meanV);

        // Rules: Good if 0.35 < mean(V) < 0.75 AND std(V) > 0.08
        const isGood = meanV > 0.35 && meanV < 0.75 && stdV > 0.08;
        return isGood;
    }

    checkPose(faceLandmarks) {
        // Very simple: assume good if face landmarks exist and head isn't too rotated
        // You can replace with a real head pose estimation later.
        if (!faceLandmarks || faceLandmarks.length === 0) return false;
        return true;
    }

    checkDistance(faceLandmarks) {
        // Estimate face size from landmarks bounding box
        if (!faceLandmarks || faceLandmarks.length === 0) return false;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;

        for (const p of faceLandmarks) {
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minY = Math.min(minY, p.y);
            maxY = Math.max(maxY, p.y);
        }

        const width = maxX - minX;
        const height = maxY - minY;

        // Heuristic: good if face box is reasonably large
        const isGood = width > 0.25 && height > 0.25 && width < 0.9 && height < 0.9;
        return isGood;
    }

    updateBadges() {
        // Only update if visible
        if (!this.badgesVisible) return;

        // Avoid DOM spam: update only on change
        const { lighting, pose, distance } = this.qualityStates;

        if (this.lastBadgeStates.lighting !== lighting) {
            this.setBadgeState("badgeLighting", lighting);
            this.lastBadgeStates.lighting = lighting;
        }
        if (this.lastBadgeStates.pose !== pose) {
            this.setBadgeState("badgePose", pose);
            this.lastBadgeStates.pose = pose;
        }
        if (this.lastBadgeStates.distance !== distance) {
            this.setBadgeState("badgeDistance", distance);
            this.lastBadgeStates.distance = distance;
        }
    }

    updateAllGreenState() {
        const allGreen =
            this.qualityStates.lighting &&
            this.qualityStates.pose &&
            this.qualityStates.distance;

        if (allGreen) {
            // All checks are green (ocean blue)
            if (this.allGreenSince === null) {
                // Just became all green - start timer
                this.allGreenSince = Date.now();
            } else {
                // Check if we've been green long enough
                const duration = Date.now() - this.allGreenSince;
                if (duration >= this.REQUIRED_GREEN_DURATION) {
                    // Stable for ≥500ms - hide badges and trigger analysis
                    if (this.state !== 'ALL_GREEN') {
                        this.state = 'ALL_GREEN';
                        console.log('✅ QualityGate: All checks green for ≥500ms - hiding badges and triggering analysis');
                        this.hideBadges(); // Hide badges when all are good
                        if (this.onQualityChange) {
                            this.onQualityChange(true);
                        }
                    }
                }
            }
        } else {
            // At least one check failed - reset timer
            if (this.allGreenSince !== null) {
                this.allGreenSince = null;
                if (this.state === 'ALL_GREEN') {
                    this.state = 'LIVE_QUALITY_CHECKS';
                    console.log('⚠️ QualityGate: Quality check failed - showing badges again');
                    this.showBadges(); // Show badges again if quality drops
                    if (this.onQualityChange) {
                        this.onQualityChange(false);
                    }
                }
            }
        }
    }

    isAnalysisAllowed() {
        return this.state === 'ALL_GREEN';
    }

    getQualityStates() {
        return { ...this.qualityStates };
    }

    // ✅ Added: unified state getter used by app.js
    getState() {
        const allGreen = this.state === 'ALL_GREEN';
        const durationMs = this.allGreenSince ? (Date.now() - this.allGreenSince) : 0;
        return {
            state: this.state,
            allGreen,
            allGreenSince: this.allGreenSince,
            allGreenDurationMs: allGreen ? durationMs : 0,
            qualityStates: { ...this.qualityStates },
            fatal: !!this.faceMeshError
        };
    }
}

// единый экземпляр
console.log("🔍 About to create QualityGate instance");
let qg;
try {
    qg = new QualityGate();
    console.log("✅ QualityGate constructor succeeded");
} catch (err) {
    console.error("❌ QualityGate constructor failed:", err);
    console.error("❌ Stack:", err.stack);
    // DON'T throw - assign bridge anyway so app.js can detect failure
    qg = null;

    // ✅ Added: fatal bridge so app.js can bypass gating safely
    window.__RUNOVA__ = window.__RUNOVA__ || {};
    window.__RUNOVA__.fatal = true;
    window.__RUNOVA__.fatalReason = 'QualityGate constructor failed';
}

console.log("🔍 About to assign bridge, qg:", qg);

// Canonical bridge (assign even if constructor failed)
if (!window.__RUNOVA__) {
    console.error("❌ window.__RUNOVA__ disappeared!");
    window.__RUNOVA__ = {};
}

// ✅ Added: if instance missing, mark fatal so app.js can bypass
if (!qg) {
    window.__RUNOVA__.fatal = true;
    window.__RUNOVA__.fatalReason = window.__RUNOVA__.fatalReason || 'QualityGate unavailable';
}

window.__RUNOVA__.QualityGate = QualityGate;
window.__RUNOVA__.qualityGate = qg;

// Legacy (do not remove yet)

console.log("🔥 quality-gate.js loaded, bridge:", window.__RUNOVA__);
console.log("🔍 Final window.__RUNOVA__ check:", typeof window.__RUNOVA__, window.__RUNOVA__);
