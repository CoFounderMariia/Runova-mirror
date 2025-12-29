#!/usr/bin/env python3
"""
Quick script to update product images in products.json
Usage: python3 update_product_images.py
"""

import json
from pathlib import Path

def update_product_image(category, asin=None, image_url=None):
    """
    Update product image in products.json
    
    Args:
        category: Product category (e.g., "oily_skin", "dry_skin")
        asin: Amazon ASIN (will construct URL automatically)
        image_url: Direct image URL (if provided, ASIN is ignored)
    """
    products_file = Path("products.json")
    
    if not products_file.exists():
        print("❌ products.json not found!")
        return
    
    # Load products
    with open(products_file, 'r') as f:
        products = json.load(f)
    
    if category not in products:
        print(f"❌ Category '{category}' not found in products.json")
        print(f"Available categories: {list(products.keys())}")
        return
    
    # Determine image URL
    if image_url:
        final_url = image_url
    elif asin:
        # Construct Amazon image URL
        final_url = f"https://m.media-amazon.com/images/I/{asin}._AC_SL1500_.jpg"
    else:
        print("❌ Please provide either ASIN or image_url")
        return
    
    # Update image
    old_image = products[category].get("image", "Not set")
    products[category]["image"] = final_url
    
    # Save
    with open(products_file, 'w') as f:
        json.dump(products, f, indent=2)
    
    print(f"✅ Updated {category}:")
    print(f"   Old: {old_image}")
    print(f"   New: {final_url}")

def show_current_images():
    """Show all current product images"""
    products_file = Path("products.json")
    
    if not products_file.exists():
        print("❌ products.json not found!")
        return
    
    with open(products_file, 'r') as f:
        products = json.load(f)
    
    print("\n📦 Current Product Images:\n")
    for category, product in products.items():
        image = product.get("image", "❌ Not set")
        name = product.get("name", "Unknown")
        print(f"{category}:")
        print(f"  Name: {name}")
        print(f"  Image: {image}")
        print()

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        if sys.argv[1] == "show":
            show_current_images()
        elif len(sys.argv) >= 3:
            category = sys.argv[1]
            if sys.argv[2].startswith("http"):
                # It's a URL
                update_product_image(category, image_url=sys.argv[2])
            else:
                # It's an ASIN
                update_product_image(category, asin=sys.argv[2])
        else:
            print("Usage:")
            print("  python3 update_product_images.py show")
            print("  python3 update_product_images.py <category> <ASIN>")
            print("  python3 update_product_images.py <category> <image_url>")
            print("\nExample:")
            print("  python3 update_product_images.py oily_skin B07RJ18VMF")
            print("  python3 update_product_images.py dry_skin https://example.com/image.jpg")
    else:
        show_current_images()
        print("\nTo update an image:")
        print("  python3 update_product_images.py <category> <ASIN or URL>")
        print("\nExample:")
        print("  python3 update_product_images.py oily_skin B07RJ18VMF")

















