import warnings
warnings.filterwarnings("ignore")

import cv2
import numpy as np
import os
import requests
import whisper
import AI_Skin_Analysis as skin_ai

from flask import Flask, render_template, request, jsonify

# === YouCam config (THIS is “at the top”) ===
YOUCAM_TASK_ENDPOINT = "https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis"
YOUCAM_TASK_STATUS_ENDPOINT = "https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis"
YOUCAM_TIMEOUT_SECONDS = 8

# === App init ===
app = Flask(__name__)
import time
def normalize_skin_image(image_base64: str) -> str:
        """
        Perfect Corp–style normalization:
        - decode image
        - face crop (simple)
        - lighting normalization
        - white balance
        - gentle denoise
        - return base64
        """

    # 1️⃣ Decode base64 → image
        image_bytes = base64.b64decode(image_base64)
        np_arr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
        if img is None:
            raise ValueError("Failed to decode image")

        if img is None:
            raise ValueError("Failed to decode image")

    # 2️⃣ Convert to LAB (separate light from color)
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
        l, a, b = cv2.split(lab)

    # 3️⃣ Lighting normalization (CLAHE)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        l_norm = clahe.apply(l)

        lab_norm = cv2.merge((l_norm, a, b))
        img_norm = cv2.cvtColor(lab_norm, cv2.COLOR_LAB2BGR)

    # 4️⃣ Gentle denoise (texture-safe)
        img_denoised = cv2.fastNlMeansDenoisingColored(
        img_norm,
        None,
        h=3,
        hColor=3,
        templateWindowSize=7,
        searchWindowSize=21
    )

    # 5️⃣ Encode back to base64
    _, buffer = cv2.imencode(".jpg", img_denoised, [int(cv2.IMWRITE_JPEG_QUALITY), 95])
    normalized_base64 = base64.b64encode(buffer).decode("utf-8")

    return normalized_base64
def run_youcam_task(image_url: str, api_key: str):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    

    # 1️⃣ Create task
    create_payload = {
        "image_url": image_url
    }

    create_resp = requests.post(
        YOUCAM_TASK_ENDPOINT,
        headers=headers,
        json=create_payload,
        timeout=10
    )

    if create_resp.status_code != 200:
        return None, "Failed to create YouCam task"

    create_data = create_resp.json()
    task_id = create_data.get("task_id")

    if not task_id:
        return None, "YouCam did not return task_id"

    # 2️⃣ Poll task status (FAIL FAST)
    start_time = time.time()

    while time.time() - start_time < YOUCAM_TIMEOUT_SECONDS:
        status_resp = requests.get(
            f"{YOUCAM_TASK_STATUS_ENDPOINT}/{task_id}",
            headers=headers,
            timeout=10
        )

        if status_resp.status_code != 200:
            return None, "Failed to fetch task status"

        status_data = status_resp.json()
        status = status_data.get("status")

        if status == "completed":
            return status_data.get("result"), None

        if status == "failed":
            return None, "YouCam task failed"

        time.sleep(1)

    return None, "YouCam task timeout"

@app.route("/analyze-audio", methods=["POST"])
def analyze_audio():
    audio = request.files.get("audio")
    if not audio:
        return jsonify({"error": "no audio"}), 400

    # временный ответ чтобы просто починить 404
    return jsonify({
        "recognized_text": "I received some audio!",
        "analysis": "This is a test response."
    })

# Load Whisper model once
model = whisper.load_model("small.en")


# -----------------------------
# HOME + DEMO ROUTES
# -----------------------------
@app.route("/")
def home():
    return render_template("mirror.html")

@app.route("/demo")
def demo():
    return render_template("demo/iphone.html")


# -----------------------------
# RETELL REALTIME SESSION (FIXED)
# -----------------------------
@app.route("/retell-session", methods=["POST"])
def create_retell_session():
    RETELL_API_KEY = os.getenv("RETELL_API_KEY")
    AGENT_ID = os.getenv("RETELL_AGENT_ID")

    if not RETELL_API_KEY or not AGENT_ID:
        return jsonify({"error": "Missing RETELL_API_KEY or RETELL_AGENT_ID"}), 500

    url = "https://api.retellai.com/v2/realtime/session"

    headers = {
    "Authorization": f"Bearer {RETELL_API_KEY}",
    "Content-Type": "application/json"
}


    data = {
        "agent_id": AGENT_ID
    }

    response = requests.post(url, json=data, headers=headers)

    if response.status_code != 200:
        print("❌ Retell API error:", response.text)
        return jsonify({"error": "Failed to create session"}), 500

    session = response.json()

    return jsonify({
        "session_id": session["id"],
        "ws_url": session["websocket_url"]
    })


# -----------------------------
# SKIN ANALYSIS ENDPOINT
# -----------------------------

        
        base64_image = data["image"]
        
        result = skin_ai.analyze_face(base64_image, language="en")

        return jsonify({"result": result})
        
    except Exception as e:
        print("❌ Skin analysis error:", e)
        return jsonify({"error": str(e)}), 500


# -----------------------------
# YOUCAM ANALYSIS ENDPOINTS
# -----------------------------
import base64
import time

def upload_to_imgur(image_base64):
    """Upload base64 image to Imgur and return public URL"""
    try:
        # Clean base64 string (remove data:image prefix if present)
        if "," in image_base64:
            image_base64 = image_base64.split(",")[1]
        
        # Imgur anonymous upload API
        # OLD DIRECT YOUCAM CALL — DISABLED
# response = requests.post(...)
# metrics = response.json()

        
        if response.status_code == 200:
            data = response.json()
            if data.get("success"):
                return data["data"]["link"]
        
        print(f"❌ Imgur upload failed: {response.status_code} - {response.text}")
        return None
    except Exception as e:
        print(f"❌ Imgur upload error: {e}")
        return None


def call_youcam_api(image_url, max_wait_seconds=10):
    """
    Call YouCam API with image URL and poll for results with 10-second timeout.
    
    Verified endpoints from PerfectCorp email:
    - POST: https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis
    - GET: https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis/{task_id} (status check)
    
    Documentation: https://yce.makeupar.com/document/index.html#tag/AI-Skin-Analysis
    """
    YOUCAM_API_KEY = os.getenv("YOUCAM_API_KEY")
    if not YOUCAM_API_KEY:
        print("❌ YOUCAM_API_KEY not found in environment")
        return None
    
    # Verified endpoint from PerfectCorp email
    TASK_ENDPOINT = "https://yce-api-01.makeupar.com/s2s/v2.0/task/skin-analysis"
    
    try:
        # Step 1: Create task with YouCam API
        # Request format: {"image_url": "https://..."}
        create_response = requests.post(
            TASK_ENDPOINT,
            headers={
                "Authorization": f"Bearer {YOUCAM_API_KEY}",
                "Content-Type": "application/json"
            },
            json={"image_url": image_url},
            timeout=5
        )
        
        print(f"📤 YouCam API POST response: {create_response.status_code}")
        if create_response.status_code not in [200, 201, 202]:
            print(f"❌ YouCam API create task failed: {create_response.status_code}")
            print(f"Response: {create_response.text[:500]}")
            return None
        
        task_data = create_response.json()
        print(f"📋 Task creation response: {task_data}")
        
        # Extract task_id from response (trying multiple possible structures)
        task_id = (task_data.get("data", {}).get("task_id") or 
                  task_data.get("task_id") or
                  task_data.get("id") or
                  task_data.get("data", {}).get("id"))
        
        if not task_id:
            print(f"❌ No task_id found in response. Full response: {task_data}")
            return None
        
        print(f"✅ Task created: {task_id}")
        
        # Step 2: Poll for results with 10-second timeout
        # GET endpoint: {TASK_ENDPOINT}/{task_id}
        start_time = time.time()
        poll_interval = 0.5  # Poll every 500ms
        max_polls = int(max_wait_seconds / poll_interval)
        
        STATUS_ENDPOINT = f"{TASK_ENDPOINT}/{task_id}"
        
        for poll_num in range(max_polls):
            elapsed = time.time() - start_time
            if elapsed >= max_wait_seconds:
                print(f"⏱️ YouCam API timeout after {max_wait_seconds}s")
                return None
            
            # Poll task status
            poll_response = requests.get(
                STATUS_ENDPOINT,
                headers={
                    "Authorization": f"Bearer {YOUCAM_API_KEY}",
                    "Content-Type": "application/json"
                },
                timeout=2
            )
            
            print(f"📊 Poll {poll_num + 1}/{max_polls}: Status {poll_response.status_code}")
            
            if poll_response.status_code == 200:
                result_data = poll_response.json()
                print(f"📋 Poll response: {result_data}")
                
                # Check task status - common status values
                status = (result_data.get("status") or 
                         result_data.get("data", {}).get("status") or
                         result_data.get("task_status"))
                
                if status in ["completed", "success", "done"]:
                    print(f"✅ Task completed: {task_id}")
                    # Return the data portion or full response
                    return result_data.get("data", {}) or result_data
                elif status in ["processing", "pending", "in_progress", "running"]:
                    # Still processing, continue polling
                    time.sleep(poll_interval)
                    continue
                elif status in ["failed", "error"]:
                    print(f"❌ Task failed with status: {status}")
                    return None
                else:
                    # Unknown status - log and continue
                    print(f"⚠️ Unknown status: {status}, continuing...")
                    time.sleep(poll_interval)
                    continue
            elif poll_response.status_code == 202:
                # Accepted but still processing
                time.sleep(poll_interval)
                continue
            else:
                print(f"⚠️ Poll status {poll_response.status_code}, response: {poll_response.text[:200]}")
                time.sleep(poll_interval)
                continue
        
        print(f"⏱️ YouCam API timeout after {max_wait_seconds}s (max polls reached)")
        return None
        
    except requests.exceptions.Timeout:
        print("⏱️ YouCam API request timeout")
        return None
    except Exception as e:
        print(f"❌ YouCam API error: {e}")
        import traceback
        traceback.print_exc()
        return None


def extract_youcam_metrics(youcam_data):
    """Extract skin metrics from YouCam API response"""
    if not youcam_data:
        return {}
    
    # Try to extract metrics from various possible response structures
    metrics = {}
    
    # Common metric keys to look for
    metric_keys = ["acne", "oiliness", "redness", "wrinkles", "spots", "pores", 
                   "texture", "moisture", "radiance", "acne_level", "pore"]
    
    # Check direct keys
    for key in metric_keys:
        if key in youcam_data:
            value = youcam_data[key]
            if isinstance(value, (int, float)):
                metrics[key] = value / 100.0 if value > 1 else value  # Normalize to 0-1
    
    # Check nested structures
    if "results" in youcam_data:
        for key in metric_keys:
            if key in youcam_data["results"]:
                value = youcam_data["results"][key]
                if isinstance(value, (int, float)):
                    metrics[key] = value / 100.0 if value > 1 else value
    
    if "metrics" in youcam_data:
        for key in metric_keys:
            if key in youcam_data["metrics"]:
                value = youcam_data["metrics"][key]
                if isinstance(value, (int, float)):
                    metrics[key] = value / 100.0 if value > 1 else value
    
    return metrics


@app.route("/youcam/analyze", methods=["POST"])
def youcam_analyze():
    """Handle YouCam analysis with FormData image file - 10 second max"""
    try:
        # Handle FormData with image file
        if "image" not in request.files:
            return jsonify({"error": "No image file provided"}), 400
        
        image_file = request.files["image"]
        if not image_file or image_file.filename == "":
            return jsonify({"error": "Invalid image file"}), 400
        
        # Read image file and convert to base64
        image_data = image_file.read()
        image_base64 = base64.b64encode(image_data).decode("utf-8")
        # 🔧 Normalize image before analysis (Perfect Corp style)
        image_base64 = normalize_skin_image(image_base64)

        
        # Upload to Imgur to get public URL
        print("📤 Uploading image to Imgur...")
        image_url = upload_to_imgur(image_base64)
        if not image_url:
            return jsonify({"error": "Failed to upload image to Imgur"}), 500
        
        print(f"✅ Image uploaded: {image_url}")
        
        # Call YouCam API with 10-second timeout
        # Call YouCam TASK-based API (authoritative)
        print("📥 Creating YouCam analysis task...")
        result, error = run_youcam_task(image_url, YOUCAM_API_KEY)

        if error:
            print(f"⚠️ YouCam task failed: {error}")
            return jsonify({
                "success": False,
                "error": error
            }), 500

        
        
    except Exception as e:
        print("❌ YouCam analyze failed")
        print(e)

        return jsonify({
        "success": False,
        "error": "Skin analysis unavailable. Please retry."
    }), 500




        image_base64 = data["image"]
        frame_id = data.get("frame_id", "unknown")
        
        # Upload to Imgur to get public URL
        print(f"📤 Uploading frame {frame_id} to Imgur...")
        image_url = upload_to_imgur(image_base64)
        if not image_url:
            return jsonify({"error": "Failed to upload image to Imgur"}), 500
        
        # Call YouCam API with 10-second timeout
        print(f"📥 Calling YouCam API for frame {frame_id}...")
        youcam_result = call_youcam_api(image_url, max_wait_seconds=10)
        
        if youcam_result:
            metrics = extract_youcam_metrics(youcam_result)
            return jsonify({
                "skin_report": metrics,
                "analysis": "",
                "frame_id": frame_id,
                "audio_url": None
            })
        else:
            # Timeout or error
            return jsonify({
                "skin_report": {},
                "analysis": "",
                "frame_id": frame_id,
                "audio_url": None
            })
        
    except Exception as e:
        print(f"❌ YouCam analyze-live error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/skin-analyze", methods=["POST"])
def skin_analyze():
    return jsonify({
        "success": False,
        "error": "This endpoint is deprecated. Use /youcam/analyze."
    }), 410



# -----------------------------
# START SERVER
# -----------------------------
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"🚀 Starting Runova server on http://0.0.0.0:{port}")
    print(f"📱 Access at http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=True)
