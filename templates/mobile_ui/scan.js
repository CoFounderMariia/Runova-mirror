/**
 * Face Scan Module
 * Handles Face-ID style scanning with progress and instructions
 */

class FaceScanner {
    constructor() {
        this.isScanning = false;
        this.scanProgress = 0;
        this.scanInterval = null;
        this.overlay = document.getElementById('faceScanOverlay');
        this.instructions = document.getElementById('scanInstructions');
        this.progressBar = document.getElementById('progressBar');
        this.progressText = document.getElementById('progressText');
        this.currentStep = 0;
        this.scanSteps = [
            { text: 'Look straight ahead', duration: 1000 },
            { text: 'Turn your head left →', duration: 1000 },
            { text: 'Turn your head right ←', duration: 1000 },
            { text: 'Look up ↑', duration: 1000 }
        ];
    }

    async startScan() {
        if (this.isScanning) {
            console.log('⚠️ Scan already in progress');
            return;
        }

        this.isScanning = true;
        this.scanProgress = 0;
        this.currentStep = 0;
        this.overlay.classList.add('active');
        
        // Disable scan button
        const scanButton = document.getElementById('scanButton');
        scanButton.disabled = true;
        scanButton.style.opacity = '0.5';

        try {
            // Start progress animation
            this.updateProgress(0);
            this.updateInstructions('Loading static image...');

            // Load static base64 image from backend
            const imageData = await this.loadStaticImage();
            if (!imageData) {
                throw new Error('Failed to load static image');
            }

            // Update progress
            this.updateProgress(100);
            this.updateInstructions('Analyzing image...');

            // Send to backend
            await this.sendScanToBackend(imageData);

        } catch (error) {
            console.error('Scan error:', error);
            this.showError('Scan failed. Please try again.');
        } finally {
            this.finishScan();
        }
    }

    async loadStaticImage() {
        try {
            const response = await fetch('/static-image');
            if (!response.ok) {
                throw new Error(`Failed to load static image: ${response.status}`);
            }
            
            const data = await response.json();
            const base64String = data.base64;
            const prefix = data.format || 'data:image/jpeg;base64,';
            
            // Return full data URL format
            return prefix + base64String;
        } catch (error) {
            console.error('Error loading static image:', error);
            throw error;
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
        showLoading(true);
        
        try {
            // Remove data URL prefix
            const base64Data = imageData.split(',')[1];
            
            const response = await fetch('/skin-analyze', {
                method: 'POST',
                body: (() => {
                    const formData = new FormData();
                    formData.append(
                        "image",
                        this.base64ToBlob(base64Data),
                        "scan.jpg"
                    );
                    return formData;
                })()
            });
            

            if (!response.ok) {
                throw new Error(`Server error: ${response.status}`);
            }

            const data = await response.json();
            
            // Handle both old format (data.analysis) and new format (data.skin_report)
            let analysisText = data.analysis;
            let concerns = [];
            
            if (data.skin_report) {
                // New format with metrics
                console.log('✅ Received skin_report with metrics:', data.skin_report);
                
                // Format metrics for display
                if (typeof formatSkinMetrics === 'function') {
                    analysisText = formatSkinMetrics(data.skin_report);
                } else {
                    // Fallback formatting if formatSkinMetrics not available
                    const metrics = data.skin_report;
                    const parts = ['**Your Skin Analysis Results:**\n\n'];
                    for (const [key, value] of Object.entries(metrics)) {
                        if (key !== 'raw_data' && key !== 'available_keys' && value != null) {
                            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                            const score = typeof value === 'number' ? Math.round(value) : value;
                            parts.push(`• **${label}:** ${score}/100`);
                        }
                    }
                    analysisText = parts.join('\n');
                }
                
                // Extract concerns from metrics
                if (typeof extractConcernsFromMetrics === 'function') {
                    concerns = extractConcernsFromMetrics(data.skin_report);
                } else {
                    concerns = this.extractConcerns(analysisText);
                }
            } else if (data.analysis) {
                // Old format
                concerns = this.extractConcerns(data.analysis);
            }
            
            // Store in memory
            memory.storeScan({
                analysis: analysisText,
                image: imageData,
                concerns: concerns
            });

            // Show result in chat
            chatManager.addMessage('assistant', analysisText, 'Runova');
            
            // Play audio if available
            if (data.audio_url) {
                playAudio(data.audio_url);
            }

            // Extract and show product recommendations
            this.showRecommendations(analysisText);

        } catch (error) {
            console.error('Backend error:', error);
            throw error;
        } finally {
            showLoading(false);
        }
    }

    extractConcerns(analysis) {
        // Simple extraction - can be improved with NLP
        const concerns = [];
        const concernKeywords = {
            'acne': ['acne', 'pimple', 'breakout', 'zit'],
            'dryness': ['dry', 'dehydrated', 'flaky'],
            'oiliness': ['oil', 'greasy', 'shiny', 'sebum'],
            'redness': ['red', 'irritated', 'inflamed'],
            'pores': ['pore', 'blackhead', 'comedone'],
            'pigmentation': ['pigment', 'dark spot', 'melasma', 'sun spot']
        };

        const lowerAnalysis = analysis.toLowerCase();
        for (const [concern, keywords] of Object.entries(concernKeywords)) {
            if (keywords.some(keyword => lowerAnalysis.includes(keyword))) {
                concerns.push(concern);
            }
        }

        return concerns;
    }

    showRecommendations(analysis) {
        // Extract product recommendations from analysis
        // For now, show placeholder recommendations based on concerns
        const concerns = this.extractConcerns(analysis);
        
        // This would normally come from backend, but for now use placeholders
        const recommendations = this.generatePlaceholderRecommendations(concerns);
        
        recommendations.forEach(rec => {
            memory.addRecommendation(rec);
            productManager.addProductCard(rec);
        });
    }

    generatePlaceholderRecommendations(concerns) {
        const productMap = {
            'acne': {
                name: 'Salicylic Acid Cleanser',
                benefits: 'Reduces acne and unclogs pores',
                usage: 'Use morning and evening',
                image: 'https://via.placeholder.com/80?text=Cleanser'
            },
            'dryness': {
                name: 'Hyaluronic Acid Serum',
                benefits: 'Deep hydration and moisture retention',
                usage: 'Apply after cleansing, before moisturizer',
                image: 'https://via.placeholder.com/80?text=Serum'
            },
            'oiliness': {
                name: 'Niacinamide Toner',
                benefits: 'Controls oil production and minimizes pores',
                usage: 'Use after cleansing, morning routine',
                image: 'https://via.placeholder.com/80?text=Toner'
            },
            'redness': {
                name: 'Centella Asiatica Cream',
                benefits: 'Soothes irritation and reduces redness',
                usage: 'Apply to affected areas as needed',
                image: 'https://via.placeholder.com/80?text=Cream'
            }
        };

        const recommendations = [];
        concerns.slice(0, 3).forEach(concern => {
            if (productMap[concern]) {
                recommendations.push(productMap[concern]);
            }
        });

        // If no specific concerns, show general recommendation
        if (recommendations.length === 0) {
            recommendations.push({
                name: 'Daily Moisturizer',
                benefits: 'Maintains skin barrier and hydration',
                usage: 'Apply morning and evening',
                image: 'https://via.placeholder.com/80?text=Moisturizer'
            });
        }

        return recommendations;
    }
    base64ToBlob(base64, mime = 'image/jpeg') {
        const bytes = atob(base64);
        const array = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
            array[i] = bytes.charCodeAt(i);
        }
        return new Blob([array], { type: mime });
    }
    
    finishScan() {
        this.isScanning = false;
        this.overlay.classList.remove('active');
        this.updateProgress(0);
        this.updateInstructions('');
        
        // Re-enable scan button
        const scanButton = document.getElementById('scanButton');
        scanButton.disabled = false;
        scanButton.style.opacity = '1';
    }

    showError(message) {
        this.instructions.textContent = message;
        setTimeout(() => {
            this.finishScan();
        }, 3000);
    }
}

// Global scanner instance
const faceScanner = new FaceScanner();

