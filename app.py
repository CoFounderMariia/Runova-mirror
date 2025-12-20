import warnings
warnings.filterwarnings("ignore")

from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_cors import CORS
import os
import json
import whisper
import AI_Skin_Analysis as skin_ai
import requests
import tempfile
import uuid
from pathlib import Path
import logging
from datetime import datetime

from dotenv import load_dotenv
load_dotenv()

# Setup logging to file for YouCam API debugging
log_dir = Path("logs")
log_dir.mkdir(exist_ok=True)
log_file = log_dir / f"youcam_api_{datetime.now().strftime('%Y%m%d')}.log"

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler(log_file),
        logging.StreamHandler()  # Also print to console
    ]
)

youcam_logger = logging.getLogger('youcam_api')
youcam_logger.info("=" * 80)
youcam_logger.info("YouCam API Logger initialized")
youcam_logger.info(f"Log file: {log_file}")
youcam_logger.info("=" * 80)

# Helper function to get YouCam API key with multiple name variations
def get_youcam_api_key():
    """
    Get YouCam API key from environment variables.
    Tries multiple possible variable names to ensure compatibility.
    Priority: YOUcam_API_KEY (as specified by user) > YOUCAM_API_KEY > others
    """
    possible_names = [
        "YOUCAM_API_KEY",      # Standard format (first priority)
        "YOUcam_API_KEY",      # User's preferred format
        "YOUCAM_APIKEY",       # Without underscore
        "YOUcam_APIKEY",       # Mixed case without underscore
        "YOUCAMAPIKEY",        # All caps no separators
        "YOUcamAPIKEY",        # Mixed case no separators
    ]
    
    for name in possible_names:
        key = os.getenv(name)
        if key and key.strip() and key not in ["YOUR_YOUCAM_API_KEY", "YOUR_YOUcam_API_KEY", ""]:
            print(f"✅ Found YouCam API key using variable name: {name}")
            return key.strip()
    
    print(f"⚠️ YouCam API key not found. Tried: {', '.join(possible_names)}")
    print(f"   Please set YOUCAM_API_KEY in your .env file")
    return None

# Helper function to get YouCam base URL from environment
def get_youcam_base_url():
    """
    Get YouCam base URL from environment variables.
    Returns CLEAN base URL without any paths.
    """
    base_url = os.getenv("YOUCAM_BASE_URL")
    
    if base_url and base_url.strip():
        base_url = base_url.strip()
        # Extract only the base URL (protocol + domain), remove any paths
        # e.g., "https://api.youcamapi.com/api/v1.1/file/skin-analysis" -> "https://api.youcamapi.com"
        if base_url.startswith("http://") or base_url.startswith("https://"):
            # Find the third slash (after protocol and domain)
            parts = base_url.split("/")
            if len(parts) >= 3:
                base_url = f"{parts[0]}//{parts[2]}"
        print(f"✅ Using YouCam base URL from .env: {base_url}")
        return base_url
    
    # Default base URL - MUST be exactly as specified
    default_url = "https://yce-api-01.makeupar.com"
    print(f"ℹ️ Using default YouCam base URL: {default_url}")
    print(f"   To use custom URL, set YOUCAM_BASE_URL in .env file (clean URL only, no paths)")
    print(f"   YOUCAM_BASE_URL MUST be: https://yce-api-01.makeupar.com")
    return default_url

# Import OpenAI client (modern API)
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    print("⚠️ OpenAI library not available. Install with: pip install openai")
    
# Also try old API style as fallback
try:
    import openai as openai_old
    OPENAI_OLD_AVAILABLE = True
except ImportError:
    OPENAI_OLD_AVAILABLE = False

app = Flask(__name__, template_folder="templates")

# Enable CORS for all routes to allow frontend requests
CORS(app, resources={
    r"/*": {
        "origins": ["*"],  # Allow all origins (you can restrict this to specific domains in production)
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

@app.route("/static-image", methods=["GET"])
def get_static_image():
    """Serve the static base64 image for testing"""
    try:
        image_path = Path("image_base64.txt")
        if image_path.exists():
            with open(image_path, 'r') as f:
                base64_string = f.read().strip()
            return jsonify({
                "base64": base64_string,
                "format": "data:image/jpeg;base64,"  # Add this prefix when using
            })
        else:
            return jsonify({"error": "Static image file not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/temp-image/<image_id>", methods=["GET"])
def serve_temp_image(image_id):
    """Serve a temporary image from base64 for YouCam API"""
    import base64 as b64
    try:
        # Get base64 from request args or use static image
        base64_data = request.args.get('data')
        if not base64_data:
            # Fallback to static image
            image_path = Path("image_base64.txt")
            if image_path.exists():
                with open(image_path, 'r') as f:
                    base64_data = f.read().strip()
            else:
                return jsonify({"error": "No image data provided"}), 400
        
        # Decode and serve as image
        image_bytes = b64.b64decode(base64_data)
        from flask import Response
        return Response(image_bytes, mimetype='image/jpeg')
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/skin-analyze", methods=["POST"])
def skin_analyze():
    """
    Skin analysis endpoint that uses YouCam V2 API.
    Accepts image file upload and returns analysis results.
    """
    try:
        if "image" not in request.files:
            return jsonify({"error": "No image uploaded"}), 400

        image = request.files["image"]
        image_bytes = image.read()
        
        # Convert image bytes to base64
        import base64 as b64
        base64_image = b64.b64encode(image_bytes).decode('utf-8')
        
        # Get YouCam API key
        youcam_api_key = get_youcam_api_key()
        
        if not youcam_api_key:
            # Fallback to old AI analysis if YouCam API key not available
            print("⚠️ YouCam API key not found, using fallback AI analysis")
            result = skin_ai.analyze_skin(image_bytes)
            return jsonify(result)
        
        # Use YouCam V2 API
        print("📡 Using YouCam V2 API for skin analysis...")
        youcam_result = analyze_with_youcam_v2_api(base64_image, youcam_api_key)
        
        if not youcam_result:
            # Fallback to old AI analysis
            print("⚠️ YouCam API returned empty result, using fallback AI analysis")
            result = skin_ai.analyze_skin(image_bytes)
            return jsonify(result)
        
        # Format response for frontend
        skin_report = youcam_result.get("skin_report", {})
        
        # Create a formatted text analysis from metrics
        analysis_text = format_youcam_metrics_as_text(skin_report)
        
        return jsonify({
            "analysis": analysis_text,
            "skin_report": skin_report,
            "raw_response": youcam_result.get("raw_response", {})
        })
        
    except Exception as e:
        print(f"❌ Skin analysis error: {e}")
        import traceback
        traceback.print_exc()
        # Fallback to old AI analysis on error
        try:
            result = skin_ai.analyze_skin(image_bytes)
            return jsonify(result)
        except:
            return jsonify({"error": str(e)}), 500

# Create audio directory if it doesn't exist
AUDIO_DIR = Path(__file__).parent / "audio"
AUDIO_DIR.mkdir(exist_ok=True)

# Load products from JSON file (if exists)
PRODUCTS_DB = {}
PRODUCTS_JSON_PATH = Path("products.json")
EXTRACTED_PRODUCTS_JSON_PATH = Path("extracted_products.json")

# -----------------------------
# AMAZON URL HELPERS (needed before load_products_from_json)
# -----------------------------
def generate_amazon_image_url(asin):
    """
    Generate Amazon product image URL from ASIN.
    Returns a list of possible image URLs (different sizes/formats).
    """
    if not asin:
        return []
    
    # Try multiple Amazon image URL patterns
    urls = [
        f"https://m.media-amazon.com/images/I/{asin}._SL1500_.jpg",  # Large size
        f"https://m.media-amazon.com/images/I/{asin}._SL1000_.jpg",  # Medium size
        f"https://m.media-amazon.com/images/I/{asin}._SL500_.jpg",   # Small size
        f"https://images-na.ssl-images-amazon.com/images/I/{asin}._SL1500_.jpg",  # Alternative domain
    ]
    return urls

def extract_asin_from_amazon_url(amazon_url, follow_redirects=True):
    """
    Extract ASIN from various Amazon URL formats.
    If URL is incomplete/truncated, tries to fetch the full URL by following redirects.
    If ASIN is too short (< 10 chars), tries to fetch the full product page to get complete ASIN.
    Returns ASIN string or None if not found.
    """
    import re
    
    if not amazon_url or "amazon.com" not in amazon_url:
        return None
    
    # Pattern 1: Standard /dp/ASIN format (most common)
    asin_match = re.search(r'/dp/([A-Z0-9]{5,10})', amazon_url)
    if asin_match:
        asin = asin_match.group(1)
        if len(asin) < 10 and follow_redirects:
            print(f"  ⚠️ ASIN '{asin}' is too short ({len(asin)} chars), fetching full product page...")
            try:
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                }
                response = requests.get(amazon_url, headers=headers, timeout=10, allow_redirects=True)
                if response.status_code == 200:
                    html_content = response.text
                    final_url = response.url
                    final_asin_match = re.search(r'/dp/([A-Z0-9]{10})', final_url)
                    if final_asin_match:
                        complete_asin = final_asin_match.group(1)
                        print(f"  ✅ Found complete ASIN '{complete_asin}' from redirected URL")
                        return complete_asin
                    
                    asin_patterns = [
                        r'data-asin=["\']([A-Z0-9]{10})["\']',
                        r'"asin":\s*["\']([A-Z0-9]{10})["\']',
                        r"'asin':\s*['\"]([A-Z0-9]{10})['\"]",
                        r'ASIN["\']?\s*:\s*["\']([A-Z0-9]{10})["\']',
                    ]
                    for pattern in asin_patterns:
                        match = re.search(pattern, html_content)
                        if match:
                            complete_asin = match.group(1)
                            if len(complete_asin) == 10:
                                print(f"  ✅ Found complete ASIN '{complete_asin}' in HTML")
                                return complete_asin
                    
                    canonical_match = re.search(r'<link[^>]*rel=["\']canonical["\'][^>]*href=["\']([^"\']+)["\']', html_content)
                    if canonical_match:
                        canonical_url = canonical_match.group(1)
                        canonical_asin_match = re.search(r'/dp/([A-Z0-9]{10})', canonical_url)
                        if canonical_asin_match:
                            complete_asin = canonical_asin_match.group(1)
                            print(f"  ✅ Found complete ASIN '{complete_asin}' in canonical URL")
                            return complete_asin
                    
                    print(f"  ⚠️ Could not find complete ASIN in product page, using partial ASIN '{asin}'")
            except Exception as e:
                print(f"  ⚠️ Could not fetch product page to get complete ASIN: {e}")
                print(f"     Using partial ASIN '{asin}' (may cause image loading issues)")
        
        return asin
    
    # Pattern 2: /gp/product/ASIN format
    asin_match = re.search(r'/gp/product/([A-Z0-9]{5,10})', amazon_url)
    if asin_match:
        asin = asin_match.group(1)
        if len(asin) < 10 and follow_redirects:
            try:
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml',
                }
                response = requests.get(amazon_url, headers=headers, timeout=10, allow_redirects=True)
                if response.status_code == 200:
                    final_url = response.url
                    final_asin_match = re.search(r'/dp/([A-Z0-9]{10})', final_url)
                    if final_asin_match:
                        return final_asin_match.group(1)
            except:
                pass
        return asin
    
    # Pattern 3: /product/ASIN format
    asin_match = re.search(r'/product/([A-Z0-9]{5,10})', amazon_url)
    if asin_match:
        return asin_match.group(1)
    
    # Pattern 4: ASIN in query parameters
    asin_match = re.search(r'[?&]asin=([A-Z0-9]{5,10})', amazon_url, re.IGNORECASE)
    if asin_match:
        return asin_match.group(1)
    
    # Pattern 5: Look for any ASIN pattern in the URL (last resort)
    asin_match = re.search(r'([A-Z0-9]{5,10})(?:[/?&]|$)', amazon_url)
    if asin_match:
        potential_asin = asin_match.group(1)
        if len(potential_asin) >= 5 and potential_asin[0] in 'B0123456789':
            if len(potential_asin) < 10 and follow_redirects:
                try:
                    headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml',
                    }
                    response = requests.get(amazon_url, headers=headers, timeout=10, allow_redirects=True)
                    if response.status_code == 200:
                        final_url = response.url
                        final_asin_match = re.search(r'/dp/([A-Z0-9]{10})', final_url)
                        if final_asin_match:
                            return final_asin_match.group(1)
                except:
                    pass
            return potential_asin
    
    # If URL appears incomplete, try to fetch the full URL by following redirects
    if follow_redirects and '/dp/' not in amazon_url and '/gp/product/' not in amazon_url:
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            }
            response = requests.head(amazon_url, headers=headers, timeout=5, allow_redirects=True)
            final_url = response.url if hasattr(response, 'url') else amazon_url
            
            if final_url != amazon_url:
                asin = extract_asin_from_amazon_url(final_url, follow_redirects=False)
                if asin:
                    print(f"  🔍 Extracted ASIN from redirected URL: {asin}")
                    return asin
        except Exception as e:
            print(f"  ⚠️ Could not follow redirects for URL {amazon_url[:100]}: {e}")
    
    return None

def load_products_from_json():
    """Load products from JSON files"""
    global PRODUCTS_DB
    import json
    
    # First, load products.json (main products file)
    try:
        if PRODUCTS_JSON_PATH.exists():
            with open(PRODUCTS_JSON_PATH, 'r', encoding='utf-8') as f:
                PRODUCTS_DB = json.load(f)
            print(f"✅ Loaded {len(PRODUCTS_DB)} products from {PRODUCTS_JSON_PATH}")
        else:
            print(f"ℹ️ Products JSON file not found at {PRODUCTS_JSON_PATH}, using default products")
            PRODUCTS_DB = get_default_products()
    except Exception as e:
        print(f"⚠️ Error loading products JSON: {e}, using default products")
        PRODUCTS_DB = get_default_products()
    
    # Then, load and merge products from extracted_products.json
    try:
        if EXTRACTED_PRODUCTS_JSON_PATH.exists():
            with open(EXTRACTED_PRODUCTS_JSON_PATH, 'r', encoding='utf-8') as f:
                extracted_data = json.load(f)
            
            if "products" in extracted_data and isinstance(extracted_data["products"], list):
                import re
                added_count = 0
                for product in extracted_data["products"]:
                    product_name = product.get("name", "").strip()
                    if not product_name:
                        continue
                    
                    # Generate a unique key from product name
                    # Remove numbers and special characters, convert to lowercase, replace spaces with underscores
                    key_base = re.sub(r'^\d+\.\s*', '', product_name)  # Remove leading numbers
                    key_base = re.sub(r'[^a-zA-Z0-9\s]', '', key_base)  # Remove special chars
                    key_base = key_base.lower().strip()
                    key_base = re.sub(r'\s+', '_', key_base)  # Replace spaces with underscores
                    key_base = key_base[:50]  # Limit length
                    
                    # Create unique key by appending number if needed
                    unique_key = key_base
                    counter = 1
                    while unique_key in PRODUCTS_DB:
                        unique_key = f"{key_base}_{counter}"
                        counter += 1
                    
                    # Only add if product doesn't already exist (check by name)
                    product_exists = False
                    for existing_product in PRODUCTS_DB.values():
                        if existing_product.get("name", "").lower() == product_name.lower():
                            product_exists = True
                            break
                    
                    if not product_exists:
                        # Determine product type from name/description
                        name_lower = product_name.lower()
                        description = ""
                        price = "Check price"
                        image_url = ""
                        
                        # Try to extract image from Amazon URL for ALL products
                        amazon_url = product.get("url", "")
                        if amazon_url and "amazon.com" in amazon_url:
                            # Use improved ASIN extraction function (will follow redirects for incomplete URLs)
                            asin = extract_asin_from_amazon_url(amazon_url, follow_redirects=True)
                            if asin:
                                # Generate Amazon image URLs (try multiple formats)
                                amazon_image_urls = generate_amazon_image_url(asin)
                                if amazon_image_urls:
                                    # Use the first (largest) image URL
                                    image_url = amazon_image_urls[0]
                                    print(f"  📷 Generated image URL for {product_name} (ASIN: {asin}): {image_url}")
                                else:
                                    print(f"  ⚠️ Could not generate image URL for {product_name} (ASIN: {asin})")
                            else:
                                print(f"  ⚠️ Could not extract ASIN from URL for {product_name}: {amazon_url[:100]}")
                                # Try one more time with a HEAD request to get full URL
                                try:
                                    headers = {
                                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                        'Accept': 'text/html,application/xhtml+xml',
                                    }
                                    response = requests.head(amazon_url, headers=headers, timeout=5, allow_redirects=True)
                                    if hasattr(response, 'url') and response.url != amazon_url:
                                        final_url = response.url
                                        asin = extract_asin_from_amazon_url(final_url, follow_redirects=False)
                                        if asin:
                                            amazon_image_urls = generate_amazon_image_url(asin)
                                            if amazon_image_urls:
                                                image_url = amazon_image_urls[0]
                                                print(f"  🔄 Retry: Generated image URL for {product_name} from redirected URL (ASIN: {asin}): {image_url}")
                                except Exception as e:
                                    print(f"  ⚠️ Could not fetch full URL for {product_name}: {e}")
                        
                        # Auto-detect product type for description
                        if any(word in name_lower for word in ["sunscreen", "spf", "sun protection"]):
                            description = "Sunscreen product for daily sun protection"
                        elif any(word in name_lower for word in ["cleanser", "wash", "cleaning"]):
                            description = "Facial cleanser for daily skincare routine"
                        elif any(word in name_lower for word in ["moisturizer", "moisturizing", "cream", "lotion"]):
                            description = "Moisturizing product for hydration and skin care"
                        elif any(word in name_lower for word in ["serum"]):
                            description = "Skincare serum for targeted treatment"
                        elif any(word in name_lower for word in ["retinol", "retin"]):
                            description = "Retinol product for anti-aging and skin renewal"
                        else:
                            description = "Skincare product"
                        
                        # Check for fragrance-free
                        if any(phrase in name_lower for phrase in ["fragrance-free", "fragrance free", "unscented"]):
                            description += ", fragrance-free"
                        
                        PRODUCTS_DB[unique_key] = {
                            "name": product_name,
                            "description": description,
                            "price": price,
                            "image": image_url,
                            "link": product.get("url", "")
                        }
                        added_count += 1
                
                print(f"✅ Added {added_count} additional products from {EXTRACTED_PRODUCTS_JSON_PATH}")
                print(f"📦 Total products in database: {len(PRODUCTS_DB)}")
            else:
                print(f"⚠️ extracted_products.json has unexpected format")
    except Exception as e:
        print(f"⚠️ Error loading extracted_products.json: {e}")
        import traceback
        traceback.print_exc()

def get_default_products():
    """Default products database (fallback if JSON not available)"""
    return {
        "oily_skin": {
            "name": "CeraVe Foaming Facial Cleanser",
            "description": "Oil-free, non-comedogenic, removes excess oil without over-drying",
            "price": "$14.99",
            "image": "/static/images/products/cerave-foaming.jpg",
            "link": "https://www.amazon.com/s?k=CeraVe+Foaming+Facial+Cleanser"
        },
        "dry_skin": {
            "name": "CeraVe Moisturizing Cream",
            "description": "Rich, non-greasy formula with ceramides and hyaluronic acid",
            "price": "$18.99",
            "image": "/static/images/products/cerave-moisturizing.jpg",
            "link": "https://www.amazon.com/s?k=CeraVe+Moisturizing+Cream"
        },
        "acne_breakout": {
            "name": "CeraVe Renewing SA Cleanser",
            "description": "Salicylic acid formula reduces breakouts and unclogs pores",
            "price": "$12.99",
            "image": "/static/images/products/cerave-sa-cleanser.jpg",
            "link": "https://www.amazon.com/s?k=CeraVe+Renewing+SA+Cleanser"
        },
        "sensitive_skin": {
            "name": "La Roche-Posay Toleriane Double Repair Moisturizer",
            "description": "Fragrance-free, gentle formula for sensitive skin",
            "price": "$21.99",
            "image": "/static/images/products/laroche-toleriane.jpg",
            "link": "https://www.amazon.com/s?k=La+Roche-Posay+Toleriane"
        },
        "anti_aging": {
            "name": "CeraVe Skin Renewing Retinol Serum",
            "description": "Retinol formula reduces fine lines and improves texture",
            "price": "$17.99",
            "image": "/static/images/products/cerave-retinol.jpg",
            "link": "https://www.amazon.com/s?k=CeraVe+Retinol+Serum"
        }
    }

# Load products at startup
load_products_from_json()

# Load Whisper model once at startup
print("🔄 Loading Whisper model...")
try:
    model = whisper.load_model("small.en")
    print("✅ Whisper model loaded!")
except Exception as e:
    print(f"❌ Failed to load Whisper model: {e}")
    print("⚠️ Make sure you have installed: pip install openai-whisper")
    print("⚠️ Also ensure ffmpeg is installed: brew install ffmpeg (on Mac)")
    model = None

@app.route("/analyze-audio", methods=["POST"])
def analyze_audio():
    temp_path = None
    try:
        audio = request.files.get("audio")
        if not audio:
            return jsonify({"error": "no audio"}), 400

        print("🎤 Received audio file, transcribing...")
        
        # Save uploaded file temporarily
        with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as tmp_file:
            audio.save(tmp_file.name)
            temp_path = tmp_file.name
        
        print(f"📁 Saved audio to: {temp_path}")
        print(f"📊 File size: {os.path.getsize(temp_path)} bytes")
        
        # Check if model is loaded
        if model is None:
            raise Exception("Whisper model not loaded")
        
        # Transcribe audio using Whisper
        # Try local Whisper first, fallback to OpenAI API if it fails
        print("🔄 Starting transcription...")
        
        recognized_text = ""
        try:
            # Try local Whisper with minimal parameters to avoid tokenizer issues
            result = model.transcribe(temp_path)
            recognized_text = result["text"].strip()
            print(f"✅ Local Whisper transcription successful")
        except (ValueError, Exception) as whisper_error:
            print(f"⚠️ Local Whisper failed: {whisper_error}")
            print("🔄 Falling back to OpenAI Whisper API...")
            
            # Fallback to OpenAI API using direct HTTP request (avoids library version issues)
            try:
                api_key = os.getenv("OPENAI_API_KEY")
                if not api_key or api_key == "YOUR_OPENAI_API_KEY":
                    raise Exception("OPENAI_API_KEY not set in .env file")
                
                # Use direct HTTP request to OpenAI API to avoid library compatibility issues
                print("📡 Calling OpenAI API directly via HTTP...")
                with open(temp_path, "rb") as audio_file:
                    files = {
                        'file': ('audio.webm', audio_file, 'audio/webm')
                    }
                    headers = {
                        'Authorization': f'Bearer {api_key}'
                    }
                    data = {
                        'model': 'whisper-1'
                    }
                    
                    response = requests.post(
                        'https://api.openai.com/v1/audio/transcriptions',
                        headers=headers,
                        files=files,
                        data=data,
                        timeout=30
                    )
                    
                    if response.status_code == 200:
                        result = response.json()
                        recognized_text = result.get('text', '').strip()
                        print(f"✅ OpenAI API transcription successful")
                    else:
                        raise Exception(f"OpenAI API returned status {response.status_code}: {response.text}")
                    
            except Exception as api_error:
                print(f"❌ OpenAI API also failed: {api_error}")
                # Don't raise - just return empty text so user knows it failed
                recognized_text = "[Transcription failed - check server logs]"
                print(f"⚠️ Returning empty transcription due to API failure")
        
        print(f"🔎 Transcribed: '{recognized_text}'")
        
        # If transcription is empty, it might be silence or too short
        if not recognized_text:
            recognized_text = "[No speech detected]"
            print("⚠️ No speech detected in audio")
        
        # Send transcribed text to /ask endpoint for AI response
        analysis = "This is a test response."  # Placeholder for now
        audio_url = None
        recommendations = []
        try:
            ask_response = requests.post(
                "http://127.0.0.1:5001/ask",
                json={"question": recognized_text},
                timeout=30  # Increased timeout to allow for TTS generation
            )
            if ask_response.status_code == 200:
                ask_data = ask_response.json()
                analysis = ask_data.get("answer", analysis)
                audio_url = ask_data.get("audio_url", None)  # Extract audio_url from /ask response
                recommendations = ask_data.get("recommendations", [])  # Extract recommendations from /ask response
                if audio_url:
                    print(f"🔊 Audio URL received from /ask: {audio_url}")
                if recommendations:
                    print(f"🛍️ Recommendations received from /ask: {len(recommendations)} products")
        except Exception as e:
            print(f"⚠️ Could not get AI response: {e}")
        
        return jsonify({
            "recognized_text": recognized_text,
            "analysis": analysis,
            "audio_url": audio_url,
            "recommendations": recommendations
        })
                
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Audio analysis error: {error_msg}")
        import traceback
        traceback.print_exc()
        
        # Return more helpful error message
        return jsonify({
            "error": error_msg,
            "recognized_text": "",
            "analysis": ""
        }), 500
    finally:
        # Clean up temporary file
        if temp_path:
            try:
                os.unlink(temp_path)
                print(f"🗑️ Cleaned up temp file: {temp_path}")
            except Exception as e:
                print(f"⚠️ Could not delete temp file: {e}")


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
# PRODUCT REQUEST DETECTION FUNCTION
# -----------------------------
def is_product_request(text):
    """
    Strict function to detect if user is explicitly asking for product recommendations.
    Returns True ONLY if the request contains clear recommendation intent.
    """
    if not text or len(text.strip()) < 5:
        return False
    
    text_lower = text.lower().strip()
    
    # Explicit recommendation patterns (must contain these phrases)
    explicit_patterns = [
        "recommend me",
        "recommend a",
        "recommend",
        "suggest me",
        "suggest a",
        "suggest",
        "what product",
        "which product",
        "what cream",
        "which cream",
        "what serum",
        "which serum",
        "what cleanser",
        "which cleanser",
        "what moisturizer",
        "which moisturizer",
        "product for",
        "product that",
        "product which",
        "product to",
        "product should",
        "should i use",
        "should i buy",
        "can you recommend",
        "can you suggest",
        "give me product",
        "product recommendation",
        "product suggestions"
    ]
    
    # Check if text contains any explicit recommendation pattern
    for pattern in explicit_patterns:
        if pattern in text_lower:
            print(f"✅ Product request detected: found pattern '{pattern}'")
            return True
    
    print("ℹ️ Not a product recommendation request")
    return False


def is_multi_product_request(text):
    """
    Detect if user is asking for multiple products (e.g., "some products", "three products")
    """
    if not text:
        return False
    
    text_lower = text.lower()
    multi_indicators = [
        "some products",
        "multiple products",
        "three products",
        "3 products",
        "few products",
        "several products",
        "products for",
        "recommend products",
        "suggest products",
        "give me products"
    ]
    
    return any(indicator in text_lower for indicator in multi_indicators)


def fuzzy_match_product_name(product_name_from_ai, products_db):
    """
    Use fuzzy matching to find the best matching product from database.
    Returns (product_key, product_data, similarity_score)
    """
    from difflib import SequenceMatcher
    
    product_name_lower = product_name_from_ai.lower().strip()
    best_match = None
    best_score = 0.0
    best_key = None
    
    for key, product in products_db.items():
        db_name = product.get("name", "").lower()
        if not db_name:
            continue
        
        # Calculate similarity
        similarity = SequenceMatcher(None, product_name_lower, db_name).ratio()
        
        # Also check if product name contains key words from AI response
        ai_words = set(product_name_lower.split())
        db_words = set(db_name.split())
        word_overlap = len(ai_words & db_words) / max(len(ai_words), len(db_words), 1)
        
        # Combined score (weighted)
        combined_score = (similarity * 0.7) + (word_overlap * 0.3)
        
        # Check category match (e.g., sunscreen vs cleanser)
        # Extract category keywords
        category_keywords = {
            "cleanser": ["cleanser", "wash", "cleaning"],
            "moisturizer": ["moisturizer", "moisturizing", "cream", "lotion"],
            "sunscreen": ["sunscreen", "spf", "sun protection"],
            "serum": ["serum"],
            "retinol": ["retinol", "retin"],
            "acne": ["acne", "salicylic", "breakout"]
        }
        
        ai_category = None
        db_category = None
        
        for cat, keywords in category_keywords.items():
            if any(kw in product_name_lower for kw in keywords):
                ai_category = cat
            if any(kw in db_name for kw in keywords):
                db_category = cat
        
        # Boost score if categories match
        if ai_category and db_category and ai_category == db_category:
            combined_score += 0.2
        
        if combined_score > best_score:
            best_score = combined_score
            best_match = product
            best_key = key
    
    # Only return if similarity is above threshold
    if best_score >= 0.3:  # 30% similarity threshold
        return best_key, best_match, best_score
    
    return None, None, 0.0


def extract_product_names_from_text(text):
    """
    Extract product names from AI response text.
    Works with natural conversational text (no numbered lists).
    """
    import re
    
    # Clean text
    clean_text = text.replace("**", "").replace("*", "")
    clean_text_lower = clean_text.lower()
    
    extracted_names = []
    
    # Get all product names from database for matching
    products_db = PRODUCTS_DB
    all_product_names = []
    for key, product in products_db.items():
        product_name = product.get("name", "")
        if product_name:
            all_product_names.append(product_name)
    
    # Strategy 1: Direct matching - find exact product names mentioned in text
    for product_name in all_product_names:
        product_name_lower = product_name.lower()
        # Check if full product name appears in text (case-insensitive)
        if product_name_lower in clean_text_lower:
            # Extract the actual text that matches (preserve original case from text)
            # Find the position and extract the matching phrase
            pattern = re.escape(product_name)
            matches = re.finditer(pattern, clean_text, re.IGNORECASE)
            for match in matches:
                matched_text = match.group(0)
                if matched_text not in extracted_names:
                    extracted_names.append(matched_text)
                    print(f"  ✅ Found exact match: '{matched_text}'")
    
    # Strategy 2: Partial matching - find product names by brand + type keywords
    # This handles cases like "CeraVe Moisturizing Cream" when AI says "CeraVe cream"
    brand_keywords = {
        "cerave": ["cerave", "cera ve"],
        "la roche-posay": ["la roche-posay", "la roche posay", "laroche-posay"],
        "neutrogena": ["neutrogena"],
        "cetaphil": ["cetaphil"],
        "vanicream": ["vanicream"],
        "avene": ["avene"],
        "the ordinary": ["the ordinary", "ordinary"]
    }
    
    product_type_keywords = {
        "cleanser": ["cleanser", "wash", "cleaning"],
        "moisturizer": ["moisturizer", "moisturizing", "moisturizing lotion", "moisturizing cream"],
        "sunscreen": ["sunscreen", "spf", "sun protection"],
        "serum": ["serum"],
        "retinol": ["retinol", "retin"],
        "acne": ["acne control", "acne", "salicylic"],
        "cream": ["cream"],
        "lotion": ["lotion"]
    }
    
    # Find brand + product type combinations
    for brand_key, brand_variants in brand_keywords.items():
        for brand_variant in brand_variants:
            if brand_variant in clean_text_lower:
                # Look for product type near the brand
                for ptype_key, ptype_variants in product_type_keywords.items():
                    for ptype_variant in ptype_variants:
                        # Look for pattern: brand ... product_type (within reasonable distance)
                        pattern = rf'{re.escape(brand_variant)}[^.]{{0,50}}?{re.escape(ptype_variant)}'
                        matches = re.finditer(pattern, clean_text_lower)
                        for match in matches:
                            # Try to match this combination to a product in database
                            matched_phrase = clean_text[match.start():match.end()]
                            # Find matching product
                            for product_name in all_product_names:
                                product_name_lower = product_name.lower()
                                if brand_key in product_name_lower and ptype_key in product_name_lower:
                                    if product_name not in extracted_names:
                                        extracted_names.append(product_name)
                                        print(f"  ✅ Found by brand+type: '{product_name}' (from phrase: '{matched_phrase}')")
                                        break
    
    # Strategy 3: Find product names by key phrases (e.g., "try the X", "recommend X", "use X")
    key_phrases = [
        r'try (?:the )?([A-Z][A-Za-z\s&]+?)(?:\.|,|$|for|with)',
        r'recommend (?:the )?([A-Z][A-Za-z\s&]+?)(?:\.|,|$|for|with)',
        r'use (?:the )?([A-Z][A-Za-z\s&]+?)(?:\.|,|$|for|with)',
        r'suggest (?:the )?([A-Z][A-Za-z\s&]+?)(?:\.|,|$|for|with)',
        r'like (?:the )?([A-Z][A-Za-z\s&]+?)(?:\.|,|$|for|with)',
    ]
    
    for pattern in key_phrases:
        matches = re.finditer(pattern, clean_text)
        for match in matches:
            potential_name = match.group(1).strip()
            # Check if this matches any product name
            for product_name in all_product_names:
                product_name_lower = product_name.lower()
                potential_lower = potential_name.lower()
                # Check if potential name contains significant words from product name
                product_words = set(product_name_lower.split())
                potential_words = set(potential_lower.split())
                # If at least 2 significant words match, consider it a match
                common_words = product_words & potential_words
                significant_words = {w for w in common_words if len(w) > 3}
                if len(significant_words) >= 2:
                    if product_name not in extracted_names:
                        extracted_names.append(product_name)
                        print(f"  ✅ Found by key phrase: '{product_name}' (from: '{potential_name}')")
                        break
    
    # Remove duplicates while preserving order
    seen = set()
    unique_names = []
    for name in extracted_names:
        name_lower = name.lower()
        if name_lower not in seen:
            seen.add(name_lower)
            unique_names.append(name)
    
    print(f"🔍 Extracted {len(unique_names)} unique product names: {unique_names}")
    return unique_names


# -----------------------------
# IMAGE URL VALIDATION AND SANITIZATION
# -----------------------------
def extract_asin_from_amazon_url(amazon_url, follow_redirects=True):
    """
    Extract ASIN from various Amazon URL formats.
    If URL is incomplete/truncated, tries to fetch the full URL by following redirects.
    If ASIN is too short (< 10 chars), tries to fetch the full product page to get complete ASIN.
    Returns ASIN string or None if not found.
    """
    import re
    
    if not amazon_url or "amazon.com" not in amazon_url:
        return None
    
    # Pattern 1: Standard /dp/ASIN format (most common)
    # Matches: /dp/B00LO, /dp/B07RJ18VMF, /dp/B00365DABC
    asin_match = re.search(r'/dp/([A-Z0-9]{5,10})', amazon_url)
    if asin_match:
        asin = asin_match.group(1)
        # CRITICAL: If ASIN is too short (< 10 chars), it's likely incomplete
        # Try to fetch the full product page to get the complete ASIN
        if len(asin) < 10 and follow_redirects:
            print(f"  ⚠️ ASIN '{asin}' is too short ({len(asin)} chars), fetching full product page...")
            try:
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                }
                # Fetch the full page to extract complete ASIN
                response = requests.get(amazon_url, headers=headers, timeout=10, allow_redirects=True)
                if response.status_code == 200:
                    html_content = response.text
                    # Look for complete 10-character ASIN in HTML
                    # Amazon stores ASIN in data-asin attribute or in the URL after redirect
                    final_url = response.url
                    # Try to extract from final URL first
                    final_asin_match = re.search(r'/dp/([A-Z0-9]{10})', final_url)
                    if final_asin_match:
                        complete_asin = final_asin_match.group(1)
                        print(f"  ✅ Found complete ASIN '{complete_asin}' from redirected URL")
                        return complete_asin
                    
                    # Try to extract from HTML data attributes
                    asin_patterns = [
                        r'data-asin=["\']([A-Z0-9]{10})["\']',
                        r'"asin":\s*["\']([A-Z0-9]{10})["\']',
                        r"'asin':\s*['\"]([A-Z0-9]{10})['\"]",
                        r'ASIN["\']?\s*:\s*["\']([A-Z0-9]{10})["\']',
                    ]
                    for pattern in asin_patterns:
                        match = re.search(pattern, html_content)
                        if match:
                            complete_asin = match.group(1)
                            if len(complete_asin) == 10:
                                print(f"  ✅ Found complete ASIN '{complete_asin}' in HTML")
                                return complete_asin
                    
                    # If still not found, try to find ASIN in the page URL structure
                    # Sometimes ASIN appears in canonical link or other meta tags
                    canonical_match = re.search(r'<link[^>]*rel=["\']canonical["\'][^>]*href=["\']([^"\']+)["\']', html_content)
                    if canonical_match:
                        canonical_url = canonical_match.group(1)
                        canonical_asin_match = re.search(r'/dp/([A-Z0-9]{10})', canonical_url)
                        if canonical_asin_match:
                            complete_asin = canonical_asin_match.group(1)
                            print(f"  ✅ Found complete ASIN '{complete_asin}' in canonical URL")
                            return complete_asin
                    
                    print(f"  ⚠️ Could not find complete ASIN in product page, using partial ASIN '{asin}'")
            except Exception as e:
                print(f"  ⚠️ Could not fetch product page to get complete ASIN: {e}")
                print(f"     Using partial ASIN '{asin}' (may cause image loading issues)")
        
        return asin
    
    # Pattern 2: /gp/product/ASIN format
    asin_match = re.search(r'/gp/product/([A-Z0-9]{5,10})', amazon_url)
    if asin_match:
        asin = asin_match.group(1)
        if len(asin) < 10 and follow_redirects:
            # Same logic as above to fetch complete ASIN
            try:
                headers = {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml',
                }
                response = requests.get(amazon_url, headers=headers, timeout=10, allow_redirects=True)
                if response.status_code == 200:
                    final_url = response.url
                    final_asin_match = re.search(r'/dp/([A-Z0-9]{10})', final_url)
                    if final_asin_match:
                        return final_asin_match.group(1)
            except:
                pass
        return asin
    
    # Pattern 3: /product/ASIN format
    asin_match = re.search(r'/product/([A-Z0-9]{5,10})', amazon_url)
    if asin_match:
        return asin_match.group(1)
    
    # Pattern 4: ASIN in query parameters (e.g., ?asin=B00LO)
    asin_match = re.search(r'[?&]asin=([A-Z0-9]{5,10})', amazon_url, re.IGNORECASE)
    if asin_match:
        return asin_match.group(1)
    
    # Pattern 5: Look for any ASIN pattern in the URL (last resort)
    asin_match = re.search(r'([A-Z0-9]{5,10})(?:[/?&]|$)', amazon_url)
    if asin_match:
        potential_asin = asin_match.group(1)
        # Validate: ASINs usually start with B, A, or a number
        if len(potential_asin) >= 5 and potential_asin[0] in 'B0123456789':
            # If too short, try to fetch complete ASIN
            if len(potential_asin) < 10 and follow_redirects:
                try:
                    headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml',
                    }
                    response = requests.get(amazon_url, headers=headers, timeout=10, allow_redirects=True)
                    if response.status_code == 200:
                        final_url = response.url
                        final_asin_match = re.search(r'/dp/([A-Z0-9]{10})', final_url)
                        if final_asin_match:
                            return final_asin_match.group(1)
                except:
                    pass
            return potential_asin
    
    # If URL appears incomplete (no /dp/ pattern found) and follow_redirects is True,
    # try to fetch the full URL by following redirects
    if follow_redirects and '/dp/' not in amazon_url and '/gp/product/' not in amazon_url:
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
            }
            response = requests.head(amazon_url, headers=headers, timeout=5, allow_redirects=True)
            final_url = response.url if hasattr(response, 'url') else amazon_url
            
            # Try to extract ASIN from the final URL (recursive call with follow_redirects=False to avoid infinite loop)
            if final_url != amazon_url:
                asin = extract_asin_from_amazon_url(final_url, follow_redirects=False)
                if asin:
                    print(f"  🔍 Extracted ASIN from redirected URL: {asin}")
                    return asin
        except Exception as e:
            print(f"  ⚠️ Could not follow redirects for URL {amazon_url[:100]}: {e}")
    
    return None

def generate_amazon_image_url(asin):
    """
    Generate Amazon product image URL from ASIN.
    Returns a list of possible image URLs (different sizes/formats).
    """
    if not asin:
        return []
    
    # Try multiple Amazon image URL patterns
    urls = [
        f"https://m.media-amazon.com/images/I/{asin}._SL1500_.jpg",  # Large size
        f"https://m.media-amazon.com/images/I/{asin}._SL1000_.jpg",  # Medium size
        f"https://m.media-amazon.com/images/I/{asin}._SL500_.jpg",   # Small size
        f"https://images-na.ssl-images-amazon.com/images/I/{asin}._SL1500_.jpg",  # Alternative domain
    ]
    return urls

def validate_and_sanitize_image_url(image_url, product_name="", amazon_link=""):
    """
    Validate and sanitize image URL. ALWAYS tries to return a valid image URL.
    Tries multiple methods:
    1. Use provided image_url if valid
    2. Extract ASIN from Amazon link and generate image URL (with redirect following)
    3. Returns empty string only if all methods fail (frontend will handle fallback)
    """
    import re
    from urllib.parse import urlparse
    
    # Step 1: If image_url is provided and valid, use it
    if image_url and image_url.strip() != "":
        image_url = image_url.strip()
        
        # Validate URL format
        try:
            parsed = urlparse(image_url)
            # Check if it's a valid HTTP/HTTPS URL
            if parsed.scheme in ['http', 'https']:
                # Validate domain (only allow Amazon and media-amazon domains for security)
                if 'amazon.com' in parsed.netloc or 'media-amazon.com' in parsed.netloc:
                    return image_url
                # Allow localhost for development
                if 'localhost' in parsed.netloc or '127.0.0.1' in parsed.netloc:
                    return image_url
            
            # If it's a relative path starting with /proxy-image, it's valid
            if image_url.startswith('/proxy-image'):
                return image_url
            
            # Relative path is OK
            if image_url.startswith('/'):
                return image_url
        except Exception as e:
            print(f"  ⚠️ Error validating provided image URL for {product_name}: {e}")
    
    # Step 2: Try to extract ASIN from Amazon link and generate image URL
    # This will also try following redirects if URL is incomplete
    if amazon_link and "amazon.com" in amazon_link:
        asin = extract_asin_from_amazon_url(amazon_link, follow_redirects=True)
        if asin:
            # CRITICAL: Validate ASIN length - if too short, it will generate invalid image URLs
            if len(asin) < 10:
                print(f"  ⚠️ ASIN '{asin}' is too short ({len(asin)} chars), attempting to fetch complete ASIN...")
                # Try to fetch the complete ASIN from the product page
                try:
                    headers = {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Accept': 'text/html,application/xhtml+xml',
                    }
                    response = requests.get(amazon_link, headers=headers, timeout=10, allow_redirects=True)
                    if response.status_code == 200:
                        final_url = response.url
                        # Try to extract complete ASIN from final URL
                        import re
                        complete_asin_match = re.search(r'/dp/([A-Z0-9]{10})', final_url)
                        if complete_asin_match:
                            complete_asin = complete_asin_match.group(1)
                            print(f"  ✅ Found complete ASIN '{complete_asin}' from product page")
                            asin = complete_asin
                        else:
                            # Try to extract from HTML
                            html_content = response.text
                            asin_patterns = [
                                r'data-asin=["\']([A-Z0-9]{10})["\']',
                                r'"asin":\s*["\']([A-Z0-9]{10})["\']',
                            ]
                            for pattern in asin_patterns:
                                match = re.search(pattern, html_content)
                                if match:
                                    complete_asin = match.group(1)
                                    if len(complete_asin) == 10:
                                        print(f"  ✅ Found complete ASIN '{complete_asin}' in HTML")
                                        asin = complete_asin
                                        break
                except Exception as e:
                    print(f"  ⚠️ Could not fetch complete ASIN: {e}")
                    print(f"     Will try with partial ASIN '{asin}' (may fail)")
            
            # Generate Amazon image URLs (try multiple formats)
            amazon_image_urls = generate_amazon_image_url(asin)
            if amazon_image_urls:
                # Return the first (largest) image URL
                image_url = amazon_image_urls[0]
                print(f"  📷 Generated image URL from Amazon ASIN ({asin}, length: {len(asin)}) for {product_name}: {image_url}")
                return image_url
        else:
            print(f"  ⚠️ Could not extract ASIN from Amazon URL for {product_name}: {amazon_link}")
    
    # Step 3: All methods failed - return empty string
    # The frontend will handle this with its fallback placeholder
    # We log this so it can be debugged
    print(f"  ⚠️ No valid image URL found for {product_name} (link: {amazon_link[:100] if amazon_link else 'N/A'})")
    return ""

def sanitize_image_url_for_proxy(image_url):
    """
    Convert external image URL to proxy URL format, with proper encoding.
    Returns proxy URL or empty string if invalid.
    CRITICAL: Use quote_plus or quote with safe='' to ensure full URL is preserved.
    """
    if not image_url or image_url.strip() == "":
        return ""
    
    image_url = image_url.strip()
    
    # If already a proxy URL, return as-is (but check if it needs re-encoding)
    if image_url.startswith('/proxy-image'):
        # Extract the URL parameter and verify it's properly encoded
        try:
            import urllib.parse
            from urllib.parse import parse_qs, urlparse
            parsed = urlparse(image_url)
            params = parse_qs(parsed.query)
            if 'url' in params and params['url']:
                # URL is already in proxy format, return as-is
                return image_url
        except:
            pass
        return image_url
    
    # If it's a relative path, return as-is (will be handled by frontend)
    if image_url.startswith('/'):
        return image_url
    
    # If it's an external URL, convert to proxy format
    if image_url.startswith('http://') or image_url.startswith('https://'):
        try:
            import urllib.parse
            # CRITICAL: Use quote() with safe='' to encode the entire URL
            # This preserves the full URL including query params, fragments, etc.
            # safe='' means encode everything except what's absolutely necessary
            encoded_url = urllib.parse.quote(image_url, safe='')
            proxy_url = f"/proxy-image?url={encoded_url}"
            
            # Verify the encoding worked by checking length
            if len(proxy_url) > 2000:  # Very long URLs might indicate double encoding
                print(f"  ⚠️ Warning: Proxy URL is very long ({len(proxy_url)} chars), might be double-encoded")
            
            return proxy_url
        except Exception as e:
            print(f"  ⚠️ Error encoding image URL: {e}")
            print(f"     Original URL: {image_url[:200]}")
            return ""
    
    return ""

# -----------------------------
# PRODUCT RECOMMENDATION FUNCTION
# -----------------------------
def get_product_recommendations(question, answer):
    """Extract product recommendations ONLY for explicit product recommendation requests"""
    recommendations = []
    
    # CRITICAL: Initialize requested_product_type at the VERY START of the function
    # This prevents "referenced before assignment" errors
    requested_product_type = None
    product_type_keywords = {
        "sunscreen": ["sunscreen", "spf", "sun protection", "sun block"],
        "cleanser": ["cleanser", "face wash", "cleaning"],
        "moisturizer": ["moisturizer", "moisturizing", "cream", "lotion"],
        "serum": ["serum"],
        "retinol": ["retinol", "retin"]
    }
    
    # Use strict detection function
    if not is_product_request(question):
        return recommendations
    
    print("✅ Processing product recommendation request...")
    
    # Check if this is a multi-product request
    is_multi = is_multi_product_request(question)
    question_lower = question.lower()
    
    # Detect specific product type requested (sunscreen, cleanser, moisturizer, etc.)
    # CRITICAL: Check more specific types first (moisturizer before cleanser, since "cream" might match both)
    # Priority order: sunscreen > moisturizer > cleanser > serum > retinol
    type_priority = ["sunscreen", "moisturizer", "cleanser", "serum", "retinol"]
    
    for ptype in type_priority:
        if ptype in product_type_keywords:
            keywords = product_type_keywords[ptype]
            # For moisturizer, check for more specific keywords first
            if ptype == "moisturizer":
                # Check for explicit moisturizer keywords first
                if any(keyword in question_lower for keyword in ["moisturizer", "moisturizing", "moisturizing cream", "moisturizing lotion"]):
                    requested_product_type = ptype
                    print(f"🎯 Detected requested product type: {ptype} (explicit)")
                    break
                # Then check for cream/lotion if not already found
                elif any(keyword in question_lower for keyword in ["cream", "lotion"]) and requested_product_type is None:
                    # Only set as moisturizer if we haven't found a more specific type
                    requested_product_type = ptype
                    print(f"🎯 Detected requested product type: {ptype} (from cream/lotion)")
                    break
            else:
                # For other types, check keywords normally
                if any(keyword in question_lower for keyword in keywords):
                    requested_product_type = ptype
                    print(f"🎯 Detected requested product type: {ptype}")
                    break
    
    # Detect fragrance-free requirement
    fragrance_free_required = any(phrase in question_lower for phrase in [
        "without fragrance", "no fragrance", "fragrance-free", "fragrance free",
        "unscented", "no scent", "without scent"
    ])
    if fragrance_free_required:
        print(f"🌿 Detected fragrance-free requirement")
    
    # Use loaded products database
    products_db = PRODUCTS_DB
    
    # Get all product names for matching (used in extraction function)
    all_product_names = [product.get("name", "") for product in products_db.values() if product.get("name")]
    
    # Clean the answer text
    clean_answer = answer.replace("**", "").replace("*", "")
    
    # Extract product names from AI response
    print(f"📝 FULL AI ANSWER TEXT:\n{clean_answer}\n")
    print(f"📝 AI answer length: {len(clean_answer)} characters")
    
    # First, check if AI answer contains ANY product names from database
    print("🔍 Checking if AI answer contains product names from database...")
    found_products_in_text = []
    for product_name in all_product_names:
        product_name_lower = product_name.lower()
        if product_name_lower in clean_answer.lower():
            found_products_in_text.append(product_name)
            print(f"  ✅ Found '{product_name}' mentioned in AI answer")
    
    if found_products_in_text:
        print(f"✅ AI answer contains {len(found_products_in_text)} product mentions: {found_products_in_text}")
    else:
        print("⚠️ WARNING: AI answer does NOT contain any product names from database!")
        print("   This means either:")
        print("   1. AI recommended products not in our database")
        print("   2. AI used different names/variations")
        print("   3. AI didn't recommend specific products")
    
    extracted_names = extract_product_names_from_text(clean_answer)
    print(f"🔍 Extraction function found {len(extracted_names)} product names: {extracted_names}")
    
    if len(extracted_names) == 0:
        print("⚠️ WARNING: No product names extracted from AI answer!")
        print("   This means the extraction function couldn't find any products.")
        if found_products_in_text:
            print(f"   BUT we found {len(found_products_in_text)} products in text manually!")
            print("   Using manually found products instead...")
            extracted_names = found_products_in_text
        else:
            print("   The system will use fallback logic based on question keywords.")
    
    # Match extracted names to database using fuzzy matching
    # CRITICAL: Preserve order from AI response (left-to-right on cards)
    matched_products = []
    matched_keys = set()
    seen_names = set()
    
    # Track order of appearance in AI response
    product_order_map = {}  # Maps product key to order index
    
    # CRITICAL: Also check order of products in AI answer text
    # Find products mentioned in AI answer and track their order
    # This helps us preserve the order AI mentioned them (left-to-right on cards)
    ai_answer_product_order = []
    for product_name in all_product_names:
        product_name_lower = product_name.lower()
        # Find first occurrence in AI answer
        idx = clean_answer.lower().find(product_name_lower)
        if idx != -1:
            ai_answer_product_order.append((idx, product_name, product_name_lower))
    
    # Sort by position in AI answer (first mentioned = first)
    ai_answer_product_order.sort(key=lambda x: x[0])
    print(f"📝 Products mentioned in AI answer (in order of appearance): {[p[1] for p in ai_answer_product_order]}")
    
    # Create a map: product_name_lower -> order_index_in_ai_answer
    ai_answer_order_map = {}
    for order_idx, (pos, product_name, product_name_lower) in enumerate(ai_answer_product_order):
        ai_answer_order_map[product_name_lower] = order_idx
    
    # First, try to match extracted product names (in order of appearance in AI response)
    # Use direct matching first (exact name match), then fuzzy matching
    for order_idx, extracted_name in enumerate(extracted_names):
        # Try direct match first (exact name from database)
        direct_match = None
        direct_key = None
        for key, product in products_db.items():
            if product.get("name", "").lower() == extracted_name.lower():
                direct_match = product
                direct_key = key
                break
        
        if direct_match and direct_key not in matched_keys:
            matched_keys.add(direct_key)
            # Use order from AI answer if available, otherwise use extraction order
            ai_order = ai_answer_order_map.get(direct_match.get("name", "").lower(), order_idx)
            product_order_map[direct_key] = ai_order  # Store order index from AI answer
            matched_products.append((direct_match, 1.0, extracted_name, ai_order))  # Include order index
            print(f"✅ Direct match [{ai_order}]: '{extracted_name}' → {direct_match.get('name')} (exact match, order from AI answer)")
        elif direct_match:
            print(f"⚠️ Skipped duplicate direct match: '{extracted_name}' → {direct_match.get('name')} (already matched)")
        else:
            # Try fuzzy matching if no direct match
            key, product, score = fuzzy_match_product_name(extracted_name, products_db)
            if product and key not in matched_keys:
                matched_keys.add(key)
                # Use order from AI answer if available, otherwise use extraction order
                ai_order = ai_answer_order_map.get(product.get("name", "").lower(), order_idx)
                product_order_map[key] = ai_order  # Store order index from AI answer
                matched_products.append((product, score, extracted_name, ai_order))  # Include order index
                print(f"✅ Fuzzy matched [{ai_order}]: '{extracted_name}' → {product.get('name')} (score: {score:.2f}, key: {key}, order from AI answer)")
            elif product:
                print(f"⚠️ Skipped duplicate fuzzy match: '{extracted_name}' → {product.get('name')} (already matched)")
            else:
                print(f"❌ No match found for: '{extracted_name}' (score too low or not in database)")
    
    # If no products extracted but products mentioned in AI answer, use those
    if len(matched_products) == 0 and len(ai_answer_product_order) > 0:
        print("⚠️ No products extracted, but products found in AI answer. Using those...")
        for order_idx, (pos, product_name, product_name_lower) in enumerate(ai_answer_product_order):
            # Find product in database
            for key, product in products_db.items():
                if product.get("name", "").lower() == product_name_lower:
                    if key not in matched_keys:
                        matched_keys.add(key)
                        product_order_map[key] = order_idx
                        matched_products.append((product, 1.0, product_name, order_idx))
                        print(f"✅ Added from AI answer [{order_idx}]: {product.get('name')}")
                        break
    
    # CRITICAL: Sort by order of appearance in AI response (preserve left-to-right order)
    # ALSO: If specific product type requested, prioritize products of that type AND filter out other types
    if requested_product_type:
        # Separate products by type
        requested_type_products = []
        other_products = []
        for p_tuple in matched_products:
            product = p_tuple[0]
            product_name_lower = product.get("name", "").lower()
            product_desc_lower = product.get("description", "").lower()
            type_keywords = product_type_keywords.get(requested_product_type, [])
            if any(keyword in product_name_lower or keyword in product_desc_lower for keyword in type_keywords):
                requested_type_products.append(p_tuple)
            else:
                other_products.append(p_tuple)
        
        # Sort requested type products by order
        requested_type_products.sort(key=lambda x: (x[3], -x[1]))
        
        # CRITICAL: If specific type requested, ONLY use products of that type (don't mix with other types)
        if len(requested_type_products) > 0:
            print(f"🎯 Filtering: Using ONLY {requested_product_type}-type products (removing {len(other_products)} other types)")
            matched_products = requested_type_products
        else:
            # If no products of requested type found, keep all (fallback)
            print(f"⚠️ No {requested_product_type} products found in matched products, keeping all")
            matched_products.sort(key=lambda x: (x[3], -x[1]))
    else:
        matched_products.sort(key=lambda x: (x[3], -x[1]))  # Sort by order index first, then by score (descending)
    
    # Store tuples before extracting products (needed for padding logic)
    matched_products_tuples = matched_products.copy()
    matched_products = [p[0] for p in matched_products]  # Extract just products
    
    print(f"📋 Products ordered by appearance in AI response (left-to-right):")
    for i, p in enumerate(matched_products, 1):
        print(f"   {i}. {p.get('name')}")
    
    print(f"📦 After fuzzy matching: {len(matched_products)} products matched")
    if matched_products:
        for i, p in enumerate(matched_products, 1):
            print(f"   {i}. {p.get('name')}")
    else:
        print("   (No products matched)")
    
    # Check if AI answer contains any product mentions (even if not extracted)
    # This helps us decide whether to use fallback or not
    answer_contains_products = False
    for product_name in all_product_names:
        if product_name.lower() in clean_answer.lower():
            answer_contains_products = True
            break
    
    # If multi-product request and we found some products, fill up to 3
    # But ONLY if we found at least one product from AI answer
    # CRITICAL: If specific product type requested, ONLY add products of that type
    if (is_multi or len(matched_products) > 1) and len(matched_products) > 0:
        # CRITICAL: If specific product type requested, ONLY add products of that type (don't mix types)
        if requested_product_type:
            print(f"🎯 Specific product type requested ({requested_product_type}). Will ONLY add products of this type.")
            # Filter matched_products to only include requested type
            filtered_matched = []
            for product in matched_products:
                product_name_lower = product.get("name", "").lower()
                product_desc_lower = product.get("description", "").lower()
                type_keywords = product_type_keywords.get(requested_product_type, [])
                if any(keyword in product_name_lower or keyword in product_desc_lower for keyword in type_keywords):
                    filtered_matched.append(product)
                else:
                    print(f"  ❌ Filtered out (not {requested_product_type}): {product.get('name')}")
            
            matched_products = filtered_matched
            print(f"📋 After filtering: {len(matched_products)} {requested_product_type} products")
        
        # Fill up to 3 products, but prioritize products that match the requested type
        while len(matched_products) < 3:
            added = False
            
            # PRIORITY 1: If specific product type requested, add ONLY products of that type
            if requested_product_type:
                for key, product in products_db.items():
                    if key not in matched_keys and len(matched_products) < 3:
                        product_name_lower = product.get("name", "").lower()
                        product_desc_lower = product.get("description", "").lower()
                        
                        # Check if product matches requested type
                        type_keywords = product_type_keywords.get(requested_product_type, [])
                        if any(keyword in product_name_lower or keyword in product_desc_lower for keyword in type_keywords):
                            # Check fragrance-free requirement if specified
                            if fragrance_free_required:
                                # Check if product is fragrance-free (must contain "fragrance-free" or "unscented" in description)
                                is_fragrance_free = any(phrase in product_desc_lower for phrase in [
                                    "fragrance-free", "fragrance free", "unscented", "no fragrance", "without fragrance"
                                ])
                                if not is_fragrance_free:
                                    print(f"  ⏭️ Skipping (not fragrance-free): {product.get('name')}")
                                    continue
                            
                            matched_keys.add(key)
                            # Add product directly (matched_products is now a list of products, not tuples)
                            matched_products.append(product)
                            print(f"➕ Added {requested_product_type}-type product [{len(matched_products)}]: {product.get('name')}")
                            added = True
                            # Continue searching for more products (don't break here!)
                            continue
                
                # If no more products of requested type, STOP (don't add other types)
                if not added:
                    print(f"⚠️ No more {requested_product_type} products available. Stopping at {len(matched_products)} products.")
                    break
            
            # PRIORITY 2: If no specific type requested, try to match question context
            elif not requested_product_type:
                for key, product in products_db.items():
                    if key not in matched_keys and len(matched_products) < 3:
                        product_name_lower = product.get("name", "").lower()
                        product_desc_lower = product.get("description", "").lower()
                        
                        # If question mentions specific concerns, try to match
                        if any(word in question_lower for word in ["oily", "oil"]) and "oil" in product_desc_lower:
                            matched_keys.add(key)
                            matched_products.append((product, 1.0, product.get("name"), len(matched_products)))
                            print(f"➕ Added context-matched product [{len(matched_products)}]: {product.get('name')}")
                            added = True
                            break
                        elif any(word in question_lower for word in ["dry", "dryness"]) and ("moisturiz" in product_desc_lower or "hydrat" in product_desc_lower):
                            matched_keys.add(key)
                            matched_products.append((product, 1.0, product.get("name"), len(matched_products)))
                            print(f"➕ Added context-matched product [{len(matched_products)}]: {product.get('name')}")
                            added = True
                            break
                
                # PRIORITY 3: If no context match, add any remaining product
                if not added:
                    for key, product in products_db.items():
                        if key not in matched_keys and len(matched_products) < 3:
                            matched_keys.add(key)
                            matched_products.append((product, 1.0, product.get("name"), len(matched_products)))
                            print(f"➕ Added product to reach 3 [{len(matched_products)}]: {product.get('name')}")
                            break
                    else:
                        # No more products available
                        break
    
    # If no products found in answer, ONLY THEN fall back to keyword matching from question
    # This ensures we prioritize what AI actually mentioned
    if not matched_products:
        print("⚠️ No products found in AI answer, using fallback keyword matching from question")
        print(f"📝 AI answer was: {clean_answer[:300]}")
        print(f"❓ Question was: {question}")
        
        # Match based on skin concerns mentioned in the question
        # CRITICAL: Only add fallback products that match the requested product type (if specified)
        fallback_matches = []
        if "oily" in question_lower and "oily_skin" in products_db:
            product = products_db["oily_skin"]
            product_name_lower = product.get("name", "").lower()
            product_desc_lower = product.get("description", "").lower()
            # Only add if no specific type requested, OR if it matches requested type (cleanser)
            if not requested_product_type:
                fallback_matches.append(("oily_skin", product))
                print(f"  → Matched 'oily' → {product.get('name')}")
            elif requested_product_type == "cleanser":
                # Check if product is a cleanser
                type_keywords = product_type_keywords.get("cleanser", [])
                if any(keyword in product_name_lower or keyword in product_desc_lower for keyword in type_keywords):
                    fallback_matches.append(("oily_skin", product))
                    print(f"  → Matched 'oily' → {product.get('name')} (matches requested type: cleanser)")
        
        if "dry" in question_lower and "skin" in question_lower and "dry_skin" in products_db:
            product = products_db["dry_skin"]
            product_name_lower = product.get("name", "").lower()
            product_desc_lower = product.get("description", "").lower()
            # Only add if no specific type requested, OR if it matches requested type (moisturizer)
            if not requested_product_type:
                fallback_matches.append(("dry_skin", product))
                print(f"  → Matched 'dry' → {product.get('name')}")
            elif requested_product_type == "moisturizer":
                # Check if product is a moisturizer
                type_keywords = product_type_keywords.get("moisturizer", [])
                if any(keyword in product_name_lower or keyword in product_desc_lower for keyword in type_keywords):
                    fallback_matches.append(("dry_skin", product))
                    print(f"  → Matched 'dry' → {product.get('name')} (matches requested type: moisturizer)")
        
        if ("acne" in question_lower or "breakout" in question_lower or "pimple" in question_lower) and "acne_breakout" in products_db:
            product = products_db["acne_breakout"]
            # Only add if no specific type requested, OR if it matches requested type (cleanser)
            if not requested_product_type or requested_product_type == "cleanser":
                fallback_matches.append(("acne_breakout", product))
                print(f"  → Matched 'acne' → {product.get('name')}")
        
        if "sensitive" in question_lower and "sensitive_skin" in products_db:
            product = products_db["sensitive_skin"]
            product_name_lower = product.get("name", "").lower()
            product_desc_lower = product.get("description", "").lower()
            # Only add if no specific type requested, OR if it matches requested type (moisturizer)
            if not requested_product_type:
                fallback_matches.append(("sensitive_skin", product))
                print(f"  → Matched 'sensitive' → {product.get('name')}")
            elif requested_product_type == "moisturizer":
                # Check if product is a moisturizer
                type_keywords = product_type_keywords.get("moisturizer", [])
                if any(keyword in product_name_lower or keyword in product_desc_lower for keyword in type_keywords):
                    fallback_matches.append(("sensitive_skin", product))
                    print(f"  → Matched 'sensitive' → {product.get('name')} (matches requested type: moisturizer)")
        
        if (("aging" in question_lower or "wrinkle" in question_lower or "anti-aging" in question_lower) and 
            "product" in question_lower and "anti_aging" in products_db):
            product = products_db["anti_aging"]
            # Only add if no specific type requested, OR if it matches requested type (serum/retinol)
            if not requested_product_type or requested_product_type in ["serum", "retinol"]:
                fallback_matches.append(("anti_aging", product))
                print(f"  → Matched 'aging' → {product.get('name')}")
        
        if ("sunscreen" in question_lower or "spf" in question_lower or "sun protection" in question_lower) and "sunscreen" in products_db:
            product = products_db["sunscreen"]
            # Only add if no specific type requested, OR if it matches requested type (sunscreen)
            if not requested_product_type or requested_product_type == "sunscreen":
                fallback_matches.append(("sunscreen", product))
                print(f"  → Matched 'sunscreen' → {product.get('name')}")
        
        # Add fallback matches
        for key, product in fallback_matches:
            if key not in matched_keys:
                matched_keys.add(key)
                matched_products.append(product)
        
        # If still no matches, recommend based on product type
        # CRITICAL: Only match if it matches the requested product type (if specified)
        if not matched_products:
            print("  → No skin concern matches, trying product type matching...")
            if "cleanser" in question_lower and "oily_skin" in products_db and "oily_skin" not in matched_keys:
                # Only add if no specific type requested, OR if requested type is cleanser
                if not requested_product_type or requested_product_type == "cleanser":
                    matched_products.append(products_db["oily_skin"])
                    matched_keys.add("oily_skin")
                    print(f"  → Matched 'cleanser' → {products_db['oily_skin'].get('name')}")
            if ("moisturizer" in question_lower or "cream" in question_lower) and "dry_skin" in products_db and "dry_skin" not in matched_keys:
                # Only add if no specific type requested, OR if requested type is moisturizer
                if not requested_product_type or requested_product_type == "moisturizer":
                    matched_products.append(products_db["dry_skin"])
                    matched_keys.add("dry_skin")
                    print(f"  → Matched 'moisturizer' → {products_db['dry_skin'].get('name')}")
            if "serum" in question_lower and "anti_aging" in products_db and "anti_aging" not in matched_keys:
                # Only add if no specific type requested, OR if requested type is serum
                if not requested_product_type or requested_product_type == "serum":
                    matched_products.append(products_db["anti_aging"])
                    matched_keys.add("anti_aging")
                    print(f"  → Matched 'serum' → {products_db['anti_aging'].get('name')}")
            if "acne" in question_lower and "acne_breakout" in products_db and "acne_breakout" not in matched_keys:
                # Only add if no specific type requested, OR if requested type is cleanser
                if not requested_product_type or requested_product_type == "cleanser":
                    matched_products.append(products_db["acne_breakout"])
                    matched_keys.add("acne_breakout")
                    print(f"  → Matched 'acne' → {products_db['acne_breakout'].get('name')}")
            if ("sunscreen" in question_lower or "spf" in question_lower) and "sunscreen" in products_db and "sunscreen" not in matched_keys:
                # Only add if no specific type requested, OR if requested type is sunscreen
                if not requested_product_type or requested_product_type == "sunscreen":
                    matched_products.append(products_db["sunscreen"])
                    matched_keys.add("sunscreen")
                    print(f"  → Matched 'sunscreen' → {products_db['sunscreen'].get('name')}")
    
    # For multi-product requests, ALWAYS return exactly 3 products
    # CRITICAL: If specific product type requested, prioritize that type
    if is_multi:
        print(f"🔄 Multi-product request detected. Current products: {len(matched_products)}, target: 3")
        while len(matched_products) < 3:
            added_any = False
            
            # If specific product type requested, add products of that type first
            if requested_product_type:
                print(f"🔍 Searching for more {requested_product_type} products...")
                for key, product in products_db.items():
                    if key not in matched_keys and len(matched_products) < 3:
                        product_name_lower = product.get("name", "").lower()
                        product_desc_lower = product.get("description", "").lower()
                        type_keywords = product_type_keywords.get(requested_product_type, [])
                        if any(keyword in product_name_lower or keyword in product_desc_lower for keyword in type_keywords):
                            # Check fragrance-free requirement if specified
                            if fragrance_free_required:
                                # Check if product is fragrance-free (must contain "fragrance-free" or "unscented" in description)
                                is_fragrance_free = any(phrase in product_desc_lower for phrase in [
                                    "fragrance-free", "fragrance free", "unscented", "no fragrance", "without fragrance"
                                ])
                                if not is_fragrance_free:
                                    print(f"  ⏭️ Skipping (not fragrance-free): {product.get('name')}")
                                    continue
                            
                            matched_keys.add(key)
                            matched_products.append(product)
                            print(f"➕ Added {requested_product_type}-type product for multi-request [{len(matched_products)}]: {product.get('name')}")
                            added_any = True
                            # Continue searching for more products (don't break here!)
                            continue
                
                # If no more products of requested type, stop (don't add other types)
                if not added_any:
                    print(f"⚠️ No more {requested_product_type} products available. Stopping at {len(matched_products)} products.")
                    # CRITICAL: Even if we can't find more of the requested type, we should still try to fill to 3
                    # But only if we have at least 1 product of the requested type
                    if len(matched_products) > 0:
                        print(f"✅ Found {len(matched_products)} {requested_product_type} products (target was 3)")
                        break
                    else:
                        # If we have 0 products of requested type, try fallback
                        print(f"⚠️ No {requested_product_type} products found, trying fallback...")
                        break
            else:
                # No specific type requested, add any product
                for key, product in products_db.items():  # Iterate in dictionary order
                    if key not in matched_keys and len(matched_products) < 3:
                        matched_keys.add(key)
                        matched_products.append(product)
                        print(f"➕ Added product for multi-request [{len(matched_products)}]: {product.get('name')}")
                        added_any = True
                        break
                
                if not added_any:
                    # No more products available
                    break
    
    # Return unique products (avoid duplicates)
    seen = set()
    for product in matched_products:
        product_id = product.get("name", "")
        if product_id and product_id not in seen:
            seen.add(product_id)
            # Ensure all required fields are present
            # CRITICAL: Create a fresh copy of product data to avoid shared state
            product_name = str(product.get("name", "Product"))  # Ensure string, not reference
            amazon_link = str(product.get("link", "")) if product.get("link") else ""
            # Get image URL from product - ensure we get the ORIGINAL, not a modified one
            image_url = str(product.get("image", "")) if product.get("image") else ""
            
            print(f"  🔍 Processing product [{len(recommendations) + 1}]: {product_name}")
            print(f"     Original image_url from DB (FULL): {image_url if image_url else 'EMPTY'}")
            print(f"     Amazon link (FULL): {amazon_link if amazon_link else 'N/A'}")
            
            # CRITICAL: Check if existing image URL has incomplete ASIN
            if image_url and '/images/I/' in image_url:
                # Extract ASIN from image URL
                import re
                asin_in_image = re.search(r'/images/I/([A-Z0-9]+)\._', image_url)
                if asin_in_image:
                    asin_from_image = asin_in_image.group(1)
                    if len(asin_from_image) < 10:
                        print(f"     ⚠️ WARNING: Image URL contains incomplete ASIN '{asin_from_image}' ({len(asin_from_image)} chars)")
                        print(f"        Will try to fetch complete ASIN from Amazon link")
                        # Clear the image_url so it gets regenerated with complete ASIN
                        image_url = ""
                    else:
                        print(f"     ✅ Image URL has complete ASIN '{asin_from_image}' ({len(asin_from_image)} chars)")
            
            # Validate and sanitize image URL (with fallback to Amazon link)
            # Pass fresh copies to avoid any shared state
            image_url = validate_and_sanitize_image_url(image_url, product_name, amazon_link)
            
            # If still empty after validation, try one more time with more aggressive ASIN extraction
            if not image_url or image_url.strip() == "":
                if amazon_link:
                    # Try extracting ASIN with redirect following enabled
                    asin = extract_asin_from_amazon_url(amazon_link, follow_redirects=True)
                    if asin:
                        # CRITICAL: Check if ASIN is complete (10 characters)
                        if len(asin) < 10:
                            print(f"  ⚠️ ASIN '{asin}' is incomplete ({len(asin)} chars), fetching complete ASIN...")
                            # Try to fetch complete ASIN from product page
                            try:
                                headers = {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                    'Accept': 'text/html,application/xhtml+xml',
                                }
                                response = requests.get(amazon_link, headers=headers, timeout=10, allow_redirects=True)
                                if response.status_code == 200:
                                    final_url = response.url
                                    import re
                                    complete_asin_match = re.search(r'/dp/([A-Z0-9]{10})', final_url)
                                    if complete_asin_match:
                                        complete_asin = complete_asin_match.group(1)
                                        print(f"  ✅ Found complete ASIN '{complete_asin}' from product page")
                                        asin = complete_asin
                                    else:
                                        # Try HTML
                                        html_content = response.text
                                        asin_patterns = [
                                            r'data-asin=["\']([A-Z0-9]{10})["\']',
                                            r'"asin":\s*["\']([A-Z0-9]{10})["\']',
                                        ]
                                        for pattern in asin_patterns:
                                            match = re.search(pattern, html_content)
                                            if match:
                                                complete_asin = match.group(1)
                                                if len(complete_asin) == 10:
                                                    print(f"  ✅ Found complete ASIN '{complete_asin}' in HTML")
                                                    asin = complete_asin
                                                    break
                            except Exception as e:
                                print(f"  ⚠️ Could not fetch complete ASIN: {e}")
                        
                        amazon_image_urls = generate_amazon_image_url(asin)
                        if amazon_image_urls:
                            image_url = amazon_image_urls[0]
                            print(f"  🔄 Retry: Generated image URL for {product_name} (ASIN: {asin}, length: {len(asin)}): {image_url}")
                    else:
                        # Last resort: try fetching the page HTML to extract ASIN
                        try:
                            headers = {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                'Accept': 'text/html,application/xhtml+xml',
                            }
                            response = requests.get(amazon_link, headers=headers, timeout=5, allow_redirects=True)
                            if response.status_code == 200:
                                html_content = response.text
                                final_url = response.url
                                # Look for ASIN in HTML (Amazon often embeds it in data attributes or meta tags)
                                import re
                                # First try to get 10-character ASIN from final URL
                                complete_asin_match = re.search(r'/dp/([A-Z0-9]{10})', final_url)
                                if complete_asin_match:
                                    complete_asin = complete_asin_match.group(1)
                                    amazon_image_urls = generate_amazon_image_url(complete_asin)
                                    if amazon_image_urls:
                                        image_url = amazon_image_urls[0]
                                        print(f"  🔍 Found complete ASIN in final URL for {product_name} (ASIN: {complete_asin}): {image_url}")
                                else:
                                    # Pattern: data-asin="B00LO" or "asin":"B00LO" - prefer 10-char ASINs
                                    asin_patterns = [
                                        r'data-asin=["\']([A-Z0-9]{10})["\']',  # Prefer 10-char ASINs
                                        r'"asin":\s*["\']([A-Z0-9]{10})["\']',
                                        r"'asin':\s*['\"]([A-Z0-9]{10})['\"]",
                                        r'/dp/([A-Z0-9]{10})',
                                        r'data-asin=["\']([A-Z0-9]{5,10})["\']',  # Fallback to shorter
                                        r'"asin":\s*["\']([A-Z0-9]{5,10})["\']',
                                    ]
                                    for pattern in asin_patterns:
                                        match = re.search(pattern, html_content)
                                        if match:
                                            potential_asin = match.group(1)
                                            if len(potential_asin) >= 5 and potential_asin[0] in 'B0123456789':
                                                amazon_image_urls = generate_amazon_image_url(potential_asin)
                                                if amazon_image_urls:
                                                    image_url = amazon_image_urls[0]
                                                    print(f"  🔍 Found ASIN in HTML for {product_name} (ASIN: {potential_asin}, length: {len(potential_asin)}): {image_url}")
                                                    break
                        except Exception as e:
                            print(f"  ⚠️ Could not fetch HTML for {product_name}: {e}")
            
            # Convert to proxy URL format if needed
            image_url = sanitize_image_url_for_proxy(image_url)
            
            # FINAL FALLBACK: If image_url is still empty, log warning but don't block the product
            # The frontend will handle the empty image with its fallback placeholder
            if not image_url or image_url.strip() == "":
                print(f"  ⚠️ WARNING: No image URL available for {product_name} (link: {amazon_link[:100] if amazon_link else 'N/A'})")
                # Don't set to empty - let frontend handle it, but log for debugging
            
            # CRITICAL: Create a completely new dictionary for each product to avoid any shared references
            product_data = {
                "name": str(product_name),  # Ensure string copy
                "description": str(product.get("description", product.get("benefits", ""))),
                "price": str(product.get("price", "Price not available")),
                "image": str(image_url) if image_url else "",  # Ensure string, not reference
                "link": str(amazon_link) if amazon_link else ""
            }
            
            print(f"  ✅ Final product_data for {product_name}: image={product_data['image'] if product_data['image'] else 'EMPTY'}")
            
            recommendations.append(product_data)
    
    # For multi-product requests, ALWAYS return exactly 3 products
    # CRITICAL: If specific product type requested, prioritize that type
    if is_multi:
        # Pad with additional products if needed
        while len(recommendations) < 3:
            added_any = False
            
            # If specific product type requested, add products of that type first
            if requested_product_type:
                for key, product in products_db.items():
                    product_name = product.get("name", "").lower()
                    product_desc = product.get("description", "").lower()
                    if product_name not in seen and len(recommendations) < 3:
                        type_keywords = product_type_keywords.get(requested_product_type, [])
                        if any(keyword in product_name or keyword in product_desc for keyword in type_keywords):
                            # Check fragrance-free requirement if specified
                            if fragrance_free_required:
                                # Check if product is fragrance-free (must contain "fragrance-free" or "unscented" in description)
                                is_fragrance_free = any(phrase in product_desc for phrase in [
                                    "fragrance-free", "fragrance free", "unscented", "no fragrance", "without fragrance"
                                ])
                                if not is_fragrance_free:
                                    print(f"  ⏭️ Skipping (not fragrance-free): {product.get('name')}")
                                    continue
                            
                            seen.add(product_name)
                            product_name_full = product.get("name", "Product")
                            amazon_link = product.get("link", "")
                            image_url = product.get("image", "")
                            
                            # CRITICAL: Check if existing image URL has incomplete ASIN
                            if image_url and '/images/I/' in image_url:
                                import re
                                asin_in_image = re.search(r'/images/I/([A-Z0-9]+)\._', image_url)
                                if asin_in_image:
                                    asin_from_image = asin_in_image.group(1)
                                    if len(asin_from_image) < 10:
                                        print(f"     ⚠️ WARNING: Image URL contains incomplete ASIN '{asin_from_image}' ({len(asin_from_image)} chars)")
                                        print(f"        Will try to fetch complete ASIN from Amazon link")
                                        image_url = ""  # Clear to force regeneration
                            
                            # Validate and sanitize image URL (with fallback to Amazon link)
                            image_url = validate_and_sanitize_image_url(image_url, product_name_full, amazon_link)
                            
                            # If still empty after validation, try one more time with more aggressive ASIN extraction
                            if not image_url or image_url.strip() == "":
                                if amazon_link:
                                    # Try extracting ASIN with redirect following enabled
                                    asin = extract_asin_from_amazon_url(amazon_link, follow_redirects=True)
                                    if asin:
                                        # CRITICAL: Check if ASIN is complete (10 characters)
                                        if len(asin) < 10:
                                            print(f"  ⚠️ ASIN '{asin}' is incomplete ({len(asin)} chars), fetching complete ASIN...")
                                            try:
                                                headers = {
                                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                                    'Accept': 'text/html,application/xhtml+xml',
                                                }
                                                response = requests.get(amazon_link, headers=headers, timeout=10, allow_redirects=True)
                                                if response.status_code == 200:
                                                    final_url = response.url
                                                    import re
                                                    complete_asin_match = re.search(r'/dp/([A-Z0-9]{10})', final_url)
                                                    if complete_asin_match:
                                                        complete_asin = complete_asin_match.group(1)
                                                        print(f"  ✅ Found complete ASIN '{complete_asin}' from product page")
                                                        asin = complete_asin
                                                    else:
                                                        html_content = response.text
                                                        asin_patterns = [
                                                            r'data-asin=["\']([A-Z0-9]{10})["\']',
                                                            r'"asin":\s*["\']([A-Z0-9]{10})["\']',
                                                        ]
                                                        for pattern in asin_patterns:
                                                            match = re.search(pattern, html_content)
                                                            if match:
                                                                complete_asin = match.group(1)
                                                                if len(complete_asin) == 10:
                                                                    print(f"  ✅ Found complete ASIN '{complete_asin}' in HTML")
                                                                    asin = complete_asin
                                                                    break
                                            except Exception as e:
                                                print(f"  ⚠️ Could not fetch complete ASIN: {e}")
                                        
                                        amazon_image_urls = generate_amazon_image_url(asin)
                                        if amazon_image_urls:
                                            image_url = amazon_image_urls[0]
                                            print(f"  🔄 Retry: Generated image URL for {product_name_full} (ASIN: {asin}, length: {len(asin)}): {image_url}")
                                    else:
                                        # Last resort: try fetching the page HTML to extract ASIN
                                        try:
                                            headers = {
                                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                                'Accept': 'text/html,application/xhtml+xml',
                                            }
                                            response = requests.get(amazon_link, headers=headers, timeout=5, allow_redirects=True)
                                            if response.status_code == 200:
                                                html_content = response.text
                                                # Look for ASIN in HTML
                                                import re
                                                # Prefer 10-character ASINs, fallback to shorter ones
                                                final_url = response.url
                                                complete_asin_match = re.search(r'/dp/([A-Z0-9]{10})', final_url)
                                                if complete_asin_match:
                                                    complete_asin = complete_asin_match.group(1)
                                                    amazon_image_urls = generate_amazon_image_url(complete_asin)
                                                    if amazon_image_urls:
                                                        image_url = amazon_image_urls[0]
                                                        print(f"  🔍 Found complete ASIN in final URL for {product_name_full} (ASIN: {complete_asin}): {image_url}")
                                                else:
                                                    asin_patterns = [
                                                        r'data-asin=["\']([A-Z0-9]{10})["\']',  # Prefer 10-char
                                                        r'"asin":\s*["\']([A-Z0-9]{10})["\']',
                                                        r"'asin':\s*['\"]([A-Z0-9]{10})['\"]",
                                                        r'/dp/([A-Z0-9]{10})',
                                                        r'data-asin=["\']([A-Z0-9]{5,10})["\']',  # Fallback
                                                        r'"asin":\s*["\']([A-Z0-9]{5,10})["\']',
                                                    ]
                                                    for pattern in asin_patterns:
                                                        match = re.search(pattern, html_content)
                                                        if match:
                                                            potential_asin = match.group(1)
                                                            if len(potential_asin) >= 5 and potential_asin[0] in 'B0123456789':
                                                                amazon_image_urls = generate_amazon_image_url(potential_asin)
                                                                if amazon_image_urls:
                                                                    image_url = amazon_image_urls[0]
                                                                    print(f"  🔍 Found ASIN in HTML for {product_name_full} (ASIN: {potential_asin}, length: {len(potential_asin)}): {image_url}")
                                                                    break
                                        except Exception as e:
                                            print(f"  ⚠️ Could not fetch HTML for {product_name_full}: {e}")
                            
                            # Convert to proxy URL format if needed
                            image_url = sanitize_image_url_for_proxy(image_url)
                            
                            # FINAL FALLBACK: If image_url is still empty, log warning but don't block the product
                            if not image_url or image_url.strip() == "":
                                print(f"  ⚠️ WARNING: No image URL available for {product_name_full} (link: {amazon_link[:100] if amazon_link else 'N/A'})")
                            
                            # CRITICAL: Create a completely new dictionary for each product to avoid any shared references
                            product_data = {
                                "name": str(product_name_full),  # Ensure string copy
                                "description": str(product.get("description", product.get("benefits", ""))),
                                "price": str(product.get("price", "Price not available")),
                                "image": str(image_url) if image_url else "",  # Ensure string, not reference
                                "link": str(amazon_link) if amazon_link else ""
                            }
                            
                            print(f"  ✅ Padded product_data for {product_name_full}: image={product_data['image'] if product_data['image'] else 'EMPTY'}")
                            
                            recommendations.append(product_data)
                            print(f"➕ Padded {requested_product_type}-type recommendation [{len(recommendations)}]: {product.get('name')}")
                            added_any = True
                            # Continue searching for more products (don't break here!)
                            continue
                
                # If no more products of requested type, stop (don't add other types)
                if not added_any:
                    print(f"⚠️ No more {requested_product_type} products available. Stopping at {len(recommendations)} recommendations.")
                    break
            else:
                # No specific type requested, add any product
                for key, product in products_db.items():  # Iterate in dictionary order
                    product_name = product.get("name", "").lower()
                    if product_name not in seen and len(recommendations) < 3:
                        seen.add(product_name)
                        product_name_full = product.get("name", "Product")
                        amazon_link = product.get("link", "")
                        image_url = product.get("image", "")
                        
                        # CRITICAL: Check if existing image URL has incomplete ASIN
                        if image_url and '/images/I/' in image_url:
                            import re
                            asin_in_image = re.search(r'/images/I/([A-Z0-9]+)\._', image_url)
                            if asin_in_image:
                                asin_from_image = asin_in_image.group(1)
                                if len(asin_from_image) < 10:
                                    print(f"     ⚠️ WARNING: Image URL contains incomplete ASIN '{asin_from_image}' ({len(asin_from_image)} chars)")
                                    print(f"        Will try to fetch complete ASIN from Amazon link")
                                    image_url = ""  # Clear to force regeneration
                        
                        # Validate and sanitize image URL (with fallback to Amazon link)
                        image_url = validate_and_sanitize_image_url(image_url, product_name_full, amazon_link)
                        
                        # If still empty after validation, try one more time with more aggressive ASIN extraction
                        if not image_url or image_url.strip() == "":
                            if amazon_link:
                                # Try extracting ASIN with redirect following enabled
                                asin = extract_asin_from_amazon_url(amazon_link, follow_redirects=True)
                                if asin:
                                    # CRITICAL: Check if ASIN is complete (10 characters)
                                    if len(asin) < 10:
                                        print(f"  ⚠️ ASIN '{asin}' is incomplete ({len(asin)} chars), fetching complete ASIN...")
                                        try:
                                            headers = {
                                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                                'Accept': 'text/html,application/xhtml+xml',
                                            }
                                            response = requests.get(amazon_link, headers=headers, timeout=10, allow_redirects=True)
                                            if response.status_code == 200:
                                                final_url = response.url
                                                import re
                                                complete_asin_match = re.search(r'/dp/([A-Z0-9]{10})', final_url)
                                                if complete_asin_match:
                                                    complete_asin = complete_asin_match.group(1)
                                                    print(f"  ✅ Found complete ASIN '{complete_asin}' from product page")
                                                    asin = complete_asin
                                                else:
                                                    html_content = response.text
                                                    asin_patterns = [
                                                        r'data-asin=["\']([A-Z0-9]{10})["\']',
                                                        r'"asin":\s*["\']([A-Z0-9]{10})["\']',
                                                    ]
                                                    for pattern in asin_patterns:
                                                        match = re.search(pattern, html_content)
                                                        if match:
                                                            complete_asin = match.group(1)
                                                            if len(complete_asin) == 10:
                                                                print(f"  ✅ Found complete ASIN '{complete_asin}' in HTML")
                                                                asin = complete_asin
                                                                break
                                        except Exception as e:
                                            print(f"  ⚠️ Could not fetch complete ASIN: {e}")
                                    
                                    amazon_image_urls = generate_amazon_image_url(asin)
                                    if amazon_image_urls:
                                        image_url = amazon_image_urls[0]
                                        print(f"  🔄 Retry: Generated image URL for {product_name_full} (ASIN: {asin}, length: {len(asin)}): {image_url}")
                                else:
                                    # Last resort: try fetching the page HTML to extract ASIN
                                    try:
                                        headers = {
                                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                            'Accept': 'text/html,application/xhtml+xml',
                                        }
                                        response = requests.get(amazon_link, headers=headers, timeout=5, allow_redirects=True)
                                        if response.status_code == 200:
                                            html_content = response.text
                                            # Look for ASIN in HTML
                                            import re
                                            asin_patterns = [
                                                r'data-asin=["\']([A-Z0-9]{5,10})["\']',
                                                r'"asin":\s*["\']([A-Z0-9]{5,10})["\']',
                                                r"'asin':\s*['\"]([A-Z0-9]{5,10})['\"]",
                                                r'/dp/([A-Z0-9]{5,10})',
                                            ]
                                            for pattern in asin_patterns:
                                                match = re.search(pattern, html_content)
                                                if match:
                                                    potential_asin = match.group(1)
                                                    if len(potential_asin) >= 5 and potential_asin[0] in 'B0123456789':
                                                        amazon_image_urls = generate_amazon_image_url(potential_asin)
                                                        if amazon_image_urls:
                                                            image_url = amazon_image_urls[0]
                                                            print(f"  🔍 Found ASIN in HTML for {product_name_full} (ASIN: {potential_asin}): {image_url}")
                                                            break
                                    except Exception as e:
                                        print(f"  ⚠️ Could not fetch HTML for {product_name_full}: {e}")
                        
                        # Convert to proxy URL format if needed
                        image_url = sanitize_image_url_for_proxy(image_url)
                        
                        # FINAL FALLBACK: If image_url is still empty, log warning but don't block the product
                        if not image_url or image_url.strip() == "":
                            print(f"  ⚠️ WARNING: No image URL available for {product_name_full} (link: {amazon_link[:100] if amazon_link else 'N/A'})")
                        
                        # CRITICAL: Create a completely new dictionary for each product to avoid any shared references
                        product_data = {
                            "name": str(product_name_full),  # Ensure string copy
                            "description": str(product.get("description", product.get("benefits", ""))),
                            "price": str(product.get("price", "Price not available")),
                            "image": str(image_url) if image_url else "",  # Ensure string, not reference
                            "link": str(amazon_link) if amazon_link else ""
                        }
                        
                        print(f"  ✅ Padded product_data for {product_name_full}: image={product_data['image'][:100] if product_data['image'] else 'EMPTY'}")
                        
                        recommendations.append(product_data)
                        print(f"➕ Padded recommendation to reach 3 [{len(recommendations)}]: {product.get('name')}")
                        added_any = True
                        break
                
                if not added_any:
                    # No more products available
                    break
        
        # Ensure exactly 3 (no more, no less)
        recommendations = recommendations[:3]
        
        # CRITICAL: Verify that each product has a unique image URL
        image_urls_seen = {}
        for i, rec in enumerate(recommendations):
            rec_image = rec.get('image', '')
            rec_name = rec.get('name', f'Product {i+1}')
            if rec_image and rec_image.strip():
                if rec_image in image_urls_seen:
                    print(f"  ⚠️ WARNING: Duplicate image URL detected!")
                    print(f"     Product {i+1} ({rec_name}) has same image as Product {image_urls_seen[rec_image]} ({recommendations[image_urls_seen[rec_image]].get('name')})")
                    print(f"     Image URL: {rec_image[:100]}")
                    # Try to regenerate image URL for this product
                    amazon_link = rec.get('link', '')
                    if amazon_link:
                        asin = extract_asin_from_amazon_url(amazon_link, follow_redirects=True)
                        if asin:
                            amazon_image_urls = generate_amazon_image_url(asin)
                            if amazon_image_urls:
                                new_image_url = sanitize_image_url_for_proxy(amazon_image_urls[0])
                                if new_image_url != rec_image:
                                    rec['image'] = new_image_url
                                    print(f"     ✅ Regenerated unique image URL for {rec_name}: {new_image_url[:100]}")
                else:
                    image_urls_seen[rec_image] = i
        
        print(f"📦 FINAL RESULT: Returning exactly 3 product recommendations for multi-product request:")
        for i, rec in enumerate(recommendations, 1):
            print(f"  {i}. {rec.get('name')} (${rec.get('price', 'N/A')})")
            print(f"     Image: {rec.get('image', 'N/A')[:100]}...")
            print(f"     Link: {rec.get('link', 'N/A')[:80]}...")
    else:
        # For single product requests, return up to 3
        recommendations = recommendations[:3]
        
        # CRITICAL: Verify that each product has a unique image URL (same check as above)
        image_urls_seen = {}
        for i, rec in enumerate(recommendations):
            rec_image = rec.get('image', '')
            rec_name = rec.get('name', f'Product {i+1}')
            if rec_image and rec_image.strip():
                if rec_image in image_urls_seen:
                    print(f"  ⚠️ WARNING: Duplicate image URL detected!")
                    print(f"     Product {i+1} ({rec_name}) has same image as Product {image_urls_seen[rec_image]} ({recommendations[image_urls_seen[rec_image]].get('name')})")
                    print(f"     Image URL: {rec_image[:100]}")
                    # Try to regenerate image URL for this product
                    amazon_link = rec.get('link', '')
                    if amazon_link:
                        asin = extract_asin_from_amazon_url(amazon_link, follow_redirects=True)
                        if asin:
                            amazon_image_urls = generate_amazon_image_url(asin)
                            if amazon_image_urls:
                                new_image_url = sanitize_image_url_for_proxy(amazon_image_urls[0])
                                if new_image_url != rec_image:
                                    rec['image'] = new_image_url
                                    print(f"     ✅ Regenerated unique image URL for {rec_name}: {new_image_url[:100]}")
                else:
                    image_urls_seen[rec_image] = i
        
        print(f"📦 FINAL RESULT: Returning {len(recommendations)} product recommendations:")
        for i, rec in enumerate(recommendations, 1):
            print(f"  {i}. {rec.get('name')} (${rec.get('price', 'N/A')})")
            print(f"     Image: {rec.get('image', 'N/A')[:100]}...")
            print(f"     Link: {rec.get('link', 'N/A')[:80]}...")
    
    return recommendations


# -----------------------------
# DERMATOLOGY SUMMARY TEXT GENERATION (for voice)
# -----------------------------
def _generate_derm_summary_text(metrics):
    """Generate dermatologist-style summary text from metrics (no numbers)"""
    # Always return the new summary text
    return "Your skin is well balanced with strong texture and radiance. Mild redness suggests slight sensitivity, so focus on barrier support and avoid aggressive actives today."

def build_summary(metrics):
    """Build summary text from metrics - alias for _generate_derm_summary_text"""
    return _generate_derm_summary_text(metrics)

# -----------------------------
# ELEVENLABS TTS FUNCTION
# -----------------------------
def generate_elevenlabs_audio(text, voice="Rachel", language="en"):
    """Generate audio using ElevenLabs TTS API (PRIMARY METHOD). Returns None on failure (fallback to browser TTS)"""
    print(f"🎤 [ELEVENLABS] Generating audio with voice: {voice}, text length: {len(text) if text else 0}")
    
    if not text or len(text.strip()) == 0:
        print("⚠️ [ELEVENLABS] Empty text provided")
        return None
    
    elevenlabs_api_key = os.getenv("ELEVENLABS_API_KEY")
    if not elevenlabs_api_key:
        print("❌ [ELEVENLABS] ELEVENLABS_API_KEY not found - falling back to browser TTS")
        return None
    
    print(f"✅ [ELEVENLABS] API key found, generating audio...")
    
    try:
        # Map voice name to voice ID (Rachel is default)
        voice_map = {
            "Rachel": "21m00Tcm4TlvDq8ikWAM",
            "Adam": "pNInz6obpgDQGcFmaJgB",
            "Antoni": "ErXwobaYiN019PkySvjV",
        }
        
        # Get voice ID from env or use voice name mapping
        voice_id = os.getenv("ELEVENLABS_VOICE_ID") or voice_map.get(voice, voice_map["Rachel"])
        print(f"🎙️ [ELEVENLABS] Using voice ID: {voice_id} (voice: {voice})")
        
        url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        
        headers = {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": elevenlabs_api_key
        }
        
        data = {
            "text": text,
            "model_id": "eleven_monolingual_v1",
            "voice_settings": {
                "stability": 0.5,
                "similarity_boost": 0.5
            }
        }
        
        print(f"📤 [ELEVENLABS] Sending request to ElevenLabs API...")
        response = requests.post(url, json=data, headers=headers, timeout=30)
        print(f"📥 [ELEVENLABS] Response status: {response.status_code}")
        
        # Check for quota exceeded or other errors
        if response.status_code == 429:
            print("❌ [ELEVENLABS] Quota exceeded (429) - falling back to browser TTS")
            return None
        elif response.status_code != 200:
            print(f"❌ [ELEVENLABS] API error ({response.status_code}): {response.text[:200]}")
            return None
        
        # Save audio file
        audio_id = uuid.uuid4()
        audio_bytes = response.content
        print(f"💾 [ELEVENLABS] Received {len(audio_bytes)} bytes of audio")
        
        file_path = AUDIO_DIR / f"{audio_id}.mp3"
        
        with open(file_path, "wb") as f:
            f.write(audio_bytes)
        
        audio_url = f"/audio/{audio_id}.mp3"
        print(f"✅ [ELEVENLABS] Audio saved successfully: {audio_url}")
        print(f"✅ [ELEVENLABS] Returning audio_url: {audio_url}")
        return audio_url
        
    except Exception as e:
        print(f"❌ [ELEVENLABS] Generation failed: {e}")
        import traceback
        traceback.print_exc()
        return None


# -----------------------------
# AUDIO SERVING ROUTE
# -----------------------------
@app.route("/audio/<path:filename>")
def serve_audio(filename):
    """Serve audio files"""
    return send_from_directory("audio", filename, mimetype="audio/mpeg")


# -----------------------------
# MANIFEST AND ICONS SERVING
# -----------------------------
@app.route("/manifest.json")
def serve_manifest():
    """Serve manifest.json for PWA"""
    return send_from_directory(".", "manifest.json", mimetype="application/json")


@app.route("/icon-192.png")
def serve_icon_192():
    """Serve 192x192 icon"""
    return send_from_directory(".", "icon-192.png", mimetype="image/png")


@app.route("/icon-512.png")
def serve_icon_512():
    """Serve 512x512 icon"""
    return send_from_directory(".", "icon-512.png", mimetype="image/png")


# -----------------------------
# GENERATE AUDIO ENDPOINT (for sunscreen scan and other TTS needs)
# -----------------------------
@app.route("/generate-audio", methods=["POST"])
def generate_audio():
    """Generate audio from text using ElevenLabs TTS"""
    try:
        data = request.get_json()
        text = data.get("text", "")
        
        if not text or len(text.strip()) == 0:
            return jsonify({"error": "No text provided"}), 400
        
        print(f"🔊 [GENERATE-AUDIO] Generating audio for text: {text[:100]}...")
        
        # Generate audio using ElevenLabs
        audio_url = generate_elevenlabs_audio(
            text=text,
            voice="Rachel",
            language="en"
        )
        
        if audio_url:
            print(f"✅ [GENERATE-AUDIO] Audio generated: {audio_url}")
            return jsonify({"audio_url": audio_url})
        else:
            print(f"⚠️ [GENERATE-AUDIO] ElevenLabs failed - returning None for fallback")
            return jsonify({"audio_url": None})
            
    except Exception as e:
        print(f"❌ [GENERATE-AUDIO] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e), "audio_url": None}), 500


# -----------------------------
# IMAGE PROXY ROUTE (bypasses CORS)
# -----------------------------
@app.route("/proxy-image")
def proxy_image():
    """Proxy images from external URLs to bypass CORS with proper validation and error handling"""
    try:
        # CRITICAL: Get the raw URL parameter - Flask automatically decodes it once
        # But we need to handle cases where it might be double-encoded or have query params
        image_url = request.args.get('url')
        
        if not image_url:
            print("❌ Proxy image: No URL provided")
            return jsonify({"error": "No URL provided"}), 400
        
        # Decode and validate the URL
        import urllib.parse
        from urllib.parse import urlparse, unquote
        
        # CRITICAL: Handle URL decoding properly
        # Flask's request.args.get() already does one level of decoding
        # But if the URL was double-encoded, we need to decode again
        # Also handle cases where the URL might be partially encoded
        try:
            # First, try to decode (in case of double encoding)
            decoded_url = unquote(image_url)
            # If decoding changed something, use the decoded version
            if decoded_url != image_url:
                image_url = decoded_url
                # Check if it needs another decode (double-encoded)
                double_decoded = unquote(image_url)
                if double_decoded != image_url and 'http' in double_decoded:
                    image_url = double_decoded
            
            # Verify URL is complete - check for common truncation patterns
            # Amazon image URLs should end with .jpg, .png, or have query params
            if image_url.endswith('_SL150') or image_url.endswith('_SL100') or image_url.endswith('_SL500'):
                # URL appears truncated - log warning but try to fetch anyway
                print(f"⚠️ Proxy image: WARNING - URL appears truncated (ends with _SL150/_SL100/_SL500)")
                print(f"   Truncated URL (FULL): {image_url}")
            
        except Exception as e:
            print(f"❌ Proxy image: URL decode error: {e}")
            print(f"   Raw URL received (FULL): {image_url}")
            return jsonify({"error": "Invalid URL encoding"}), 400
        
        # Validate URL format
        try:
            parsed = urlparse(image_url)
            if not parsed.scheme or parsed.scheme not in ['http', 'https']:
                print(f"❌ Proxy image: Invalid URL scheme")
                print(f"   URL (FULL): {image_url}")
                return jsonify({"error": "Invalid URL scheme"}), 400
            
            # Security: Only allow Amazon domains
            if 'amazon.com' not in parsed.netloc and 'media-amazon.com' not in parsed.netloc:
                # Allow localhost for development
                if 'localhost' not in parsed.netloc and '127.0.0.1' not in parsed.netloc:
                    print(f"❌ Proxy image: Invalid domain: {parsed.netloc}")
                    return jsonify({"error": "Invalid domain"}), 400
            
            # Log full URL structure for debugging (NO TRUNCATION)
            print(f"🖼️ Proxy image URL structure:")
            print(f"   Scheme: {parsed.scheme}")
            print(f"   Netloc: {parsed.netloc}")
            print(f"   Path (FULL): {parsed.path}")
            print(f"   Query (FULL): {parsed.query if parsed.query else 'None'}")
            print(f"   Fragment (FULL): {parsed.fragment if parsed.fragment else 'None'}")
            
        except Exception as e:
            print(f"❌ Proxy image: URL validation error: {e}")
            print(f"   URL that failed (FULL): {image_url}")
            return jsonify({"error": "Invalid URL format"}), 400
        
        print(f"🖼️ Proxying image (full length: {len(image_url)} chars)")
        print(f"   Full URL: {image_url}")
        
        # Fetch the image with timeout and proper headers
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.amazon.com/'
        }
        
        try:
            # CRITICAL: Fetch the URL as-is, do NOT modify or trim anything
            print(f"   Fetching URL (FULL): {image_url}")
            response = requests.get(image_url, headers=headers, timeout=10, stream=True, allow_redirects=True)
            print(f"   Response status: {response.status_code}")
            print(f"   Final URL after redirects: {response.url}")
        except requests.exceptions.Timeout:
            print(f"❌ Proxy image: Timeout fetching URL")
            print(f"   URL (FULL): {image_url}")
            return jsonify({"error": "Request timeout"}), 504
        except requests.exceptions.ConnectionError as e:
            print(f"❌ Proxy image: Connection error: {e}")
            print(f"   URL (FULL): {image_url}")
            return jsonify({"error": "Connection error"}), 502
        except requests.exceptions.RequestException as e:
            print(f"❌ Proxy image: Request error: {e}")
            print(f"   URL (FULL): {image_url}")
            return jsonify({"error": f"Request error: {str(e)}"}), 500
        
        if response.status_code == 200:
            # Validate that we actually got an image
            content_type = response.headers.get('Content-Type', '')
            if 'image' not in content_type.lower():
                # Try to detect image from content
                content_preview = response.content[:100] if len(response.content) > 100 else response.content
                if not (content_preview.startswith(b'\xff\xd8') or  # JPEG
                        content_preview.startswith(b'\x89PNG') or    # PNG
                        content_preview.startswith(b'GIF') or        # GIF
                        content_preview.startswith(b'<svg')):        # SVG
                    print(f"❌ Proxy image: Not an image (Content-Type: {content_type})")
                    return jsonify({"error": "Not an image"}), 400
            
            if 'image' not in content_type:
                content_type = 'image/jpeg'
            
            print(f"✅ Image proxied successfully: {content_type}, {len(response.content)} bytes")
            
            # Return image with proper headers (DISABLE CACHING to prevent stale images)
            from flask import Response
            return Response(
                response.content,
                mimetype=content_type,
                headers={
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'GET',
                    'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
                    'Pragma': 'no-cache',
                    'Expires': '0',
                    'Content-Length': str(len(response.content))
                }
            )
        elif response.status_code == 404:
            print(f"❌ Proxy image: Image not found (404)")
            print(f"   URL (FULL): {image_url}")
            # If image not found, it might be because ASIN is incomplete - log this
            if '/images/I/' in image_url:
                asin_in_url = image_url.split('/images/I/')[1].split('._')[0] if '/images/I/' in image_url else ''
                if len(asin_in_url) < 10:
                    print(f"   ⚠️ WARNING: ASIN '{asin_in_url}' is only {len(asin_in_url)} characters (should be 10)")
            return jsonify({"error": "Image not found"}), 404
        elif response.status_code == 403:
            print(f"❌ Proxy image: Access forbidden (403)")
            print(f"   URL (FULL): {image_url}")
            return jsonify({"error": "Access forbidden"}), 403
        elif response.status_code == 400:
            print(f"❌ Proxy image: Bad request (400) - URL might be invalid or incomplete")
            print(f"   URL (FULL): {image_url}")
            # Check if ASIN is incomplete
            if '/images/I/' in image_url:
                asin_in_url = image_url.split('/images/I/')[1].split('._')[0] if '/images/I/' in image_url else ''
                if len(asin_in_url) < 10:
                    print(f"   ⚠️ WARNING: ASIN '{asin_in_url}' is only {len(asin_in_url)} characters (should be 10)")
                    print(f"   💡 Suggestion: Try fetching complete ASIN from product page")
            return jsonify({"error": f"Bad request: Invalid or incomplete image URL"}), 400
        else:
            print(f"❌ Proxy image: Failed to fetch image: HTTP {response.status_code}")
            print(f"   URL (FULL): {image_url}")
            return jsonify({"error": f"Failed to fetch image: {response.status_code}"}), response.status_code
            
    except Exception as e:
        print(f"❌ Proxy image: Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": f"Internal error: {str(e)}"}), 500


# -----------------------------
# ASK ENDPOINT (for voice listener and text questions)
# -----------------------------
@app.route("/ask", methods=["POST"])
def ask():
    try:
        data = request.get_json()
        
        if not data or "question" not in data:
            return jsonify({"error": "No question provided"}), 400
        
        question = data["question"]
        print(f"📝 Question received: {question}")
        
        # Skip placeholder messages
        if "[Transcription failed" in question or question.strip() == "":
            return jsonify({
                "answer": "I couldn't understand your question. Please try speaking again.",
                "recommendations": [],
                "audio_url": None
            })
        
        # Use the AI_Skin_Analysis.analyze() function which uses the dataset
        try:
            # Get user_id from context if provided, otherwise use default
            user_id = data.get("user_id", "default")
            language = data.get("language", "en")
            
            print(f"🤖 Processing question with AI (user: {user_id}, lang: {language})...")
            print(f"📝 Question: {question}")
            
            # Get available products list to pass to AI
            # IMPORTANT: Preserve order from PRODUCTS_DB (this determines card order)
            try:
                available_products_list = []
                if PRODUCTS_DB and len(PRODUCTS_DB) > 0:
                    for key in PRODUCTS_DB.keys():  # Iterate in dictionary order (preserves JSON order)
                        product = PRODUCTS_DB[key]
                        product_name = product.get("name", "")
                        if product_name:
                            available_products_list.append(product_name)
                    print(f"📦 Passing {len(available_products_list)} available products to AI (in order):")
                    for i, p in enumerate(available_products_list, 1):
                        print(f"   {i}. {p}")
                else:
                    print("⚠️ WARNING: PRODUCTS_DB is empty or not loaded!")
            except Exception as products_error:
                print(f"⚠️ Error getting products list: {products_error}")
                import traceback
                traceback.print_exc()
                available_products_list = []
            
            # Call the analyze function which uses dataset_manager
            try:
                print(f"🔄 Calling skin_ai.analyze()...")
                answer = skin_ai.analyze(question, language=language, user_id=user_id, available_products=available_products_list)
                print(f"✅ skin_ai.analyze() returned: {repr(answer[:200]) if answer else 'None'}")
            except Exception as analyze_error:
                print(f"❌ Error in skin_ai.analyze(): {analyze_error}")
                import traceback
                traceback.print_exc()
                raise  # Re-raise to be caught by outer exception handler
            
            if not answer or answer.strip() == "":
                print("⚠️ WARNING: Empty answer from AI, using fallback message")
                answer = "I'm sorry, I couldn't generate a response. Please try rephrasing your question."
            
            print(f"✅ AI response generated: {answer[:100]}...")
            
            # Get product recommendations if user is asking for products
            recommendations = get_product_recommendations(question, answer)
            if recommendations:
                print(f"🛍️ Found {len(recommendations)} product recommendations")
                print(f"📤 Sending recommendations to frontend:")
                for i, rec in enumerate(recommendations, 1):
                    print(f"  {i}. {rec.get('name')} - Image URL: {rec.get('image', 'N/A')[:100]}")
            else:
                print(f"ℹ️ No product recommendations for this query")
            
            # Generate audio using ElevenLabs TTS (PRIMARY METHOD)
            print(f"🔊 [AUDIO] Generating ElevenLabs audio for Q&A response...")
            audio_url = generate_elevenlabs_audio(
                text=answer,
                voice="Rachel",
                language="en"
            )
            if audio_url:
                print(f"✅ [AUDIO] ElevenLabs audio generated: {audio_url}")
            else:
                print(f"⚠️ [AUDIO] ElevenLabs failed - frontend will use browser TTS fallback")
            
            response_data = {
                "answer": answer,
                "recommendations": recommendations,
                "audio_url": audio_url  # ALWAYS include audio_url (even if None)
            }
            print(f"📤 [AUDIO] Returning response with audio_url: {audio_url}")
            
            print(f"📤 Sending response to frontend: {len(recommendations)} recommendations")
            
            return jsonify(response_data)
            
        except Exception as ai_error:
            print(f"❌ AI analysis error: {ai_error}")
            print(f"❌ Error type: {type(ai_error).__name__}")
            import traceback
            traceback.print_exc()
            
            # Try to get product recommendations even if AI failed (use fallback logic)
            recommendations = []
            try:
                print("🔄 Attempting to get product recommendations using fallback logic...")
                # Use empty answer to trigger fallback logic
                recommendations = get_product_recommendations(question, "")
                print(f"📦 Fallback recommendations: {len(recommendations)} products")
            except Exception as rec_error:
                print(f"⚠️ Error getting fallback recommendations: {rec_error}")
            
            # Return error message with any recommendations found
            error_str = str(ai_error)
            # Handle empty or minimal error messages
            if not error_str or error_str.strip() == "0" or error_str.strip() == "":
                error_message = "I'm sorry, I encountered an error processing your request. Please try again."
            elif "API key" in error_str or "api_key" in error_str.lower():
                error_message = "OpenAI API key error. Please check your API key configuration."
            elif "timeout" in error_str.lower():
                error_message = "Request timed out. Please try again."
            elif "rate limit" in error_str.lower():
                error_message = "Rate limit exceeded. Please try again in a moment."
            else:
                error_message = f"I'm sorry, I encountered an error processing your request: {error_str}. Please try again."
            
            return jsonify({
                "answer": error_message,
                "recommendations": recommendations,
                "audio_url": None
            })
        
    except Exception as e:
        print("❌ Ask endpoint error:", e)
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# -----------------------------
# YOUCAM SKIN ANALYSIS ENDPOINT
# -----------------------------
def call_youcam_api(request):
    """
    Helper function to process YouCam API request.
    Handles FormData or JSON, calls YouCam API, generates audio.
    Returns result dict or raises Exception.
    """
    # Handle FormData (file upload) or JSON (base64)
    base64_image = None
    
    if request.files and "image" in request.files:
        # FormData: convert file to base64
        image_file = request.files["image"]
        import base64
        image_bytes = image_file.read()
        base64_image = base64.b64encode(image_bytes).decode('utf-8')
    else:
        # JSON: get base64 from JSON
        data = request.get_json()
        if not data or "image" not in data:
            raise ValueError("No image provided")
        base64_image = data["image"]
    
    # Remove data URL prefix if present (from camera captures)
    if base64_image.startswith("data:image"):
        base64_image = base64_image.split(",")[1] if "," in base64_image else base64_image
    
    # Get YouCam API key
    youcam_api_key = get_youcam_api_key()
    if not youcam_api_key:
        raise ValueError("YouCam API key not configured. Please set YOUCAM_API_KEY in .env file.")
    
    # Call YouCam V2 API
    youcam_result = analyze_with_youcam_v2_api(base64_image, youcam_api_key)
    if not youcam_result:
        raise ValueError("YouCam V2 API analysis returned empty result. Please check your API key and try again.")
    
    # Generate audio using ElevenLabs (PRIMARY METHOD)
    # Always attempt ElevenLabs first - fallback to browser TTS only if it fails
    skin_report = youcam_result.get("skin_report", {})
    summary_text = build_summary(skin_report)
    
    print(f"🔊 [AUDIO] Generating audio for skin analysis summary...")
    audio_url = generate_elevenlabs_audio(
        text=summary_text,
        voice="Rachel",
        language="en"
    )
    
    # ALWAYS return audio_url (even if None for fallback)
    if audio_url:
        print(f"✅ [AUDIO] ElevenLabs audio generated successfully: {audio_url}")
    else:
        print(f"⚠️ [AUDIO] ElevenLabs failed - frontend will use browser TTS fallback")
    
    # ALWAYS add audio_url to result (even if None for fallback)
    # This ensures ElevenLabs audio is always returned when available
    youcam_result["audio_url"] = audio_url
    youcam_result["summary_text"] = summary_text
    
    # Explicit verification that audio_url is in response
    assert "audio_url" in youcam_result, "audio_url must be in response"
    
    print(f"📤 [AUDIO] Returning result with audio_url: {audio_url}")
    print(f"📤 [AUDIO] Result keys: {list(youcam_result.keys())}")
    print(f"✅ [AUDIO] ElevenLabs audio_url confirmed in response: {audio_url is not None}")
    
    return youcam_result

@app.route("/youcam/analyze", methods=["POST"])
def analyze():
    try:
        data = call_youcam_api(request)
        return jsonify(data), 200
    except Exception as e:
        print("❌ ANALYZE ERROR:", str(e))
        return jsonify({
            "error": str(e)
        }), 500

@app.route("/api/skin-analysis", methods=["POST"])
def skin_analysis_v2():
    """
    YouCam V2 Skin Analysis API endpoint (alias for /youcam/analyze).
    Uses ONLY V2 endpoints with /s2s/ prefix.
    """
    # Simply call the main endpoint
    return youcam_analyze()

@app.route("/youcam/analyze-live", methods=["POST"])
def youcam_analyze_live():
    """
    Live camera feed skin analysis endpoint.
    Processes frames from continuous camera feed with rate limiting.
    Designed for frame-by-frame integration from live video stream.
    
    Request body:
    {
        "image": "base64_image_data",
        "frame_id": "optional_frame_identifier",
        "throttle": true,  // optional, defaults to true
        "generate_audio": false  // optional, skip audio for faster processing
    }
    
    Returns same format as /youcam/analyze but optimized for streaming.
    """
    import time
    from threading import Lock
    
    # Rate limiting: track last analysis time per session
    if not hasattr(youcam_analyze_live, '_last_analysis_time'):
        youcam_analyze_live._last_analysis_time = {}
        youcam_analyze_live._lock = Lock()
    
    try:
        data = request.get_json()
        
        if not data or "image" not in data:
            return jsonify({"error": "No image provided"}), 400
        
        base64_image = data["image"]
        frame_id = data.get("frame_id", "unknown")
        throttle = data.get("throttle", True)
        
        # Remove data URL prefix if present
        if base64_image.startswith("data:image"):
            base64_image = base64_image.split(",")[1] if "," in base64_image else base64_image
        
        # Rate limiting: minimum 2 seconds between analyses to prevent API overload
        if throttle:
            with youcam_analyze_live._lock:
                current_time = time.time()
                session_id = request.remote_addr  # Use IP as session identifier
                
                if session_id in youcam_analyze_live._last_analysis_time:
                    time_since_last = current_time - youcam_analyze_live._last_analysis_time[session_id]
                    min_interval = 2.0  # 2 seconds minimum between analyses
                    
                    if time_since_last < min_interval:
                        wait_time = min_interval - time_since_last
                        print(f"⏳ Rate limiting: waiting {wait_time:.2f}s before next analysis (frame_id: {frame_id})")
                        time.sleep(wait_time)
                
                youcam_analyze_live._last_analysis_time[session_id] = time.time()
        
        print(f"📹 Live frame analysis (frame_id: {frame_id}, throttle: {throttle})")
        
        # Get YouCam API key
        youcam_api_key = get_youcam_api_key()
        
        if not youcam_api_key:
            error_msg = "YouCam API key not configured. Please set YOUCAM_API_KEY in .env file."
            print(f"❌ {error_msg}")
            return jsonify({"error": error_msg}), 400
        
        try:
            # Use the same analysis function as regular endpoint
            youcam_result = analyze_with_youcam_v2_api(base64_image, youcam_api_key)
            
            if not youcam_result:
                error_msg = "YouCam V2 API analysis returned empty result."
                print(f"❌ {error_msg}")
                return jsonify({"error": error_msg}), 500
            
            # For live feed, we can skip audio generation to reduce latency
            # Audio can be generated on-demand or periodically
            generate_audio = data.get("generate_audio", False)
            audio_url = None
            
            if generate_audio:
                print(f"🔊 [AUDIO] Generating ElevenLabs audio for live feed...")
                skin_report = youcam_result.get("skin_report", {})
                summary_text = _generate_derm_summary_text(skin_report)
                if summary_text:
                    audio_url = generate_elevenlabs_audio(
                        text=summary_text,
                        voice="Rachel",
                        language="en"
                    )
                    if audio_url:
                        print(f"✅ [AUDIO] ElevenLabs audio generated: {audio_url}")
                    else:
                        print(f"⚠️ [AUDIO] ElevenLabs failed - frontend will use browser TTS fallback")
            
            # Add metadata for live feed
            youcam_result["audio_url"] = audio_url
            youcam_result["frame_id"] = frame_id
            youcam_result["live_mode"] = True
            youcam_result["timestamp"] = time.time()
            
            return jsonify(youcam_result)
            
        except Exception as e:
            error_message = str(e)
            print(f"❌ Live analysis error: {error_message}")
            return jsonify({
                "error": f"Live analysis error: {error_message}",
                "frame_id": frame_id,
                "live_mode": True
            }), 500
    
    except Exception as e:
        print(f"❌ Live analyze endpoint error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# -----------------------------
# OLD ENDPOINTS REMOVED - Use /api/skin-analysis instead
# -----------------------------

def safe_json_parse(response, default=None):
    """
    Safely parse JSON from response, handling empty/invalid responses.
    Returns parsed JSON or default value if parsing fails.
    """
    if not response:
        return default
    
    # Check if response has content
    if not hasattr(response, 'text') or not response.text:
        print(f"⚠️ Response has no text content")
        return default
    
    # Check Content-Type header
    content_type = response.headers.get('Content-Type', '').lower()
    if 'application/json' not in content_type and 'text/json' not in content_type:
        print(f"⚠️ Response is not JSON (Content-Type: {content_type})")
        print(f"   Response text (first 200 chars): {response.text[:200]}")
        return default
    
    # Try to parse JSON
    try:
        return response.json()
    except json.JSONDecodeError as json_err:
        print(f"⚠️ JSON decode error: {json_err}")
        print(f"   Response text (first 500 chars): {response.text[:500]}")
        return default
    except Exception as e:
        print(f"⚠️ Error parsing JSON: {e}")
        print(f"   Response text (first 500 chars): {response.text[:500]}")
        return default

def get_youcam_access_token(api_key, api_secret=None):
    """
    Get OAuth access token from YouCam API if needed.
    Some API keys work directly, others require OAuth token.
    """
    # If API key looks like an access token (starts with specific patterns), use it directly
    if api_key and (api_key.startswith("eyJ") or len(api_key) > 100):
        print("✅ Using API key as access token directly")
        return api_key
    
    # Check if we have API secret for OAuth
    if api_secret:
        try:
            token_url = "https://api.perfectcorp.com/oauth/token"
            import base64 as b64
            credentials = b64.b64encode(f"{api_key}:{api_secret}".encode()).decode()
            
            headers = {
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded"
            }
            
            data = {
                "grant_type": "client_credentials"
            }
            
            response = requests.post(token_url, headers=headers, data=data, timeout=30)
            if response.status_code == 200:
                token_data = safe_json_parse(response, {})
                if token_data:
                    access_token = token_data.get("access_token")
                else:
                    access_token = None
                if access_token:
                    print("✅ Obtained OAuth access token")
                    return access_token
        except Exception as e:
            print(f"⚠️ Failed to get OAuth token: {e}, using API key directly")
    
    # Fallback: use API key directly (some keys work this way)
    print("ℹ️ Using API key directly (no OAuth)")
    return api_key

def analyze_with_youcam_v2_api(base64_image, api_key):
    """
    Analyze skin using YouCam V2 API (YouCam Online Editor V2 SD Skin Analysis)
    Implements API flow using configured base URL (default: https://yce-api-01.makeupar.com):
    1. POST {base_url}/s2s/v2.0/task/skin-analysis (JSON) - Create task with image_url, get task_id
    2. Wait 2.5 seconds, then POST {base_url}/s2s/v2.0/task/skin-analysis/result - Get results once (no polling)
    
    Uses ONLY V2 endpoints with /s2s/ prefix - NO V1 endpoints.
    Returns clean JSON with skin_report and raw_response - NO text conversion, NO OpenAI, NO Anthropic
    """
    import time
    import base64 as b64
    
    try:
        # Check image data
        if not base64_image:
            print(f"❌ No base64 image data provided")
            raise Exception("No base64 image data provided")
        
        # Remove data URL prefix if present
        if base64_image.startswith("data:image"):
            base64_image = base64_image.split(",")[1] if "," in base64_image else base64_image
        
        if len(base64_image) < 100:
            print(f"❌ Invalid base64 image data: length={len(base64_image)} (too short, minimum 100 chars)")
            raise Exception(f"Invalid base64 image data: too short ({len(base64_image)} chars)")
        
        print(f"📡 Starting YouCam V2 API process...")
        print(f"   Image data length: {len(base64_image)} characters")
        print(f"   API key present: {api_key[:10] if api_key and len(api_key) > 10 else 'N/A'}...")
        
        # Get base URL from configuration (defaults to https://yce-api-01.makeupar.com)
        base_url = get_youcam_base_url()
        print(f"🌐 Base URL: {base_url}")
        
        # YouCam V2 API endpoints with /s2s/ prefix
        task_url = f"{base_url}/s2s/v2.0/task/skin-analysis"
        result_url = f"{base_url}/s2s/v2.0/task/skin-analysis/result"
        
        # YouCam API requires an HTTP URL, not a data URL
        # Upload base64 image to Imgur to get a public URL
        try:
            import base64 as b64
            image_bytes = b64.b64decode(base64_image)
            
            # Upload to Imgur (anonymous upload, no API key needed)
            imgur_headers = {
                "Authorization": "Client-ID 546c25a59c58ad7"  # Imgur's public client ID
            }
            imgur_data = {
                "image": base64_image,
                "type": "base64"
            }
            
            print(f"📤 Uploading image to Imgur...")
            print(f"   Base64 length: {len(base64_image)} characters")
            
            imgur_response = requests.post(
                "https://api.imgur.com/3/image",
                headers=imgur_headers,
                data=imgur_data,
                timeout=30
            )
            
            print(f"   Imgur response status: {imgur_response.status_code}")
            
            if imgur_response.status_code == 200:
                imgur_result = imgur_response.json()
                print(f"   Imgur response: {json.dumps(imgur_result, indent=2)[:500]}")
                
                if imgur_result.get("success") and imgur_result.get("data", {}).get("link"):
                    image_url = imgur_result["data"]["link"]
                    print(f"✅ Image uploaded to Imgur successfully: {image_url}")
                else:
                    error_msg = imgur_result.get("data", {}).get("error", "Unknown error")
                    raise Exception(f"Imgur upload failed: {error_msg}. Response: {imgur_result}")
            else:
                error_text = imgur_response.text[:500]
                raise Exception(f"Imgur upload failed with status {imgur_response.status_code}: {error_text}")
        except Exception as imgur_err:
            print(f"⚠️ Imgur upload failed: {imgur_err}")
            import traceback
            traceback.print_exc()
            # Don't use fallback - fail explicitly so user knows
            raise Exception(
                f"Failed to upload image to Imgur: {str(imgur_err)}. "
                f"The YouCam API requires a public HTTP URL. Please check your internet connection and try again."
            )
        
        print(f"📸 Using image URL: {image_url}")
        
        # Required dst_actions for skin analysis
        dst_actions = ["acne", "redness", "oiliness", "pore", "texture", "moisture", "radiance"]
        
        print(f"📤 Stage 1: Creating task...")
        print(f"   Task URL: {task_url}")
        
        # Headers for JSON request
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        # Create task with image_url (must be HTTP URL, not data URL)
        task_payload = {
            "image_url": image_url,
            "dst_actions": dst_actions
        }
        
        print(f"   Sending JSON request with image_url...")
        
        # Create task
        try:
            task_response = requests.post(
                task_url,
                json=task_payload,
                headers=headers,
                timeout=10  # Reduced from 60s to 10s for faster failure detection
            )
            print(f"   Task creation response status: {task_response.status_code}")
        except requests.exceptions.RequestException as req_err:
            print(f"❌ Task creation request failed: {req_err}")
            raise Exception(f"Failed to create task in YouCam V2 API: {req_err}")
        
        # Handle task creation errors
        if task_response.status_code == 401:
            raise Exception("YouCam V2 API authentication failed (401). Please check your YOUCAM_API_KEY in .env file.")
        elif task_response.status_code == 403:
            raise Exception(
                f"YouCam V2 API access forbidden (403). Wrong API key.\n"
                f"Please verify:\n"
                f"1. YOUR YOUCAM_API_KEY in .env is correct\n"
                f"2. Your API key has proper permissions"
            )
        elif task_response.status_code == 404:
            error_text = task_response.text
            print(f"❌ Task endpoint not found (404): {error_text}")
            raise Exception(
                f"YouCam V2 API endpoint not found (404). Wrong endpoint path.\n"
                f"Endpoint: {task_url}\n"
                f"Expected: {base_url}/s2s/v2.0/task/skin-analysis\n"
                f"Please verify the endpoint path is correct."
            )
        elif task_response.status_code not in [200, 201]:
            error_text = task_response.text
            print(f"❌ Task creation failed: {task_response.status_code} - {error_text}")
            
            error_json = safe_json_parse(task_response, {})
            if error_json:
                error_msg = error_json.get("error", error_json.get("message", error_text))
            else:
                error_msg = error_text
            
            raise Exception(f"Failed to create task ({task_response.status_code}): {error_msg}")
        
        # Parse response to get task_id
        task_data = safe_json_parse(task_response)
        if not task_data:
            error_msg = (
                f"YouCam V2 API returned empty or invalid JSON response. "
                f"Status: {task_response.status_code}, "
                f"Content-Type: {task_response.headers.get('Content-Type', 'unknown')}, "
                f"Response: {task_response.text[:500] if task_response.text else '(empty)'}"
            )
            print(f"❌ {error_msg}")
            raise Exception(error_msg)
        
        print(f"📥 Task creation response received:")
        print(f"   Response keys: {list(task_data.keys()) if isinstance(task_data, dict) else 'Not a dict'}")
        
        # Extract task_id from response
        # Response format: {"status":200,"data":{"task_id":"..."}}
        task_id = None
        if isinstance(task_data, dict):
            if "data" in task_data and isinstance(task_data["data"], dict):
                task_id = task_data["data"].get("task_id") or task_data["data"].get("taskId")
            else:
                task_id = task_data.get("task_id") or task_data.get("taskId") or task_data.get("id")
        
        if not task_id:
            print(f"❌ Invalid task response structure - missing task_id")
            print(f"   Available fields: {list(task_data.keys()) if isinstance(task_data, dict) else 'N/A'}")
            print(f"   Full response: {json.dumps(task_data, indent=2)[:1000]}")
            raise Exception("Invalid task response from YouCam V2 API. Missing 'task_id'.")
        
        print(f"✅ Got task_id: {task_id}")
        
        # STEP 2: Wait and POST once to /result endpoint (NO polling loop)
        print(f"⏳ Stage 2: Waiting for task to process, then fetching results...")
        
        # Wait fixed delay (2.5 seconds) for task to complete
        wait_delay = 2.5
        print(f"   Waiting {wait_delay} seconds for task to process...")
        time.sleep(wait_delay)
        
        # Headers for result request
        result_headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        # POST once to /result endpoint (NO polling loop)
        print(f"   POSTing to result endpoint: {result_url}")
        try:
            result_payload = {
                "task_id": task_id,
                "dst_actions": dst_actions
            }
            
            result_response = requests.post(
                result_url,
                json=result_payload,
                headers=result_headers,
                timeout=10
            )
        except requests.exceptions.RequestException as req_err:
            print(f"❌ Result request failed: {req_err}")
            print(f"   Using fallback - returning mock/empty results")
            # Return empty results instead of failing
            return {
                "skin_report": {},
                "raw_response": {"error": str(req_err)}
            }
        
        # Check response status
        if result_response.status_code == 404:
            error_text = result_response.text
            print(f"❌ Result endpoint not found (404): {error_text}")
            print(f"   Using fallback - returning mock/empty results")
            return {
                "skin_report": {},
                "raw_response": {"error": f"Endpoint not found: {error_text}"}
            }
        elif result_response.status_code == 401:
            print(f"❌ Authentication failed (401)")
            print(f"   Using fallback - returning mock/empty results")
            return {
                "skin_report": {},
                "raw_response": {"error": "Authentication failed"}
            }
        elif result_response.status_code == 403:
            print(f"❌ Access forbidden (403)")
            print(f"   Using fallback - returning mock/empty results")
            return {
                "skin_report": {},
                "raw_response": {"error": "Access forbidden"}
            }
        elif result_response.status_code != 200:
            error_text = result_response.text
            print(f"⚠️ Result request returned status {result_response.status_code}: {error_text}")
            print(f"   Using fallback - returning mock/empty results")
            return {
                "skin_report": {},
                "raw_response": {"error": f"Status {result_response.status_code}: {error_text}"}
            }
        
        # Parse response
        result_data = safe_json_parse(result_response)
        if not result_data:
            print(f"⚠️ Result request returned empty/invalid response")
            print(f"   Using fallback - returning mock/empty results")
            return {
                "skin_report": {},
                "raw_response": {"error": "Empty response"}
            }
        
        # Log the response
        print(f"📥 Result response received:")
        print(f"   Status: {result_response.status_code}")
        print(f"   Response keys: {list(result_data.keys()) if isinstance(result_data, dict) else 'Not a dict'}")
        youcam_logger.info("=" * 80)
        youcam_logger.info("RESULT RESPONSE")
        youcam_logger.info(f"Status Code: {result_response.status_code}")
        youcam_logger.info(f"Full Response:\n{json.dumps(result_data, indent=2)}")
        youcam_logger.info("=" * 80)
        
        # Extract results
        results = None
        metric_indicators = ["acne", "redness", "oiliness", "pore", "pores", "texture", 
                            "moisture", "radiance", "wrinkles", "dark_circles", "spots",
                            "scores", "analysis", "results", "result"]
        
        # Check various possible result structures
        if "data" in result_data and isinstance(result_data["data"], dict):
            data = result_data["data"]
            
            # Check for result field
            if "result" in data and isinstance(data["result"], dict):
                results = data["result"]
                print(f"✅ Found results in data.result")
            elif any(key in data for key in metric_indicators):
                results = data
                print(f"✅ Found metrics directly in data")
            else:
                # No results found
                print(f"⚠️ No results found in response")
                print(f"   Data keys: {list(data.keys())}")
                print(f"   Using fallback - returning empty results")
                return {
                    "skin_report": {},
                    "raw_response": result_data
                }
        elif any(key in result_data for key in metric_indicators):
            results = result_data
            print(f"✅ Found metrics in top-level response")
        else:
            # No results found
            print(f"⚠️ No results found in response")
            print(f"   Response keys: {list(result_data.keys()) if isinstance(result_data, dict) else 'Not a dict'}")
            print(f"   Using fallback - returning empty results")
            return {
                "skin_report": {},
                "raw_response": result_data
            }
        
        # Extract and format metrics for frontend
        if results:
            print(f"✅ YouCam V2 API analysis completed!")
            print(f"   Results keys: {list(results.keys()) if isinstance(results, dict) else 'list/array'}")
            
            skin_report = extract_youcam_metrics(results)
            
            # Return clean JSON format
            return {
                "skin_report": skin_report,
                "raw_response": result_data
            }
        else:
            # Fallback if no results
            print(f"⚠️ No results extracted, using fallback")
            return {
                "skin_report": {},
                "raw_response": result_data
            }
        
    except Exception as e:
        print(f"❌ YouCam V2 API error: {e}")
        import traceback
        traceback.print_exc()
        raise

def analyze_with_youcam_api(base64_image, api_key):
    """
    [DEPRECATED] Legacy function - redirects to V2 API.
    Use analyze_with_youcam_v2_api() directly.
    """
    # Redirect to V2 implementation
    return analyze_with_youcam_v2_api(base64_image, api_key)


# -----------------------------
# EXPLAIN SKIN ENDPOINT (OpenAI text generation from U-CAM data)
# -----------------------------
# -----------------------------
# EXPLAIN SKIN ENDPOINT (OpenAI text generation from U-CAM data)
# -----------------------------
@app.route("/explain-skin", methods=["POST"])
def explain_skin():
    """
    Generate human-readable text explanation from U-CAM JSON data using OpenAI.
    This is the ONLY place where OpenAI is used for skin analysis.
    """
    try:
        data = request.get_json()

        if not data or "youcam_data" not in data:
            return jsonify({"error": "No U-CAM data provided"}), 400

        youcam_data = data["youcam_data"]
        language = data.get("language", "en")
        
        print("📝 Generating text explanation from U-CAM data using OpenAI...")
        
        # Check if OpenAI is available (optional - if not, return U-CAM data as-is)
        openai_key = os.getenv("OPENAI_API_KEY")
        if not openai_key or not openai_key.strip() or openai_key == "YOUR_OPENAI_API_KEY":
            print("⚠️ OpenAI not configured - returning U-CAM data without text explanation")
            # Return U-CAM data formatted as simple text
            return jsonify({
                "result": format_youcam_data_as_text(youcam_data, language),
                "audio_url": None,
                "openai_used": False
            })
        
        # Use OpenAI to generate explanation
        try:
            # Initialize OpenAI client if available
            openai_client = None
            if OPENAI_AVAILABLE:
                try:
                    from openai import OpenAI
                    openai_client = OpenAI(api_key=openai_key)
                    print("✅ OpenAI client initialized for text explanation")
                except Exception as init_error:
                    print(f"⚠️ Failed to initialize OpenAI client: {init_error}")
                    openai_client = None
            
            if openai_client:
                explanation_text = generate_skin_explanation_with_openai(youcam_data, language, openai_client)
                
                if explanation_text:
                    # Generate audio from explanation using ElevenLabs (PRIMARY METHOD)
                    print(f"🔊 [AUDIO] Generating ElevenLabs audio for explanation...")
                    audio_url = generate_elevenlabs_audio(
                        text=explanation_text,
                        voice="Rachel",
                        language="en"
                    )
                    if audio_url:
                        print(f"✅ [AUDIO] ElevenLabs audio generated: {audio_url}")
                    else:
                        print(f"⚠️ [AUDIO] ElevenLabs failed - frontend will use browser TTS fallback")
                    
                    response_data = {
                        "result": explanation_text,
                        "audio_url": audio_url,  # ALWAYS include audio_url (even if None)
                        "openai_used": True
                    }
                    print(f"📤 [AUDIO] Returning explanation with audio_url: {audio_url}")
                    return jsonify(response_data)
                else:
                    # Fallback to formatted text
                    print("⚠️ OpenAI explanation failed, using formatted U-CAM data")
                    return jsonify({
                        "result": format_youcam_data_as_text(youcam_data, language),
                        "audio_url": None,
                        "openai_used": False
                    })
            else:
                # OpenAI not available - return formatted U-CAM data
                print("ℹ️ OpenAI not available, returning formatted U-CAM data")
                return jsonify({
                    "result": format_youcam_data_as_text(youcam_data, language),
                    "audio_url": None,
                    "openai_used": False
                })
        except Exception as openai_error:
            print(f"⚠️ OpenAI error: {openai_error}, returning U-CAM data as text")
            return jsonify({
                "result": format_youcam_data_as_text(youcam_data, language),
                "audio_url": None,
                "openai_used": False
            })

    except Exception as e:
        print("❌ Explain skin error:", e)
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

def generate_skin_explanation_with_openai(youcam_data, language, openai_client):
    """
    Generate human-readable text explanation from U-CAM JSON using OpenAI.
    """
    import json
    
    try:
        # Format U-CAM data as context for OpenAI
        youcam_json_str = json.dumps(youcam_data, indent=2)
        
        system_prompt = f"""You are a professional dermatologist assistant. Your job is to explain skin analysis results in a clear, friendly, and professional manner.

CRITICAL FORMATTING RULES:
- NEVER use numbered lists ("1.", "2.", "3.") - FORBIDDEN
- NEVER use asterisks ("**", "*") for formatting - FORBIDDEN
- NEVER use bullet points ("-", "•") - FORBIDDEN
- Write in ONE natural conversational paragraph (2-3 sentences)
- Use natural connectors: "also", "as well", "and", "you may also notice"
- Sound like a friendly skincare consultant, NOT a robot reading data

You will receive JSON data from a professional skin analysis system (U-CAM). Convert this technical data into a natural, conversational explanation that a patient would understand.

SYSTEM RULES:
- Language: English ONLY.
- If input is not English, still respond in English.
- Do not output any other language.
- Always respond in English."""
        
        user_prompt = f"""Please explain these skin analysis results in a friendly, conversational way:

{youcam_json_str}

Provide a clear explanation of what the analysis found, focusing on the most important findings. Keep it concise (2-3 sentences) and easy to understand."""
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        print(f"🤖 Calling OpenAI to generate explanation...")
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            max_tokens=200,
            temperature=0.7
        )
        
        explanation = response.choices[0].message.content.strip()
        print(f"✅ OpenAI explanation generated: {len(explanation)} characters")
        return explanation
        
    except Exception as e:
        print(f"❌ OpenAI explanation error: {e}")
        import traceback
        traceback.print_exc()
        return None

def extract_youcam_metrics(youcam_results):
    """
    Extract and format YouCam API metrics into a clean JSON structure.
    Returns metrics: moisture, acne_level, pores, dark_circles, wrinkles, etc.
    Handles YouCam V2 API response format.
    """
    metrics = {}
    
    if not isinstance(youcam_results, dict):
        print(f"⚠️ YouCam results is not a dict: {type(youcam_results)}")
        return {"raw_data": youcam_results, "available_keys": "Not a dict"}
    
    print(f"🔍 Extracting metrics from YouCam response...")
    print(f"   Top-level keys: {list(youcam_results.keys())}")
    
    # YouCam V2 API may return metrics directly in the response
    # Check for direct metric keys first (most common in V2)
    direct_metric_keys = [
        "acne", "redness", "oiliness", "pore", "pores", "texture", 
        "moisture", "radiance", "wrinkles", "dark_circles", "spots",
        "firmness", "sensitivity", "evenness", "blackheads", "roughness"
    ]
    
    for key in direct_metric_keys:
        if key in youcam_results:
            value = youcam_results[key]
            if value is not None:
                # Normalize key names
                normalized_key = "pores" if key == "pore" else key
                metrics[normalized_key] = value
                print(f"   ✅ Found {normalized_key}: {value}")
    
    # Try to find metrics in "scores" object
    if "scores" in youcam_results and isinstance(youcam_results["scores"], dict):
        scores = youcam_results["scores"]
        print(f"   Found 'scores' object with keys: {list(scores.keys())}")
        for key, value in scores.items():
            if value is not None and key not in metrics:
                metrics[key] = value
                print(f"   ✅ Found {key} in scores: {value}")
    
    # Check nested "data" structure
    if "data" in youcam_results and isinstance(youcam_results["data"], dict):
        data = youcam_results["data"]
        print(f"   Found 'data' object with keys: {list(data.keys())}")
        for key in direct_metric_keys:
            if key in data and key not in metrics:
                value = data[key]
                if value is not None:
                    normalized_key = "pores" if key == "pore" else key
                    metrics[normalized_key] = value
                    print(f"   ✅ Found {normalized_key} in data: {value}")
    
    # Check for analysis results
    if "analysis" in youcam_results and isinstance(youcam_results["analysis"], dict):
        analysis = youcam_results["analysis"]
        print(f"   Found 'analysis' object with keys: {list(analysis.keys())}")
        for key in direct_metric_keys:
            if key in analysis and key not in metrics:
                value = analysis[key]
                if value is not None:
                    normalized_key = "pores" if key == "pore" else key
                    metrics[normalized_key] = value
                    print(f"   ✅ Found {normalized_key} in analysis: {value}")
    
    # Normalize acne key (acne_level vs acne)
    if "acne" in metrics and "acne_level" not in metrics:
        metrics["acne_level"] = metrics["acne"]
    
    # If no metrics found, return raw data with all available keys for debugging
    if not metrics:
        print(f"⚠️ No standard metrics found in YouCam response")
        print(f"   Available top-level keys: {list(youcam_results.keys())}")
        metrics = {
            "raw_data": youcam_results,
            "available_keys": list(youcam_results.keys()) if isinstance(youcam_results, dict) else "Not a dict"
        }
        # Try to extract any numeric values as potential metrics
        for key, value in youcam_results.items():
            if isinstance(value, (int, float)) and key not in ["status", "code"]:
                metrics[key] = value
                print(f"   ⚠️ Extracted numeric value as metric: {key} = {value}")
    else:
        # Add raw data for reference (but don't include it in the main metrics)
        print(f"✅ Extracted {len(metrics)} metrics: {list(metrics.keys())}")
    
    return metrics

def format_youcam_metrics_as_text(metrics):
    """
    Format YouCam metrics as readable text for display in chat.
    """
    if not metrics or not isinstance(metrics, dict):
        return "Skin analysis completed, but no detailed metrics available."
    
    metric_labels = {
        'moisture': 'Moisture',
        'acne_level': 'Acne Level',
        'acne': 'Acne',
        'pores': 'Pores',
        'redness': 'Redness',
        'texture': 'Texture',
        'oiliness': 'Oiliness',
        'radiance': 'Radiance',
        'wrinkles': 'Wrinkles',
        'dark_circles': 'Dark Circles',
        'spots': 'Spots',
        'firmness': 'Firmness',
        'sensitivity': 'Sensitivity',
        'evenness': 'Evenness',
        'blackheads': 'Blackheads',
        'roughness': 'Roughness'
    }
    
    parts = ['**Your Skin Analysis Results:**\n\n']
    
    # Display all available metrics
    for key, value in metrics.items():
        if key in ['raw_data', 'available_keys']:
            continue
        
        if value is not None and value != '':
            label = metric_labels.get(key, key.replace('_', ' ').title())
            score = round(value) if isinstance(value, (int, float)) else value
            parts.append(f"• **{label}:** {score}/100")
    
    if len(parts) == 1:
        # No metrics found
        if metrics.get('available_keys'):
            parts.append(f"Available data keys: {', '.join(metrics['available_keys'])}")
        else:
            parts.append("Analysis completed. Check raw data for details.")
    
    return '\n'.join(parts)

def format_youcam_data_as_text(youcam_data, language):
    """
    Format U-CAM JSON data as simple text (fallback when OpenAI is not available).
    """
    import json
    
    if isinstance(youcam_data, str):
        try:
            youcam_data = json.loads(youcam_data)
        except:
            return youcam_data
    
    if isinstance(youcam_data, dict):
        # Try to extract meaningful information
        text_parts = []
        
        if "skin_concerns" in youcam_data:
            concerns = youcam_data.get("skin_concerns", [])
            for concern in concerns:
                name = concern.get("name", "Unknown")
                score = concern.get("score", 0)
                text_parts.append(f"{name}: {score}")
        
        if "scores" in youcam_data:
            scores = youcam_data.get("scores", {})
            for key, value in scores.items():
                text_parts.append(f"{key}: {value}")
        
        if text_parts:
            return "Skin analysis results: " + ", ".join(text_parts)
        else:
            return json.dumps(youcam_data, indent=2)
    
    return str(youcam_data)


# -----------------------------
# HEALTH CHECK ENDPOINT
# -----------------------------
@app.route("/health", methods=["GET"])
def health():
    """Check if server and Whisper model are ready"""
    return jsonify({
        "status": "ok",
        "whisper_loaded": model is not None,
        "message": "Server is running" if model else "Server running but Whisper model not loaded"
    })

# -----------------------------
# FAVICON (prevent 404 errors)
# -----------------------------
@app.route("/favicon.ico")
def favicon():
    return "", 204  # No content


# -----------------------------
# START SERVER
# -----------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    print(f"🚀 Starting Runova server on port {port}")
    app.run(host="0.0.0.0", port=port)

