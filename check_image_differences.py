#!/usr/bin/env python3
"""
Quick script to check if different images are being sent to the API.
Run this and check the server logs for image hashes.
"""

import re
from pathlib import Path

def check_logs_for_image_hashes():
    """Check recent logs for image hashes to see if they're different"""
    log_dir = Path("logs")
    if not log_dir.exists():
        print("❌ Logs directory not found")
        return
    
    # Find most recent log file
    log_files = sorted(log_dir.glob("youcam_api_*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
    
    if not log_files:
        print("❌ No log files found")
        return
    
    latest_log = log_files[0]
    print(f"📄 Checking log file: {latest_log}")
    print("=" * 80)
    
    # Read log and extract image hashes
    with open(latest_log, 'r') as f:
        content = f.read()
    
    # Find all image hash entries
    hash_pattern = r'Image received: (\d+) bytes, hash: ([a-f0-9]+)'
    matches = re.findall(hash_pattern, content)
    
    if not matches:
        print("⚠️ No image hash entries found in log")
        print("   Make sure you've run skin analysis at least once")
        return
    
    print(f"✅ Found {len(matches)} image captures:")
    print()
    
    unique_hashes = set()
    for i, (size, hash_val) in enumerate(matches, 1):
        unique_hashes.add(hash_val)
        print(f"  {i}. Size: {size} bytes, Hash: {hash_val}")
    
    print()
    print("=" * 80)
    if len(unique_hashes) == 1:
        print("❌ PROBLEM: All images have the SAME hash!")
        print("   This means the same image is being sent every time.")
        print("   Check the frontend code - video capture may not be working.")
    elif len(unique_hashes) == len(matches):
        print(f"✅ GOOD: All {len(matches)} images have DIFFERENT hashes")
        print("   Different images are being sent correctly.")
    else:
        print(f"⚠️ WARNING: {len(unique_hashes)} unique hashes out of {len(matches)} captures")
        print("   Some images are duplicates.")

if __name__ == "__main__":
    check_logs_for_image_hashes()







