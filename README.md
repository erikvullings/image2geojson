# image2geojson

Convert a scanned or photographed military map with tactical overlay markings into [GeoJSON](https://geojson.org/) — entirely in the browser, with no backend required.

> **Live demo** (after deploying to GitHub Pages): `https://<your-github-username>.github.io/image2geojson/`

---

## Goal

Military printed maps often have hand-drawn or printed overlays showing brigade areas, phase lines, assault lines, attack zones, artillery areas, and similar tactical information. Digitising these overlays — turning them into machine-readable GeoJSON linestrings and polygons — is traditionally tedious manual work.

**image2geojson** provides a streamlined three-step workflow:

1. **Georeference** — upload your map scan and align it on top of a live world map so geographic coordinates are established.
2. **Trace** — let the app automatically detect and vectorise dark lines from the overlay using in-browser skeleton tracing, then review and export the result.
3. **Draw** — manually create or refine features using interactive drawing tools.

The application works fully offline (PWA), supports self-hosted tile servers including PMTiles, and persists all work in `localStorage` so you can pick up where you left off.

---

## Features

| Feature                        | Description                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🗺 **MapLibre background map**  | Full-screen vector/raster world map                                                                                                               |
| 📷 **Flexible image loading**   | Upload via file picker, **drag & drop** onto the map, or **Ctrl+V** paste from clipboard                                                          |
| 📍 **Georeferencing**           | Drag, scale (per-axis), rotate, skew and adjust opacity of the image overlay to align it with the background map (inspired by QGIS Georeferencer) |
| 📌 **Pin to map**               | Locks the image to geographic coordinates as a MapLibre `ImageSource`; image then moves with the map                                              |
| ✏️ **Drawing tools**            | Draw points, lines and polygons interactively; box-select and Cmd/Ctrl+click for multi-selection; join linestrings; edit vertices                 |
| 📂 **GeoJSON import / export**  | Load an existing `.geojson` file or download your work                                                                                            |
| 🔍 **Bitmap tracing**           | Automatically trace dark lines using in-browser morphological skeletonisation (Zhang-Suen); configurable threshold, blur, and simplification      |
| 💾 **Auto-save**                | Full application state (including image as base64) persisted to `localStorage`                                                                    |
| 📴 **PWA / offline**            | Installable as a Progressive Web App; tile requests cached by Service Worker                                                                      |
| 🌐 **Configurable tile source** | OpenFreeMap (default), OSM raster, any MapLibre style URL, XYZ raster template, or PMTiles (vector or raster) for offline / self-hosted scenarios |

---

## Architecture

### Technology stack

| Concern          | Choice                                                           | Rationale                                                          |
| ---------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| UI framework     | [Mithril.js](https://mithril.js.org/) v2                         | Tiny (~10 kB), fast virtual DOM, no build magic needed             |
| Language         | TypeScript                                                       | Type safety across state, components and services                  |
| State management | [meiosis-setup](https://meiosis.js.org/) v6                      | Functional stream-based state (mergerino object patches); no magic |
| Map engine       | [MapLibre GL JS](https://maplibre.org/) v5                       | Open-source, WebGL-accelerated, vector + raster + custom sources   |
| Drawing          | [maplibre-gl-draw](https://github.com/geolonia/maplibre-gl-draw) | MapLibre-native interactive drawing (community fork)               |
| Bitmap tracing   | Custom Zhang-Suen thinning + skeleton walker                     | Pure-JS morphological skeletonisation; no WASM, works offline      |
| Geometry         | [@turf/turf](https://turfjs.org/)                                | Douglas-Peucker simplification of traced paths                     |
| Offline tiles    | [pmtiles](https://github.com/protomaps/PMTiles)                  | Single-file tile archives; loaded via MapLibre custom protocol     |
| Build            | [Vite](https://vitejs.dev/) v6                                   | Fast dev server + Rollup bundler with code splitting               |
| PWA              | [vite-plugin-pwa](https://vite-pwa-org.netlify.app/) / Workbox   | Service Worker generation, tile caching                            |
| Deploy           | GitHub Actions → GitHub Pages                                    | Zero-config CI/CD                                                  |

### Source layout

```
image2geojson/
├── index.html                      Vite entry, PWA meta tags
├── vite.config.ts                  Build config, PWA manifest, chunk splitting
├── tsconfig.json
├── public/
│   ├── favicon.svg
│   ├── pwa-192.png                 PWA home-screen icon
│   └── pwa-512.png
└── src/
    ├── app.ts                      Mount point: wires cells → Mithril root
    ├── assets/
    │   └── style.css               Dark theme, layout
    ├── state/
    │   ├── types.ts                AppState interface and all sub-types
    │   └── index.ts                meiosisSetup cells, localStorage persistence
    ├── components/
    │   ├── App.ts                  Root layout; drag-and-drop, paste, keyboard shortcuts
    │   ├── Toolbar.ts              Mode switcher (Georeference / Trace / Draw)
    │   ├── MapView.ts              MapLibre map; PMTiles protocol registration
    │   ├── ImageOverlay.ts         DOM overlay image with drag/scale/rotate/skew handles
    │   ├── DrawPanel.ts            maplibre-gl-draw integration; feature list; multi-select
    │   ├── TracePanel.ts           Trace settings UI; run/preview/commit workflow
    │   └── SettingsPanel.ts        Tile source selector (preset + custom)
    └── services/
        ├── mapHelpers.ts           buildMapStyle() — converts TileSourceConfig to MapLibre style
        ├── geojsonExport.ts        downloadGeoJSON(), parseGeoJSON()
        └── imageTracer.ts          Canvas preprocessing → Zhang-Suen thinning → skeleton walk → GeoJSON
```

### State shape

```typescript
interface AppState {
  map: {
    center: [number, number];   // [lng, lat]
    zoom: number;
  };
  tileSource: {
    type: 'preset' | 'custom';
    preset: 'openfreemap' | 'osm-raster';
    customUrl: string;
    customType: 'style-url' | 'xyz-raster' | 'pmtiles-vector' | 'pmtiles-raster';
  };
  image: {
    src: string | null;          // base64 data URL
    naturalWidth: number;        // original image pixel size
    naturalHeight: number;
    transform: {
      translateX/Y: number;      // px offset from viewport centre
      scaleX/Y: number;          // 1.0 = original size
      rotation: number;          // degrees
      skewX/Y: number;           // degrees
    };
    opacity: number;             // 0–1
    pinned: boolean;
    geoCorners?: [[lng,lat]×4];  // TL, TR, BR, BL when pinned
  };
  geojson: GeoJSON.FeatureCollection;
  ui: {
    mode: 'georeference' | 'draw' | 'trace';
    selectedFeatureIds: string[];  // supports multi-selection
    sidebarOpen: boolean;
    settingsOpen: boolean;
    traceSettings: {
      colorMode: 'black' | 'color';
      threshold: number;         // 0–255 grayscale cutoff
      simplification: number;    // Turf Douglas-Peucker tolerance (degrees)
      blurRadius: number;        // px blur before threshold
    };
  };
}
```

State is managed by **meiosis-setup v6** which wraps it in a stream of "cells". Each cell exposes `.state` (read) and `.update(patch)` (write). Object patches are deep-merged by mergerino. Every state change is persisted to `localStorage`.

### Bitmap tracing pipeline

```
base64 image src
      │
      ▼
Draw to offscreen <canvas> (downscaled to max 1500 px)
      │
      ▼  optional Gaussian blur (ctx.filter)
Apply grayscale + threshold  ← pixel < threshold → foreground, else background
      │
      ▼
Zhang-Suen morphological thinning  ← iterative two-pass erosion → 1-px skeleton
      │
      ▼
Skeleton walker  ← greedy direction-preferring chain follower; emits pixel chains
      │
      ▼
Border-margin filter  ← suppress edges within 5 px of image boundary
      │
      ▼
pixelToGeo() bilinear interpolation  ← maps pixel [x,y] → [lng,lat]
  using the four pinned geoCorners as control points
      │
      ▼
Split on jumps  ← split chains where consecutive points are > 3 % of image diagonal apart
      │
      ▼
@turf/turf simplify()  ← Douglas-Peucker with configurable tolerance
      │
      ▼
GeoJSON FeatureCollection  → preview on map → user commits to drawing layer
```

---

## Tile Sources

Click **⚙️** in the toolbar to open the tile source settings. The chosen source is persisted across sessions.

| Option                    | When to use                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| **OpenFreeMap** (default) | Free vector tiles, no API key. Works on GitHub Pages and public deployments.                             |
| **OSM Raster**            | Familiar OpenStreetMap raster tiles. Good reference for orientation.                                     |
| **MapLibre Style URL**    | Any self-hosted or commercial vector tile style (`https://…/style.json`).                                |
| **XYZ Raster**            | Any standard tile server (`https://…/{z}/{x}/{y}.png`).                                                  |
| **PMTiles – Vector**      | A single `.pmtiles` file (local file or URL) containing vector tiles. Ideal for fully offline operation. |
| **PMTiles – Raster**      | A single `.pmtiles` file containing raster tiles (e.g. scanned topographic maps).                        |

---

## Using a Local / Offline Map (PMTiles)

PMTiles lets you load an entire country's map from a single local file — no internet required. This is ideal for secure or disconnected environments.

### What is PMTiles?

[PMTiles](https://docs.protomaps.com/pmtiles/) is an open archive format for tiled map data. A single `.pmtiles` file contains all vector or raster tiles for a geographic area and can be served from a static file host, an S3 bucket, or loaded directly from disk in the browser.

### Pre-built downloads

Ready-to-use vector PMTiles files based on OpenStreetMap data (31 March 2026, built with [tilemaker](https://github.com/systemed/tilemaker)):

| Area | Size | Download |
| --- | --- | --- |
| 🇳🇱 **Netherlands** | 688 MB | [GitHub Release](https://github.com/erikvullings/image2geojson/releases/download/v1.0.0/netherlands.pmtiles) |
| 🇩🇪 **Germany** | 2.9 GB | [Zenodo](https://zenodo.org/records/19387309/files/germany.pmtiles?download=1) |

Both files are also available together on [Zenodo (record 19387309)](https://zenodo.org/records/19387309) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

To use a downloaded file: open **⚙️ Settings**, select **PMTiles – Vector**, then either paste the URL directly or click **📂 Browse…** to load a local file.

> **Tip**: Remote PMTiles URLs (Zenodo/GitHub) work directly in the app without downloading first — MapLibre fetches only the tiles needed for the current view.

### Getting PMTiles for the Netherlands

**Option A — Protomaps daily extract (recommended)**

The easiest source for country-level OpenStreetMap vector tiles:

```
https://maps.protomaps.com/builds/
```

1. Go to [https://app.protomaps.com/downloads/small_map](https://app.protomaps.com/downloads/small_map).
2. Draw a bounding box around the Netherlands (roughly `[3.2, 50.7, 7.3, 53.6]`).
3. Click **Download** — you receive a `.pmtiles` file (typically 200–500 MB for NL).
4. In the app, open **⚙️ Settings**, select **PMTiles – Vector**, click **📂 Browse…** and pick your file.

Alternatively, download a pre-built country extract:

```
# Daily OpenStreetMap builds from Protomaps (replace YYYYMMDD)
https://build.protomaps.com/YYYYMMDD.pmtiles   # full planet (too large)
```

For country extracts use the Protomaps download tool or [GeoFabrik-based converters](#).

**Option B — Geofabrik + `pmtiles` CLI**

1. Download a country PBF from [download.geofabrik.de](https://download.geofabrik.de):

   ```bash
   # Netherlands
   wget https://download.geofabrik.de/europe/netherlands-latest.osm.pbf

   # Germany
   wget https://download.geofabrik.de/europe/germany-latest.osm.pbf
   ```

2. Convert to PMTiles using [Planetiler](https://github.com/onthegomap/planetiler) (Java, fast):

   ```bash
   wget https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar
   java -Xmx4g -jar planetiler.jar \
     --osm-path=netherlands-latest.osm.pbf \
     --output=netherlands.pmtiles
   ```

   This produces a self-contained `netherlands.pmtiles` vector tile file (~120 MB for NL).

3. Or use [tilemaker](https://github.com/systemed/tilemaker) for a lighter approach:

   First, clone the repo, and compile it. On Mac:

   ```bash
   git clone https://github.com/systemed/tilemaker.git
   cd tilemaker
   brew install curl wget boost lua sqlite3 shapelib rapidjson

   # To use the latest version of curl, needed to run the scripts
   echo 'export PATH="/opt/homebrew/opt/curl/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc

   # Get rid of Windows line endings
   sed -i '' $'s/\r$//' get-landcover.sh
   sed -i '' $'s/\r$//' get-coastline.sh

   ./get-landcover.sh
   ./get-coastline.sh

   wget https://download.geofabrik.de/europe/germany-latest.osm.pbf

   # Fix Makefile: Remove -lboost_system from the LIB definition in the Makefile.
   vi Makefile

   make
   sudo make install
   ```

   ```bash
   tilemaker --input germany-latest.osm.pbf \
             --output germany.pmtiles \
             --config ./resources/config-openmaptiles.json \
             --process ./resources/process-openmaptiles.lua
   ```

**Option C — Pre-built German federal state extracts**

[BBBike extract service](https://extract.bbbike.org/) provides free PMTiles downloads for custom regions (takes a few minutes to generate).

### Getting raster topographic map tiles

For military use you often want official topographic rasters (Topografische kaart / TK):

- **Netherlands (BRT)**: The [PDOK tile service](https://www.pdok.nl/ogc-webservices) provides official Dutch topographic maps as XYZ tiles:

  ```text
  https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png
  ```

  Enter this URL in **⚙️ Settings → XYZ Raster**.

- **Germany (BKG)**: The Bundesamt für Kartographie offers [WebAtlasDE](https://gdz.bkg.bund.de/):

  ```text
  https://sgx.geodatenzentrum.de/wmts_webatlasde.light/tile/1.0.0/webatlasde.light/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png
  ```

- **Converting raster to PMTiles**: Use [gdal2tiles](https://gdal.org/programs/gdal2tiles.html) + the `pmtiles` CLI:

  ```bash
  gdal2tiles.py --zoom=7-14 your_tif.tif ./tiles/
  pmtiles convert ./tiles/ output.pmtiles
  ```

### Loading a PMTiles file in the app

1. Open **⚙️ Settings** (toolbar).
2. Select tile source type: **PMTiles – Vector** or **PMTiles – Raster**.
3. Either:
   - Paste a URL (e.g. `https://yourserver.com/netherlands.pmtiles`), **or**
   - Click **📂 Browse…** and select a local `.pmtiles` file from disk.
4. For vector PMTiles you also need a MapLibre style that references the tiles. A sensible default is to use a **MapLibre Style URL** pointing to a style that uses your PMTiles as the source.

> **Tip**: For fully offline use, combine a local PMTiles file with the **PWA install**. After installing the app and loading the PMTiles once, the map works without any network connection.

---

## Workflow

### Step 1 — Load an image

There are three ways to load a map scan or photograph:

- **File picker** — click **📷 Upload image** in the toolbar.
- **Drag & drop** — drag any image file from your file manager onto the browser window.
- **Clipboard paste** — copy an image (e.g. a screenshot) and press **Ctrl+V** / **Cmd+V**.

The app automatically switches to **Georeference** mode.

### Step 2 — Georeference

Align the image with the background map:

| Control                              | Action                                                    |
| ------------------------------------ | --------------------------------------------------------- |
| **Drag the image**                   | Repositions it on screen                                  |
| **Corner handles** (red dots)        | Scale X and Y independently                               |
| **Rotation handle** (green dot, top) | Rotates the image                                         |
| **Skew X / Skew Y** sliders          | Corrects perspective distortion                           |
| **Opacity** slider                   | Makes the image transparent so you can see the background |

Pan and zoom the background map freely at any time — the image stays in its screen position until pinned.

When the overlay is aligned, click **📌 Pin to map**. The image is now locked to geographic coordinates and moves with the map. This step is required before tracing.

### Step 3 — Trace (automatic)

Switch to **🔍 Trace** mode (image must be pinned).

| Setting                       | Effect                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Threshold** (10–245)        | Grayscale cutoff — pixels darker than this are treated as lines. Lower = more lines captured; higher = only the darkest ink. |
| **Blur radius** (0–5 px)      | Applied before thresholding. Reduces noise and fills small gaps.                                                             |
| **Simplification** (0–0.001°) | Douglas-Peucker tolerance. Higher = fewer vertices, smoother lines.                                                          |

Click **🔍 Run trace**. A red preview shows the detected lines on the map. Then:

- **✅ Add to GeoJSON** — merges traced features into the drawing layer.
- **💾 Export preview** — downloads only the traced result.
- **✕ Discard** — throws away the preview.

Re-run with different settings as many times as needed.

### Step 4 — Draw (manual)

Switch to **✏️ Draw** mode. Drawing controls appear in the top-right corner of the map:

- **Point**, **LineString**, **Polygon** draw tools
- **Trash** — delete the selected feature(s)

**Selecting features:**

- Click a feature on the map or in the sidebar list to select it.
- **Cmd/Ctrl+click** in the sidebar to toggle individual features into/out of a multi-selection.
- **Drag a rectangle** on the map (box-select) to select all features within the drawn area.

**Multi-selection actions** (shown in the sidebar when ≥ 2 features are selected):

- **⛓ Join** — chains all selected LineStrings into a single LineString by greedily connecting nearest endpoints.
- **🗑 Delete selected** — deletes all selected features at once.

**Single-feature editing:**

- Click a feature to select it — the sidebar reveals inline property fields (Name, Type, Description).
- Click **✱ Edit vertices** to enter vertex-editing mode; drag individual points, or click to delete them.
- The **Type** field has an autocomplete list of common military feature types: `phase-line`, `axis-of-advance`, `boundary`, `engagement-area`, `assault-position`, `fire-support-area`, `obstacle`, `route`.

Use **📂 Import** to load an existing GeoJSON, and **💾 Export** to download the current FeatureCollection.

---

## Keyboard Shortcuts

| Key                | Action                      |
| ------------------ | --------------------------- |
| `G`                | Switch to Georeference mode |
| `T`                | Switch to Trace mode        |
| `D`                | Switch to Draw mode         |
| `Ctrl+V` / `Cmd+V` | Paste image from clipboard  |

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 20
- [pnpm](https://pnpm.io/) ≥ 9

### Commands

```bash
# Install dependencies
pnpm install

# Start development server (hot reload)
pnpm dev

# Type-check + production build → dist/
pnpm build

# Preview the production build locally
pnpm preview
```

---

## Deployment (GitHub Pages)

The repository can be deployed to GitHub Pages automatically.

**Setup:**

1. Go to **Settings → Pages** in your GitHub repository.
2. Set **Source** to **GitHub Actions**.
3. Add a workflow file `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install
      - run: pnpm build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - uses: actions/deploy-pages@v4
        id: deployment
```

1. Push to `main` — the site is live at `https://<username>.github.io/image2geojson/`.

No API keys or secrets are required for the default OpenFreeMap tile source.

---

## License

MIT © Erik Vullings

