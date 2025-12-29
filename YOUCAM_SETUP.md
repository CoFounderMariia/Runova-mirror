# YouCam Skin Analysis Setup Guide

## Overview
The YouCam V2 API requires a **public HTTP URL** for images, not base64 data directly. This means:
1. Camera captures → Convert to base64 → Upload to Imgur → Get HTTP URL → Send to YouCam API
2. Static base64 images → Upload to Imgur → Get HTTP URL → Send to YouCam API

## Current Flow

### Frontend (Camera Capture)
1. User clicks "Analyze Skin" button
2. Camera captures frame → Canvas → Base64 string
3. Base64 sent to `/youcam/analyze` endpoint (JSON) OR `/skin-analyze` endpoint (FormData)

### Backend Processing
1. Receives base64 image
2. **Uploads to Imgur** to get public HTTP URL
3. Sends HTTP URL to YouCam API with task creation
4. Polls YouCam API for results (up to 20 seconds)
5. Extracts metrics and returns to frontend

## Requirements

### 1. YouCam API Key
- Set `YOUCAM_API_KEY` in `.env` file
- Get your API key from YouCam API provider

### 2. Internet Connection
- Required for Imgur upload (to convert base64 → HTTP URL)
- Required for YouCam API calls

### 3. Image Format
- JPEG format (quality 0.9)
- Base64 encoded
- Minimum 100 characters (validates image data)

## Common Issues & Solutions

### Issue 1: Timeout After 20 Seconds
**Problem:** API takes longer than 20 seconds to process
**Solution:** 
- Check server logs for actual API response structure
- The detection logic looks for metric keys (acne, redness, moisture, etc.)
- If API returns results in unexpected format, update `extract_youcam_metrics()` function

### Issue 2: Imgur Upload Fails
**Problem:** Can't upload image to Imgur
**Solution:**
- Check internet connection
- Imgur uses anonymous upload (no API key needed)
- If Imgur is blocked, you'll need an alternative image hosting service

### Issue 3: Camera Capture Not Working
**Problem:** Only static base64 image works, not camera captures
**Solution:**
- Both should work identically - camera capture is converted to base64 first
- Check browser console for errors
- Verify camera permissions are granted
- Check that canvas capture is working

### Issue 4: Results Not Detected
**Problem:** API returns results but code doesn't detect them
**Solution:**
- Check server logs - they now show response structure on each poll
- Look for metric indicators: `acne`, `redness`, `oiliness`, `pore`, `pores`, `texture`, `moisture`, `radiance`, etc.
- Update detection logic if API returns different structure

## Debugging

### Enable Detailed Logging
The code now logs:
- Image upload status
- Imgur response
- Each poll's response structure
- Metric detection results

### Check Server Logs
Look for:
- `📤 Uploading image to Imgur...` - Image upload start
- `✅ Image uploaded to Imgur successfully` - Upload success
- `📥 Poll X/Y response:` - Each polling attempt
- `✅ Found metrics in response data!` - Results detected
- `⏳ Task still processing` - Still waiting for results

## Testing

### Test with Static Image
1. Use `/static-image` endpoint to get base64
2. Send to `/youcam/analyze` endpoint
3. Should work if Imgur upload succeeds

### Test with Camera Capture
1. Click "Analyze Skin" button
2. Camera captures frame
3. Converts to base64
4. Sends to backend
5. Should work identically to static image

## Next Steps

If YouCam API still times out:
1. Check the actual API response structure in logs
2. Verify API key is correct
3. Check if API endpoint URL is correct
4. Consider increasing timeout if API is slow
5. Check if API requires different request format












