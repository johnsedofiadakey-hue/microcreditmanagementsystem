# Field Ledger photographic hero — design handoff

**21 October 2026 · concept, not a site release.** The public site remains owned by the backend session. This package is a concrete response to the owner's request for a colorful, interactive, full-hero photographic direction. `apps/site/`, the hosted trial, and trial data were not changed.

## Review the concept

- [Interactive desktop and phone prototype](field-ledger-hero-concept.html)
- [Desktop, 1440 × 900](hero-concept-desktop-1440.png) · [Phone, 390 × 844](hero-concept-phone-390.png) · [Narrow phone, 320 × 700](hero-concept-phone-320.png)

The photograph covers the whole first screen. Type, a dark green readability gradient and small gold accents sit over it. Three scenes crossfade with a restrained zoom; the third slide brings a deliberately bright fabric palette. Previous/next, direct slide selection, pause/play, arrow keys and swipe work in the prototype. Autoplay pauses on hover or focus. Reduced-motion users get a still initial frame. The CTA remains a real link and the first frame remains visible with JavaScript disabled.

The prototype's people and locations are illustrative Ghanaian documentary photographs. **They are not Gadufia Fiase customers, staff or premises, and no endorsement is implied.** The final site should keep that distinction visible until the client supplies consented local photography.

## Photo sources and use

| Prototype file | Scene | Photographer and source |
|---|---|---|
| `hero-concept-assets/accra-market.jpg` | Market street, Accra | Zeal Creative Studios, [Pexels photo](https://www.pexels.com/photo/bustling-market-scene-in-accra-ghana-36392318/) |
| `hero-concept-assets/ghana-produce.jpg` | Produce market, Ghana | Mensa Bonsu, [Pexels photo](https://www.pexels.com/photo/traditional-african-market-scene-with-produce-36611201/) |
| `hero-concept-assets/accra-fabrics.jpg` | Fabric market, Accra | WyteShot, [Pexels photo](https://www.pexels.com/photo/colorful-african-fabrics-displayed-at-market-35633192/) |

[Pexels' license](https://www.pexels.com/license/) permits free use and modification without required attribution, but prohibits implying endorsement by people or brands in the images. The prototype retains photographer credit here and labels the photos as illustrative in the hero. The downloaded images are optimized concept assets; the site owner should review the final image selection with the client and preserve source credits in project records.

## Site implementation request — REQUESTS #43

1. Replace the current illustration/orbit hero with a **full-bleed real photograph** covering the full hero area at desktop and phone widths. Use the three attached photos as the reviewable starting point, or client-approved local photographs with documented consent. Keep scene crops tuned separately for portrait and landscape; do not let text cover the main face or trade details.
2. Carry the prototype's field green, warm paper and gold treatment into the site's existing design system. The first screen should feel like a local financial service with real people and energy, while text and controls remain legible. Keep product copy accurate: Susu can be enquired about now; future STF and OPWS services should remain expressions of interest until launched.
3. Implement the carousel with semantic buttons, visible focus, previous/next, pause/play, touch swipe and keyboard support. Autoplay must pause on hover/focus and for reduced motion. Keep an image and useful copy visible when JavaScript has not hydrated. Avoid slide motion or announcements that interrupt reading.
4. Optimize the images through the site's image pipeline, preload only the opening scene, avoid layout shift, and check contrast against each image. Keep an image-free fallback color if loading fails.
5. Verify at 320, 390 and 1280 CSS px, keyboard-only, `prefers-reduced-motion: reduce`, and a slow connection. In the same site pass, address REQUESTS #40–#42 for copy, App Check, reflow and form accessibility. Do not present a build or screenshot as a completed hosted release; inspect the rendered site after the owner deploys it.

## Local checks of this package

Headless Chrome 155 loaded all three local JPEGs at 1440, 390 and 320 CSS px. The document width equaled the viewport at each size. Clicking Next changed the headline, counter and active photograph. The screenshots above were visually reviewed. This validates the concept prototype, not the Next.js implementation or live site.
