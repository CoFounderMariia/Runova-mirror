/**
 * Frontend Memory System
 * Stores scan results, user concerns, and recommendations
 */

class RunovaMemory {
    constructor() {
        this.data = {
            lastScan: null,
            scanHistory: [],
            userConcerns: [],
            recommendations: [],
            chatHistory: []
        };
        this.load();
    }

    // Load from localStorage
    load() {
        try {
            const saved = localStorage.getItem('runova_memory');
            if (saved) {
                this.data = { ...this.data, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.error('Failed to load memory:', e);
        }
    }

    // Save to localStorage
    save() {
        try {
            localStorage.setItem('runova_memory', JSON.stringify(this.data));
        } catch (e) {
            console.error('Failed to save memory:', e);
        }
    }

    // Store last scan result
    storeScan(scanData) {
        this.data.lastScan = {
            timestamp: new Date().toISOString(),
            analysis: scanData.analysis,
            image: scanData.image, // Base64 or URL
            concerns: scanData.concerns || []
        };
        this.data.scanHistory.unshift(this.data.lastScan);
        // Keep only last 10 scans
        if (this.data.scanHistory.length > 10) {
            this.data.scanHistory = this.data.scanHistory.slice(0, 10);
        }
        this.save();
    }

    // Add user concern
    addConcern(concern) {
        const concernData = {
            text: concern,
            timestamp: new Date().toISOString()
        };
        this.data.userConcerns.push(concernData);
        // Keep only last 20 concerns
        if (this.data.userConcerns.length > 20) {
            this.data.userConcerns = this.data.userConcerns.slice(-20);
        }
        this.save();
    }

    // Store recommendation
    addRecommendation(recommendation) {
        const recData = {
            ...recommendation,
            timestamp: new Date().toISOString()
        };
        this.data.recommendations.push(recData);
        // Keep only last 30 recommendations
        if (this.data.recommendations.length > 30) {
            this.data.recommendations = this.data.recommendations.slice(-30);
        }
        this.save();
    }

    // Add chat message
    addChatMessage(role, content) {
        this.data.chatHistory.push({
            role: role, // 'user' or 'assistant'
            content: content,
            timestamp: new Date().toISOString()
        });
        // Keep only last 50 messages
        if (this.data.chatHistory.length > 50) {
            this.data.chatHistory = this.data.chatHistory.slice(-50);
        }
        this.save();
    }

    // Get all data for backend sync
    getAllData() {
        return this.data;
    }

    // Clear all data
    clear() {
        this.data = {
            lastScan: null,
            scanHistory: [],
            userConcerns: [],
            recommendations: [],
            chatHistory: []
        };
        localStorage.removeItem('runova_memory');
    }
}

// Global memory instance
const memory = new RunovaMemory();

