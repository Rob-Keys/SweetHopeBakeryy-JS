# TODO — Polish & Professionalism

Items ranked by impact on visual quality and user trust.

---

## Critical (affects trust / SEO)

### 1. Replace placeholder OG images
`index.html:10`, `menu.html:10` (and all other pages) — `og:image` points to `https://example.com/your-cake-photo.jpg`. Social shares will show a broken or empty card. Replace with a real product or brand photo hosted on the S3 bucket.

### 2. Fix page titles
`menu.html:7` sets `<title>Menu</title>`. Other pages may have similar bare titles. Each page title should include the brand name and be descriptive for SEO and browser tab readability, e.g. "Menu | Sweet Hope Bakery".

---

## High Impact (visible on every page)

### 3. Add a readable body font alongside Tagesschrift
`shared.css:12` applies the decorative `Tagesschrift` font to the entire body with `!important`. It is applied to form labels, dropdowns, cart items, and error messages — anywhere legibility matters. Pair it with a clean secondary font (e.g. `Lato`, `Inter`, or `Source Sans 3` from Google Fonts) for body copy and UI elements, reserving Tagesschrift for headings and the brand name only.

### 4. Fix the header layout hack
`header.js:28` — an absolutely positioned full-width `<div>` is injected to fill the visual gap below the pill-shaped header. This is fragile and incorrect. Fix the header CSS so it fills its container naturally (remove `border-radius: 500px` or change the approach so the background color extends to the edges without a hack).

### 5. Use the brand color for the Checkout button
`menu.html:45`, `menu.html:53` — both Checkout buttons use Bootstrap's `btn-primary` (blue), which clashes with the warm brown palette. Replace with `btn-cookie` (the brand button class already defined in `shared.css`) or a new `btn-checkout` variant using `#3f2a14`.

### 6. Modernize the footer copy
`footer.js:14` — "ALL RIGHTS RESERVED" in all caps reads as a relic from early-2000s websites. Change to normal sentence or title case: "All rights reserved."

### 7. Move inline `background-color` off the body tags
`index.html:27`, `menu.html:27`, and every other HTML file — `style="background-color:#fdf5e6"` is hardcoded inline, duplicating what `shared.css:13` already sets. Remove the inline styles; the CSS rule handles it.

---

## Medium Impact (polish and consistency)

### 8. Tighten the product image border
`menu.css:28` — `border: 8px #3f2a14 solid` on product images is unusually heavy. Reducing to 3–4px, or switching to a `border-radius` + `box-shadow` treatment (consistent with `.product-card`), would look more refined.

### 9. Replace the rhombus badge with something on-brand
`home.css:60-66` — the "World Class Baking Since 2002" badge uses a red gradient (`#A00000` → `#700000`) on a clip-path rhombus shape. The color is out of place on a warm cream-and-brown palette, and the rhombus shape reads as a throwback design element. Consider a simpler pill badge, a thin underline treatment, or a warm brown/gold consistent with the rest of the palette.

### 10. Standardize Bootstrap version
`index.html:25` loads `bootstrap@5.3.0-alpha1` CSS. `footer.js:21` loads `5.3.2` JS. Running mismatched major/minor versions of the same library is a potential source of bugs and sends a sloppy signal in code review. Align to `5.3.2` (or latest stable) across both.

### 11. Move inline button styles to CSS
`menu.js:136`, `menu.js:193` — the cart remove button has `style="color: red; background: none; border: none;"` hardcoded inline. Move to a `.remove-item-btn` rule in `menu.css`.

### 12. Add alt text to home page section images
`home.js:32` — home section images are rendered with no `alt` attribute. This fails basic accessibility and hurts image SEO. Populate alt from the section's title or description field.

---

## Lower Impact (cleanup)

### 13. Remove `!important` overrides on heading sizes
`shared.css:130-148` — h1–h5 and `p` font sizes are all set with `!important`. This makes it impossible for page-level CSS to customize type scale without also using `!important`. Define the base type scale once without the flag.

### 14. Add `<meta name="theme-color">` to all pages
Sets the browser chrome color on mobile (address bar, tab bar). Use `#3f2a14` to match the header. One line per HTML file in the `<head>`.

### 15. Reduce `contain-intrinsic-size` brittleness
`shared.css:127` — `.cv-auto` sets a fixed `contain-intrinsic-size: 1000px 800px` for all content-visibility sections. A single value doesn't fit both home page sections and product cards. Either remove it (modern browsers estimate this acceptably) or set different intrinsic sizes per context.
