import sounddevice as sd
import numpy as np
import requests
import tempfile
import wave
import time
import openai
from pynput import keyboard
from threading import Event, Thread
import queue
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# -----------------------------
#  CONFIG
# -----------------------------
openai.api_key = os.getenv("OPENAI_API_KEY", "YOUR_OPENAI_API_KEY")
RUNOVA_API = "http://127.0.0.1:5001/ask"  # эндпоинт Runova Flask


# -----------------------------
#  RECORD AUDIO (push-to-talk)
# -----------------------------
def record_audio_until_stop(stop_event, fs=16000):
    """Record audio until stop_event is set"""
    print("🎤 Listening... (V key held)")
    
    audio_chunks = []
    
    def audio_callback(indata, frames, time, status):
        if status:
            print(f"⚠️ Audio status: {status}")
        audio_chunks.append(indata.copy())
    
    stream = sd.InputStream(samplerate=fs, channels=1, dtype='int16', 
                           callback=audio_callback, blocksize=int(fs * 0.1))
    
    stream.start()
    
    # Wait until stop_event is set
    stop_event.wait()
    
    stream.stop()
    stream.close()
    
    if not audio_chunks:
        return None
    
    # Concatenate all audio chunks
    audio = np.concatenate(audio_chunks, axis=0)
    
    # Save to temporary WAV file
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".wav")
    with wave.open(tmp.name, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(fs)
        wf.writeframes(audio.tobytes())
    
    duration = len(audio) / fs
    print(f"✅ Recorded {duration:.2f} seconds")
    return tmp.name


# -----------------------------
#  TRANSCRIBE WITH WHISPER
# -----------------------------
def transcribe_audio(path):
    print("🧠 Transcribing with Whisper...")

    with open(path, "rb") as f:
        transcript = openai.audio.transcriptions.create(
            model="gpt-4o-transcribe",
            file=f
        )

    text = transcript.text.strip()
    print("🔎 You said:", text)
    return text


# -----------------------------
#  SEND TO RUNOVA BACKEND
# -----------------------------
def ask_runova(question):
    print("📡 Sending to Runova…")

    resp = requests.post(RUNOVA_API, json={"question": question})

    if resp.status_code != 200:
        print("❌ Server error:", resp.text)
        return "Error"

    answer = resp.json().get("answer", "No answer")
    print("💡 Runova:", answer)
    return answer


# -----------------------------
#  MAIN LOOP (Push-to-Talk with V key)
# -----------------------------

class VoiceListener:
    def __init__(self):
        self.is_recording = False
        self.stop_event = None
        self.recording_thread = None
        self.audio_queue = queue.Queue()
        
    def on_press(self, key):
        """Called when a key is pressed"""
        try:
            # Check if V key is pressed
            if key.char == 'v' or key.char == 'V':
                if not self.is_recording:
                    self.is_recording = True
                    self.stop_event = Event()
                    
                    # Start recording in a separate thread
                    self.recording_thread = Thread(
                        target=self._record_audio,
                        args=(self.stop_event,)
                    )
                    self.recording_thread.start()
        except AttributeError:
            # Special keys don't have .char attribute
            pass
    
    def on_release(self, key):
        """Called when a key is released"""
        try:
            # Check if V key is released
            if key.char == 'v' or key.char == 'V':
                if self.is_recording:
                    self.is_recording = False
                    # Signal to stop recording
                    if self.stop_event:
                        self.stop_event.set()
                    
                    # Wait for recording to finish and process
                    if self.recording_thread:
                        self.recording_thread.join(timeout=5)
                    
                    # Process the recorded audio
                    if not self.audio_queue.empty():
                        audio_path = self.audio_queue.get()
                        if audio_path:
                            text = transcribe_audio(audio_path)
                            if text.strip() != "":
                                ask_runova(text)
        except AttributeError:
            # Special keys don't have .char attribute
            pass
        
        # Stop listener if ESC is pressed
        if key == keyboard.Key.esc:
            return False
    
    def _record_audio(self, stop_event):
        """Record audio in a separate thread"""
        try:
            audio_path = record_audio_until_stop(stop_event)
            if audio_path:
                self.audio_queue.put(audio_path)
        except Exception as e:
            print(f"⚠️ Recording error: {e}")
            self.audio_queue.put(None)


if __name__ == "__main__":
    print("🎧 Runova Voice Listener Started.")
    print("Press and hold V to talk → release to stop.")
    print("Press ESC to exit.")
    
    listener_obj = VoiceListener()
    
    # Set up keyboard listener
    with keyboard.Listener(
        on_press=listener_obj.on_press,
        on_release=listener_obj.on_release
    ) as listener:
        try:
            listener.join()
        except KeyboardInterrupt:
            print("\n🛑 Stopped.")
