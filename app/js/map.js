// A small slippy map: OpenStreetMap tiles, drag to pan, pinch / wheel /
// double-tap / buttons to zoom, and pins that call back when tapped.
// Zoomed out, pins close together become one circle with their number
// (tap it to zoom in), and only what is on screen is drawn, so moving the
// map stays quick with thousands of places.
// No library. Tiles need a connection; pins and everything else work offline.
// Tile usage policy: https://operations.osmfoundation.org/policies/tiles/

const TILE = 256;
const TILE_URL = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const MIN_ZOOM = 2;
const MAX_ZOOM = 19;
// How close the map starts around `focus`: a few miles across on a phone.
export const START_ZOOM = 13;
// From this close in (a neighbourhood across), pins show their names.
export const LABEL_ZOOM = 15;
// Below this, pins closer than CLUSTER_PX on screen are grouped.
const CLUSTER_ZOOM = LABEL_ZOOM;
const CLUSTER_PX = 60;
const MERGE_PX = 44;

// Web Mercator: lon/lat ↔ world position in [0, 1).
const toWorld = (lat, lon) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return { x: (lon + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
};

// `pins`: [{ lat, lon, label, id }], the first ones the most important:
// zoomed in, their names are shown first where names would overlap.
// `onPin(id)` when one is tapped,
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
      el.hidden = true; // until drawn on screen
      el.title = p.label;
      el.setAttribute('aria-label', p.label);
      const name = document.createElement('span');
      name.className = 'map-label';
      name.textContent = p.label;
      name.setAttribute('aria-hidden', 'true');
      el.append(name);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        for (const q of placed) q.el.classList.toggle('selected', q.el === el);
        el.parentNode.append(el); // on top of its neighbours
        onPin(p.id);
        draw(); // its name now goes before the others'
      });
      pinLayer.append(el);
      return { ...p, world: toWorld(p.lat, p.lon), el, name, nameWidth: 0, on: false, screen: null };
    });

  // Groups of pins per whole zoom level, worked out once each: pins in the
  // same CLUSTER_PX square of the map at that zoom. Close in, each pin is
  // its own group.
  const groupCache = new Map();
  function groupsAt(z) {
    if (z >= CLUSTER_ZOOM) z = CLUSTER_ZOOM;
    if (groupCache.has(z)) return groupCache.get(z);
    let groups;
    if (z >= CLUSTER_ZOOM) {
      groups = placed.map((p) => ({ world: p.world, members: [p] }));
    } else {
      const cell = CLUSTER_PX / (TILE * 2 ** z);
      const cells = new Map();
      for (const p of placed) {
        const key = `${Math.floor(p.world.x / cell)}:${Math.floor(p.world.y / cell)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(p);
      }
      const middle = (members) => ({
        x: members.reduce((s, p) => s + p.world.x, 0) / members.length,
        y: members.reduce((s, p) => s + p.world.y, 0) / members.length,
      });
      // Where a circle goes is the middle of its places, so circles from
      // neighbouring squares can still land on each other: those closer
      // than MERGE_PX become one, the bigger ones taking in the smaller.
      const near = MERGE_PX / (TILE * 2 ** z);
      const kept = new Map(); // square of side `near` → groups kept there
      groups = [];
      for (const members of [...cells.values()].sort((a, b) => b.length - a.length)) {
        const world = middle(members);
        const gx = Math.floor(world.x / near);
        const gy = Math.floor(world.y / near);
        let into = null;
        for (let dy = -1; dy <= 1 && !into; dy++) {
          for (let dx = -1; dx <= 1 && !into; dx++) {
            into = (kept.get(`${gx + dx}:${gy + dy}`) || []).find((g) => Math.hypot(g.world.x - world.x, g.world.y - world.y) < near) || null;
          }
        }
        if (into) { into.members.push(...members); continue; }
        const group = { members, world };
        groups.push(group);
        const key = `${gx}:${gy}`;
        if (!kept.has(key)) kept.set(key, []);
        kept.get(key).push(group);
      }
      // A group that took others in sits in the middle of all its places.
      for (const g of groups) g.world = middle(g.members);
    }
    groupCache.set(z, groups);
    return groups;
  }

  // Circles for groups, reused from draw to draw.
  const circles = [];
  let circlesUsed = 0;
  function circle(group) {
    let el = circles[circlesUsed];
    if (!el) {
      el = document.createElement('button');
      el.type = 'button';
      el.className = 'map-cluster';
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomToGroup(el.group);
      });
      pinLayer.append(el);
      circles.push(el);
    }
    circlesUsed++;
    const n = group.members.length;
    if (el.group?.members.length !== n) {
      el.textContent = n > 999 ? `${Math.floor(n / 1000)}k` : String(n);
      el.setAttribute('aria-label', `${n} places: zoom in`);
      el.dataset.size = n < 10 ? 's' : n < 100 ? 'm' : 'l';
    }
    el.group = group;
    el.hidden = false;
    return el;
  }

  // Tapping a circle: zoom in until its places fit (at least one step).
  function zoomToGroup(group) {
    const xs = group.members.map((p) => p.world.x);
    const ys = group.members.map((p) => p.world.y);
    const pad = 60;
    const zx = Math.log2((width - pad * 2) / TILE / Math.max(Math.max(...xs) - Math.min(...xs), 1e-9));
    const zy = Math.log2((height - pad * 2) / TILE / Math.max(Math.max(...ys) - Math.min(...ys), 1e-9));
    moved = true;
    center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    zoom = Math.max(Math.floor(zoom) + 1, Math.min(MAX_ZOOM - 1, Math.floor(Math.min(zx, zy))));
    clampCenter();
    draw();
  }
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
    // Pins and circles on screen (a little beyond, so they don't pop in at
    // the edges); the rest are hidden, not moved.
    const groups = groupsAt(Math.floor(zoom + 1e-6));
    circlesUsed = 0;
    const onNow = new Set();
    for (const g of groups) {
      const s = toScreen(g.world);
      if (s.x < -60 || s.x > width + 60 || s.y < -40 || s.y > height + 60) continue;
      if (g.members.length === 1) {
        const p = g.members[0];
        p.screen = s;
        p.el.style.transform = `translate(${s.x}px, ${s.y}px)`;
        onNow.add(p);
      } else {
        circle(g).style.transform = `translate(${s.x}px, ${s.y}px)`;
      }
    }
    for (const p of placed) {
      const on = onNow.has(p);
      if (on !== p.on) { p.el.hidden = !on; p.on = on; }
    }
    for (let i = circlesUsed; i < circles.length; i++) if (!circles[i].hidden) circles[i].hidden = true;
    drawLabels();
    if (hereDot) {
      const s = toScreen(toWorld(here.lat, here.lon));
      hereDot.style.transform = `translate(${s.x}px, ${s.y}px)`;
    }
  }

  // Names next to the pins, once zoomed in far enough: the selected pin's
  // first, then in the order given, each only where it doesn't cover a name
  // already shown (or a pin's own name, its pin).
  let labelsOn = false;
  function drawLabels() {
    const on = zoom >= LABEL_ZOOM - 0.01;
    if (on !== labelsOn) container.classList.toggle('map-labels', (labelsOn = on));
    if (!on) return;
    const visible = placed.filter((p) => p.on && p.screen.x > -160 && p.screen.x < width + 20 && p.screen.y > -20 && p.screen.y < height + 40);
    // Widths once each (shown names are measured the first time).
    const unmeasured = visible.filter((p) => !p.nameWidth);
    for (const p of unmeasured) p.name.hidden = false;
    for (const p of unmeasured) p.nameWidth = p.name.offsetWidth || 1;
    const order = [...visible.filter((p) => p.el.classList.contains('selected')), ...visible.filter((p) => !p.el.classList.contains('selected'))];
    const taken = [];
    const overlaps = (r) => taken.some((t) => r.x1 < t.x2 && r.x2 > t.x1 && r.y1 < t.y2 && r.y2 > t.y1);
    // The pins themselves, so names don't cover them.
    for (const p of order) taken.push({ x1: p.screen.x - 11, x2: p.screen.x + 11, y1: p.screen.y - 30, y2: p.screen.y });
    const shown = new Set();
    for (const p of order) {
      // Right of the pin, level with its head (see .map-label); left of it
      // where the right would run off the map.
      const y1 = p.screen.y - 27;
      const y2 = p.screen.y - 9;
      const right = { x1: p.screen.x + 13, x2: p.screen.x + 15 + p.nameWidth, y1, y2 };
      const left = { x1: p.screen.x - 15 - p.nameWidth, x2: p.screen.x - 13, y1, y2 };
      const flip = right.x2 > width - 4 && left.x1 >= 4;
      const r = flip ? left : right;
      if (overlaps(r)) continue;
      taken.push(r);
      shown.add(p);
      p.name.classList.toggle('left', flip);
    }
    for (const p of placed) p.name.hidden = !shown.has(p);
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
