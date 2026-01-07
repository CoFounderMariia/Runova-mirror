/**
 * Camera Management
 * Handles external webcam access and video stream
 */

class CameraManager {
    constructor() {
        this.stream = null;
        this.isActive = false;
    }

    async initialize() {
        if (this.isActive && this.stream) return true;

        
        this.video = document.getElementById("cameraVideo");
                
        if (!this.video || !this.canvas) {
            console.error("❌ cameraVideo / cameraCanvas not found in DOM");
            return false;
        }

        try { // Try to get external webcam first, then fallback to default
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(d => d.kind === 'videoinput');
            
            let constraints = {
                video: {
                    width: { ideal: 1280, min: 640 },
                    height: { ideal: 720, min: 480 },
                    facingMode: 'user'
                },
                audio: false
            };

            // Try to find external webcam (usually not 'environment' on desktop)
           
            
              

            if (videoDevices.length > 1) {
                constraints.video.deviceId = { exact: videoDevices[0].deviceId };
            }
            

            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video.srcObject = this.stream;
            this.isActive = true;
            
            this.video.setAttribute('playsinline', true);
            this.video.muted = true;
            await this.video.play();
            console.log('✅ Camera initialized');
            return true;
        } catch (error) {
            console.error('❌ Camera error:', error);
            // this.showCameraError(); // disabled: no visible camera error UI
            return false;
        }
    }

    showCameraError() {
        // disabled: camera error UI not allowed
        return;

        const preview = document.getElementById("cameraPreview");
        if (!preview) return;
    
        preview.innerHTML = `
            <div style="color:white;text-align:center">
                <div style="font-size:40px">📷</div>
                <div>Camera not available</div>
            </div>
        `;
    }
    

    captureFrame() {
        if (!this.video || this.video.readyState < 2) {
            return null;
        }
    
        const canvas = document.createElement('canvas');
        canvas.width = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
    
        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.scale(-1, 1);
        ctx.drawImage(this.video, -canvas.width, 0, canvas.width, canvas.height);
        ctx.restore();
    
        return canvas.toDataURL('image/jpeg', 0.9);
    }
    
    stop() {
        if (!this.stream) return;

        this.stream.getTracks().forEach(t => t.stop());
        this.video.srcObject = null;
        this.stream = null;
        this.isActive = false;
        console.log("🛑 Camera stopped");
    }
}
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        window.cameraManager?.stop();
    }
});

window.cameraManager = window.cameraManager || new CameraManager();
