/**
 * Face Scan Module
 * Handles Face-ID style scanning with progress and instructions
 */

class FaceScanner {
    constructor() {
        this.isScanning = false;
        this.scanProgress = 0;
        this.currentStep = 0;

        this.overlay = null;
        this.instructions = null;
        this.progressBar = null;
        this.progressText = null;

        this.scanSteps = [
            { text: 'Look straight ahead', duration: 1000 },
            { text: 'Turn your head left →', duration: 1000 },
            { text: 'Turn your head right ←', duration: 1000 },
            { text: 'Look up ↑', duration: 1000 }
        ];

        this.initDOM();
    }

    initDOM() {
        this.overlay = document.getElementById('faceScanOverlay');
        this.instructions = document.getElementById('scanInstructions');
        this.progressBar = document.getElementById('progressBar');
        this.progressText = document.getElementById('progressText');

        if (!this.overlay || !this.instructions || !this.progressBar || !this.progressText) {
            console.error("❌ FaceScanner DOM missing");
            return false;
        }
        return true;
    }

    async startScan() {
        if (!this.overlay) {
            console.error("❌ FaceScanner DOM not initialized");
            return;
        }

        if (this.isScanning) {
            console.log('⚠️ Scan already in progress');
            return;
        }

        if (!window.cameraManager || !window.cameraManager.isActive) {
            alert('Camera not ready.');
            this.finishScan();
            return;
        }

        this.isScanning = true;
        this.scanProgress = 0;
        this.currentStep = 0;
        this.overlay.classList.add('active');

        const scanButton = document.getElementById('scanButton');
        if (scanButton) {
            scanButton.disabled = true;
            scanButton.style.opacity = '0.5';
        }

        try {
            this.updateProgress(0);

            for (let i = 0; i < this.scanSteps.length; i++) {
                this.currentStep = i;
                this.updateInstructions(this.scanSteps[i].text);
                await this.wait(this.scanSteps[i].duration);

                const progress = ((i + 1) / this.scanSteps.length) * 100;
                this.updateProgress(progress);
            }

            const imageData = window.cameraManager.captureFrame();
            if (!imageData) {
                throw new Error('Failed to capture image');
            }

            await this.sendScanToBackend(imageData);

        } catch (error) {
            console.error('Scan error:', error);
            this.showError('Scan failed. Please try again.');
        } finally {
            this.finishScan();
        }
    }

    updateProgress(percent) {
        this.scanProgress = percent;
        this.progressBar.style.width = `${percent}%`;
        this.progressText.textContent = `${Math.round(percent)}%`;
    }

    updateInstructions(text) {
        this.instructions.textContent = text;
    }

    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async sendScanToBackend(imageData) {
        try {
            const base64Data = imageData.split(',')[1];

            const response = await fetch('/scan-face', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64Data, language: 'en' })
            });

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json();

            window.memory?.handleSkinAnalysis?.(data);
            window.chatManager?.addMessage?.('assistant', data.analysis, 'Runova');

            if (data.audio_url) {
                window.playAudio?.(data.audio_url);
            }

            this.showRecommendations(data.analysis);

        } finally {
            window.showLoading?.(false);
        }
    }

    showRecommendations(analysis) {
        const recommendations = this.generatePlaceholderRecommendations(
            this.extractConcerns(analysis)
        );

        recommendations.forEach(rec => {
            window.memory?.addRecommendation?.(rec);
            window.productManager?.addProductCard?.(rec);
        });
    }

    extractConcerns(analysis) {
        const concerns = [];
        const map = {
            acne: ['acne', 'pimple'],
            dryness: ['dry'],
            oiliness: ['oil'],
            redness: ['red']
        };

        const text = analysis.toLowerCase();
        for (const key in map) {
            if (map[key].some(w => text.includes(w))) {
                concerns.push(key);
            }
        }
        return concerns;
    }

    generatePlaceholderRecommendations(concerns) {
        if (!concerns.length) {
            return [{
                name: 'Daily Moisturizer',
                benefits: 'Hydration and barrier support',
                usage: 'Morning and evening',
                image: 'https://via.placeholder.com/80'
            }];
        }
        return [];
    }

    finishScan() {
        this.isScanning = false;
        if (this.overlay) this.overlay.classList.remove('active');

        this.updateProgress(0);
        this.updateInstructions('');

        const scanButton = document.getElementById('scanButton');
        if (scanButton) {
            scanButton.disabled = false;
            scanButton.style.opacity = '1';
        }
    }

    showError(message) {
        this.instructions.textContent = message;
        setTimeout(() => this.finishScan(), 3000);
    }
}

window.faceScanner = new FaceScanner();
