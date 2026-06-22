#!/usr/bin/env node
/**
 * Active Inventory Sync — Tigon DMS → static snapshot
 * ===================================================
 * Pulls live ACTIVE inventory from the Tigon DMS API and writes a static
 * `data/inventory.json` snapshot that the website (GitHub Pages, no backend)
 * loads client-side.
 *
 * Why a build-time sync instead of a browser fetch?
 *   - The site is a static GitHub Pages site (no server / no proxy).
 *   - The DMS API does not send CORS headers, so browsers can't call it
 *     directly. A scheduled GitHub Action runs this script server-side
 *     (no CORS restriction) and commits the resulting JSON, mirroring the
 *     DMS's own daily 11:00 PM EST refresh model.
 *
 * Run locally:   node scripts/sync-inventory.mjs
 * Env overrides:
 *   DMS_BASE_URL   - override the API base (default below)
 *   DMS_STORE_IDS  - comma-separated store IDs to limit to a location
 *                    (e.g. the Pocono store). Default: all active inventory.
 *   OUTPUT_FILE    - override output path (default data/inventory.json)
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const DMS_BASE_URL = process.env.DMS_BASE_URL || "https://api.tigondms.com/wp-website";
const OUTPUT_FILE = resolve(ROOT, process.env.OUTPUT_FILE || "data/inventory.json");
const STORE_IDS = (process.env.DMS_STORE_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const PAGE_SIZE = 100; // DMS recommended max per request
const MAX_CARTS = 2000; // safety cap

/** POST helper against the DMS API. */
async function dmsPost(endpoint, body) {
  const res = await fetch(`${DMS_BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`DMS ${endpoint} -> ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** GET helper against the DMS API. */
async function dmsGet(endpoint) {
  const res = await fetch(`${DMS_BASE_URL}${endpoint}`);
  if (!res.ok) {
    throw new Error(`DMS ${endpoint} -> ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Fetch every cart across all pages, applying optional store filter. */
async function fetchAllCarts() {
  const all = [];
  let pageNumber = 0;
  let total = Infinity;

  while (all.length < total && all.length < MAX_CARTS) {
    const body = { pageNumber, pageSize: PAGE_SIZE };
    if (STORE_IDS.length) body.storeIds = STORE_IDS;

    const data = await dmsPost("/get-carts", body);
    const carts = Array.isArray(data?.carts) ? data.carts : [];
    total = typeof data?.totalCarts === "number" ? data.totalCarts : carts.length;

    all.push(...carts);
    if (carts.length === 0) break; // no more results
    pageNumber += 1;
  }

  return all;
}

/**
 * A cart counts as ACTIVE (sellable) inventory when its DMS status is
 * "retail" (units listed for retail sale) or "available", or when it has no
 * status. Carts in "work_in_progress", "boneyard" or "permanent_boneyard"
 * are not sellable and are dropped.
 */
const ACTIVE_STATUSES = new Set(["retail", "available", "in_stock", "instock"]);
function isActive(cart) {
  const status = (cart?.status || "").toString().trim().toLowerCase();
  if (!status) return true;
  return ACTIVE_STATUSES.has(status);
}

/**
 * Keep only the fields the inventory cards need. Drops the private
 * `internalCartImageUrls` (403 for the public) and other unused data so the
 * committed JSON stays small.
 */
function trimCart(cart) {
  const a = cart?.cartAttributes || {};
  return {
    _id: cart?._id,
    cartType: {
      make: cart?.cartType?.make ?? null,
      model: cart?.cartType?.model ?? null,
      year: cart?.cartType?.year ?? null,
    },
    retailPrice: typeof cart?.retailPrice === "number" ? cart.retailPrice : null,
    isElectric: cart?.isElectric ?? null,
    isUsed: cart?.isUsed ?? null,
    cartAttributes: {
      cartColor: a.cartColor ?? null,
      seatColor: a.seatColor ?? null,
      passengers: a.passengers ?? null,
      driveTrain: a.driveTrain ?? null,
      isLifted: a.isLifted ?? null,
    },
    cartLocation: {
      locationId: cart?.cartLocation?.locationId ?? null,
      latestStoreId: cart?.cartLocation?.latestStoreId ?? null,
      locationDescription: cart?.cartLocation?.locationDescription ?? null,
    },
    title: { isStreetLegal: cart?.title?.isStreetLegal ?? null },
    imageUrls: Array.isArray(cart?.imageUrls) ? cart.imageUrls : [],
    status: cart?.status ?? null,
  };
}

/** Trim a store record down to what the site needs for location labels. */
function trimStore(store) {
  return {
    storeId: store?.storeId ?? null,
    name: store?.name ?? null,
    address: {
      city: store?.address?.city ?? null,
      state: store?.address?.state ?? null,
      country: store?.address?.country ?? null,
    },
  };
}

/** URL-safe slug part: lowercase, non-alphanumerics -> hyphen, trimmed. */
function toSlugPart(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Build SEO slugs for each cart:
 *   {make}-{model}-{color}-{city}-{state}-{country}, deduped with -01, -02 ...
 */
function buildSlugMap(carts, stores) {
  const storeMap = new Map();
  for (const s of stores) if (s.storeId) storeMap.set(s.storeId, s);

  const idToSlug = {};
  const counts = {};

  for (const cart of carts) {
    const storeId = cart.cartLocation?.locationId || cart.cartLocation?.latestStoreId || "";
    const store = storeMap.get(storeId);
    const parts = [
      cart.cartType?.make,
      cart.cartType?.model,
      cart.cartAttributes?.cartColor,
      store?.address?.city,
      store?.address?.state,
      store?.address?.country || "USA",
    ]
      .map(toSlugPart)
      .filter(Boolean);

    const base = parts.length ? parts.join("-") : `cart-${cart._id}`;
    let slug = base;
    if (counts[base] === undefined) {
      counts[base] = 0;
    } else {
      counts[base] += 1;
      slug = `${base}-${String(counts[base]).padStart(2, "0")}`;
    }
    idToSlug[cart._id] = slug;
  }

  return idToSlug;
}

/** Unique makes derived from inventory, keyed lowercase-with-underscores. */
function deriveBrands(carts) {
  const map = new Map();
  for (const cart of carts) {
    const make = cart.cartType?.make;
    if (make && make.trim()) {
      const key = make.toLowerCase().replace(/[^a-z0-9]/g, "_");
      if (!map.has(key)) map.set(key, make);
    }
  }
  return Array.from(map.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function main() {
  console.log(`Syncing active inventory from ${DMS_BASE_URL} ...`);
  if (STORE_IDS.length) console.log(`Store filter: ${STORE_IDS.join(", ")}`);

  const [rawCarts, rawStores] = await Promise.all([
    fetchAllCarts(),
    dmsGet("/tigon-stores").catch((err) => {
      console.warn(`Could not fetch stores: ${err.message}`);
      return [];
    }),
  ]);

  const stores = (Array.isArray(rawStores) ? rawStores : []).map(trimStore);

  // Diagnostic: how many carts carry each status value (helps tune isActive).
  const statusCounts = {};
  for (const c of rawCarts) {
    const s = c && c.status != null && String(c.status).trim() ? String(c.status).trim() : "(none)";
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  }
  console.log("Status breakdown:", JSON.stringify(statusCounts));

  const activeCarts = rawCarts.filter(isActive).map(trimCart).filter((c) => c._id);
  const idToSlug = buildSlugMap(activeCarts, stores);
  const brands = deriveBrands(activeCarts);

  // Diagnostic: active carts per store (helps decide location scope).
  const storeNameById = new Map(stores.map((s) => [s.storeId, s.name]));
  const storeActiveCounts = {};
  for (const c of activeCarts) {
    const id = c.cartLocation?.locationId || c.cartLocation?.latestStoreId || "(none)";
    const label = `${id}${storeNameById.get(id) ? " " + storeNameById.get(id) : ""}`;
    storeActiveCounts[label] = (storeActiveCounts[label] || 0) + 1;
  }
  console.log("Active per store:", JSON.stringify(storeActiveCounts));

  const snapshot = {
    generatedAt: new Date().toISOString(),
    source: DMS_BASE_URL,
    totalActive: activeCarts.length,
    totalFetched: rawCarts.length,
    statusCounts,
    storeActiveCounts,
    storeIds: STORE_IDS,
    brands,
    stores,
    slugMap: idToSlug,
    carts: activeCarts,
  };

  await mkdir(dirname(OUTPUT_FILE), { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

  console.log(
    `Wrote ${activeCarts.length} active carts (of ${rawCarts.length} fetched) ` +
      `and ${stores.length} stores to ${OUTPUT_FILE}`
  );
}

main().catch((err) => {
  console.error("Inventory sync failed:", err);
  process.exit(1);
});
