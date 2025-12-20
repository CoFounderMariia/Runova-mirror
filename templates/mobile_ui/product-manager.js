/**
 * Product Recommendation Manager
 * Handles product cards display
 */

class ProductManager {
    constructor() {
        this.recommendationsSection = document.getElementById('recommendationsSection');
    }

    addProductCard(product) {
        // Check if title exists, if not create it
        let title = this.recommendationsSection.querySelector('.recommendations-title');
        if (!title) {
            title = document.createElement('div');
            title.className = 'recommendations-title';
            title.textContent = 'Recommended Products';
            this.recommendationsSection.insertBefore(title, this.recommendationsSection.firstChild);
        }

        const card = document.createElement('div');
        card.className = 'product-card';
        
        card.innerHTML = `
            <img src="${product.image || 'https://via.placeholder.com/80?text=Product'}" 
                 alt="${product.name}" 
                 class="product-image"
                 onerror="this.src='https://via.placeholder.com/80?text=Product'">
            <div class="product-info">
                <div class="product-name">${product.name}</div>
                <div class="product-benefits">${product.benefits}</div>
                <div class="product-usage">${product.usage || 'Follow product instructions'}</div>
            </div>
        `;

        this.recommendationsSection.appendChild(card);
        
        // Scroll to recommendations
        setTimeout(() => {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 100);
    }

    clear() {
        this.recommendationsSection.innerHTML = '';
    }
}

// Global product manager instance
const productManager = new ProductManager();

