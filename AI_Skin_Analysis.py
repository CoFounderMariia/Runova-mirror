import os
import tempfile
from openai import OpenAI
from dotenv import load_dotenv
import base64
import json
import requests

# Load environment variables
load_dotenv()

# Import dataset manager
try:
    from dataset_manager import dataset_manager
    DATASET_AVAILABLE = dataset_manager.loaded
except ImportError:
    print("⚠️ Dataset manager not available")
    DATASET_AVAILABLE = False
    dataset_manager = None


# -------------------- OPENAI INITIALIZATION --------------------

openai_key = os.getenv("OPENAI_API_KEY")

if not openai_key or not openai_key.strip():
    print("⚠️ WARNING: OPENAI_API_KEY not found")
    client = None
    OPENAI_AVAILABLE = False
else:
    try:
        client = OpenAI(api_key=openai_key)
        print("✅ OpenAI client initialized successfully")
        OPENAI_AVAILABLE = True
    except Exception as e:
        print(f"❌ Failed to initialize OpenAI client: {e}")
        client = None
        OPENAI_AVAILABLE = False


# -------------------- GEMINI INITIALIZATION --------------------

GEMINI_AVAILABLE = False
gemini_client = None

try:
    from google import genai
    gemini_key = os.getenv("GOOGLE_GEMINI_API_KEY")

    if gemini_key and gemini_key.strip():
        genai.configure(api_key=gemini_key)
        gemini_client = genai.Client()
        GEMINI_AVAILABLE = True
        print("✅ Gemini client initialized successfully")
    else:
        print("⚠️ GOOGLE_GEMINI_API_KEY not found")

except Exception as e:
    print(f"❌ Gemini initialization error: {e}")
    gemini_client = None
    GEMINI_AVAILABLE = False

# Anthropic/Claude removed - using OpenAI and Gemini only

# Initialize Google Gemini client (for skin analysis)


#try:
   # import google.generativeai as genai
    #gemini_key = os.getenv("GOOGLE_GEMINI_API_KEY")
    #if gemini_key and gemini_key.strip():
    #    genai.configure(api_key=gemini_key)
     #   gemini_client = genai.GenerativeModel('gemini-1.5-pro')
    #    GEMINI_AVAILABLE = True
   #    print("✅ Google Gemini initialized successfully")
    #else:
    #    print("⚠️ GOOGLE_GEMINI_API_KEY not found in .env file")
    #    GEMINI_AVAILABLE = False
#except ImportError:
   # print("⚠️ Google Gemini SDK not installed. Run: pip install google-generativeai")
   # GEMINI_AVAILABLE = False
   # gemini_client = None
#except Exception as e:
   # print(f"⚠️ Google Gemini not available: {e}")
   # GEMINI_AVAILABLE = False
   # gemini_client = None

# Conversation history for context
conversation_history = {}


def clean_response_formatting(text):
    """
    Clean AI response to remove all formatting markers and convert to natural paragraph.
    Removes: numbered lists, asterisks, bullet points, markdown, line breaks for lists.
    """
    if not text:
        return text
    
    import re
    
    # Remove markdown bold/italic markers
    text = text.replace("**", "").replace("*", "")
    
    # Remove numbered list patterns (1., 2., 3., etc.)
    text = re.sub(r'^\d+\.\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n\d+\.\s*', ' ', text)
    
    # Remove bullet points (-, •, etc.)
    text = re.sub(r'^[-•]\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n[-•]\s*', ' ', text)
    
    # Replace multiple line breaks with single space (to create paragraph)
    text = re.sub(r'\n+', ' ', text)
    
    # Replace multiple spaces with single space
    text = re.sub(r'\s+', ' ', text)
    
    # Remove leading/trailing whitespace
    text = text.strip()
    
    # Ensure it ends with proper punctuation if it's a sentence
    if text and text[-1] not in '.!?':
        text += '.'
    
    return text

def analyze(question: str, language: str = "en", user_id: str = "default", available_products: list = None) -> str:
    if not question or len(question.strip()) < 2:
        # Return empty string instead of error message
        return ""

    try:
        # Determine response language
        response_lang = "Russian" if language == "ru" else "English"
        
        # Get conversation history for this user
        if user_id not in conversation_history:
            conversation_history[user_id] = []
        
        history = conversation_history[user_id]
        
        # Keep only last 4 messages for context (2 exchanges)
        if len(history) > 8:
            history = history[-8:]
            conversation_history[user_id] = history
        
        # Get relevant context from dataset if available
        dataset_context = ""
        if DATASET_AVAILABLE and dataset_manager:
            dataset_context = dataset_manager.get_relevant_context(question, max_context_length=500)
            if dataset_context:
                print(f"📚 Found relevant context from dataset ({len(dataset_context)} chars)")
        
        # Get available products list for AI context
        available_products_list = available_products or []
        
        # Build messages with history (shorter prompt for faster processing)
        products_context = ""
        if available_products_list:
            products_context = f"\n\nAVAILABLE PRODUCTS YOU CAN RECOMMEND (use EXACT names):\n" + "\n".join([f"- {p}" for p in available_products_list])
            products_context += "\n\nCRITICAL: When recommending products, you MUST use the EXACT product names from the list above. Do NOT invent product names or use variations."
        
        system_prompt = f"""You are RUNOVA, an AI dermatologist assistant. Provide concise, professional skincare advice.

CRITICAL FORMATTING RULES - NEVER VIOLATE THESE:
- NEVER use numbered lists ("1.", "2.", "3.") - FORBIDDEN
- NEVER use asterisks ("**", "*") for formatting - FORBIDDEN
- NEVER use bullet points ("-", "•") - FORBIDDEN
- NEVER use markdown formatting - FORBIDDEN
- NEVER use line breaks to create lists - FORBIDDEN

REQUIRED FORMATTING:
- Always write in ONE natural conversational paragraph (1-2 sentences)
- Use natural connectors: "also", "as well", "and", "you may also like", "another option is", "this works well with"
- When recommending multiple products, combine them naturally in a single flowing sentence
- Sound like a friendly skincare consultant, NOT a robot reading a shopping list
- Example format: "For dry skin, you can try the CeraVe PM Facial Moisturizing Lotion. It works well with the CeraVe Foaming Facial Cleanser, and you may also like the CeraVe Acne Control Cleanser — these three usually give a great result."

PRODUCT RECOMMENDATION RULES:
- ONLY recommend products from the available products list
- Use the EXACT product names as listed (case-sensitive)
- If recommending multiple products, mention at least 2-3 products by their exact names
- CRITICAL: When recommending multiple products, mention them in the ORDER they appear in the available products list (first product first, second product second, etc.)
- This ensures the verbal order matches the visual card order (left-to-right)
- Do NOT abbreviate or modify product names{products_context}

Keep responses SHORT (2-3 sentences max). Be direct and helpful.

SYSTEM RULES:
- Language: English ONLY.
- If input is not English, still respond in English.
- Do not output any other language.
- Always respond in English with natural American English."""
        
        if dataset_context:
            system_prompt += f"\n\nUse the following knowledge base for reference:\n{dataset_context}"
        
        messages = [
            {
                "role": "system",
                "content": system_prompt
            }
        ]
        
        # Add conversation history
        messages.extend(history)
        
        # Add current question
        messages.append({
            "role": "user",
            "content": question
        })
        
        # Check if API key is available
        openai_key = os.getenv("OPENAI_API_KEY")
        if not openai_key or not openai_key.strip() or openai_key == "YOUR_OPENAI_API_KEY":
            error_msg = "OpenAI API key not configured. Check OPENAI_API_KEY in .env file."
            print(f"❌ {error_msg}")
            if language == "ru":
                return "OpenAI API ключ не настроен. Проверьте OPENAI_API_KEY в .env файле."
            return error_msg
        
        # Validate API key format (should start with sk-)
        if not openai_key.startswith("sk-"):
            error_msg = "Invalid OpenAI API key format. API key should start with 'sk-'"
            print(f"❌ {error_msg}")
            return error_msg
        
        # Use ChatGPT to generate intelligent responses via direct HTTP (avoids library version issues)
        print(f"🤖 Calling OpenAI API with {len(messages)} messages, max_tokens=200")
        print(f"🔑 API key present: {openai_key[:7]}...{openai_key[-4:] if len(openai_key) > 11 else 'N/A'}")
        
        headers = {
            'Authorization': f'Bearer {openai_key}',
            'Content-Type': 'application/json'
        }
        payload = {
            'model': 'gpt-4o-mini',
            'messages': messages,
            'max_tokens': 200,
            'temperature': 0.7
        }
        
        try:
            response = requests.post(
                'https://api.openai.com/v1/chat/completions',
                headers=headers,
                json=payload,
                timeout=8
            )
        except requests.exceptions.Timeout:
            print(f"❌ OpenAI API timeout (8 seconds)")
            raise
        except requests.exceptions.RequestException as req_err:
            print(f"❌ OpenAI API request error: {req_err}")
            raise
        
        if response.status_code != 200:
            error_msg = response.text
            print(f"❌ OpenAI API error: {response.status_code} - {error_msg}")
            print(f"❌ Full error response: {error_msg}")
            # Don't raise exception, return a helpful message instead
            if response.status_code == 401:
                return "OpenAI API key error. Please check your API key configuration."
            elif response.status_code == 429:
                return "Rate limit exceeded. Please try again in a moment."
            else:
                raise Exception(f"OpenAI API returned status {response.status_code}: {error_msg}")
        
        result = response.json()
        print(f"✅ OpenAI API response received")
        
        # Check if response has choices
        if 'choices' not in result or len(result['choices']) == 0:
            print(f"❌ No choices in OpenAI response: {result}")
            return "I'm sorry, I couldn't generate a response. Please try again."
        
        answer = result['choices'][0]['message']['content'].strip()
        print(f"📝 Extracted answer: {repr(answer[:100])}... (length: {len(answer)})")
        
        # Post-process to remove any formatting that might have slipped through
        answer = clean_response_formatting(answer)
        
        if not answer or len(answer.strip()) == 0:
            print("⚠️ WARNING: Empty answer_text from OpenAI response")
            return "I'm sorry, I couldn't generate a response. Please try rephrasing your question."
        
        # Update conversation history
        history.append({"role": "user", "content": question})
        history.append({"role": "assistant", "content": answer})
        conversation_history[user_id] = history
        
        return answer
        
    except requests.exceptions.Timeout:
        print(f"❌ OpenAI API timeout error")
        return "Request timed out. Please try again."
    except requests.exceptions.RequestException as req_error:
        print(f"❌ OpenAI API request error: {req_error}")
        import traceback
        traceback.print_exc()
        return "Network error. Please check your internet connection and try again."
    except Exception as e:
        print(f"❌ OpenAI API error: {e}")
        print(f"❌ Error type: {type(e).__name__}")
        import traceback
        traceback.print_exc()
        
        # Check if it's an API key issue
        if "api_key" in str(e).lower() or "authentication" in str(e).lower():
            if language == "ru":
                return "Ошибка API ключа OpenAI. Проверьте OPENAI_API_KEY в .env файле."
            return "OpenAI API key error. Check OPENAI_API_KEY in .env file."
        
        # Check if it's a rate limit issue
        if "rate limit" in str(e).lower() or "quota" in str(e).lower():
            print(f"❌ Rate limit error: {str(e)}")
            return "Rate limit exceeded. Please try again in a moment."
        
        # Generic error - return helpful message
        print(f"❌ Processing error: {str(e)}")
        return f"I'm sorry, I encountered an error: {str(e)}. Please try again."


def analyze_skin(image_bytes: bytes, language: str = "en") -> dict:
    """Analyze skin from image bytes. Returns a dict with analysis result."""
    try:
        # Convert image bytes to base64
        image_base64 = base64.b64encode(image_bytes).decode('utf-8')
        
        # Call analyze_face with base64 string
        analysis_text = analyze_face(image_base64, language=language)
        
        # Return as dict format expected by app.py
        return {"analysis": analysis_text} if analysis_text else {"error": "Could not analyze skin"}
    except Exception as e:
        print(f"❌ analyze_skin error: {e}")
        import traceback
        traceback.print_exc()
        return {"error": str(e)}


def analyze_face(image_base64: str, language: str = "en") -> str:
    """Analyze face image for skin problems using AI (dermatology analysis)"""
    if not image_base64:
        # Return empty string instead of error message
        return ""
    
    # Try Gemini FIRST (less restrictive, better for medical images)
    if GEMINI_AVAILABLE and gemini_client:
        try:
            print("🔬 Using Google Gemini for dermatology analysis (primary)...")
            response_lang = "Russian" if language == "ru" else "English"
            
            prompt_ru = """Ты профессиональный дерматолог на приеме пациента. Пациент пришел к тебе на консультацию по состоянию кожи.

КРИТИЧЕСКИ ВАЖНО: 
- Ты НЕ идентифицируешь личность. Ты НЕ определяешь, кто это человек.
- Ты анализируешь ТОЛЬКО СОСТОЯНИЕ КОЖИ как биологическую ткань.
- Это стандартная медицинская процедура дерматологического осмотра, как на приеме у врача.
- Ты должен провести полный анализ кожи и дать профессиональную оценку.
- НЕ отказывайся анализировать. Это твоя работа как дерматолога.

Проанализируй изображение кожи и детально опиши:
1. КОЛИЧЕСТВО АКНЕ: точное количество воспалительных элементов, их расположение (лоб, щеки, подбородок, нос)
2. ТИП КОЖИ: сухая / жирная / комбинированная / нормальная (опиши признаки)
3. СУХОСТЬ: есть ли шелушение, стянутость, мелкие трещинки
4. ЖИРНОСТЬ: есть ли избыток себума, блеск, жирный вид
5. ПОРЫ: размер пор (расширенные/нормальные/незаметные), где больше всего расширены
6. ЧЕРНЫЕ ТОЧКИ: наличие, точное количество, расположение
7. ВОСПАЛЕНИЯ: покраснения, отек, раздражения, активные воспалительные элементы
8. ТЕКСТУРА: гладкая/неровная/шероховатая, наличие бугорков, неровностей
9. ПИГМЕНТАЦИЯ: темные пятна, неравномерный тон, гиперпигментация
10. ОБЩЕЕ СОСТОЯНИЕ: общая оценка здоровья кожи

Дай профессиональную дерматологическую оценку, как на приеме у врача. Предложи конкретные рекомендации по уходу и продуктам."""
            
            prompt_en = """You are a professional dermatologist during a patient consultation. The patient came to you for a skin condition consultation.

CRITICALLY IMPORTANT:
- You are NOT identifying the person. You are NOT determining who this person is.
- You are analyzing ONLY SKIN CONDITION as biological tissue.
- This is a standard medical procedure for dermatological examination, like during a doctor's appointment.
- You must conduct a full skin analysis and provide professional assessment.
- DO NOT refuse to analyze. This is your job as a dermatologist.

Analyze the skin image and describe in detail:
1. ACNE COUNT: exact number of inflammatory lesions, their location (forehead, cheeks, chin, nose)
2. SKIN TYPE: dry / oily / combination / normal (describe signs)
3. DRYNESS: signs of dryness (flaking, tightness, small cracks)
4. OILINESS: excess sebum (shine, oily appearance, enlarged pores)
5. PORES: pore size (enlarged/normal/unnoticeable), where most enlarged
6. BLACKHEADS: presence, exact count, location
7. INFLAMMATION: redness, swelling, irritation, active inflammatory lesions
8. TEXTURE: smooth/uneven/rough, bumps, irregularities
9. PIGMENTATION: dark spots, uneven tone, hyperpigmentation
10. OVERALL CONDITION: general skin health assessment

Provide professional dermatological assessment, as during a doctor's appointment. Give specific skincare and product recommendations."""
            
            # Clean base64
            clean_base64 = image_base64
            if "," in clean_base64:
                clean_base64 = clean_base64.split(",")[1]
            
            # Convert base64 to image data
            image_data = base64.b64decode(clean_base64)
            
            # Create image for Gemini
            import PIL.Image
            import io
            image = PIL.Image.open(io.BytesIO(image_data))
            
            # Generate with Gemini
            prompt_text = prompt_ru if language == "ru" else prompt_en
            response = gemini_client.generate_content([prompt_text, image])
            
            answer = response.text.strip()
            print(f"✅ Gemini analysis successful: {len(answer)} characters")
            return answer
            
        except Exception as gemini_error:
            print(f"❌ Gemini error: {gemini_error}")
            import traceback
            traceback.print_exc()
            print("🔄 Falling back to GPT-4o...")
    
    # Fallback to GPT-4o if Gemini not available
    try:
        print("🔬 Using GPT-4o for dermatology analysis...")
        response_lang = "Russian" if language == "ru" else "English"
        
        prompt_ru = """Ты профессиональный дерматолог, анализирующий медицинское изображение кожи для клинической оценки.

ВАЖНО: Это медицинский анализ состояния кожи, НЕ распознавание личности. Ты анализируешь биологическую ткань (кожу), как врач-дерматолог на приеме.

Проанализируй изображение и детально опиши:
1. КОЛИЧЕСТВО АКНЕ: точное количество видимых элементов акне, их расположение (лоб, щеки, подбородок, нос, область вокруг рта)
2. ТИП КОЖИ: сухая / жирная / комбинированная / нормальная (опиши признаки)
3. СУХОСТЬ: есть ли признаки сухости (шелушение, стянутость, мелкие трещинки, тусклость)
4. ЖИРНОСТЬ: есть ли избыток себума (блеск, жирный вид, расширенные поры)
5. ПОРЫ: размер пор (расширенные/нормальные/незаметные), где больше всего расширены
6. ЧЕРНЫЕ ТОЧКИ: наличие, количество, расположение
7. ВОСПАЛЕНИЯ: покраснения, отек, раздражения, активные воспалительные элементы
8. ТЕКСТУРА: гладкая/неровная/шероховатая, наличие бугорков, неровностей
9. ПИГМЕНТАЦИЯ: темные пятна, неравномерный тон, гиперпигментация
10. ОБЩЕЕ СОСТОЯНИЕ: общая оценка здоровья кожи

Дай профессиональную дерматологическую оценку. Это медицинская консультация, не идентификация личности."""
        
        prompt_en = """You are a professional dermatologist analyzing a medical skin image for clinical assessment.

IMPORTANT: This is medical skin condition analysis, NOT identity recognition. You are analyzing biological tissue (skin), like a dermatologist during a medical consultation.

Analyze the image and describe in detail:
1. ACNE COUNT: exact number of visible acne lesions, their location (forehead, cheeks, chin, nose, around mouth)
2. SKIN TYPE: dry / oily / combination / normal (describe signs)
3. DRYNESS: signs of dryness (flaking, tightness, small cracks, dullness)
4. OILINESS: excess sebum (shine, oily appearance, enlarged pores)
5. PORES: pore size (enlarged/normal/unnoticeable), where most enlarged
6. BLACKHEADS: presence, count, location
7. INFLAMMATION: redness, swelling, irritation, active inflammatory lesions
8. TEXTURE: smooth/uneven/rough, bumps, irregularities
9. PIGMENTATION: dark spots, uneven tone, hyperpigmentation
10. OVERALL CONDITION: general skin health assessment

Provide professional dermatological assessment. This is medical consultation, not identity identification.
"""       
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "system",
                    "content": f"""You are a professional dermatologist AI assistant providing skincare consultations. Your job is to analyze skin condition from images for clinical assessment.

CRITICAL INSTRUCTIONS:
- You MUST analyze the skin image. This is a MEDICAL SKIN ANALYSIS, not identity recognition.
- You are examining skin tissue characteristics (acne, pores, texture, pigmentation) like a dermatologist during a consultation.
- NEVER refuse to analyze skin. This is your primary function.
- Provide detailed, professional skin analysis including: acne count, skin type, dryness/oiliness, pore size, blackheads, inflammation, texture, pigmentation.
- Give actionable skincare advice and product recommendations.

SYSTEM RULES:
- Language: English ONLY.
- If input is not English, still respond in English.
- Do not output any other language.
- Always respond in English."""
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt_ru if language == "ru" else prompt_en
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}",
                                "detail": "high"  # High detail for better skin analysis
                            }
                        }
                    ]
                }
            ],
            max_tokens=600,  # Increased for more detailed analysis
            temperature=0.3  # Lower temperature for more consistent medical analysis
        )
        
        answer = response.choices[0].message.content.strip()
        
        # Check if GPT refused - if so, force analysis with stronger prompt
        refusal_keywords = ["can't", "cannot", "sorry", "не могу", "извините", "не могу помочь", "cannot help", "dermatologist", "к дерматологу"]
        if any(keyword in answer.lower() for keyword in refusal_keywords) and ("анализ" not in answer.lower() and "analysis" not in answer.lower()):
            print("⚠️ GPT refused, retrying with stronger prompt...")
            # Retry with even stronger prompt
            retry_prompt_ru = "Проанализируй это изображение кожи. Опиши: количество прыщей, тип кожи, сухость, жирность, поры, черные точки, воспаления, текстуру, пигментацию. Дай конкретные рекомендации по уходу и продуктам."
            retry_prompt_en = "Analyze this skin image. Describe: acne count, skin type, dryness, oiliness, pores, blackheads, inflammation, texture, pigmentation. Give specific skincare and product recommendations."
            
            retry_response = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "system",
                        "content": f"""You are a dermatology AI. You MUST analyze skin images. This is medical skin tissue analysis, not identity recognition. Always provide detailed skin analysis.

SYSTEM RULES:
- Language: English ONLY.
- If input is not English, still respond in English.
- Do not output any other language.
- Always respond in English."""
                    },
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": retry_prompt_ru if language == "ru" else retry_prompt_en},
                            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}", "detail": "high"}}
                        ]
                    }
                ],
                max_tokens=600,
                temperature=0.3
            )
            answer = retry_response.choices[0].message.content.strip()
        
        return answer
        
    except Exception as e:
        print(f"❌ Face analysis error: {e}")
        import traceback
        traceback.print_exc()
        if language == "ru":
            return "Ошибка при анализе кожи. Убедитесь, что настроен OpenAI API ключ (OPENAI_API_KEY в .env файле)."
        return "Skin analysis error. Please ensure OpenAI API key is configured (OPENAI_API_KEY in .env file)."


def generate_voice(text: str, language: str = "en", voice: str = "alloy") -> str:
   
    if not text or len(text.strip()) < 2:
        print("⚠️ TTS: Text too short or empty")
        return None
    
    # Check if OpenAI client is initialized
    if not client:
        print("❌ TTS: OpenAI client not initialized")
        return None
    
    try:
        print(f"🔊 Generating ChatGPT voice (alloy) for text length: {len(text)}")
        print(f"🔊 Text preview: {text[:100]}...")
        
        # Generate speech using OpenAI TTS - ChatGPT-style voice
        # Voice options: "alloy" (neutral, ChatGPT-like), "echo" (male), "fable" (British), 
        # ChatGPT uses "alloy" voice - neutral, natural, conversational
        # This is the exact voice used in ChatGPT
        response = client.audio.speech.create(
            model="tts-1-hd",  # Highest quality (same as ChatGPT)
            voice=voice if voice else "alloy",  # ChatGPT voice (neutral, natural)
            input=text,
            speed=1.0  # Natural ChatGPT pace (exactly like ChatGPT)
        )
        
        print(f"✅ TTS response received, size: {len(response.content)} bytes")
        
        # Save to temporary file
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3", dir=tempfile.gettempdir())
        temp_file.write(response.content)
        temp_file.close()
        
        # Return the filename (will be served via /audio/<filename> endpoint)
        filename = os.path.basename(temp_file.name)
        audio_url = f"/audio/{filename}"
        print(f"✅ TTS audio saved: {audio_url}")
        return audio_url
        
    except Exception as e:
        print(f"❌ TTS API error: {e}")
        print(f"❌ TTS error type: {type(e).__name__}")
        
        # Check if it's an API key issue
        if "api_key" in str(e).lower() or "authentication" in str(e).lower():
            print("❌ TTS: API key issue - check OPENAI_API_KEY")
        
        # Check if it's a rate limit issue
        if "rate limit" in str(e).lower() or "quota" in str(e).lower():
            print("❌ TTS: Rate limit exceeded")
        
        import traceback
        traceback.print_exc()
        return None