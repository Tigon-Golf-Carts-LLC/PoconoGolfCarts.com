# Active Inventory Sync (Tigon DMS)

The **Live Inventory** page (`inventory.html`) shows our real, in-stock golf
carts with live pricing and availability, pulled from the Tigon DMS API.

Because this site is a **static GitHub Pages site** (no backend server), the
browser cannot call the DMS API directly — the API does not send CORS headers.
Instead, a scheduled GitHub Action runs server-side, fetches the active
inventory, and commits a static snapshot that the page reads.

## How it works

```
Tigon DMS API ──(GitHub Action, nightly)──▶ data/inventory.json ──▶ inventory.html
   (POST /get-carts)        scripts/sync-inventory.mjs              js/inventory.js
```

1. **`scripts/sync-inventory.mjs`** — calls `POST /get-carts` (paginated) plus
   `GET /tigon-stores`, keeps only **active** carts (`status: Available`),
   strips private fields (`internalCartImageUrls`), builds SEO slugs and the
   brand list, and writes `data/inventory.json`.
2. **`.github/workflows/sync-inventory.yml`** — runs the script nightly at
   11:00 PM EST (04:00 UTC) and on demand, committing the refreshed snapshot.
   That commit to `main` triggers the existing Pages deploy.
3. **`inventory.html` + `js/inventory.js`** — load the snapshot and render
   cards with price, New/Used + Electric/Gas + Street Legal badges, brand and
   condition filters, price sorting, and search.

## Display rules (from the DMS integration guide)

- **Price:** `$1,234.56` (commas + 2 decimals); no price → **"Call for Price"**.
- **Condition:** a cart is **Used** when `isUsed === true` **or** its `year` is
  before the current year; otherwise **New**.
- **Images:** `https://s3.amazonaws.com/prod.docs.s3/carts/` + `imageUrls[0]`,
  with a "Coming Soon" placeholder fallback when no public image exists.
- **Phone:** every Call Now button uses `1-844-844-6638`.

## Configuration

Set an optional repository **variable** (Settings → Secrets and variables →
Actions → Variables) to limit the sync to one or more store locations:

| Variable        | Example            | Effect                                   |
|-----------------|--------------------|------------------------------------------|
| `DMS_STORE_IDS` | `store456,store789`| Only sync carts from these store IDs.    |

Leave it unset to sync **all** active inventory.

## Running the sync manually

```bash
# All active inventory
node scripts/sync-inventory.mjs

# Limit to specific stores
DMS_STORE_IDS=store456 node scripts/sync-inventory.mjs
```

Or trigger the **"Sync Active Inventory from DMS"** workflow from the GitHub
Actions tab.
