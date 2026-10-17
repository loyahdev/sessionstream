# SessionStream website

`index.html` is the entry point. All CSS, JavaScript, Three.js and image assets are in `websrc/`.

## Preview locally

From the directory containing index.html, run:

```sh
python3 -m http.server 8080
```

Open http://localhost:8080. Use a web server rather than double-clicking the file because the animation uses JavaScript modules. No npm install or build step is required.

## Hosting

Upload index.html and the complete websrc directory to any static host. Paths are relative, so the site also works in a subdirectory. Google Fonts load over the internet; system font fallbacks are included.

## Editing

- index.html: content and page structure
- websrc/styles.css: appearance and responsive layouts
- websrc/app.js: Three.js scene and animation
- websrc/three.module.js: Three.js r170 (MIT; see THREE-LICENSE.txt)

The screenshots and logo come from loyahdev/sessionstream. Product links point to that repository and its v0.30 release. This is a website mockup, not the SessionStream audio plugin or streaming service.
