/**
 * Face Detection using MediaPipe Face Mesh
 * On-device face detection, ROI cropping, and region stabilization
 */

// Global readiness flag (mandatory)
window.faceDetectionReady = false;

class FaceDetectionManager {
    constructor() {
        this.faceMesh = null;
        this.isInitialized = false;
        this.currentLandmarks = null;
        this.stabilizedLandmarks = null;
        this.stabilizationBuffer = [];
        this.bufferSize = 5; // Number of frames to average for stabilization
        this.faceDetected = false;
        this.faceBoundingBox = null;
        this.stabilizedBoundingBox = null;
    }

    async initialize() {
        if (this.isInitialized) {
            return true;
        }

        try {
            // Check if FaceMesh is available
            if (typeof FaceMesh === 'undefined') {
                console.error('❌ MediaPipe FaceMesh not loaded. Check script tags.');
                return false;
            }

            this.faceMesh = new FaceMesh({
                locateFile: (file) => {
                    return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`;
                }
            });

            this.faceMesh.setOptions({
                maxNumFaces: 1,
                refineLandmarks: true,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });

            this.faceMesh.onResults((results) => {
                this.processResults(results);
            });

            this.isInitialized = true;
            console.log('✅ MediaPipe Face Mesh initialized');
            return true;
        } catch (error) {
            console.error('❌ Face detection initialization error:', error);
            return false;
        }
    }

    processResults(results) {
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            this.currentLandmarks = results.multiFaceLandmarks[0];
            this.faceDetected = true;
            
            // Calculate bounding box from landmarks
            this.faceBoundingBox = this.calculateBoundingBox(this.currentLandmarks);
            
            // Stabilize landmarks
            this.stabilizeLandmarks();
            
            // Stabilize bounding box
            this.stabilizeBoundingBox();
        } else {
            this.faceDetected = false;
            this.currentLandmarks = null;
            this.faceBoundingBox = null;
            this.stabilizedLandmarks = null;
            this.stabilizedBoundingBox = null;
            this.stabilizationBuffer = [];
        }
    }

    calculateBoundingBox(landmarks) {
        if (!landmarks || landmarks.length === 0) {
            return null;
        }

        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        landmarks.forEach(landmark => {
            minX = Math.min(minX, landmark.x);
            minY = Math.min(minY, landmark.y);
            maxX = Math.max(maxX, landmark.x);
            maxY = Math.max(maxY, landmark.y);
        });

        // Add padding (10% on each side)
        const paddingX = (maxX - minX) * 0.1;
        const paddingY = (maxY - minY) * 0.1;

        return {
            x: Math.max(0, minX - paddingX),
            y: Math.max(0, minY - paddingY),
            width: Math.min(1, maxX - minX + 2 * paddingX),
            height: Math.min(1, maxY - minY + 2 * paddingY),
            centerX: (minX + maxX) / 2,
            centerY: (minY + maxY) / 2
        };
    }

    stabilizeLandmarks() {
        if (!this.currentLandmarks) {
            return;
        }

        // Add current landmarks to buffer
        this.stabilizationBuffer.push(this.currentLandmarks);

        // Keep buffer size limited
        if (this.stabilizationBuffer.length > this.bufferSize) {
            this.stabilizationBuffer.shift();
        }

        // Average landmarks across buffer
        if (this.stabilizationBuffer.length > 0) {
            const numLandmarks = this.currentLandmarks.length;
            this.stabilizedLandmarks = [];

            for (let i = 0; i < numLandmarks; i++) {
                let sumX = 0, sumY = 0, sumZ = 0;

                this.stabilizationBuffer.forEach(landmarks => {
                    sumX += landmarks[i].x;
                    sumY += landmarks[i].y;
                    sumZ += landmarks[i].z;
                });

                this.stabilizedLandmarks.push({
                    x: sumX / this.stabilizationBuffer.length,
                    y: sumY / this.stabilizationBuffer.length,
                    z: sumZ / this.stabilizationBuffer.length
                });
            }
        }
    }

    stabilizeBoundingBox() {
        if (!this.faceBoundingBox) {
            return;
        }

        // Simple exponential smoothing for bounding box
        if (!this.stabilizedBoundingBox) {
            this.stabilizedBoundingBox = { ...this.faceBoundingBox };
        } else {
            const alpha = 0.3; // Smoothing factor (0-1, lower = more smoothing)
            this.stabilizedBoundingBox.x = alpha * this.faceBoundingBox.x + (1 - alpha) * this.stabilizedBoundingBox.x;
            this.stabilizedBoundingBox.y = alpha * this.faceBoundingBox.y + (1 - alpha) * this.stabilizedBoundingBox.y;
            this.stabilizedBoundingBox.width = alpha * this.faceBoundingBox.width + (1 - alpha) * this.stabilizedBoundingBox.width;
            this.stabilizedBoundingBox.height = alpha * this.faceBoundingBox.height + (1 - alpha) * this.stabilizedBoundingBox.height;
            this.stabilizedBoundingBox.centerX = alpha * this.faceBoundingBox.centerX + (1 - alpha) * this.stabilizedBoundingBox.centerX;
            this.stabilizedBoundingBox.centerY = alpha * this.faceBoundingBox.centerY + (1 - alpha) * this.stabilizedBoundingBox.centerY;
        }
    }

    async detectFace(imageElement) {
        if (!this.isInitialized || !this.faceMesh) {
            await this.initialize();
        }

        if (!this.faceMesh) {
            return { detected: false };
        }

        try {
            await this.faceMesh.send({ image: imageElement });
            
            return {
                detected: this.faceDetected,
                landmarks: this.stabilizedLandmarks || this.currentLandmarks,
                boundingBox: this.stabilizedBoundingBox || this.faceBoundingBox
            };
        } catch (error) {
            console.error('Face detection error:', error);
            return { detected: false, error: error.message };
        }
    }

    cropFaceROI(imageElement, boundingBox, canvas) {
        if (!boundingBox || !imageElement) {
            return null;
        }

        const ctx = canvas.getContext('2d');
        const imgWidth = imageElement.videoWidth || imageElement.width;
        const imgHeight = imageElement.videoHeight || imageElement.height;

        // Convert normalized coordinates to pixel coordinates
        const x = Math.floor(boundingBox.x * imgWidth);
        const y = Math.floor(boundingBox.y * imgHeight);
        const width = Math.floor(boundingBox.width * imgWidth);
        const height = Math.floor(boundingBox.height * imgHeight);

        // Set canvas size to ROI
        canvas.width = width;
        canvas.height = height;

        // Mirror the image (like the original captureFrame does)
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(
            imageElement,
            x, y, width, height,
            -width, 0, width, height
        );
        ctx.restore();

        return canvas;
    }

    cropRegionROI(imageElement, regionLandmarks, canvas) {
        if (!regionLandmarks || regionLandmarks.length === 0 || !imageElement) {
            return null;
        }

        // Calculate bounding box for specific region
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        regionLandmarks.forEach(landmark => {
            minX = Math.min(minX, landmark.x);
            minY = Math.min(minY, landmark.y);
            maxX = Math.max(maxX, landmark.x);
            maxY = Math.max(maxY, landmark.y);
        });

        const imgWidth = imageElement.videoWidth || imageElement.width;
        const imgHeight = imageElement.videoHeight || imageElement.height;

        // Add padding
        const paddingX = (maxX - minX) * 0.15;
        const paddingY = (maxY - minY) * 0.15;

        const x = Math.max(0, Math.floor((minX - paddingX) * imgWidth));
        const y = Math.max(0, Math.floor((minY - paddingY) * imgHeight));
        const width = Math.min(imgWidth - x, Math.floor((maxX - minX + 2 * paddingX) * imgWidth));
        const height = Math.min(imgHeight - y, Math.floor((maxY - minY + 2 * paddingY) * imgHeight));

        const ctx = canvas.getContext('2d');
        canvas.width = width;
        canvas.height = height;

        // Mirror the image (like the original captureFrame does)
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(
            imageElement,
            x, y, width, height,
            -width, 0, width, height
        );
        ctx.restore();

        return canvas;
    }

    // Get specific facial region landmarks (MediaPipe Face Mesh has 468 landmarks)
    getRegionLandmarks(region) {
        if (!this.stabilizedLandmarks && !this.currentLandmarks) {
            return null;
        }

        const landmarks = this.stabilizedLandmarks || this.currentLandmarks;

        // MediaPipe Face Mesh landmark indices for different regions
        const regions = {
            // Forehead (approximate)
            forehead: [10, 151, 9, 10, 151, 337, 299, 333, 298, 301],
            // Left cheek
            leftCheek: [116, 117, 118, 119, 120, 121, 126, 142, 36, 205, 206, 207],
            // Right cheek
            rightCheek: [345, 346, 347, 348, 349, 350, 451, 452, 266, 425, 426, 427],
            // Left eye region
            leftEye: [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
            // Right eye region
            rightEye: [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398],
            // Nose
            nose: [4, 5, 6, 19, 20, 94, 125, 141, 235, 236, 3, 51, 48, 115, 131, 134, 102, 49, 220, 305, 281, 363, 360, 279, 358, 327, 326, 2, 97, 98, 327],
            // Mouth
            mouth: [61, 146, 91, 181, 84, 17, 314, 405, 320, 307, 375, 321, 308, 324, 318],
            // Chin
            chin: [18, 200, 199, 175, 18, 175, 18, 175, 18, 175]
        };

        const regionIndices = regions[region];
        if (!regionIndices) {
            return null;
        }

        return regionIndices.map(idx => landmarks[idx]).filter(Boolean);
    }

    /**
     * Validation Methods
     */
    
    validateFaceSize(boundingBox, imageWidth, imageHeight) {
        if (!boundingBox) {
            return { valid: false, message: "Face not detected" };
        }

        // Calculate face size as percentage of image
        const faceArea = boundingBox.width * boundingBox.height;
        const imageArea = imageWidth * imageHeight;
        const facePercentage = (faceArea / imageArea) * 100;

        // Face should be between 15% and 60% of image area
        const MIN_FACE_SIZE = 15; // percentage
        const MAX_FACE_SIZE = 60; // percentage

        if (facePercentage < MIN_FACE_SIZE) {
            return { valid: false, message: "Move closer" };
        }
        if (facePercentage > MAX_FACE_SIZE) {
            return { valid: false, message: "Move farther away" };
        }

        return { valid: true };
    }

    validateLighting(imageElement, boundingBox) {
        if (!boundingBox || !imageElement) {
            return { valid: false, message: "Face not detected" };
        }

        // Create temporary canvas to analyze face region brightness
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const imgWidth = imageElement.videoWidth || imageElement.width;
        const imgHeight = imageElement.videoHeight || imageElement.height;

        // Crop face region
        const x = Math.floor(boundingBox.x * imgWidth);
        const y = Math.floor(boundingBox.y * imgHeight);
        const width = Math.floor(boundingBox.width * imgWidth);
        const height = Math.floor(boundingBox.height * imgHeight);

        canvas.width = width;
        canvas.height = height;

        ctx.drawImage(
            imageElement,
            x, y, width, height,
            0, 0, width, height
        );

        // Get image data and calculate average brightness
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;
        let totalBrightness = 0;
        let pixelCount = 0;

        // Sample every 10th pixel for performance (RGBA = 4 bytes per pixel)
        const sampleRate = 10;
        for (let i = 0; i < data.length; i += (4 * sampleRate)) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            // Calculate luminance (perceived brightness)
            const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            totalBrightness += brightness;
            pixelCount++;
        }

        const avgBrightness = totalBrightness / pixelCount;

        // Check for too dark (below 0.2) or too bright/blown out (above 0.9)
        const MIN_BRIGHTNESS = 0.2;
        const MAX_BRIGHTNESS = 0.9;

        if (avgBrightness < MIN_BRIGHTNESS) {
            return { valid: false, message: "Too dark" };
        }
        if (avgBrightness > MAX_BRIGHTNESS) {
            return { valid: false, message: "Too bright" };
        }

        return { valid: true };
    }

    validateOrientation(landmarks) {
        if (!landmarks || landmarks.length < 468) {
            return { valid: false, message: "Face not detected" };
        }

        // Use key facial landmarks to determine orientation
        // MediaPipe landmark indices for key points:
        const NOSE_TIP = 4;
        const LEFT_EYE = 33;
        const RIGHT_EYE = 263;
        const LEFT_MOUTH = 61;
        const RIGHT_MOUTH = 291;
        const CHIN = 18;

        const nose = landmarks[NOSE_TIP];
        const leftEye = landmarks[LEFT_EYE];
        const rightEye = landmarks[RIGHT_EYE];
        const leftMouth = landmarks[LEFT_MOUTH];
        const rightMouth = landmarks[RIGHT_MOUTH];
        const chin = landmarks[CHIN];

        // Calculate face center
        const faceCenterX = (leftEye.x + rightEye.x) / 2;
        const faceCenterY = (leftEye.y + rightEye.y + chin.y) / 3;

        // Check horizontal alignment (yaw)
        const eyeDistance = Math.abs(leftEye.x - rightEye.x);
        const eyeCenterX = (leftEye.x + rightEye.x) / 2;
        const noseOffsetX = Math.abs(nose.x - eyeCenterX);
        const yawRatio = noseOffsetX / eyeDistance;

        // Check vertical alignment (pitch)
        const eyeCenterY = (leftEye.y + rightEye.y) / 2;
        const noseOffsetY = nose.y - eyeCenterY;
        const mouthCenterY = (leftMouth.y + rightMouth.y) / 2;
        const faceHeight = Math.abs(eyeCenterY - chin.y);
        const pitchRatio = Math.abs(noseOffsetY) / faceHeight;

        // Thresholds for acceptable orientation
        const MAX_YAW = 0.15; // 15% offset from center
        const MAX_PITCH = 0.25; // 25% vertical offset

        if (yawRatio > MAX_YAW) {
            // Determine left or right
            if (nose.x < eyeCenterX) {
                return { valid: false, message: "Turn slightly right" };
            } else {
                return { valid: false, message: "Turn slightly left" };
            }
        }

        if (pitchRatio > MAX_PITCH) {
            if (noseOffsetY > 0) {
                return { valid: false, message: "Look up slightly" };
            } else {
                return { valid: false, message: "Look down slightly" };
            }
        }

        return { valid: true };
    }

    /**
     * Validate all conditions before analysis
     * Returns: { valid: boolean, message: string }
     */
    async validateForAnalysis(imageElement) {
        // Step 1: Face must be detected
        const faceResult = await this.detectFace(imageElement);
        if (!faceResult.detected || !faceResult.boundingBox) {
            return { valid: false, message: "Face not detected" };
        }

        const boundingBox = faceResult.boundingBox;
        const landmarks = faceResult.landmarks;
        const imgWidth = imageElement.videoWidth || imageElement.width;
        const imgHeight = imageElement.videoHeight || imageElement.height;

        // Step 2: Validate face size (distance)
        const sizeValidation = this.validateFaceSize(boundingBox, imgWidth, imgHeight);
        if (!sizeValidation.valid) {
            return sizeValidation;
        }

        // Step 3: Validate lighting
        const lightingValidation = this.validateLighting(imageElement, boundingBox);
        if (!lightingValidation.valid) {
            return lightingValidation;
        }

        // Step 4: Validate orientation
        const orientationValidation = this.validateOrientation(landmarks);
        if (!orientationValidation.valid) {
            return orientationValidation;
        }

        // All validations passed
        return { valid: true, message: "Ready to analyze" };
    }

    reset() {
        this.stabilizationBuffer = [];
        this.currentLandmarks = null;
        this.stabilizedLandmarks = null;
        this.faceBoundingBox = null;
        this.stabilizedBoundingBox = null;
        this.faceDetected = false;
    }
}

// Global face detection instance
const faceDetectionManager = new FaceDetectionManager();

/**
 * Initialize face detection and set readiness flag
 */
async function initFaceDetection() {
    if (window.faceDetectionReady) {
        console.log("✅ Face detection already ready");
        return true;
    }

    try {
        // Initialize MediaPipe setup
        const initialized = await faceDetectionManager.initialize();
        
        if (initialized) {
            window.faceDetectionManager = faceDetectionManager;
            window.faceDetectionReady = true;
            console.log("✅ Face detection ready");
            return true;
        } else {
            console.error("❌ Face detection initialization failed");
            return false;
        }
    } catch (error) {
        console.error("❌ Face detection initialization error:", error);
        return false;
    }
}

// Export initFaceDetection globally
window.initFaceDetection = initFaceDetection;

// Auto-initialize when script loads (if MediaPipe is available)
// Note: This may run before MediaPipe scripts are loaded, so we also call it from app.js
if (typeof FaceMesh !== 'undefined') {
    initFaceDetection().catch(err => {
        console.error("❌ Failed to auto-initialize face detection:", err);
    });
}


