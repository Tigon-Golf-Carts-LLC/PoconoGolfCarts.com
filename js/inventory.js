/**
 * Active Inventory — client renderer
 * ==================================
 * Loads the DMS inventory snapshot (data/inventory.json, refreshed by the
 * Sync Active Inventory GitHub Action) and renders live cards with prices,
 * condition / power / street-legal badges, filtering, sorting and search.
 *
 * Display rules mirror the DMS integration guide:
 *   - Money:        "$1,234.56"  (commas + 2 decimals); else "Call for Price"
 *   - Condition:    USED if isUsed === true OR year < current year; else NEW
 *   - Images:       S3 base + imageUrls[0]; fall back to "Coming Soon"
 *   - Phone:        1-844-844-6638  (every Call Now button)
 */
(function () {
  "use strict";

  const PHONE_NUMBER = "1-844-844-6638";
  const PHONE_TEL = "tel:1-844-844-6638";
  const S3_CARTS_URL = "https://s3.amazonaws.com/prod.docs.s3/carts/";
  const COMING_SOON_IMAGE =
    "https://tigongolfcarts.com/wp-content/uploads/2024/11/TIGON-GOLF-CARTS-IMAGES-COMING-SOON.jpg";
  const INVENTORY_URL = "data/inventory.json";

  const CURRENT_YEAR = new Date().getFullYear();

  // ---- Display helpers -----------------------------------------------------

  function formatPrice(price) {
    if (!price) return "Call for Price";
    return (
      "$" +
      Number(price).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }

  function getCartImageUrl(imageUrls) {
    if (Array.isArray(imageUrls) && imageUrls.length > 0) {
      return S3_CARTS_URL + imageUrls[0];
    }
    return COMING_SOON_IMAGE;
  }

  function buildCartTitle(make, model, color) {
    const parts = [];
    if (make && model) parts.push(make + " " + model);
    else if (make) parts.push(make);
    else if (model) parts.push(model);
    if (color) parts.push(color);
    return parts.join(" ") || "Golf Cart";
  }

  // A cart is USED when isUsed === true OR its year is before the current year.
  function isUsedCart(cart) {
    if (cart.isUsed === true) return true;
    const year = parseInt(cart.cartType && cart.cartType.year, 10);
    if (!isNaN(year) && year < CURRENT_YEAR) return true;
    return false;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function storeLabel(cart, storeMap) {
    const id =
      (cart.cartLocation && (cart.cartLocation.locationId || cart.cartLocation.latestStoreId)) || "";
    const store = storeMap.get(id);
    if (store && store.address && (store.address.city || store.address.state)) {
      return [store.address.city, store.address.state].filter(Boolean).join(", ");
    }
    return (cart.cartLocation && cart.cartLocation.locationDescription) || "";
  }

  // ---- State ---------------------------------------------------------------

  const state = {
    carts: [],
    storeMap: new Map(),
    slugMap: {},
    filter: {
      search: "",
      make: "all",
      condition: "all", // all | new | used
      power: "all", // all | electric | gas
      streetLegal: false,
      sort: "default", // default | priceAsc | priceDesc
    },
  };

  // ---- Rendering -----------------------------------------------------------

  function cardHtml(cart) {
    const make = cart.cartType && cart.cartType.make;
    const model = cart.cartType && cart.cartType.model;
    const color = cart.cartAttributes && cart.cartAttributes.cartColor;
    const year = cart.cartType && cart.cartType.year;
    const title = buildCartTitle(make, model, color);
    const used = isUsedCart(cart);
    const electric = cart.isElectric !== false; // default to electric for this dealer
    const streetLegal = cart.title && cart.title.isStreetLegal === true;
    const lifted = cart.cartAttributes && cart.cartAttributes.isLifted === true;
    const passengers = cart.cartAttributes && cart.cartAttributes.passengers;
    const location = storeLabel(cart, state.storeMap);
    const img = getCartImageUrl(cart.imageUrls);

    const badges = [
      '<span class="inv-badge ' +
        (used ? "inv-badge-used" : "inv-badge-new") +
        '">' +
        (used ? "Used" : "New") +
        "</span>",
      '<span class="inv-badge inv-badge-power">' + (electric ? "Electric" : "Gas") + "</span>",
    ];
    if (streetLegal) badges.push('<span class="inv-badge inv-badge-legal">Street Legal</span>');
    if (lifted) badges.push('<span class="inv-badge">Lifted</span>');

    const meta = [];
    if (year) meta.push(escapeHtml(year));
    if (passengers) meta.push(escapeHtml(passengers) + " Passenger");
    if (location) meta.push(escapeHtml(location));

    return (
      '<article class="vehicle-card inv-card">' +
      '<div class="inv-image-wrap">' +
      '<img src="' +
      escapeHtml(img) +
      '" alt="' +
      escapeHtml(title) +
      '" class="vehicle-image" loading="lazy" ' +
      "onerror=\"this.onerror=null;this.src='" +
      COMING_SOON_IMAGE +
      "';\">" +
      "</div>" +
      '<div class="vehicle-info">' +
      '<div class="inv-badges">' +
      badges.join("") +
      "</div>" +
      '<h3 class="vehicle-title">' +
      escapeHtml(title) +
      "</h3>" +
      (meta.length ? '<p class="inv-meta">' + meta.join(" &middot; ") + "</p>" : "") +
      '<p class="inv-price">' +
      formatPrice(cart.retailPrice) +
      "</p>" +
      '<div class="inv-actions">' +
      '<a class="cta-button inv-call" href="' +
      PHONE_TEL +
      '" data-testid="button-call-' +
      escapeHtml(cart._id) +
      '">Call Now: ' +
      PHONE_NUMBER +
      "</a>" +
      "</div>" +
      "</div>" +
      "</article>"
    );
  }

  function applyFilters() {
    const f = state.filter;
    let list = state.carts.slice();

    if (f.make !== "all") {
      list = list.filter(function (c) {
        const make = (c.cartType && c.cartType.make) || "";
        return make.toLowerCase().replace(/[^a-z0-9]/g, "_") === f.make;
      });
    }

    if (f.condition !== "all") {
      list = list.filter(function (c) {
        return f.condition === "used" ? isUsedCart(c) : !isUsedCart(c);
      });
    }

    if (f.power !== "all") {
      list = list.filter(function (c) {
        const electric = c.isElectric !== false;
        return f.power === "electric" ? electric : !electric;
      });
    }

    if (f.streetLegal) {
      list = list.filter(function (c) {
        return c.title && c.title.isStreetLegal === true;
      });
    }

    if (f.search) {
      const q = f.search.toLowerCase();
      list = list.filter(function (c) {
        const hay = buildCartTitle(
          c.cartType && c.cartType.make,
          c.cartType && c.cartType.model,
          c.cartAttributes && c.cartAttributes.cartColor
        ).toLowerCase();
        return hay.indexOf(q) !== -1;
      });
    }

    if (f.sort === "priceAsc" || f.sort === "priceDesc") {
      list.sort(function (a, b) {
        const pa = a.retailPrice || 0;
        const pb = b.retailPrice || 0;
        return f.sort === "priceAsc" ? pa - pb : pb - pa;
      });
    }

    return list;
  }

  function render() {
    const grid = document.getElementById("inventoryGrid");
    const count = document.getElementById("inventoryCount");
    if (!grid) return;

    const list = applyFilters();

    if (list.length === 0) {
      grid.innerHTML =
        '<div class="inv-empty">' +
        "<p>No carts match your filters right now.</p>" +
        '<p>Call us at <a href="' +
        PHONE_TEL +
        '">' +
        PHONE_NUMBER +
        "</a> and we'll help you find the right cart.</p>" +
        "</div>";
    } else {
      grid.innerHTML = list.map(cardHtml).join("");
    }

    if (count) {
      const total = state.carts.length;
      count.textContent =
        list.length === total
          ? "Showing all " + total + " available cart" + (total === 1 ? "" : "s")
          : "Showing " + list.length + " of " + total + " available carts";
    }
  }

  function setStatus(message, isError) {
    const grid = document.getElementById("inventoryGrid");
    if (!grid) return;
    grid.innerHTML =
      '<div class="inv-empty' +
      (isError ? " inv-error" : "") +
      '">' +
      "<p>" +
      escapeHtml(message) +
      "</p>" +
      (isError
        ? '<p>Call us at <a href="' + PHONE_TEL + '">' + PHONE_NUMBER + "</a>.</p>"
        : "") +
      "</div>";
  }

  function buildBrandOptions() {
    const select = document.getElementById("filterMake");
    if (!select) return;
    const makes = new Map();
    state.carts.forEach(function (c) {
      const make = c.cartType && c.cartType.make;
      if (make && make.trim()) {
        const key = make.toLowerCase().replace(/[^a-z0-9]/g, "_");
        if (!makes.has(key)) makes.set(key, make);
      }
    });
    const sorted = Array.from(makes.entries()).sort(function (a, b) {
      return a[1].localeCompare(b[1]);
    });
    sorted.forEach(function (entry) {
      const opt = document.createElement("option");
      opt.value = entry[0];
      opt.textContent = entry[1];
      select.appendChild(opt);
    });
  }

  function wireControls() {
    const search = document.getElementById("inventorySearch");
    const make = document.getElementById("filterMake");
    const sort = document.getElementById("filterSort");
    const condBtns = document.querySelectorAll("[data-condition]");
    const powerBtns = document.querySelectorAll("[data-power]");
    const legal = document.getElementById("filterStreetLegal");

    if (search) {
      search.addEventListener("input", function () {
        state.filter.search = this.value.trim();
        render();
      });
    }
    if (make) {
      make.addEventListener("change", function () {
        state.filter.make = this.value;
        render();
      });
    }
    if (sort) {
      sort.addEventListener("change", function () {
        state.filter.sort = this.value;
        render();
      });
    }
    condBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        condBtns.forEach(function (b) {
          b.classList.remove("active");
        });
        this.classList.add("active");
        state.filter.condition = this.dataset.condition;
        render();
      });
    });
    powerBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        powerBtns.forEach(function (b) {
          b.classList.remove("active");
        });
        this.classList.add("active");
        state.filter.power = this.dataset.power;
        render();
      });
    });
    if (legal) {
      legal.addEventListener("change", function () {
        state.filter.streetLegal = this.checked;
        render();
      });
    }
  }

  async function load() {
    setStatus("Loading live inventory…", false);
    try {
      const res = await fetch(INVENTORY_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      state.carts = Array.isArray(data.carts) ? data.carts : [];
      state.slugMap = data.slugMap || {};
      state.storeMap = new Map();
      (data.stores || []).forEach(function (s) {
        if (s.storeId) state.storeMap.set(s.storeId, s);
      });

      buildBrandOptions();
      wireControls();

      if (state.carts.length === 0) {
        setStatus(
          "Our live inventory is syncing. Please check back shortly or call " +
            PHONE_NUMBER +
            " for current availability.",
          false
        );
        const count = document.getElementById("inventoryCount");
        if (count) count.textContent = "";
        return;
      }

      // Show when the snapshot was last refreshed.
      const updated = document.getElementById("inventoryUpdated");
      if (updated && data.generatedAt) {
        const d = new Date(data.generatedAt);
        updated.textContent = "Inventory updated " + d.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
      }

      render();
    } catch (err) {
      console.error("Failed to load inventory:", err);
      setStatus("We couldn't load live inventory right now.", true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
