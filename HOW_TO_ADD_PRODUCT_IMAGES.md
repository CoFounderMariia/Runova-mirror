# How to Add Product Images

## Method 1: Using Amazon Product Image URLs (Recommended)

### Step 1: Get the Amazon Product ASIN
1. Go to the Amazon product page
2. Find the ASIN in the product details (e.g., `B07RJ18VMF`)
3. Or extract it from the product URL: `https://www.amazon.com/dp/B07RJ18VMF`

### Step 2: Construct the Image URL
Amazon image URLs follow this pattern:
```
https://m.media-amazon.com/images/I/{ASIN}._AC_SL1500_.jpg
```

Example:
- ASIN: `B07RJ18VMF`
- Image URL: `https://m.media-amazon.com/images/I/B07RJ18VMF._AC_SL1500_.jpg`

### Step 3: Update products.json
Edit `/Users/mary/runova_mirror/products.json`:

```json
{
  "oily_skin": {
    "name": "CeraVe Foaming Facial Cleanser",
    "description": "Oil-free, non-comedogenic, removes excess oil without over-drying",
    "price": "$14.99",
    "image": "https://m.media-amazon.com/images/I/B07RJ18VMF._AC_SL1500_.jpg",
    "link": "https://www.amazon.com/dp/B07RJ18VMF"
  }
}
```

## Method 2: Using Local Images

### Step 1: Add Images to Static Folder
1. Create directory: `static/images/products/`
2. Add your product images (e.g., `cerave-foaming.jpg`)

### Step 2: Update products.json
Use relative paths:

```json
{
  "oily_skin": {
    "name": "CeraVe Foaming Facial Cleanser",
    "image": "/static/images/products/cerave-foaming.jpg",
    "link": "https://www.amazon.com/dp/B07RJ18VMF"
  }
}
```

## Method 3: Using Any Image URL

You can use any publicly accessible image URL:

```json
{
  "oily_skin": {
    "name": "Product Name",
    "image": "https://example.com/product-image.jpg",
    "link": "https://www.amazon.com/dp/ASIN"
  }
}
```

## Quick Guide: Finding Amazon Product Images

### Option A: From Product Page
1. Open Amazon product page
2. Right-click on the main product image
3. Select "Copy image address"
4. Use that URL in `products.json`

### Option B: Using ASIN
1. Get ASIN from product URL or details
2. Use format: `https://m.media-amazon.com/images/I/{ASIN}._AC_SL1500_.jpg`
3. Replace `{ASIN}` with actual ASIN

### Option C: Extract from PDF
If you have product links in PDF:
1. Extract ASIN from URL (10 characters after `/dp/`)
2. Construct image URL using the pattern above

## Current Image URLs in products.json

Your current products.json already has image URLs:
- ✅ `oily_skin`: `B07RJ18VMF`
- ✅ `dry_skin`: `B0CTTDLQF3`
- ✅ `acne_breakout`: `B0F3CD1Y9B`
- ✅ `sensitive_skin`: `B01N7T7JKJ`
- ✅ `anti_aging`: `B07XJ8XJ8X`

## Troubleshooting

### Images Not Showing?
1. **Check browser console** (F12) for errors
2. **Verify URL is accessible**: Open image URL directly in browser
3. **Check CORS**: Amazon images should work, but some external URLs might have CORS issues
4. **Verify JSON format**: Make sure `"image"` field is a string with quotes

### Test Image URL
Open this in your browser to test:
```
https://m.media-amazon.com/images/I/B07RJ18VMF._AC_SL1500_.jpg
```

If it shows the product image, the URL is correct!

## Example: Complete Product Entry

```json
{
  "oily_skin": {
    "name": "CeraVe Foaming Facial Cleanser",
    "description": "Oil-free, non-comedogenic, removes excess oil without over-drying",
    "price": "$14.99",
    "image": "https://m.media-amazon.com/images/I/B07RJ18VMF._AC_SL1500_.jpg",
    "link": "https://www.amazon.com/dp/B07RJ18VMF"
  }
}
```

## Notes

- Images are displayed at **80×80px** with `object-fit: contain`
- If image fails to load, a gray placeholder will show
- Supported formats: JPG, PNG, GIF, WebP
- Maximum recommended size: 500×500px (will be scaled down)










