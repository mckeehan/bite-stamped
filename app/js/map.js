// A small slippy map: OpenStreetMap tiles, drag to pan, pinch / wheel /
// double-tap / buttons to zoom, and pins that call back when tapped.
// No library. Tiles need a connection; pins and everything else work offline.
// Tile usage policy: https://operations.osmfoundation.org/policies/tiles/

const TILE = 256;
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const MIN_ZOOM = 2;
const MAX_ZOOM = 19;
// How close the map starts around `focus`: a few miles across on a phone.
export const START_ZOOM = 13;

// Web Mercator: lon/lat ↔ world position in [0, 1).
const toWorld = (lat, lon) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
};

// `pins`: [{ lat, lon, label, id }]. `onPin(id)` when one is tapped,
// `onPin(null)` when the map itself is tapped. With `focus` ({ lat, lon }),
// the map starts close around it (START_ZOOM) instead of showing every pin,
// unless the pins fit at that zoom anyway.
export function createMap(container, { pins = [], onPin = () => {}, here = null, focus = null } = {}) {
  container.classList.add('map');
  container.innerHTML = `
    <div class="map-tiles"></div>
    <div class="map-pins"></div>
    <div class="map-zoom">
      <button type="button" data-zoom="1" aria-label="Zoom in">+</button>
      <button type="button" data-zoom="-1" aria-label="Zoom out">−</button>
    </div>
    <a class="map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>`;
  const tileLayer = container.querySelector('.map-tiles');
  const pinLayer = container.querySelector('.map-pins');

  let zoom = 12;
  let center = { x: 0.5, y: 0.5 }; // world position
  let width = 0;
  let height = 0;
  const tiles = new Map(); // "z/x/y" → <img>

  const placed = pins
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'map-pin';
      el.title = p.label;
      el.setAttribute('aria-label', p.label);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        for (const q of placed) q.el.classList.toggle('selected', q.el === el);
        el.parentNode.append(el); // on top of its neighbours
        onPin(p.id);
      });
      pinLayer.append(el);
      return { ...p, world: toWorld(p.lat, p.lon), el };
    });
  let hereDot = null;
  const showHere = () => {
    if (!here || hereDot) return;
    hereDot = document.createElement('span');
    hereDot.className = 'map-here';
    hereDot.title = 'You are here';
    pinLayer.append(hereDot);
  };
  showHere();
  let moved = false; // the user panned or zoomed: leave the view alone

  const scale = () => TILE * 2 ** zoom;
  const toScreen = (w) => ({ x: (w.x - center.x) * scale() + width / 2, y: (w.y - center.y) * scale() + height / 2 });

  function draw() {
    const tz = Math.max(0, Math.min(MAX_ZOOM, Math.round(zoom)));
    const size = TILE * 2 ** (zoom - tz); // on-screen size of one tile
    const n = 2 ** tz;
    const left = center.x * n - width / 2 / size;
    const top = center.y * n - height / 2 / size;
    const wanted = new Set();
    for (let ty = Math.floor(top); ty < top + height / size; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(left); tx < left + width / size; tx++) {
        const x = ((tx % n) + n) % n;
        const key = `${tz}/${tx}/${ty}`;
        wanted.add(key);
        let img = tiles.get(key);
        if (!img) {
          img = new Image();
          img.alt = '';
          img.draggable = false;
          img.referrerPolicy = 'strict-origin-when-cross-origin';
          img.src = TILE_URL(tz, x, ty);
          img.onerror = () => img.classList.add('failed');
          tiles.set(key, img);
          tileLayer.append(img);
        }
        img.style.transform = `translate(${(tx - left) * size}px, ${(ty - top) * size}px)`;
        img.style.width = img.style.height = `${size + 0.5}px`;
      }
    }
    for (const [key, img] of tiles) {
      if (!wanted.has(key)) { img.remove(); tiles.delete(key); }
    }
    for (const p of placed) {
      const s = toScreen(p.world);
      p.el.style.transform = `translate(${s.x}px, ${s.y}px)`;
    }
    if (hereDot) {
      const s = toScreen(toWorld(here.lat, here.lon));
      hereDot.style.transform = `translate(${s.x}px, ${s.y}px)`;
    }
  }

  // Zoom to `z`, keeping the world point under screen point (sx, sy) in place.
  function zoomTo(z, sx = width / 2, sy = height / 2) {
    z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
    moved = true;
    const before = { x: center.x + (sx - width / 2) / scale(), y: center.y + (sy - height / 2) / scale() };
    zoom = z;
    center = { x: before.x - (sx - width / 2) / scale(), y: before.y - (sy - height / 2) / scale() };
    clampCenter();
    draw();
  }

  function clampCenter() {
    center.y = Math.max(0, Math.min(1, center.y));
    center.x = ((center.x % 1) + 1) % 1;
  }

  // Show every pin (and "here", if there are no pins); with a focus, start
  // close around it unless all pins fit at that zoom.
  function fit() {
    const points = placed.length ? placed.map((p) => p.world) : here ? [toWorld(here.lat, here.lon)] : [];
    if (!points.length) { zoom = 3; center = toWorld(30, -40); return draw(); }
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const pad = 48;
    const zx = Math.log2((width - pad * 2) / TILE / Math.max(maxX - minX, 1e-9));
    const zy = Math.log2((height - pad * 2) / TILE / Math.max(maxY - minY, 1e-9));
    zoom = Math.max(MIN_ZOOM, Math.min(15, Math.floor(Math.min(zx, zy) * 4) / 4));
    if (focus && zoom < START_ZOOM) {
      zoom = START_ZOOM;
      center = toWorld(focus.lat, focus.lon);
    }
    draw();
  }

  // The device's position arrived after the map opened: show it, and start
  // around it instead, if the user hasn't moved the map yet.
  function setHere(pos) {
    if (!pos) return;
    here = pos;
    showHere();
    if (!moved) { focus = pos; fit(); } else draw();
  }

  function resize() {
    const r = container.getBoundingClientRect();
    width = r.width;
    height = r.height;
    draw();
  }

  // --- input ---
  const pointers = new Map();
  let gesture = null;

  let tap = null; // where a one-finger press started, until it moves
  container.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, a')) return;
    tap = pointers.size ? null : { x: e.clientX, y: e.clientY };
    container.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
  });
  container.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) tap = null;
    const now = gestureState();
    if (!gesture || !now) return;
    if (now.distance && gesture.distance) {
      const r = container.getBoundingClientRect();
      zoomTo(gesture.zoom + Math.log2(now.distance / gesture.distance), now.x - r.left, now.y - r.top);
      gesture.zoom = zoom;
      gesture.distance = now.distance;
    }
    if (now.x !== gesture.x || now.y !== gesture.y) moved = true;
    center = { x: center.x - (now.x - gesture.x) / scale(), y: center.y - (now.y - gesture.y) / scale() };
    gesture.x = now.x;
    gesture.y = now.y;
    clampCenter();
    draw();
  });
  const end = (e) => {
    if (e.type === 'pointerup' && tap && pointers.size === 1) {
      for (const q of placed) q.el.classList.remove('selected');
      onPin(null);
    }
    tap = null;
    pointers.delete(e.pointerId);
    startGesture();
  };
  container.addEventListener('pointerup', end);
  container.addEventListener('pointercancel', end);

  function gestureState() {
    const ps = [...pointers.values()];
    if (!ps.length) return null;
    const x = ps.reduce((s, p) => s + p.x, 0) / ps.length;
    const y = ps.reduce((s, p) => s + p.y, 0) / ps.length;
    const distance = ps.length > 1 ? Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) : 0;
    return { x, y, distance };
  }
  function startGesture() {
    const s = gestureState();
    gesture = s ? { ...s, zoom } : null;
  }

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = container.getBoundingClientRect();
    zoomTo(zoom - e.deltaY * (e.deltaMode ? 0.05 : 0.002), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  container.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, a')) return;
    const r = container.getBoundingClientRect();
    zoomTo(Math.round(zoom) + 1, e.clientX - r.left, e.clientY - r.top);
  });
  container.querySelector('.map-zoom').addEventListener('click', (e) => {
    const b = e.target.closest('[data-zoom]');
    if (b) zoomTo(Math.round(zoom) + Number(b.dataset.zoom));
  });

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  fit();

  return { fit, setHere, destroy: () => observer.disconnect() };
}
