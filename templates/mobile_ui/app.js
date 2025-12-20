/**
 * Main Application Logic
 * Initializes all components and handles user interactions
 */

// Global state
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Initializing Runova Mobile App...');
    
    // Initialize camera
    const cameraReady = await cameraManager.initialize();
    if (!cameraReady) {
        console.error('❌ Camera initialization failed');
    }

    // Setup event listeners
    setupEventListeners();
    
    // Show welcome message
    setTimeout(() => {
        chatManager.addMessage('assistant', 
            "Hi! I'm Runova, your smart skin analysis assistant. Tap 'Scan Face' to analyze your skin, or ask me any questions about skincare!",
            'Runova'
        );
    }, 1000);
});

function setupEventListeners() {
    // Scan button
    const scanButton = document.getElementById('scanButton');
    scanButton.addEventListener('click', () => {
        faceScanner.startScan();
    });

    // Voice button
    const voiceButton = document.getElementById('voiceButton');
    voiceButton.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            await sendAudioToBackend(audioBlob);
            
            // Stop all tracks
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        isRecording = true;
        
        const voiceButton = document.getElementById('voiceButton');
        voiceButton.classList.add('recording');
        voiceButton.innerHTML = '<span class="voice-icon">⏹</span><span>Stop</span>';
        
        console.log('🎤 Recording started');
    } catch (error) {
        console.error('❌ Recording error:', error);
        alert('Microphone access denied. Please allow microphone access.');
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        
        const voiceButton = document.getElementById('voiceButton');
        voiceButton.classList.remove('recording');
        voiceButton.innerHTML = '<span class="voice-icon">🎤</span><span>Ask Runova</span>';
        
        console.log('⏹ Recording stopped');
    }
}

async function sendAudioToBackend(audioBlob) {
    showLoading(true);
    
    try {
        const formData = new FormData();
        formData.append('audio', audioBlob, 'voice.webm');

        const response = await fetch('/analyze-audio', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.recognized_text) {
            // Add user message
            chatManager.addMessage('user', data.recognized_text);
            memory.addConcern(data.recognized_text);
        }

        if (data.analysis) {
            // Add assistant response
            chatManager.addMessage('assistant', data.analysis, 'Runova');
            
            // Play audio if available
            if (data.audio_url) {
                playAudio(data.audio_url);
            }
        }

    } catch (error) {
        console.error('❌ Backend error:', error);
        chatManager.addMessage('assistant', 
            'Sorry, I encountered an error. Please try again.',
            'Runova'
        );
    } finally {
        showLoading(false);
    }
}

// Alternative: Send text directly (for /ask endpoint)
async function askRunova(question) {
    showLoading(true);
    
    try {
        const response = await fetch('/ask', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                question: question,
                context: memory.getAllData() // Send memory for context
            })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();
        
        // Add messages
        chatManager.addMessage('user', question);
        chatManager.addMessage('assistant', data.answer, 'Runova');
        
        // Store concerns
        memory.addConcern(question);
        
        // Show recommendations if provided
        if (data.recommendations) {
            data.recommendations.forEach(rec => {
                memory.addRecommendation(rec);
                productManager.addProductCard(rec);
            });
        }

        // Play audio if available
        if (data.audio_url) {
            playAudio(data.audio_url);
        }

    } catch (error) {
        console.error('❌ Backend error:', error);
        chatManager.addMessage('assistant', 
            'Sorry, I encountered an error. Please try again.',
            'Runova'
        );
    } finally {
        showLoading(false);
    }
}

function playAudio(audioUrl) {
    const audio = new Audio(audioUrl);
    audio.play().catch(e => {
        console.error('Audio play error:', e);
    });
}

function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (show) {
        overlay.classList.add('active');
    } else {
        overlay.classList.remove('active');
    }
}

// Export for use in other modules
window.askRunova = askRunova;
window.playAudio = playAudio;
window.showLoading = showLoading;

