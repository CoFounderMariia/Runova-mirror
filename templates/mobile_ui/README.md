# Runova Mobile UI

Clean, mobile-first interface for Runova smart skin analysis.

## Features

✅ **Mobile-First Design** - iPhone-like vertical layout (390-430px width)
✅ **Face-ID Style Scanning** - Blue oval overlay with progress bar
✅ **External Webcam Support** - Automatically detects and uses external cameras
✅ **ChatGPT-Style Chat** - Clean chat feed for AI responses
✅ **Product Recommendations** - Card-based product suggestions
✅ **Frontend Memory** - Stores scan history, concerns, and recommendations

## File Structure

```
mobile_ui/
├── index.html          # Main HTML structure
├── styles.css          # Mobile-first CSS styling
├── app.js             # Main application logic
├── camera.js          # Camera management
├── scan.js            # Face scanning logic
├── chat.js            # Chat feed management
├── product-manager.js # Product cards
└── memory.js          # Frontend memory system
```

## Usage

1. Start the Flask server:
   ```bash
   python3 app.py
   ```

2. Navigate to:
   ```
   http://localhost:5001/mobile
   ```

3. Allow camera and microphone access when prompted.

## API Endpoints Used

- `POST /scan-face` - Face image analysis
- `POST /analyze-audio` - Voice input processing
- `POST /ask` - Text question answering
- `GET /audio/<filename>` - Audio file serving

## Memory System

The frontend memory system stores:
- Last scan results
- Scan history (last 10)
- User concerns (last 20)
- Recommendations (last 30)
- Chat history (last 50)

All data is stored in browser localStorage and can be synced with backend.

