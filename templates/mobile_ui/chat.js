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
        memory.addChatMessage(role, content);
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
}

// Global chat instance
const chatManager = new ChatManager();

