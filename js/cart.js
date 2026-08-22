/**
 * Vehicle Detail page — renders a single DMS cart.
 * ================================================
 * Resolves ?id=<_id> or ?slug=<slug> from the URL, loads the inventory
 * snapshot (data/inventory.json, live DMS as fallback), and renders the
 * full detail view: image gallery, price, 0% financing estimate, badges,
 * specifications and CTAs.
 */
(function () {
  "use strict";

  const PHONE_NUMBER = "570-643-0152";
  const PHONE_TEL = "tel:570-643-0152";
  const S3_CARTS_URL = "https://s3.amazonaws.com/prod.docs.s3/carts/";
  const COMING_SOON_IMAGE = "images/cart-coming-soon.svg";
  const INVENTORY_URL = "data/inventory.json";
  const DMS_BASE_URL = "https://api.tigondms.com/wp-website";
  const FINANCE_MONTHS = 48; // 0% APR over 48 months
  const CURRENT_YEAR = new Date().getFullYear();

  // ---- Helpers -------------------------------------------------------------

  function formatPrice(price) {
    if (!price) return "Call for Price";
    return (
      "$" +
      Number(price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    );
  }

  function allImages(imageUrls) {
    if (Array.isArray(imageUrls) && imageUrls.length > 0) {
      return imageUrls.map(function (u) {
        return S3_CARTS_URL + u;
      });
    }
    return [COMING_SOON_IMAGE];
  }

  function buildCartTitle(make, model, color) {
    const parts = [];
    if (make && model) parts.push(make + " " + model);
    else if (make) parts.push(make);
    else if (model) parts.push(model);
    if (color) parts.push(color);
    return parts.join(" ") || "Golf Cart";
  }

  function isUsedCart(cart) {
    if (cart.isUsed === true) return true;
    const year = parseInt(cart.cartType && cart.cartType.year, 10);
    return !isNaN(year) && year < CURRENT_YEAR;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function setStatus(html) {
    const el = document.getElementById("cartDetail");
    if (el) el.innerHTML = '<div class="inv-empty">' + html + "</div>";
  }

  function specRow(label, value) {
    if (value == null || value === "") return "";
    return (
      '<div class="spec-row"><span>' +
      escapeHtml(label) +
      "</span><span>" +
      escapeHtml(value) +
      "</span></div>"
    );
  }

  function yesNo(v) {
    if (v === true) return "Yes";
    if (v === false) return "No";
    return null;
  }

  // ---- Render --------------------------------------------------------------

  function render(cart, storeMap) {
    const c = cart;
    const make = c.cartType && c.cartType.make;
    const model = c.cartType && c.cartType.model;
    const color = c.cartAttributes && c.cartAttributes.cartColor;
    const year = c.cartType && c.cartType.year;
    const title = buildCartTitle(make, model, color);
    const used = isUsedCart(c);
    const electric = c.isElectric !== false;
    const streetLegal = c.title && c.title.isStreetLegal === true;
    const lifted = c.cartAttributes && c.cartAttributes.isLifted === true;
    const a = c.cartAttributes || {};

    // Location / store
    const storeId =
      (c.cartLocation && (c.cartLocation.locationId || c.cartLocation.latestStoreId)) || "";
    const store = storeMap.get(storeId);
    const locParts = [];
    if (store && store.address) {
      if (store.address.city) locParts.push(store.address.city);
      if (store.address.state) locParts.push(store.address.state);
    }
    const locationLabel = locParts.join(", ") || (c.cartLocation && c.cartLocation.locationDescription) || "";
    const storeName = (store && store.name) || "";

    // Page title / meta
    document.getElementById("pageTitle").textContent = title + " | Pocono Golf Carts";
    const desc = document.getElementById("pageDesc");
    if (desc)
      desc.setAttribute(
        "content",
        title + " for sale" + (locationLabel ? " in " + locationLabel : "") + " — " + formatPrice(c.retailPrice) + ". Call " + PHONE_NUMBER + "."
      );

    // Gallery
    const images = allImages(c.imageUrls);
    const thumbs =
      images.length > 1
        ? '<div class="cart-thumbs">' +
          images
            .map(function (src, i) {
              return (
                '<img class="cart-thumb' +
                (i === 0 ? " active" : "") +
                '" src="' +
                escapeHtml(src) +
                '" alt="' +
                escapeHtml(title) +
                " photo " +
                (i + 1) +
                '" data-full="' +
                escapeHtml(src) +
                "\" onerror=\"this.onerror=null;this.src='" +
                COMING_SOON_IMAGE +
                "';\">"
              );
            })
            .join("") +
          "</div>"
        : "";

    // Badges
    const badges = [
      '<span class="inv-badge ' + (used ? "inv-badge-used" : "inv-badge-new") + '">' + (used ? "Used" : "New") + "</span>",
      '<span class="inv-badge">' + (electric ? "Electric" : "Gas") + "</span>",
    ];
    if (streetLegal) badges.push('<span class="inv-badge inv-badge-legal">Street Legal</span>');
    if (lifted) badges.push('<span class="inv-badge">Lifted</span>');
    if (a.passengers) badges.push('<span class="inv-badge">' + escapeHtml(a.passengers) + "</span>");

    // Financing estimate (0% APR / 48 mo)
    let financeLine = "";
    if (c.retailPrice) {
      const monthly = c.retailPrice / FINANCE_MONTHS;
      financeLine =
        '<p class="cart-finance">Or about <strong>' +
        formatPrice(monthly) +
        "/mo</strong> with 0% APR for " +
        FINANCE_MONTHS +
        " months (with approved credit)</p>";
    }

    // Specs
    const specs = [
      specRow("Make", make),
      specRow("Model", model),
      specRow("Year", year),
      specRow("Condition", used ? "Used" : "New"),
      specRow("Power", electric ? "Electric" : "Gas"),
      specRow("Color", color),
      specRow("Seat Color", a.seatColor),
      specRow("Passengers", a.passengers),
      specRow("Drivetrain", a.driveTrain),
      specRow("Lifted", yesNo(lifted)),
      specRow("Street Legal", yesNo(c.title && c.title.isStreetLegal)),
      specRow("Location", storeName || locationLabel),
    ]
      .filter(Boolean)
      .join("");

    const subParts = [];
    if (year) subParts.push(escapeHtml(year));
    if (locationLabel) subParts.push(escapeHtml(locationLabel));

    const html =
      '<div class="cart-layout">' +
      // Gallery column
      "<div>" +
      '<div class="cart-gallery-main">' +
      '<img id="cartMainImage" src="' +
      escapeHtml(images[0]) +
      '" alt="' +
      escapeHtml(title) +
      "\" onerror=\"this.onerror=null;this.src='" +
      COMING_SOON_IMAGE +
      "';\">" +
      "</div>" +
      thumbs +
      "</div>" +
      // Info column
      '<div class="cart-info">' +
      "<h1>" +
      escapeHtml(title) +
      "</h1>" +
      (subParts.length ? '<p class="cart-sub">' + subParts.join(" &middot; ") + "</p>" : "") +
      '<div class="cart-badges">' +
      badges.join("") +
      "</div>" +
      '<p class="cart-price">' +
      formatPrice(c.retailPrice) +
      "</p>" +
      financeLine +
      '<div class="cart-ctas">' +
      '<a class="cta-button" href="' +
      PHONE_TEL +
      '" data-testid="button-call">Call Now: ' +
      PHONE_NUMBER +
      "</a>" +
      '<a class="cta-secondary" href="contact.html" data-testid="link-quote">Request a Quote</a>' +
      "</div>" +
      '<div class="cart-specs"><h2>Specifications</h2><div class="spec-grid">' +
      specs +
      "</div></div>" +
      "</div>" +
      "</div>";

    document.getElementById("cartDetail").innerHTML = html;

    // Thumbnail switching
    const main = document.getElementById("cartMainImage");
    document.querySelectorAll(".cart-thumb").forEach(function (t) {
      t.addEventListener("click", function () {
        main.src = this.getAttribute("data-full");
        document.querySelectorAll(".cart-thumb").forEach(function (x) {
          x.classList.remove("active");
        });
        this.classList.add("active");
      });
    });
  }

  // ---- Data ----------------------------------------------------------------

  async function loadSnapshot() {
    const res = await fetch(INVENTORY_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  // Live single-cart fetch (fallback when not in the snapshot).
  async function loadLiveCart(id) {
    const res = await fetch(DMS_BASE_URL + "/get-cart-by-id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cartId: id }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function init() {
    const id = getParam("id");
    const slug = getParam("slug");
    if (!id && !slug) {
      setStatus("<p>No cart selected.</p><p><a href='inventory.html'>Browse our inventory</a></p>");
      return;
    }

    let data;
    try {
      data = await loadSnapshot();
    } catch (err) {
      data = { carts: [], stores: [], slugMap: {} };
    }

    const carts = Array.isArray(data.carts) ? data.carts : [];
    const storeMap = new Map();
    (data.stores || []).forEach(function (s) {
      if (s && s.storeId) storeMap.set(s.storeId, s);
    });

    // Resolve the target cart id (slug -> id via the snapshot's slugMap).
    let targetId = id;
    if (!targetId && slug && data.slugMap) {
      for (const cid in data.slugMap) {
        if (data.slugMap[cid] === slug) {
          targetId = cid;
          break;
        }
      }
    }

    let cart = null;
    if (targetId) cart = carts.find(function (c) { return c._id === targetId; });
    if (!cart && slug) {
      // Fallback: match by slug-like title if id not found
      cart = carts.find(function (c) { return (data.slugMap && data.slugMap[c._id]) === slug; });
    }

    // Last resort: try the live DMS API by id.
    if (!cart && targetId) {
      try {
        const live = await loadLiveCart(targetId);
        if (live && live._id) cart = live;
      } catch (e) {
        /* ignore */
      }
    }

    if (!cart) {
      setStatus(
        "<p>Sorry, we couldn't find that cart — it may have just sold.</p>" +
          "<p><a href='inventory.html'>Browse our current inventory</a> or call <a href='" +
          PHONE_TEL +
          "'>" +
          PHONE_NUMBER +
          "</a>.</p>"
      );
      return;
    }

    render(cart, storeMap);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
