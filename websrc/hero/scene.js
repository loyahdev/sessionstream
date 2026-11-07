import {
  AmbientLight, DirectionalLight, ExtrudeGeometry, Group, MathUtils, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, NoToneMapping, PerspectiveCamera,
  Scene, Shape, ShapeGeometry, SRGBColorSpace, Texture, Vector3, WebGLRenderer,
} from 'three';

function roundedRectangle(width, height, radius) {
  const x = -width / 2, y = -height / 2;
  return new Shape().moveTo(x + radius, y)
    .lineTo(x + width - radius, y).quadraticCurveTo(x + width, y, x + width, y + radius)
    .lineTo(x + width, y + height - radius).quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
    .lineTo(x + radius, y + height).quadraticCurveTo(x, y + height, x, y + height - radius)
    .lineTo(x, y + radius).quadraticCurveTo(x, y, x + radius, y);
}

export function createHeroScene(stage, image) {
  const button = stage.querySelector('.intro-product-shot');
  const surface = document.createElement('span');
  surface.className = 'hero-scene';
  surface.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.dataset.renderer = 'three';
  surface.append(canvas);
  const context = canvas.getContext('webgl2', {alpha: true, antialias: true, powerPreference: 'low-power'});
  if (!context) return () => {};
  const renderer = new WebGLRenderer({canvas, context, alpha: true, antialias: true, powerPreference: 'low-power'});
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NoToneMapping;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new Scene();
  const camera = new PerspectiveCamera(24, 1, .1, 100);
  const panel = new Group();
  const width = 10, height = width * image.naturalHeight / image.naturalWidth;
  // The front is a rigid plane with the screenshot's exact aspect ratio.
  const faceGeometry = new ShapeGeometry(roundedRectangle(width, height, .075), 12);
  const positions = faceGeometry.attributes.position, uv = faceGeometry.attributes.uv;
  for (let i = 0; i < positions.count; i++) {
    uv.setXY(i, positions.getX(i) / width + .5, positions.getY(i) / height + .5);
  }
  const texture = new Texture(image);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  texture.needsUpdate = true;
  const faceMaterial = new MeshBasicMaterial({map: texture, toneMapped: false});
  const face = new Mesh(faceGeometry, faceMaterial);
  face.position.z = .009;
  panel.add(face);

  const frameGeometry = new ExtrudeGeometry(roundedRectangle(width + .025, height + .025, .085), {
    depth: .038, bevelEnabled: true, bevelSize: .012, bevelThickness: .012, bevelSegments: 3, curveSegments: 12, steps: 1,
  });
  const frameMaterial = new MeshStandardMaterial({color: 0x303a29, metalness: .15, roughness: .7});
  const frame = new Mesh(frameGeometry, frameMaterial);
  frame.position.z = -.052;
  panel.add(frame);
  panel.rotation.set(0, -.07, MathUtils.degToRad(7));
  scene.add(panel, new AmbientLight(0xffffff, 1.8));
  const key = new DirectionalLight(0xe6f2d9, 2.6);
  key.position.set(-4, 8, 10);
  scene.add(key);
  const fill = new DirectionalLight(0xb6c7aa, .7);
  fill.position.set(6, 0, 5);
  scene.add(fill);

  button.append(surface);
  let disposed = false, contextLost = false;
  function render() {
    if (disposed || contextLost) return;
    button.classList.add('is-3d');
    const bounds = surface.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    camera.aspect = bounds.width / bounds.height;
    // A long camera distance keeps near and far edges close in scale.
    const distance = width / (2 * Math.tan(MathUtils.degToRad(camera.fov / 2)) * camera.aspect * .82);
    const target = new Vector3(0, .65, 0);
    camera.position.copy(new Vector3(.35, -7.3, 20).normalize().multiplyScalar(distance).add(target));
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    renderer.setSize(bounds.width, bounds.height, false);
    renderer.render(scene, camera);
    button.classList.add('is-3d');
  }
  const observer = new ResizeObserver(render);
  observer.observe(stage);
  const onLost = event => { event.preventDefault(); contextLost = true; button.classList.remove('is-3d'); };
  const onRestored = () => { contextLost = false; render(); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  try { render(); } catch { cleanup(); return () => {}; }

  function cleanup() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    button.classList.remove('is-3d');
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    faceGeometry.dispose(); frameGeometry.dispose(); faceMaterial.dispose(); frameMaterial.dispose(); texture.dispose();
    renderer.dispose(); renderer.forceContextLoss(); surface.remove();
  }
  return cleanup;
}
