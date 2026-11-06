// Keep the full-size image useful before enhancement and on smaller screens.
const stage = document.querySelector('.intro-product-stage');
const desktop = matchMedia('(min-width: 701px)');
let pending = false;
let dispose = null;
async function update() {
  if (!desktop.matches) { dispose?.(); dispose = null; return; }
  if (!stage || dispose || pending) return;
  pending = true;
  try {
    const image = stage.querySelector('img');
    await image.decode();
    const {createHeroScene} = await import('./scene.js');
    if (desktop.matches) dispose = createHeroScene(stage, image);
  } catch { /* The original image remains visible if WebGL is unavailable. */ }
  finally { pending = false; }
}
desktop.addEventListener('change', update);
window.addEventListener('pagehide', event => { if (!event.persisted) { dispose?.(); dispose = null; } });
update();
