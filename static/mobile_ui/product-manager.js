/**
 * Product Recommendation Manager
 * Handles product cards display
 */

class ProductManager {
    constructor() {
        this.recommendationsSection = null;
        this.init();
    }
    
    init() {
        // Wait for DOM to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.findSection());
        } else {
            this.findSection();
        }
    }
    
    findSection() {
        this.recommendationsSection = document.getElementById('recommendationsSection');
        if (!this.recommendationsSection) {
            console.warn('⚠️ recommendationsSection not found, will retry when needed');
            console.warn('   Searching for element with id="recommendationsSection"');
            // Try alternative selectors
            this.recommendationsSection = document.querySelector('#recommendationsSection') || 
                                         document.querySelector('.recommendations-section');
        } else {
            console.log('✅ recommendationsSection found in DOM');
        }
    }

    addProductCard(product, index = 0) {
        // Ensure section exists
        if (!this.recommendationsSection) {
            this.findSection();
        }
        
        if (!this.recommendationsSection) {
            console.error('❌ Cannot add product card: recommendationsSection not found');
            return;
        }
        
        // CRITICAL: Create a deep copy of product data to avoid shared state
        // This ensures each card gets its own unique data, including image URL
        const productCopy = {
            name: String(product.name || ''),
            description: String(product.description || product.benefits || ''),
            price: String(product.price || 'Check price'),
            image: String(product.image || product.image_url || ''),  // Explicitly get image URL
            link: String(product.link || '')
        };
        
        // Clean product data from ** formatting
        if (productCopy.name) {
            productCopy.name = productCopy.name.replace(/\*\*/g, "");
        }
        if (productCopy.description) {
            productCopy.description = productCopy.description.replace(/\*\*/g, "");
        }
        
        console.log(`🛍️ Adding product card ${index + 1}:`, productCopy.name);
        console.log(`   Image URL for card ${index + 1} (FULL):`, productCopy.image || 'EMPTY');
        
        // Check if title exists, if not create it
        let title = this.recommendationsSection.querySelector('.recommendations-title');
        if (!title) {
            title = document.createElement('div');
            title.className = 'recommendations-title';
            title.textContent = 'Recommended Products';
            this.recommendationsSection.insertBefore(title, this.recommendationsSection.firstChild);
        }

        // Check if products container exists, if not create it
        let productsContainer = this.recommendationsSection.querySelector('.products-container');
        if (!productsContainer) {
            productsContainer = document.createElement('div');
            productsContainer.className = 'products-container';
            this.recommendationsSection.appendChild(productsContainer);
        }

        const card = document.createElement('div');
        card.className = 'product-card';
        
        // Use a simple fallback image (SVG data URI that always works)
        const fallbackImage = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="80" height="80" fill="%23e0e0e0"/%3E%3Ctext x="50%25" y="50%25" text-anchor="middle" dy=".3em" font-size="10" fill="%23999"%3ENo Image%3C/text%3E%3C/svg%3E';
        
        // Handle image URL: check both product.image and product.image_url
        // Backend sends "image" field, but we also check "image_url" for compatibility
        let imageUrl = fallbackImage;
        const imageSource = product.image || product.image_url || '';
        
        // Validate image source - must be non-empty and not just whitespace
        if (imageSource && typeof imageSource === 'string' && imageSource.trim() !== '') {
            const trimmedSource = imageSource.trim();
            
            // Additional validation: check if it's a valid URL pattern
            const isValidUrlPattern = trimmedSource.startsWith('/proxy-image') ||
                                     trimmedSource.startsWith('http://') ||
                                     trimmedSource.startsWith('https://') ||
                                     trimmedSource.startsWith('/') ||
                                     trimmedSource.match(/^[a-zA-Z0-9]/); // Basic check for non-empty non-whitespace
            
            if (isValidUrlPattern) {
                // Add UNIQUE cache-busting query parameter per product to prevent stale images
                // CRITICAL: Use timestamp + index + random, but don't truncate the original URL
                const timestamp = Date.now();
                const randomStr = Math.random().toString(36).substr(2, 9);
                const cacheBusterValue = `${timestamp}_${index}_${randomStr}`;
                
                try {
                    if (trimmedSource.startsWith('/proxy-image')) {
                        // Proxy URL from backend - add unique cache-busting parameter
                        // CRITICAL: Preserve the FULL URL, don't truncate anything
                        const separator = trimmedSource.includes('?') ? '&' : '?';
                        imageUrl = `${window.location.origin}${trimmedSource}${separator}t=${cacheBusterValue}`;
                    } else if (trimmedSource.startsWith('http://') || trimmedSource.startsWith('https://')) {
                        // Full external URL - convert to proxy URL to bypass CORS + unique cache-busting
                        // CRITICAL: Use encodeURIComponent to preserve the ENTIRE URL including _SL1500_.jpg
                        const encodedUrl = encodeURIComponent(trimmedSource);
                        imageUrl = `${window.location.origin}/proxy-image?url=${encodedUrl}&t=${cacheBusterValue}`;
                    } else if (trimmedSource.startsWith('/')) {
                        // Relative path - make absolute + unique cache-busting
                        const separator = trimmedSource.includes('?') ? '&' : '?';
                        imageUrl = `${window.location.origin}${trimmedSource}${separator}t=${cacheBusterValue}`;
                    } else {
                        // Try as-is (might be a valid URL without protocol) + unique cache-busting
                        const separator = trimmedSource.includes('?') ? '&' : '?';
                        imageUrl = `${trimmedSource}${separator}t=${cacheBusterValue}`;
                    }
                } catch (e) {
                    console.warn(`⚠️ Error processing image URL for ${productCopy.name}:`, e);
                    imageUrl = fallbackImage; // Fallback on error
                }
            } else {
                console.warn(`⚠️ Invalid image URL pattern for ${productCopy.name}`);
                imageUrl = fallbackImage; // Use fallback for invalid patterns
            }
        } else {
            // No valid image source - use fallback
            console.log(`ℹ️ No image URL provided for ${product.name}, using fallback`);
        }
        
        // This logging is now done above with FULL URLs, so this is redundant but kept for compatibility
        // The actual logging with FULL URLs happens in the section above
        
        const description = productCopy.description || productCopy.benefits || '';
        
        // Build HTML with proper image container and tag
        const imageContainer = document.createElement('div');
        imageContainer.className = 'product-image-container';
        
        // CRITICAL: Create a stable, unique cardId for this specific card
        // This ensures handlers are bound to the correct card and don't get reused
        const cardId = `card-${index}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const productName = productCopy.name || 'Unknown';
        
        const imgTag = document.createElement('img');
        imgTag.alt = productName;
        imgTag.className = 'product-image';
        imgTag.loading = 'lazy';
        
        // CRITICAL: Store product name, index, and cardId on the image element
        // Store FULL URL, no truncation
        imgTag.setAttribute('data-product-name', productName);
        imgTag.setAttribute('data-card-index', String(index));
        imgTag.setAttribute('data-card-id', cardId);
        imgTag.setAttribute('data-image-url', imageUrl); // FULL URL, no substring
        
        // Store reference to cancel if needed - scoped to this specific card
        let imageLoadCancelled = false;
        
        // Error handling for image load with retry logic - scoped to this card
        let retryCount = 0;
        const maxRetries = 2;
        
        // CRITICAL: Create a closure that captures cardId and productName
        // This ensures the handler always references the correct card, not a reused one
        imgTag.onerror = (function(cardId, productName, cardIndex, originalImageUrl, originalImageSource) {
            return function() {
                // Verify this is still the correct card (check cardId matches)
                const currentCardId = this.getAttribute('data-card-id');
                if (currentCardId !== cardId) {
                    console.error(`❌ Card ID mismatch! Expected ${cardId}, got ${currentCardId}`);
                    return; // Don't process if card ID doesn't match
                }
                
                if (!imageLoadCancelled) {
                    retryCount++;
                    console.error(`❌ Image failed to load for card ${cardIndex} (${productName}, cardId: ${cardId}, attempt ${retryCount}/${maxRetries + 1}):`, originalImageUrl.substring(0, 100));
                    
                    // Try retry if we haven't exceeded max retries and URL is valid
                    if (retryCount <= maxRetries && originalImageSource && originalImageSource.trim() !== '' && originalImageSource !== fallbackImage) {
                        // Add a longer delay before retry
                        setTimeout(() => {
                            // Double-check card ID still matches before retry
                            const stillCardId = this.getAttribute('data-card-id');
                            if (stillCardId === cardId && !imageLoadCancelled) {
                                // Add a new cache-busting parameter for retry
                                // CRITICAL: Preserve FULL URL, don't truncate
                                const retryTimestamp = Date.now();
                                const retryRandom = Math.random().toString(36).substr(2, 9);
                                const separator = originalImageUrl.includes('?') ? '&' : '?';
                                const retryUrl = `${originalImageUrl}${separator}retry=${retryTimestamp}_${retryRandom}`;
                                console.log(`🔄 Retrying image load for card ${cardIndex} (${productName}, cardId: ${cardId})`);
                                console.log(`   Retry URL (FULL): ${retryUrl}`);
                                this.src = retryUrl;
                            } else {
                                console.warn(`⚠️ Skipping retry - card ID changed or cancelled (was ${cardId}, now ${stillCardId})`);
                            }
                        }, 500 * retryCount); // Exponential backoff: 500ms, 1000ms
                    } else {
                        // Max retries exceeded or invalid URL - use fallback
                        console.warn(`⚠️ Using fallback image for card ${cardIndex} (${productName}, cardId: ${cardId})`);
                        this.onerror = null; // Prevent infinite loop
                        this.src = fallbackImage;
                    }
                }
            };
        })(cardId, productName, index, imageUrl, imageSource);
        
        // Success logging with product identification - also scoped to cardId
        imgTag.onload = (function(cardId, productName, cardIndex, originalImageUrl) {
            return function() {
                // Verify this is still the correct card
                const currentCardId = this.getAttribute('data-card-id');
                if (currentCardId !== cardId) {
                    console.warn(`⚠️ Card ID mismatch on load! Expected ${cardId}, got ${currentCardId}`);
                    return;
                }
                
                if (!imageLoadCancelled) {
                    console.log(`✅ Image loaded successfully for card ${cardIndex} (${productName}, cardId: ${cardId})`);
                    console.log(`   Loaded URL (FULL): ${originalImageUrl}`);
                }
            };
        })(cardId, productName, index, imageUrl);
        
        // CRITICAL: Set src AFTER setting up handlers (prevents race conditions)
        // Use the specific imageUrl for THIS card, not a shared variable
        imgTag.src = imageUrl;
        
        // Verify the image URL is set correctly and cardId is bound
        console.log(`   ✅ Set img.src for card ${index + 1} (${productCopy.name}, cardId: ${cardId})`);
        console.log(`   img.src (FULL): ${imgTag.src}`);
        console.log(`   Card ID bound: ${imgTag.getAttribute('data-card-id')}`);
        
        // Store cancellation function on the image element
        imgTag._cancelLoad = function() {
            imageLoadCancelled = true;
            this.onload = null;
            this.onerror = null;
            this.src = '';
        };
        
        // Add image to container
        imageContainer.appendChild(imgTag);
        
        // Format price - hide "Price not available" and show "Check price" instead
        let displayPrice = productCopy.price || 'Check price';
        if (displayPrice.toLowerCase().includes('not available') || displayPrice.toLowerCase().includes('price not')) {
            displayPrice = 'Check price';
        }
        
        card.innerHTML = `
            <div class="product-info">
                <div class="product-name">${productCopy.name || 'Product'}</div>
                <div class="product-price">${displayPrice}</div>
                <div class="product-description">${description}</div>
            </div>
        `;
        
        // Insert image container at the beginning
        card.insertBefore(imageContainer, card.firstChild);
        
        // CRITICAL: Store product data on the card for verification
        // Use the same cardId that was set on the image
        const storedCardId = imageContainer.querySelector('img')?.getAttribute('data-card-id') || cardId;
        card.setAttribute('data-product-name', productCopy.name);
        card.setAttribute('data-card-index', String(index));
        card.setAttribute('data-card-id', storedCardId);
        card.setAttribute('data-image-url', imageUrl); // FULL URL, no substring
        
        // Make entire card clickable if link exists
        if (productCopy.link && productCopy.link.trim() !== '') {
            card.setAttribute('data-clickable', 'true');
            card.style.cursor = 'pointer';
            card.setAttribute('title', 'Click to view on Amazon');
            card.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('🔗 Opening product link:', productCopy.link);
                window.open(productCopy.link, '_blank', 'noopener,noreferrer');
            });
            // Add visual feedback on hover
            card.addEventListener('mouseenter', () => {
                card.style.transform = 'translateY(-2px)';
                card.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = 'translateY(0)';
                card.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
            });
        } else {
            card.setAttribute('data-clickable', 'false');
            card.style.cursor = 'default';
        }
        
        // Debug: Log product data to ensure everything is present
        console.log(`📦 Product card ${index + 1} created:`, {
            name: productCopy.name,
            price: displayPrice,
            hasImage: !!imageSource,
            hasLink: !!(productCopy.link && productCopy.link.trim()),
            imageUrl: imageUrl, // FULL URL, no truncation
            cardIndex: index
        });
        
        // Final verification: Check that the image element has the correct URL
        const cardImage = card.querySelector('img');
        if (cardImage) {
            console.log(`   🔍 Verification: Card ${index + 1} img.src (FULL) = ${cardImage.src}`);
            console.log(`   🔍 Verification: Card ${index + 1} expected URL (FULL) = ${imageUrl}`);
            if (cardImage.src !== imageUrl && !cardImage.src.includes(imageUrl.split('?')[0])) {
                console.error(`   ❌ MISMATCH: Card ${index + 1} image URL doesn't match!`);
            }
        }

        productsContainer.appendChild(card);
        
        // Debug: Verify card was added
        const cardsInContainer = productsContainer.querySelectorAll('.product-card').length;
        console.log(`✅ Card ${index + 1} added to container. Total cards in container: ${cardsInContainer}`);
        
        // DO NOT automatically show section - only show when user explicitly requests recommendations
        // Section will be shown via showRecommendations() method when user asks for product recommendations
        
        // Debug: Verify section is visible and has correct structure
        console.log(`📊 Section state:`, {
            display: this.recommendationsSection.style.display,
            visibility: window.getComputedStyle(this.recommendationsSection).visibility,
            opacity: window.getComputedStyle(this.recommendationsSection).opacity,
            childrenCount: this.recommendationsSection.children.length,
            containerExists: !!productsContainer,
            cardsInContainer: cardsInContainer
        });
    }

    /**
     * Show recommendations section (only when user explicitly requests recommendations)
     */
    showRecommendations() {
        // NOTE: Do NOT stop voice here - audio should continue playing when recommendations appear
        // The audio is already being managed by the global voice controller in app.js
        
        console.log('🔍 showRecommendations() called');
        if (!this.recommendationsSection) {
            console.log('⚠️ recommendationsSection not found, trying to find it...');
            this.findSection();
        }
        if (this.recommendationsSection) {
            console.log('✅ recommendationsSection found:', this.recommendationsSection);
            // Ensure close button exists
            let header = this.recommendationsSection.querySelector('.recommendations-header');
            if (!header) {
                console.log('➕ Creating recommendations header with close button...');
                header = document.createElement('div');
                header.className = 'recommendations-header';
                const closeBtn = document.createElement('button');
                closeBtn.id = 'recommendationsClose';
                closeBtn.className = 'skin-results-close';
                closeBtn.innerHTML = '&times;';
                closeBtn.addEventListener('click', () => {
                    this.recommendationsSection.style.display = 'none';
                });
                header.appendChild(closeBtn);
                this.recommendationsSection.insertBefore(header, this.recommendationsSection.firstChild);
            }
            // Force display with flex for proper layout (title at top, cards below)
            this.recommendationsSection.style.setProperty('display', 'flex', 'important');
            this.recommendationsSection.style.setProperty('flex-direction', 'column', 'important');
            this.recommendationsSection.style.setProperty('justify-content', 'flex-start', 'important');
            console.log('✅ Recommendations section displayed. Current display:', window.getComputedStyle(this.recommendationsSection).display);
            console.log('✅ Section has children:', this.recommendationsSection.children.length);
        } else {
            console.error('❌ Cannot show recommendations: recommendationsSection not found!');
        }
    }

    addProducts(products) {
        // Add multiple products at once
        if (!products || !Array.isArray(products) || products.length === 0) {
            console.warn('⚠️ No products to add');
            return;
        }
        
        console.log(`🛍️ NEW RECOMMENDATION REQUEST: Adding ${products.length} product cards...`);
        console.log('📦 Products received from backend:', JSON.stringify(products, null, 2));
        
        // CRITICAL: Clear ALL previous products FIRST (atomic operation)
        this.clear();
        
        // Wait longer to ensure DOM is fully cleared and all image loads are cancelled
        setTimeout(() => {
            // Double-check that section is still empty (prevent race conditions)
            if (this.recommendationsSection && this.recommendationsSection.children.length > 0) {
                console.warn('⚠️ Section not empty after clear, forcing re-clear...');
                this.clear();
            }
            
            // Validate all products before rendering
            const validProducts = products.filter(p => p && (p.name || p.image || p.link));
            if (validProducts.length === 0) {
                console.warn('⚠️ No valid products to render');
                return;
            }
            
            console.log(`✅ Cleared old cards, rendering ${validProducts.length} NEW products:`, validProducts.map(p => p.name));
            
            // Add each product with unique cache-busting timestamp
            validProducts.forEach((product, index) => {
                // Add small delay between cards to ensure proper rendering order
                setTimeout(() => {
                    this.addProductCard(product, index);
                    
                    // After all cards are added, verify they're all in DOM
                    if (index === validProducts.length - 1) {
                        setTimeout(() => {
                            const finalCards = this.recommendationsSection.querySelectorAll('.product-card');
                            const finalContainer = this.recommendationsSection.querySelector('.products-container');
                            console.log(`🔍 FINAL VERIFICATION:`, {
                                expectedCards: validProducts.length,
                                actualCards: finalCards.length,
                                containerExists: !!finalContainer,
                                containerChildren: finalContainer ? finalContainer.children.length : 0,
                                sectionChildren: this.recommendationsSection.children.length,
                                cardNames: Array.from(finalCards).map(c => c.querySelector('.product-name')?.textContent || 'N/A')
                            });
                            
                            if (finalCards.length !== validProducts.length) {
                                console.error(`❌ MISMATCH: Expected ${validProducts.length} cards, but found ${finalCards.length} in DOM!`);
                            }
                        }, 100);
                    }
                }, index * 20); // 20ms delay between each card
            });
            
            console.log(`✅ Successfully initiated rendering of ${validProducts.length} NEW product cards`);
            
            // Show recommendations section after products are added
            // Use setTimeout to ensure DOM is updated
            setTimeout(() => {
                this.showRecommendations();
            }, 150);
        }, 100); // Increased to 100ms to ensure clearing is complete
    }

    clear() {
        console.log('🧹 CLEARING ALL PRODUCT CARDS - Starting atomic clear operation...');
        
        if (!this.recommendationsSection) {
            this.findSection();
        }
        
        if (!this.recommendationsSection) {
            console.warn('⚠️ Cannot clear: recommendationsSection not found');
            return;
        }
        
        // Log current state BEFORE clearing
        const beforeChildren = this.recommendationsSection.children.length;
        const beforeImages = this.recommendationsSection.querySelectorAll('img').length;
        const beforeCards = this.recommendationsSection.querySelectorAll('.product-card').length;
        console.log(`📊 Before clear: ${beforeChildren} children, ${beforeImages} images, ${beforeCards} cards`);
        
        // Step 1: Cancel all pending image loads FIRST (critical to prevent old images loading)
        const allImages = this.recommendationsSection.querySelectorAll('img');
        console.log(`🖼️ Cancelling ${allImages.length} pending image loads...`);
        allImages.forEach((img, idx) => {
            // Use cancellation function if available
            if (img._cancelLoad && typeof img._cancelLoad === 'function') {
                img._cancelLoad();
            } else {
                // Fallback: cancel manually
                img.onload = null;
                img.onerror = null;
                img.src = '';
            }
        });
        
        // Step 2: Remove all child elements (title, products container, all cards)
        // Use multiple methods to ensure complete removal
        let removedCount = 0;
        
        // Method 1: Cancel all image loads and remove event listeners
        const allCards = this.recommendationsSection.querySelectorAll('.product-card');
        allCards.forEach(card => {
            // Cancel any image loads within this card
            const cardImages = card.querySelectorAll('img');
            cardImages.forEach(img => {
                if (img._cancelLoad && typeof img._cancelLoad === 'function') {
                    img._cancelLoad();
                }
            });
            // Remove all event listeners by cloning and replacing
            const newCard = card.cloneNode(false);
            card.parentNode?.replaceChild(newCard, card);
        });
        
        // Method 2: Remove via firstChild loop (most reliable)
        while (this.recommendationsSection.firstChild) {
            const child = this.recommendationsSection.firstChild;
            // Cancel any image loads before removing
            const childImages = child.querySelectorAll('img');
            childImages.forEach(img => {
                if (img._cancelLoad && typeof img._cancelLoad === 'function') {
                    img._cancelLoad();
                } else {
                    img.onload = null;
                    img.onerror = null;
                    img.src = '';
                }
            });
            this.recommendationsSection.removeChild(child);
            removedCount++;
        }
        
        // Method 3: Also remove via querySelector (in case some elements weren't caught)
        const remainingElements = this.recommendationsSection.querySelectorAll('*');
        remainingElements.forEach(el => {
            if (el.parentNode === this.recommendationsSection) {
                // Cancel any image loads
                if (el.tagName === 'IMG' && el._cancelLoad) {
                    el._cancelLoad();
                }
                this.recommendationsSection.removeChild(el);
                removedCount++;
            }
        });
        
        console.log(`🗑️ Removed ${removedCount} child elements`);
        
        // Step 3: Clear innerHTML as backup (ensures everything is gone)
        this.recommendationsSection.innerHTML = '';
        
        // Step 3.5: Remove any remaining event listeners by cloning the section
        const parent = this.recommendationsSection.parentNode;
        const nextSibling = this.recommendationsSection.nextSibling;
        const clonedSection = this.recommendationsSection.cloneNode(false);
        if (parent) {
            parent.removeChild(this.recommendationsSection);
            if (nextSibling) {
                parent.insertBefore(clonedSection, nextSibling);
            } else {
                parent.appendChild(clonedSection);
            }
            this.recommendationsSection = clonedSection;
        }
        
        // Step 4: Hide the section
        this.recommendationsSection.style.display = 'none';
        
        // Step 5: Force a reflow to ensure DOM is updated
        void this.recommendationsSection.offsetHeight;
        
        // Step 6: Verify clearing was successful
        const afterChildren = this.recommendationsSection.children.length;
        const afterImages = this.recommendationsSection.querySelectorAll('img').length;
        const afterCards = this.recommendationsSection.querySelectorAll('.product-card').length;
        
        console.log(`📊 After clear: ${afterChildren} children, ${afterImages} images, ${afterCards} cards`);
        
        if (afterChildren === 0 && afterImages === 0 && afterCards === 0) {
            console.log('✅ All product cards cleared successfully, DOM reset complete');
        } else {
            console.warn(`⚠️ Warning: ${afterChildren} children, ${afterImages} images, ${afterCards} cards still remain after clear!`);
            // Force clear again
            this.recommendationsSection.innerHTML = '';
            this.recommendationsSection.style.display = 'none';
            console.log('🔄 Forced re-clear completed');
        }
    }
}

// Global product manager instance
const productManager = new ProductManager();

