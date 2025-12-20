/**
 * Camera Management
 * Handles external webcam access and video stream
 */

class CameraManager {
    constructor() {
        this.stream = null;
        this.video = document.getElementById('cameraVideo');
        this.canvas = document.getElementById('cameraCanvas');
        this.isActive = false;
    }

    async initialize() {
        try {
            // Try to get external webcam first, then fallback to default
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            
            let constraints = {
                video: {
                    width: { ideal: 1280, min: 640 },
                    height: { ideal: 720, min: 480 },
                    aspectRatio: { ideal: 3/4 },
                    facingMode: 'user'
                },
                audio: false
            };

            // Try to find external webcam (usually not 'environment' on desktop)
            const externalCam = videoDevices.find(d => 
                d.label.toLowerCase().includes('external') ||
                d.label.toLowerCase().includes('usb') ||
                d.label.toLowerCase().includes('logitech') ||
                d.label.toLowerCase().includes('camera')
            );

            if (externalCam && videoDevices.length > 1) {
                constraints.video.deviceId = { exact: externalCam.deviceId };
                console.log('📹 Using external webcam:', externalCam.label);
            }

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            this.isActive = true;
            
            await this.video.play();
            console.log('✅ Camera initialized');
            return true;
        } catch (error) {
            console.error('❌ Camera error:', error);
            this.showCameraError();
            return false;
        }
    }

    showCameraError() {
        const preview = document.getElementById('cameraPreview');
        preview.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: white; text-align: center; padding: 20px;">
                <div>
                    <div style="font-size: 48px; margin-bottom: 16px;">📷</div>
                    <div>Camera not available</div>
                    <div style="font-size: 14px; margin-top: 8px; opacity: 0.8;">Please allow camera access</div>
                </div>
            </div>
        `;
    }

    captureFrame() {
        if (!this.isActive || !this.video.videoWidth) {
            return null;
        }

        const ctx = this.canvas.getContext('2d');
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        
        // Draw video frame to canvas (mirror it back for correct orientation)
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(this.video, -this.canvas.width, 0, this.canvas.width, this.canvas.height);
        ctx.restore();

        // Convert to base64
        return this.canvas.toDataURL('image/jpeg', 0.9);
    }

    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
            this.isActive = false;
        }
    }
}

// Global camera instance
const cameraManager = new CameraManager();

