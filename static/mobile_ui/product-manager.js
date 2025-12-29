console.log("🧩 product-manager.js EXECUTED");

(function () {
  // Ensure global namespace
  window.__RUNOVA__ = window.__RUNOVA__ || {};

  class ProductManager {
    constructor() {
      this.container = null;
      this.products = [];
      this.initialized = false;
    }

    init() {
      if (this.initialized) return;

      const container =
        document.getElementById("recommendationsSection") ||
        document.querySelector(".recommendations-section");

      if (!container) {
        console.warn("⚠️ ProductManager: container not found, delaying init");
        return;
      }

      this.container = container;
      this.initialized = true;
      console.log("✅ ProductManager initialized");
    }

    clear() {
      if (!this.container) return;
      this.products = [];
      this.container.innerHTML = "";
      this.container.style.display = "none";
      console.log("🧹 ProductManager cleared");
    }

    addProducts(products) {
      if (!Array.isArray(products)) {
        console.warn("⚠️ ProductManager.addProducts called with invalid data:", products);
        return;
      }

      this.init();
      if (!this.container) return;

      this.products = products;
      this.render();
    }

    render() {
      if (!this.container) return;

      this.container.innerHTML = "";
      this.container.style.display = "block";

      const wrapper = document.createElement("div");
      wrapper.className = "products-container";

      this.products.forEach((product) => {
        const card = document.createElement("div");
        card.className = "product-card";
        card.dataset.clickable = product.url ? "true" : "false";

        if (product.url) {
          card.addEventListener("click", () => {
            window.open(product.url, "_blank");
          });
        }

        const imgWrap = document.createElement("div");
        imgWrap.className = "product-image-container";

        const img = document.createElement("img");
        img.className = "product-image";
        img.src = product.image || "";
        img.alt = product.name || "product";

        imgWrap.appendChild(img);

        const info = document.createElement("div");
        info.className = "product-info";

        const name = document.createElement("div");
        name.className = "product-name";
        name.textContent = product.name || "Unnamed product";

        const price = document.createElement("div");
        price.className = "product-price";
        price.textContent = product.price ? `$${product.price}` : "";

        const desc = document.createElement("div");
        desc.className = "product-description";
        desc.textContent = product.description || "";

        info.appendChild(name);
        info.appendChild(price);
        info.appendChild(desc);

        card.appendChild(imgWrap);
        card.appendChild(info);

        wrapper.appendChild(card);
      });

      this.container.appendChild(wrapper);
      console.log(`🧴 Rendered ${this.products.length} products`);
    }
  }

  // Singleton
  const pm = new ProductManager();

  // Expose globally (for app.js)
  window.productManager = pm;
  window.__RUNOVA__.productManager = pm;

  // Try init on DOM ready
  document.addEventListener("DOMContentLoaded", () => {
    pm.init();
  });

  console.log("🧩 ProductManager ready");
})();
