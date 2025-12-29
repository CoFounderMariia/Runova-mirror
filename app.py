import os
import base64
import uuid
import socket
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import requests
from flask import Flask, request, jsonify, make_response, render_template

# =========================
# Minimal .env loader
# =========================

def load_dotenv():
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if os.getenv(k) is None:
                os.environ[k] = v.strip().strip('"').strip("'")

load_dotenv()

# =========================
# App
# =========================

app = Flask(__name__, template_folder="templates", static_folder="static")

@app.after_request
def cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return resp

def options_204():
    return make_response("", 204)

# =========================
# Health / Frontend
# =========================

@app.route("/", methods=["GET"])
def home():
    return render_template("index.html")

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})

# =========================
# YouCam config
# =========================

YOUCAM_ENDPOINT = (
    os.getenv("YOUCAM_BASE_URL")
    or "https://yce-api-01.makeupar.com/s2s/v2.0/file/skin-analysis"
)

YOUCAM_API_KEY = os.getenv("YOUCAM_API_KEY")

if not YOUCAM_API_KEY:
    raise RuntimeError("YOUCAM_API_KEY is missing")

# =========================
# Helpers
# =========================

def extract_image_bytes() -> Tuple[Optional[bytes], Optional[str]]:
    if request.files:
        f = request.files.get("image") or request.files.get("file")
        if f:
            data = f.read()
            if data:
                return data, None
            return None, "Uploaded image is empty"

    if request.is_json:
        body = request.get_json(silent=True) or {}
        b64 = body.get("image") or body.get("image_base64")
        if not b64:
            return None, "Missing base64 image"
        try:
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            return base64.b64decode(b64), None
        except Exception as e:
            return None, f"Invalid base64: {e}"

    return None, "No image found"

def call_youcam(image_bytes: bytes):
    headers = {
        "Authorization": f"Bearer {YOUCAM_API_KEY}",
    }

    files = {
        "file": ("image.jpg", image_bytes, "image/jpeg")
    }

    resp = requests.post(
        YOUCAM_ENDPOINT,
        headers=headers,
        files=files,
        timeout=45
    )

    raw = (resp.text or "")[:2000]
    try:
        data = resp.json() if resp.text else {}
    except Exception:
        data = {}

    return resp.status_code, data, raw

# =========================
# API
# =========================

@app.route("/skin-analyze", methods=["OPTIONS"])
def skin_analyze_options():
    return options_204()

@app.route("/skin-analyze", methods=["POST"])
def skin_analyze():
    trace_id = str(uuid.uuid4())[:8]

    img_bytes, err = extract_image_bytes()
    if err:
        return jsonify({
            "ok": False,
            "trace_id": trace_id,
            "error": err
        }), 400

    try:
        status, payload, raw = call_youcam(img_bytes)

        if status < 200 or status >= 300:
            return jsonify({
                "ok": False,
                "trace_id": trace_id,
                "error": "YouCam request failed",
                "upstream_status": status,
                "upstream_body": raw
            }), 502

        return jsonify({
            "ok": True,
            "trace_id": trace_id,
            "skin_report": payload
        })

    except Exception as e:
        return jsonify({
            "ok": False,
            "trace_id": trace_id,
            "error": "Server exception",
            "detail": str(e)
        }), 502

@app.route("/youcam/analyze", methods=["POST", "OPTIONS"])
def youcam_alias():
    if request.method == "OPTIONS":
        return options_204()
    return skin_analyze()

# =========================
# Run
# =========================

def port_free(p):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", p)) != 0

if __name__ == "__main__":
    preferred = int(os.getenv("PORT", "5005"))
    port = preferred if port_free(preferred) else 0
    app.run(host="0.0.0.0", port=port, debug=False)
