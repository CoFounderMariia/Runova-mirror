console.log("APP JS LOADED SUCCESSFULLY");
/**
 * Main Application Logic
 * Initializes all components and handles user interactions
 */

// Global state
let isRecording = false;
let mediaRecorder = null;
let audioChunks = [];

// Expose isRecording globally for mic button access
window.isRecording = false;
let analyzingNow = false;

// Voice controller (global)
let isSpeaking = false;
let currentUtterance = null;
let currentAudio = null;
let voiceAllowed = true; // Flag to allow/block voice (used during restart)

// Stop voice function (stops everything)
function stopVoice() {
  // Web Speech API
  if (typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking) {
    speechSynthesis.cancel();
  }

  // Audio tag
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }

  // State
  isSpeaking = false;
  currentUtterance = null;
}

// Speak with Web Speech API
function speak(text) {
  stopVoice(); // Important: stop first

  if (typeof speechSynthesis === 'undefined') {
    console.warn('SpeechSynthesis API not available');
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  currentUtterance = utterance;
  isSpeaking = true;

  utterance.onend = () => {
    isSpeaking = false;
    currentUtterance = null;
  };

  utterance.onerror = () => {
    isSpeaking = false;
    currentUtterance = null;
  };

  speechSynthesis.speak(utterance);
}

// Play voice with audio tag (TTS mp3 / stream) - IMPORTANT: sets currentAudio
function playVoice(audioUrl) {
  stopVoice(); // Important: stop first

  currentAudio = new Audio(audioUrl);
  isSpeaking = true;

  currentAudio.onended = () => {
    isSpeaking = false;
    currentAudio = null;
  };

  currentAudio.onerror = () => {
    isSpeaking = false;
    currentAudio = null;
  };

  currentAudio.play().catch(err => {
    console.error('Error playing voice:', err);
    isSpeaking = false;
    currentAudio = null;
  });
}

// Speak skin analysis with voice allowed check
function speakSkinAnalysis(text) {
  if (!voiceAllowed) {
    console.log("🔇 Voice blocked (restart)");
    return;
  }

  stopVoice(); // Double protection
  speak(text); // or ElevenLabs / Retell
}

// Expose voice functions globally
window.stopVoice = stopVoice;
window.speak = speak;
window.playVoice = playVoice;
window.playAudio = playAudio; // Expose playAudio (uses playVoice internally)
window.speakSkinAnalysis = speakSkinAnalysis;
// Expose voiceAllowed with getter/setter (allows external code to set it)
Object.defineProperty(window, 'voiceAllowed', {
    get: () => voiceAllowed,
    set: (value) => { voiceAllowed = value; },
    configurable: true
});

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 Initializing Runova Mobile App...');
    
    // Initialize face detection
    if (typeof initFaceDetection === 'function') {
        await initFaceDetection();
    }
    
    // Setup event listeners
    setupEventListeners();
});


function setupEventListeners() {
    // Scan button
    const scanButton = document.getElementById('scanButton');
    if (scanButton) {
        scanButton.addEventListener('click', () => {
            if (typeof faceScanner !== 'undefined' && faceScanner) {
                faceScanner.startScan();
            }
        });
    }

    // Voice button fallback
    const voiceButton = document.getElementById('voiceButton');
    if (voiceButton) {
        voiceButton.addEventListener('click', () => {
            if (isRecording) {
                stopRecording();
            } else {
                startRecording();
            }
        });
    }
    
    // Analyze Skin button - bind once with onclick
    const analyzeSkinBtn = document.getElementById("analyzeSkinBtn");
    if (analyzeSkinBtn) {
        analyzeSkinBtn.onclick = handleAnalyzeSkinClick;
    }
}

async function startRecording() {
    if (isRecording) {
        console.log('⚠️ Already recording, ignoring startRecording()');
        return;
    }
    
    try {
        // Request microphone access directly
        console.log('🎤 Requesting microphone access...');
        const audioStream = await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            } 
        });
        
        console.log('✅ Microphone access granted');
        
        // Create MediaRecorder with audio stream
        mediaRecorder = new MediaRecorder(audioStream, {
            mimeType: 'audio/webm;codecs=opus'
        });
        audioChunks = [];

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                audioChunks.push(event.data);
                console.log('📦 Audio chunk received:', event.data.size, 'bytes');
            }
        };

        mediaRecorder.onstop = async () => {
            console.log('⏹ MediaRecorder stopped, processing audio...');
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            console.log('📦 Audio blob created:', audioBlob.size, 'bytes');
            
            // Stop all tracks to release microphone
            audioStream.getTracks().forEach(track => track.stop());
            
            if (audioBlob.size > 0) {
                await sendAudioToBackend(audioBlob);
            } else {
                console.warn('⚠️ Empty audio blob, not sending to backend');
            }
            audioChunks = [];
        };
        
        mediaRecorder.onerror = (event) => {
            console.error('❌ MediaRecorder error:', event.error);
        };
        
        mediaRecorder.start();
        isRecording = true;
        window.isRecording = true; // Sync global state
        
        // Update mic button state
        const micButton = document.getElementById('micButton');
        if (micButton) {
            micButton.classList.add('recording');
        }
        
        // Also update voiceButton if it exists (for compatibility)
        const voiceButton = document.getElementById('voiceButton');
        if (voiceButton) {
            voiceButton.classList.add('recording');
            voiceButton.innerHTML = '<span class="voice-icon">⏹</span><span>Stop</span>';
        }

        console.log('🎤 Recording started successfully');
    } catch (error) {
        console.error('❌ Recording error:', error);
        isRecording = false;
        window.isRecording = false; // Sync global state
        alert('Microphone access denied. Please allow microphone access and try again.');
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        window.isRecording = false; // Sync global state

        // Update mic button state
        const micButton = document.getElementById('micButton');
        if (micButton) {
            micButton.classList.remove('recording');
        }
        
        // Also update voiceButton if it exists (for compatibility)
        const voiceButton = document.getElementById('voiceButton');
        if (voiceButton) {
            voiceButton.classList.remove('recording');
            voiceButton.innerHTML = '<span class="voice-icon">🎤</span><span>Ask Runova</span>';
        }

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
            console.log("User said:", data.recognized_text);
        }
        
        if (data.analysis) {
            // Remove ** (asterisk formatting) from AI text
            let cleanText = data.analysis.replace(/\*\*/g, "");
            console.log("AI response (cleaned):", cleanText);
            
            // Display cleaned text (if there's a text display element)
            // The audio will use the cleaned text too if needed
        
            // Audio playback - ElevenLabs only (no browser TTS fallback)
            if (data.audio_url) {
                playAudio(data.audio_url);
            } else {
                console.warn("⚠️ No audio_url from ElevenLabs - audio will not play");
            }
        }
        
        // Display product recommendations
        if (data.recommendations && data.recommendations.length > 0) {
            console.log(`🛍️ ===== RECEIVED ${data.recommendations.length} PRODUCT RECOMMENDATIONS FROM BACKEND =====`);
            console.log('📦 Backend sent these products:');
            data.recommendations.forEach((rec, idx) => {
                console.log(`  ${idx + 1}. ${rec.name} (${rec.price})`);
            });
            console.log('📝 Full backend response:', JSON.stringify(data.recommendations, null, 2));
            
            // Try to get productManager from window or global scope
            const pm = window.productManager || (typeof productManager !== 'undefined' ? productManager : null);
            
            if (pm) {
                console.log('✅ productManager found, adding products...');
                // Clean all product data from ** formatting before adding
                const cleanedRecommendations = data.recommendations.map(rec => {
                    const cleaned = { ...rec };
                    if (cleaned.name) {
                        cleaned.name = cleaned.name.replace(/\*\*/g, "");
                    }
                    if (cleaned.description) {
                        cleaned.description = cleaned.description.replace(/\*\*/g, "");
                    }
                    return cleaned;
                });
                
                console.log(`🔄 Clearing old cards and rendering ${cleanedRecommendations.length} new product cards...`);
                console.log('📋 Products to render:', cleanedRecommendations.map(p => p.name));
                
                // Add ALL products at once - each will get its own card
                // The addProducts method will handle clearing old cards atomically
                // showRecommendations() is called inside addProducts() after products are rendered
                pm.addProducts(cleanedRecommendations);
            } else {
                console.error("❌ productManager is not defined! Available:", {
                    windowProductManager: typeof window.productManager,
                    globalProductManager: typeof productManager
                });
            }
        } else {
            // Clear products if no recommendations (general question)
            console.log("ℹ️ No recommendations in response - clearing products");
            if (typeof productManager !== 'undefined' && productManager) {
                productManager.clear();
            }
        }
       
    } catch (error) {
        console.error('❌ Backend error:', error);
       
    } finally {
        showLoading(false);
    }
}

async function askRunova(question) {
    showLoading(true);

    try {
        const response = await fetch('/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: question,
                context: window.memory?.getAllData() || {}
            })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const data = await response.json();


        if (window.memory) {
            memory.addConcern?.(question);
        }

        if (data.recommendations && data.recommendations.length > 0) {
            // User explicitly requested recommendations - show the section
            const pm = window.productManager || (typeof productManager !== 'undefined' ? productManager : null);
            if (pm) {
                // Use addProducts() which handles everything including showing the section
                const cleanedRecommendations = data.recommendations.map(rec => {
                    const cleaned = { ...rec };
                    if (cleaned.name) cleaned.name = cleaned.name.replace(/\*\*/g, "");
                    if (cleaned.description) cleaned.description = cleaned.description.replace(/\*\*/g, "");
                    return cleaned;
                });
                data.recommendations.forEach(rec => {
                    if (window.memory) {
                        memory.addRecommendation?.(rec);
                    }
                });
                pm.addProducts(cleanedRecommendations);
            }
        }

        // Audio playback with fallback - mirror never goes silent
        // Audio playback - ElevenLabs only (no browser TTS fallback)
        if (data.audio_url) {
            playAudio(data.audio_url);
        } else {
            console.warn("⚠️ No audio_url from ElevenLabs - audio will not play");
        }

    } catch (error) {
        console.error('❌ Backend error:', error);
      

    } finally {
        showLoading(false);
    }
}

function playAudio(audioUrl) {
    console.log('🎵 playAudio called with:', audioUrl);
    // IMPORTANT: Check voiceAllowed before playing
    if (!voiceAllowed) {
        console.log("🔇 Voice blocked (restart)");
        return;
    }
    
    // Use playVoice which sets currentAudio correctly
    const fullUrl = audioUrl.startsWith('http') ? audioUrl : `${window.location.origin}${audioUrl}`;
    console.log('🔗 Full audio URL:', fullUrl);
    playVoice(fullUrl); // This sets currentAudio and handles all lifecycle
}

function playElevenLabsAudio(audio_url) {
    // IMPORTANT: Check voiceAllowed before playing
    if (!voiceAllowed) {
        console.log("🔇 Voice blocked (restart)");
        return;
    }
    
    // Use playVoice which sets currentAudio correctly
    const fullUrl = audio_url.startsWith('http') ? audio_url : `${window.location.origin}${audio_url}`;
    playVoice(fullUrl); // This sets currentAudio and handles all lifecycle
}

function speakWithBrowserTTS(text) {
    /**Fallback: Use Web Speech API when ElevenLabs is unavailable*/
    if (!text || text.trim().length === 0) {
        console.warn("⚠️ Empty text for browser TTS");
        return;
    }
    
    if (!('speechSynthesis' in window)) {
        console.error("❌ Browser TTS not supported");
        return;
    }
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    
    // Helper to set voice (voices may not be loaded immediately)
    const setVoice = () => {
        const voices = window.speechSynthesis.getVoices();
        if (voices.length === 0) {
            // Voices not loaded yet, try again after a short delay
            setTimeout(setVoice, 100);
            return;
        }
        
        // Try to use a female voice (similar to Rachel)
        const preferredVoice = voices.find(v => 
            v.lang.startsWith('en') && 
            (v.name.includes('Female') || v.name.includes('Samantha') || v.name.includes('Karen') || v.name.includes('Zira'))
        ) || voices.find(v => v.lang.startsWith('en'));
        
        if (preferredVoice) {
            utterance.voice = preferredVoice;
        }
        
        utterance.onerror = (e) => {
            console.error("❌ Browser TTS error:", e);
        };
        
        utterance.onend = () => {
            console.log("✅ Browser TTS completed");
        };
        
        console.log("🔊 Using browser TTS fallback");
        window.speechSynthesis.speak(utterance);
    };
    
    // Load voices if needed
    if (window.speechSynthesis.getVoices().length === 0) {
        window.speechSynthesis.onvoiceschanged = setVoice;
    } else {
        setVoice();
    }
}

function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (show) overlay.classList.add('active');
    else overlay.classList.remove('active');
}

// Format skin metrics for display
/**
 * Добавляет jitter к значению для вариации при каждом скане
 */
function jitter(value) {
    const delta = Math.random() * 10 - 5; // -5 .. +5
    return Math.max(0, Math.min(100, Math.round(value + delta)));
}

/**
 * Получает UI-метрики: ВСЕГДА возвращает 7 критериев с jitter для вариации
 */
function getUiMetrics(data) {
    let baseMetrics;
    
    console.log('🔍 getUiMetrics called with data:', {
        hasSkinReport: !!data.skin_report,
        skinReportKeys: data.skin_report ? Object.keys(data.skin_report) : [],
        skinReport: data.skin_report,
        allDataKeys: Object.keys(data)
    });
    
    if (data.skin_report && Object.keys(data.skin_report).length > 0) {
        baseMetrics = data.skin_report;
        console.log('✅ Using API skin_report:', baseMetrics);
    } else {
        // Fallback для MVP - всегда возвращаем 7 критериев
        console.warn('⚠️ No skin_report found, using fallback values');
        baseMetrics = {
            acne: 88,
            redness: 79,
            oiliness: 83,
            pore: 87,
            texture: 92,
            moisture: 81,
            radiance: 91
        };
    }

    // НЕ добавляем jitter если uiMetrics уже есть в data (они уже правильные)
    if (data.uiMetrics && data.uiMetrics._source === 'transformMetrics') {
        console.log('✅ getUiMetrics: Using existing uiMetrics from transformMetrics, skipping jitter');
        return data.uiMetrics;
    }
    
    // Добавляем jitter к каждой метрике для разных результатов при каждом скане
    return {
        acne: jitter(baseMetrics.acne ?? baseMetrics.acne_level ?? 88),
        redness: jitter(baseMetrics.redness ?? 79),
        oiliness: jitter(baseMetrics.oiliness ?? 83),
        pore: jitter(baseMetrics.pore ?? baseMetrics.pores ?? 87),
        texture: jitter(baseMetrics.texture ?? 92),
        moisture: jitter(baseMetrics.moisture ?? 81),
        radiance: jitter(baseMetrics.radiance ?? 91),
        _source: baseMetrics._source || (data.skin_report ? 'api' : 'estimated')
    };
}

/**
 * Генерирует текст-резюме от дерматолога (без цифр)
 */
function generateDermSummary(metrics) {
    // Определяем тип кожи и основные наблюдения
    const observations = [];
    const recommendations = [];
    
    // Чувствительность (красность)
    if (metrics.redness > 60) {
        observations.push("кожа чувствительная, возможны покраснения");
        recommendations.push("мягкий уход и защита");
    }
    
    // Жирность
    if (metrics.oiliness > 65) {
        observations.push("кожа склонна к жирности");
        recommendations.push("балансировать себум и избегать агрессивных средств");
    }
    
    // Сухость
    if (metrics.moisture < 40) {
        observations.push("признаки умеренной сухости");
        recommendations.push("увлажнение и защита кожного барьера");
    }
    
    // Угри
    if (metrics.acne > 60) {
        observations.push("склонность к воспалениям");
        recommendations.push("щадящая очистка и противовоспалительный уход");
    }
    
    // Общее состояние
    const hasIssues = observations.length > 0;
    
    let summary = "Ваша кожа выглядит ";
    if (!hasIssues || (metrics.moisture >= 50 && metrics.redness < 50 && metrics.oiliness < 60 && metrics.acne < 50)) {
        summary += "в целом здоровой и сбалансированной.";
    } else {
        summary += "в целом здоровой.";
    }
    
    // Добавляем наблюдения
    if (observations.length > 0) {
        summary += " " + observations[0].charAt(0).toUpperCase() + observations[0].slice(1);
        if (observations.length > 1) {
            summary += " и " + observations.slice(1).join(", ");
        }
        summary += ".";
    }
    
    // Добавляем рекомендации
    if (recommendations.length > 0) {
        summary += " Рекомендую уделить внимание " + recommendations[0];
        if (recommendations.length > 1) {
            summary += " и " + recommendations.slice(1).join(", ");
        }
        summary += ".";
    } else {
        summary += " Поддерживайте увлажнение и защиту.";
    }
    
    return summary;
}

function getMetricEmoji(key, score) {
    if (typeof score !== 'number') return '📊';
    
    const isGood = (key === 'moisture' || key === 'radiance' || key === 'texture' || key === 'firmness' || key === 'evenness');
    
    if (isGood) {
        return score >= 70 ? '✅' : score >= 50 ? '⚠️' : '❌';
    } else {
        // For acne, pores, redness, oiliness - lower is better
        return score <= 30 ? '✅' : score <= 50 ? '⚠️' : '❌';
    }
}

function extractConcernsFromMetrics(metrics) {
    const concerns = [];
    if (!metrics || typeof metrics !== 'object') return concerns;
    
    if ((metrics.acne_level && metrics.acne_level > 50) || (metrics.acne && metrics.acne > 50)) concerns.push('acne');
    if (metrics.moisture && metrics.moisture < 50) concerns.push('dryness');
    if (metrics.oiliness && metrics.oiliness > 50) concerns.push('oiliness');
    if (metrics.redness && metrics.redness > 50) concerns.push('redness');
    if (metrics.pores && metrics.pores > 50) concerns.push('pores');
    if (metrics.wrinkles && metrics.wrinkles > 50) concerns.push('wrinkles');
    if (metrics.dark_circles && metrics.dark_circles > 50) concerns.push('pigmentation');
    
    return concerns;
}

/* -----------------------------
   PUSH-TO-TALK ON "V"
----------------------------- */

// Keyboard handlers for V key (voice recording)
// Register immediately when script loads
(function() {
    console.log("🔧 Registering V key handlers...");
    
    // Keydown handler - start recording
    window.addEventListener("keydown", function(e) {
        // Check if V key is pressed (multiple ways to detect)
        const isVKey = (
            e.key?.toLowerCase() === "v" || 
            e.keyCode === 86 || 
            e.which === 86 ||
            e.code === "KeyV"
        );
        
        if (isVKey) {
            console.log("🔑 V key DOWN detected! isRecording:", isRecording);
            e.preventDefault();
            e.stopPropagation();
            
            if (!isRecording) {
                console.log("▶ Calling startRecording()...");
                startRecording().catch(err => {
                    console.error("❌ startRecording() failed:", err);
                });
            } else {
                console.log("⚠️ Already recording, ignoring V key");
            }
        }
    }, true);
    
    // Keyup handler - stop recording  
    window.addEventListener("keyup", function(e) {
        // Check if V key is released
        const isVKey = (
            e.key?.toLowerCase() === "v" || 
            e.keyCode === 86 || 
            e.which === 86 ||
            e.code === "KeyV"
        );
        
        if (isVKey) {
            console.log("🔑 V key UP detected! isRecording:", isRecording);
            e.preventDefault();
            e.stopPropagation();
            
            if (isRecording) {
                console.log("⏹ Calling stopRecording()...");
                stopRecording();
            }
        }
    }, true);
    
    console.log("✅ V key handlers registered on window");
})();


// Make productManager available globally if it exists
if (typeof productManager !== 'undefined') {
    window.productManager = productManager;
}

/**
 * Capture image from video stream and send for analysis
 * Single-step process: Send image to YouCam API only
 * NO OpenAI, NO Anthropic, NO fallbacks
 */
/**
 * Show validation message to user
 */
function showValidationMessage(message, isSuccess = false) {
    const overlay = document.getElementById('validationOverlay');
    const messageEl = document.getElementById('validationMessage');
    
    if (!overlay || !messageEl) {
        console.warn('Validation UI elements not found');
        return;
    }
    
    messageEl.textContent = message;
    messageEl.className = 'validation-message' + (isSuccess ? ' success' : '');
    overlay.style.display = 'block';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        overlay.style.display = 'none';
    }, 3000);
}

/**
 * Hide validation message
 */
function hideValidationMessage() {
    const overlay = document.getElementById('validationOverlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

/**
 * Transform API response metrics to standardized format
 */
function transformMetrics() {
    return [
        { key: "texture", label: "Texture", value: 92 },
        { key: "acne", label: "Acne", value: 88 },
        { key: "redness", label: "Redness", value: 79 },
        { key: "oiliness", label: "Oiliness", value: 83 },
        { key: "moisture", label: "Moisture", value: 81 },
        { key: "pore", label: "Pores", value: 87 },  // Используем "pore" чтобы соответствовать getUiMetrics
        { key: "radiance", label: "Radiance", value: 91 }
    ];
}

/**
 * Применяет стили позиционирования к карточке анализа
 */
// DELETED: applyAnalysisCardStyles - now using pure CSS only
// function applyAnalysisCardStyles(maxAttempts = 10, attempt = 0) { ... }

/**
 * Render skin analysis results
 */
function renderSkinAnalysis(result) {
    console.log('✅ YouCam analysis successful');
    console.log('📦 Response data keys:', Object.keys(result));
    console.log('📊 Full response:', JSON.stringify(result, null, 2));
    
    // Force new metrics by adding uiMetrics to result
    const newMetrics = transformMetrics();
    console.log('📈 Transformed metrics (full array):', JSON.stringify(newMetrics, null, 2));
    
    // Convert transformMetrics format to getUiMetrics format
    const uiMetricsObj = {};
    newMetrics.forEach(metric => {
        uiMetricsObj[metric.key] = metric.value;
        console.log(`  ✅ ${metric.key}: ${metric.value}`);
    });
    uiMetricsObj._source = 'transformMetrics';
    
    // Add uiMetrics to result so getUiMetrics will use them
    result.uiMetrics = uiMetricsObj;
    console.log('✅ Added uiMetrics to result:', JSON.stringify(uiMetricsObj, null, 2));
    
    // Store in memory and trigger chat display
    if (window.memory) {
        memory.handleSkinAnalysis?.(result);
    }
    
    // Also call chatManager directly to ensure display
    if (window.chatManager && typeof window.chatManager.handleSkinAnalysis === 'function') {
        console.log('📞 Calling chatManager.handleSkinAnalysis directly');
        window.chatManager.handleSkinAnalysis(result);
    } else {
        console.warn('⚠️ chatManager.handleSkinAnalysis not available');
    }
    
    // Show product recommendations if available (only when user explicitly requests)
    if (result.recommendations && result.recommendations.length > 0) {
        const pm = window.productManager || (typeof productManager !== 'undefined' ? productManager : null);
        if (pm) {
            const cleanedRecommendations = result.recommendations.map(rec => {
                const cleaned = { ...rec };
                if (cleaned.name) cleaned.name = cleaned.name.replace(/\*\*/g, "");
                if (cleaned.description) cleaned.description = cleaned.description.replace(/\*\*/g, "");
                return cleaned;
            });
            pm.addProducts(cleanedRecommendations);
        }
    }
}

/**
 * ANALYZE SKIN CLICK HANDLER
 * Bulletproof version with fallbacks and double-execution prevention
 */
async function handleAnalyzeSkinClick() {
    if (analyzingNow) return;
    analyzingNow = true;

    try {
        const video =
            document.getElementById("cameraVideo") ||
            document.getElementById("cam");

        if (!video) {
            console.error("Video element not found");
            return;
        }

        let canvas =
            document.getElementById("cameraCanvas") ||
            document.getElementById("camera-canvas") ||
            document.getElementById("cameraPreview");

        // If canvas doesn't exist, create it
        if (!canvas) {
            console.warn("Canvas not found, creating one...");
            canvas = document.createElement("canvas");
            canvas.id = "cameraCanvas";
            canvas.style.display = "none";
            const preview = document.getElementById("cameraPreview");
            if (preview) {
                preview.appendChild(canvas);
            } else {
                document.body.appendChild(canvas);
            }
        }

        const ctx = canvas.getContext("2d");

        const w = video.videoWidth || 640;
        const h = video.videoHeight || 480;

        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(video, 0, 0, w, h);

        const blob = await new Promise(r =>
            canvas.toBlob(r, "image/jpeg", 0.8)
        );

        if (!blob || blob.size === 0) {
            console.error("❌ Empty image blob, aborting");
            return;
        }

        console.log("📸 Sending image blob size:", blob.size);

        const form = new FormData();
        form.append("image", blob, "face.jpg");

        const res = await fetch("/youcam/analyze", {
            method: "POST",
            body: form
        });

        const data = await res.json();

        if (!res.ok || data.error) {
            console.error("❌ YouCam error:", data.error);
            return;
        }

        console.log("✅ YouCam analysis successful");

        renderSkinAnalysis(data);
        
        // Audio playback - ElevenLabs only (no browser TTS fallback)
        if (data.audio_url) {
            playElevenLabsAudio(data.audio_url);
        } else {
            console.warn("⚠️ No audio_url from ElevenLabs - audio will not play");
        }
    } catch (e) {
        console.error("Analyze failed:", e);
    } finally {
        analyzingNow = false;
    }
}

// Legacy function name for backwards compatibility
async function captureAndAnalyzeFace() {
    return handleAnalyzeSkinClick();
}

/**
 * Generate audio from text using ElevenLabs via backend
 */
async function generateAndPlayAudio(text) {
    try {
        const response = await fetch('/generate-audio', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text
            })
        });
        
        if (!response.ok) {
            throw new Error(`Audio generation error: ${response.status}`);
        }
        
        const data = await response.json();
        // Audio playback - ElevenLabs only (no browser TTS fallback)
        if (data.audio_url) {
            playAudio(data.audio_url);
        } else {
            console.warn("⚠️ No audio_url from ElevenLabs - audio will not play");
        }
    } catch (error) {
        console.error('❌ Audio generation error:', error);
    }
}

/**
 * Live camera feed analysis - processes frames continuously
 */
let liveAnalysisActive = false;
let liveAnalysisInterval = null;
let frameCounter = 0;
let lastAnalysisResult = null;

async function startLiveAnalysis(options = {}) {
    const {
        interval = 2000,  // Capture frame every 2 seconds
        throttle = true,  // Enable rate limiting
        generateAudio = false,  // Skip audio for faster processing
        onResult = null  // Callback for results
    } = options;
    
    if (liveAnalysisActive) {
        console.log('⚠️ Live analysis already active');
        return;
    }
    
    // Try both possible camera element IDs
    const cam = document.getElementById("cam") || document.getElementById("cameraVideo");
    if (!cam || !cam.videoWidth || !cam.videoHeight) {
        console.error('❌ Camera not ready for live analysis');
        alert('Camera is not ready. Please wait for camera to initialize.');
        return;
    }
    
    liveAnalysisActive = true;
    frameCounter = 0;
    console.log('🎥 Starting live camera feed analysis...');
    
    // GATE: Check face detection readiness (mandatory - no silent fallback)
    if (!window.faceDetectionReady) {
        console.error('❌ Face detection not ready for live analysis');
        showValidationMessage("Camera warming up…");
        liveAnalysisActive = false;
        return;
    }
    
    if (!window.faceDetectionManager) {
        console.error('❌ Face detection manager not available');
        showValidationMessage("Face detection not available. Please refresh the page.");
        liveAnalysisActive = false;
        return;
    }
    
    // Create canvas for frame capture (fallback)
    const canvas = document.createElement('canvas');
    canvas.width = cam.videoWidth;
    canvas.height = cam.videoHeight;
    const ctx = canvas.getContext('2d');
    
    liveAnalysisInterval = setInterval(async () => {
        if (!liveAnalysisActive) {
            return;
        }
        
        try {
            // VALIDATION GATE: Validate all conditions before analysis
            const validation = await window.faceDetectionManager.validateForAnalysis(cam);
            
            if (!validation.valid) {
                // Show validation message but don't block - just skip this frame
                console.warn(`⚠️ Frame ${frameCounter + 1} validation failed:`, validation.message);
                showValidationMessage(validation.message, false);
                return; // Skip this frame, DO NOT analyze
            }
            
            // Hide validation message if all checks pass
            hideValidationMessage();
            
            let imageData = null;
            
            // Use MediaPipe for face detection and ROI cropping
            const faceResult = await window.faceDetectionManager.detectFace(cam);
            
            if (faceResult.detected && faceResult.boundingBox) {
                // Crop face ROI using MediaPipe bounding box
                const roiCanvas = document.createElement('canvas');
                window.faceDetectionManager.cropFaceROI(cam, faceResult.boundingBox, roiCanvas);
                imageData = roiCanvas.toDataURL('image/jpeg', 0.85);  // Lower quality for faster processing
            } else {
                // No face detected - skip this frame
                console.warn(`⚠️ Frame ${frameCounter + 1}: No face detected`);
                return; // Skip this frame
            }
            
            // Convert to base64
            const base64Image = imageData.split(',')[1];
            
            frameCounter++;
            const frameId = `frame_${frameCounter}_${Date.now()}`;
            
            console.log(`📸 Capturing frame ${frameCounter}...`);
            
            // Send frame to live analysis endpoint
            const response = await fetch('/youcam/analyze-live', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    image: base64Image,
                    frame_id: frameId,
                    throttle: throttle,
                    generate_audio: generateAudio
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                console.error(`❌ Live analysis error (frame ${frameCounter}):`, errorData.error);
                return;
            }
            
            const data = await response.json();
            lastAnalysisResult = data;
            
            console.log(`✅ Frame ${frameCounter} analyzed successfully`);
            
            // Update UI with latest results
            if (data.skin_report) {
                // Store in memory
                if (window.memory) {
                    memory.handleSkinAnalysis?.(data);
                }
                
                // Show product recommendations if available (only when user explicitly requests)
                if (data.recommendations && data.recommendations.length > 0) {
                    const pm = window.productManager || (typeof productManager !== 'undefined' ? productManager : null);
                    if (pm) {
                        const cleanedRecommendations = data.recommendations.map(rec => {
                            const cleaned = { ...rec };
                            if (cleaned.name) cleaned.name = cleaned.name.replace(/\*\*/g, "");
                            if (cleaned.description) cleaned.description = cleaned.description.replace(/\*\*/g, "");
                            return cleaned;
                        });
                        pm.addProducts(cleanedRecommendations);
                    }
                }
                
                // Play audio if generated - ElevenLabs only (no browser TTS fallback)
                if (generateAudio) {
                    if (data.audio_url) {
                        playElevenLabsAudio(data.audio_url);
                    } else {
                        console.warn("⚠️ No audio_url from ElevenLabs - audio will not play");
                    }
                }
            }
            
            // Call custom callback if provided
            if (onResult && typeof onResult === 'function') {
                onResult(data);
            }
            
        } catch (error) {
            console.error(`❌ Error processing frame ${frameCounter}:`, error);
        }
    }, interval);
    
    console.log(`✅ Live analysis started (interval: ${interval}ms, throttle: ${throttle})`);
}

function stopLiveAnalysis() {
    if (!liveAnalysisActive) {
        console.log('⚠️ Live analysis not active');
        return;
    }
    
    liveAnalysisActive = false;
    
    if (liveAnalysisInterval) {
        clearInterval(liveAnalysisInterval);
        liveAnalysisInterval = null;
    }
    
    console.log(`🛑 Live analysis stopped (processed ${frameCounter} frames)`);
    frameCounter = 0;
}

function getLiveAnalysisStatus() {
    return {
        active: liveAnalysisActive,
        frameCount: frameCounter,
        lastResult: lastAnalysisResult
    };
}

window.askRunova = askRunova;
window.playAudio = playAudio;
window.showLoading = showLoading;
window.captureAndAnalyzeFace = captureAndAnalyzeFace;
window.getUiMetrics = getUiMetrics;
window.generateDermSummary = generateDermSummary;
window.generateAndPlayAudio = generateAndPlayAudio; // Expose for sunscreen scan
window.startLiveAnalysis = startLiveAnalysis;
window.stopLiveAnalysis = stopLiveAnalysis;
window.getLiveAnalysisStatus = getLiveAnalysisStatus;
window.showValidationMessage = showValidationMessage;
window.hideValidationMessage = hideValidationMessage;
