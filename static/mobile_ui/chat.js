/**
 * Chat Management
 * Handles ChatGPT-style responses and chat feed
 */

class ChatManager {
    constructor() {
        this.chatFeed = document.getElementById('chatFeed');
    }

    addMessage(role, content, author = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        
        const time = new Date().toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit' 
        });

        const authorName = author || (role === 'user' ? 'You' : 'Runova');
        const avatarText = role === 'user' ? 'U' : 'R';

        messageDiv.innerHTML = `
            <div class="message-header">
                <div class="message-avatar">${avatarText}</div>
                <span class="message-author">${authorName}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content ${role}">${this.formatContent(content)}</div>
        `;

        this.chatFeed.appendChild(messageDiv);
        this.scrollToBottom();

        // Store in memory
        if (window.memory) {
            memory.addChatMessage?.(role, content);
        }
    }

    formatContent(content) {
        // Simple formatting - can be enhanced with markdown
        return content
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
    }

    scrollToBottom() {
        this.chatFeed.scrollTop = this.chatFeed.scrollHeight;
    }

    clear() {
        this.chatFeed.innerHTML = '';
    }

    /**
     * Обрабатывает результаты анализа кожи
     * ВСЕГДА показывает 7 критериев с кругами, анимацией и процентами
     */
    handleSkinAnalysis(data) {
        console.log('🎯 handleSkinAnalysis called with data:', {
            hasAudioUrl: !!data.audio_url,
            audioUrl: data.audio_url,
            hasSkinReport: !!data.skin_report
        });
        
        // Получаем UI метрики (всегда 7 критериев)
        console.log('🔍 Checking for uiMetrics in data:', {
            hasUiMetrics: !!data.uiMetrics,
            uiMetrics: data.uiMetrics,
            dataKeys: Object.keys(data)
        });
        
        // ПРИОРИТЕТ: используем uiMetrics если они есть, иначе вычисляем
        let uiMetrics;
        if (data.uiMetrics) {
            console.log('✅ Using uiMetrics from data (transformMetrics values)');
            uiMetrics = data.uiMetrics;
        } else {
            console.log('⚠️ No uiMetrics in data, calling getUiMetrics()');
            uiMetrics = getUiMetrics(data);
        }
        
        console.log('📊 UI Metrics that will be displayed:', JSON.stringify(uiMetrics, null, 2));
        console.log('📊 Metrics values:', {
            texture: uiMetrics.texture,
            acne: uiMetrics.acne,
            redness: uiMetrics.redness,
            oiliness: uiMetrics.oiliness,
            moisture: uiMetrics.moisture,
            pore: uiMetrics.pore,
            radiance: uiMetrics.radiance
        });

        // ВСЕГДА рендерим панель с метриками (даже если есть ошибка, показываем метрики)
        this.renderScorePanel(uiMetrics);
        
        // Если есть ошибка, показываем ее как текст под панелью
        if (data.error) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'error-message';
            errorDiv.textContent = data.error;
            const lastPanel = this.lastMetricsPanel || document.getElementById('analysisCard');
            if (lastPanel) {
                const content = lastPanel.querySelector('.message-content');
                if (content) {
                    content.appendChild(errorDiv);
                }
            }
        }
        
        // Анимация кругов
        setTimeout(() => {
            console.log('⏱️ First timeout (100ms) fired, starting animation');
            this.animateScorePanel();
            
            // Voice over после анимации (задержка 300-500мс) - использует audio_url из data
            setTimeout(() => {
                console.log('🎤 Second timeout (400ms) fired, calling playDermSummaryVoice');
                console.log('🎤 Calling playDermSummaryVoice with data:', { 
                    hasAudioUrl: !!data.audio_url, 
                    audioUrl: data.audio_url,
                    hasData: !!data 
                });
                this.playDermSummaryVoice(data);
            }, 400);
        }, 100);

        // Сохраняем в память
        if (window.memory) {
            memory.handleSkinAnalysis?.(data);
        }
    }

    /**
     * Проигрывает голосовое резюме через ElevenLabs (использует audio_url из ответа)
     */
    playDermSummaryVoice(data) {
        console.log('🎵 playDermSummaryVoice called with:', data);
        try {
            // IMPORTANT: Check voiceAllowed before playing (blocked during restart)
            if (typeof window !== 'undefined' && window.voiceAllowed === false) {
                console.log("🔇 Voice blocked (restart)");
                return;
            }
            
            // Используем audio_url из ответа бэкенда (бэкенд уже сгенерировал аудио через ElevenLabs)
            if (data && data.audio_url) {
                console.log('🔊 Playing ElevenLabs audio:', data.audio_url);
                if (window.playAudio) {
                    console.log('✅ playAudio function exists, calling it...');
                    window.playAudio(data.audio_url);
                } else {
                    console.error('❌ playAudio function not available');
                }
            } else {
                console.warn('⚠️ No audio_url in response data:', data);
            }
        } catch (error) {
            console.error('❌ Voice over error:', error);
            console.error('❌ Error stack:', error.stack);
        }
    }

    /**
     * Создает HTML панель с 7 критериями (круги + проценты)
     */
    createMetricsPanel(metrics, isEstimated = false) {
        console.log('🎨 createMetricsPanel called with metrics:', JSON.stringify(metrics, null, 2));
        
        const metricConfig = [
            { key: 'acne', label: 'Acne', reverse: true },
            { key: 'redness', label: 'Redness', reverse: true },
            { key: 'oiliness', label: 'Oiliness', reverse: true },
            { key: 'pore', label: 'Pores', reverse: true },
            { key: 'texture', label: 'Texture', reverse: false },
            { key: 'moisture', label: 'Moisture', reverse: false },
            { key: 'radiance', label: 'Radiance', reverse: false }
        ];

        // Создаем уникальный ID для градиентов этой панели
        const panelId = 'panel-' + Date.now();
        
        let html = '<div class="skin-metrics-panel">';
        
        metricConfig.forEach(({ key, label, reverse }, index) => {
            const value = metrics[key] ?? 50;
            console.log(`  🎨 ${key}: ${value} (from metrics[${key}])`);
            
            // Генерируем градиент на основе значения
            const gradient = this.getValueBasedGradient(value, reverse);
            const gradientId = `${panelId}-gradient-${index}`;
            
            html += `
                <div class="metric-item">
                    <div class="metric-circle-wrapper">
                        <svg class="metric-circle" viewBox="0 0 100 100">
                            <defs>
                                <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
                                    <stop offset="0%" style="stop-color:${gradient.color1};stop-opacity:1" />
                                    <stop offset="100%" style="stop-color:${gradient.color2};stop-opacity:1" />
                                </linearGradient>
                            </defs>
                            <circle class="metric-circle-bg" cx="50" cy="50" r="45" stroke-width="2"/>
                            <circle class="metric-circle-progress" 
                                    cx="50" cy="50" r="45" 
                                    data-value="${value}"
                                    stroke="url(#${gradientId})"
                                    stroke-width="2"
                                    stroke-linecap="round"
                                    fill="none"
                                    stroke-dasharray="${2 * Math.PI * 45}"
                                    stroke-dashoffset="${2 * Math.PI * 45}"/>
                        </svg>
                        <div class="metric-value">0</div>
                    </div>
                    <div class="metric-label">${label}</div>
                </div>
            `;
        });

        html += '</div>';
        
        if (isEstimated) {
            html += '<div class="metrics-note">Scores are estimated based on visual analysis</div>';
        }
        
        return html;
    }

    /**
     * Получает цвет для метрики на основе значения (премиум палитра)
     */
    getMetricColor(value, reverse = false) {
        // Для reverse: низкие значения = хорошо, высокие = плохо
        // Для обычных: высокие значения = хорошо, низкие = плохо
        const effectiveValue = reverse ? (100 - value) : value;
        
        // Премиум палитра Runova-style
        if (effectiveValue <= 40) return '#FF4D4F'; // Плохой
        if (effectiveValue <= 60) return '#FF9F43'; // Средний
        if (effectiveValue <= 75) return '#8B5CF6'; // Хороший
        return '#22D3EE'; // Отличный
    }

    /**
     * Генерирует градиент на основе значения метрики
     * < 80 → жёлто-оранжевый (плохое состояние)
     * ≥ 80 → зелёно-синий (хорошее состояние)
     * Чем выше значение, тем "холоднее" цвет
     */
    getValueBasedGradient(value, reverse = false) {
        // Для reverse метрик инвертируем значение
        // Например, для acne: значение 20 означает плохое состояние (80% проблем)
        const effectiveValue = reverse ? (100 - value) : value;
        
        let color1, color2;
        
        if (effectiveValue < 80) {
            // Плохое состояние: жёлто-оранжевый градиент
            if (effectiveValue < 40) {
                // Очень плохо (0-40): оранжево-красный
                const t = effectiveValue / 40; // 0.0 - 1.0
                color1 = this.interpolateColor('#FF4444', '#FF6B35', t); // Красный → оранжево-красный
                color2 = this.interpolateColor('#FF6B35', '#FF8C42', t); // Оранжево-красный → оранжевый
            } else if (effectiveValue < 70) {
                // Средне (40-70): жёлто-оранжевый
                const t = (effectiveValue - 40) / 30; // 0.0 - 1.0
                color1 = this.interpolateColor('#FF8C42', '#FFB347', t); // Оранжевый → жёлто-оранжевый
                color2 = this.interpolateColor('#FFB347', '#FFD700', t); // Жёлто-оранжевый → жёлтый
            } else {
                // Borderline (70-80): градиент от зелёного → жёлтого
                const t = (effectiveValue - 70) / 10; // 0.0 - 1.0
                color1 = this.interpolateColor('#10B981', '#22C55E', t); // Зелёный → светло-зелёный
                color2 = this.interpolateColor('#22C55E', '#FFD700', t); // Светло-зелёный → жёлтый
            }
        } else {
            // Хорошее состояние: зелёно-синий градиент
            if (effectiveValue < 90) {
                // Хорошо (80-90): зелёно-голубой
                const t = (effectiveValue - 80) / 10; // 0.0 - 1.0
                color1 = this.interpolateColor('#10B981', '#14B8A6', t); // Зелёный → бирюзовый
                color2 = this.interpolateColor('#14B8A6', '#06B6D4', t); // Бирюзовый → голубой
            } else {
                // Отлично (90-100): сине-голубой (самый холодный)
                const t = (effectiveValue - 90) / 10; // 0.0 - 1.0
                color1 = this.interpolateColor('#06B6D4', '#0EA5E9', t); // Голубой → светло-синий
                color2 = this.interpolateColor('#0EA5E9', '#3B82F6', t); // Светло-синий → синий
            }
        }
        
        return { color1, color2 };
    }

    /**
     * Интерполирует между двумя цветами
     */
    interpolateColor(color1, color2, factor) {
        const hex1 = color1.replace('#', '');
        const hex2 = color2.replace('#', '');
        
        const r1 = parseInt(hex1.substr(0, 2), 16);
        const g1 = parseInt(hex1.substr(2, 2), 16);
        const b1 = parseInt(hex1.substr(4, 2), 16);
        
        const r2 = parseInt(hex2.substr(0, 2), 16);
        const g2 = parseInt(hex2.substr(2, 2), 16);
        const b2 = parseInt(hex2.substr(4, 2), 16);
        
        const r = Math.round(r1 + (r2 - r1) * factor);
        const g = Math.round(g1 + (g2 - g1) * factor);
        const b = Math.round(b1 + (b2 - b1) * factor);
        
        return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    }

    /**
     * Создает явный DOM-элемент карточки анализа
     */
    createAnalysisCard(metrics) {
        const card = document.createElement('div');
        card.id = 'analysisCard';
        card.className = 'analysis-card';
        
        // Создаем HTML для панели с метриками
        const metricsHTML = this.createMetricsPanel(metrics, metrics._source === 'estimated');
        
        const time = new Date().toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit' 
        });

        card.innerHTML = `
            <div class="message-header">
                <div class="message-avatar">R</div>
                <span class="message-author">Runova</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content assistant">
                <strong>Your Skin Analysis Results:</strong>
                ${metricsHTML}
            </div>
        `;
        
        return card;
    }

    /**
     * Рендерит панель с метриками (7 критериев)
     */
    renderScorePanel(uiMetrics) {
        console.log('🎨 renderScorePanel called with uiMetrics:', JSON.stringify(uiMetrics, null, 2));
        
        // Удаляем старую карточку если есть
        const oldCard = document.getElementById('analysisCard');
        if (oldCard) {
            oldCard.remove();
        }
        
        // Создаем новую карточку
        const card = this.createAnalysisCard(uiMetrics);
        
        // Находим якорный элемент для карточки
        const anchor = document.querySelector('.analysis-anchor');
        
        if (!anchor) {
            console.error('❌ .analysis-anchor not found');
            return;
        }
        
        // Вставляем карточку в якорь
        anchor.appendChild(card);
        console.log('✅ Analysis card created and appended to .analysis-anchor');
        console.log('🔍 Card element:', card);
        console.log('🔍 Card ID:', card.id);
        console.log('🔍 Card classes:', card.className);
        console.log('🔍 Card in DOM:', document.getElementById('analysisCard') ? 'YES' : 'NO');
        
        // Сохраняем ссылку на элемент для анимации
        this.lastMetricsPanel = card;
        
        // Запускаем анимацию
        setTimeout(() => {
            this.animateScorePanel();
        }, 100);
    }

    /**
     * Анимирует панель с метриками (круги от 0 до значения)
     */
    animateScorePanel() {
        const messageDiv = this.lastMetricsPanel || document.getElementById('analysisCard');
        if (!messageDiv) return;
        
        const circles = messageDiv.querySelectorAll('.metric-circle-progress');
        const valueElements = messageDiv.querySelectorAll('.metric-value');
        
        circles.forEach((circle, index) => {
            const value = parseInt(circle.getAttribute('data-value'));
            const svg = circle.closest('svg');
            
            // Находим существующий градиент в SVG
            let gradientId = null;
            if (svg) {
                const existingGradient = svg.querySelector('linearGradient');
                if (existingGradient) {
                    gradientId = existingGradient.getAttribute('id');
                }
            }
            
            // Если градиент не найден, создаем новый на основе значения
            if (!gradientId && svg) {
                // Получаем метрику из конфига (нужно знать reverse)
                const metricConfig = [
                    { key: 'acne', reverse: true },
                    { key: 'redness', reverse: true },
                    { key: 'oiliness', reverse: true },
                    { key: 'pore', reverse: true },
                    { key: 'texture', reverse: false },
                    { key: 'moisture', reverse: false },
                    { key: 'radiance', reverse: false }
                ];
                const config = metricConfig[index];
                const reverse = config ? config.reverse : false;
                
                // Генерируем градиент на основе значения
                const gradient = this.getValueBasedGradient(value, reverse);
                gradientId = `gradient-${Date.now()}-${index}`;
                
                const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                const linearGradient = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
                linearGradient.setAttribute('id', gradientId);
                linearGradient.setAttribute('x1', '0%');
                linearGradient.setAttribute('y1', '0%');
                linearGradient.setAttribute('x2', '100%');
                linearGradient.setAttribute('y2', '100%');
                
                const stop1 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                stop1.setAttribute('offset', '0%');
                stop1.setAttribute('style', `stop-color:${gradient.color1};stop-opacity:1`);
                
                const stop2 = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
                stop2.setAttribute('offset', '100%');
                stop2.setAttribute('style', `stop-color:${gradient.color2};stop-opacity:1`);
                
                linearGradient.appendChild(stop1);
                linearGradient.appendChild(stop2);
                defs.appendChild(linearGradient);
                svg.insertBefore(defs, svg.firstChild);
            }
            
            // Убеждаемся, что используется градиент и правильная толщина
            if (gradientId) {
                circle.setAttribute('stroke', `url(#${gradientId})`);
            }
            circle.setAttribute('stroke-width', '2');
            
            const circumference = 2 * Math.PI * 45;
            const offset = circumference - (value / 100) * circumference;
            
            // Анимация круга
            circle.style.transition = 'stroke-dashoffset 1s ease-out';
            circle.style.strokeDashoffset = offset;
            
            // Анимация числа
            const valueEl = valueElements[index];
            let current = 0;
            const duration = 1000; // 1 секунда
            const step = value / (duration / 16); // 60fps
            
            const timer = setInterval(() => {
                current += step;
                if (current >= value) {
                    current = value;
                    clearInterval(timer);
                }
                valueEl.textContent = Math.round(current);
            }, 16);
        });
    }
}

// Global chat instance
const chatManager = new ChatManager();
window.chatManager = chatManager; // Export to window for global access

