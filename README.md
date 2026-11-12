# ELSEWHERE

Generate a random point near you and go and find it.

**Live: <https://elsewhere-point.pages.dev>**

Free, no account, no tracking, no server. Every calculation happens in the
browser tab. The only outbound requests are map tiles and, optionally, a
place-name lookup.

---

## What it actually does

Scatter 42,000 points uniformly through a ring around your position,
rasterise them onto a 96×96 grid, and score every grid square against the
count a uniform scatter would have put there.

| Type | Chosen square |
| --- | --- |
| **Attractor** | the largest surplus of points |
| **Void** | the largest deficit |
| **Random** | an ordinary point from the scatter, no test applied |
| **Blind spot** | a high-surplus square as far as possible from anything already in your journal |
| **Nearby** | an attractor restricted to squares within 300 m of a real, named place |
| **Landmark** | a named place itself, weighted towards places the scatter runs hot around |

Only squares lying **entirely inside the ring** are scored, so the expected
count per square is exactly `N × cellArea / ringArea`. That makes every score
a real standard score against a known distribution rather than a heuristic.
The figure works out at 6.044 points per square at every radius, which is
what the test harness asserts.

Each result reports:

- **σ** — how many standard deviations the chosen square sits from expected.
- **p** — the one-sided tail probability for that square.
- The number of squares at least that extreme you would expect from a
  uniform scatter, which is usually the honest number to look at.

Attractors land around σ +4.5 in practice, voids pin at σ −2.46 (every
zero-count square has exactly the same score, so the tie is broken at random).

### Known places

Separately from the scatter, the app asks Wikipedia which geotagged articles sit
inside your radius and keeps them on the device. That is a decent working
definition of a place somebody thought worth writing down: roughly 500 within
3 km of central Edinburgh, a dozen within 8 km of a Highland glen.

The places are projected into the same local plane as the scatter, so they can
constrain the search (**Nearby**), become the destination (**Landmark**), or
simply annotate the result with the nearest named thing. Dots for every known
place are drawn on the map with a canvas renderer, and the nearest one to your
point is lit.

Results are cached in IndexedDB for 24 hours, keyed by the rounded coordinate
and radius, so a second look at the same area costs one cache read and no
network. The store is capped at 8,000 rows and trims its oldest quarter when it
grows past that.

### What it is not

Nothing here is quantum. The randomness comes from `crypto.getRandomValues`,
seeded by the operating system, which is indistinguishable from any other
good source for this purpose.

The anomaly is an anomaly **in the sample**. It is a property of the numbers,
not of the place. A clump of points is not a vortex, a ley line or a signal.
The app says so in its own About panel rather than dressing it up.

## Privacy

- Position never leaves the device.
- Journal is `localStorage`, exportable as JSON.
- No analytics, no cookies, no identifiers, no accounts.
- No Cloudflare Functions, no D1, no KV. Static files only.
- The service worker never caches map tiles or place lookups, and never
  touches cross-origin requests.

## Stack

Plain HTML, CSS and classic `<script>` tags. No build step, no framework, no
bundler, no npm dependencies at runtime. Leaflet 1.9.4 is vendored.

```
site/
  index.html
  _headers                 security headers + cache policy
  manifest.webmanifest
  sw.js                    shell cache only
  assets/css/app.css
  assets/js/geo.js         haversine, bearing, local tangent plane
  assets/js/places.js      Wikipedia GeoSearch + IndexedDB cache
  assets/js/rng.js         crypto.getRandomValues -> Float64 uniforms
  assets/js/generator.js   the scatter, the grid, the z-scores
  assets/js/journal.js     localStorage CRUD + import/export
  assets/js/nav.js         watchPosition + device orientation compass
  assets/js/app.js         UI
  assets/vendor/leaflet/   Leaflet 1.9.4 (BSD-2-Clause)
tools/
  make_assets.py           regenerates the icons and the OG card
  e2e.js                   60 checks in real Chrome against any URL
  check_sw.js              13 checks on service-worker behaviour
```

## Run locally

```sh
cd site
python -m http.server 8787
# open http://127.0.0.1:8787
```

`127.0.0.1` counts as a secure context, so geolocation works.

## Test

```sh
node tools/e2e.js http://127.0.0.1:8787/          # local
node tools/e2e.js https://elsewhere-point.pages.dev/   # production
node tools/check_sw.js https://elsewhere-point.pages.dev/
```

The suite drives a real Chrome: it grants a synthetic GPS fix, fetches the known
places for the area, runs 128 generations across four radii and four point
types, asserts every point lands inside its ring, checks the closed-form
expected count, verifies determinism against fixed entropy, proves that Nearby
lands within reach of a real place and that Landmark returns one that exists,
and then exercises the whole UI — all six modes, the places drawer and filter,
generate, navigate, log a note, export, import, shared link, settings
persistence, and desktop containment. It exits non-zero on any failure.

## Deploy

```sh
unset CLOUDFLARE_API_TOKEN          # use the wrangler OAuth session
npx wrangler pages deploy site --project-name=elsewhere-point --branch=main
```

Deploy `site/` only. Do not deploy the repository root: `tools/` and `.git/`
must not be published.

## Licence

MIT. Leaflet is BSD-2-Clause. Map data © OpenStreetMap contributors, inverted
to a night palette in the browser with a CSS filter. Place names via
Nominatim.
