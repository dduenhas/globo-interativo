/* =========================================================
   GLOBO INTERATIVO // VISUALIZAÇÃO PLANETÁRIA EM TEMPO REAL
   Globo 3D + satélites + arcos + cabos + dia/noite + dossiês
   ========================================================= */
import * as solar from "solar-calculator";

const THREE = window.THREE;
if (!THREE) throw new Error("Three.js não carregado.");

const COUNTRIES_URL =
  "https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson";
const META_URL = "https://raw.githubusercontent.com/mledoze/countries/master/countries.json";
const TZ_URL =
  "https://raw.githubusercontent.com/dr5hn/countries-states-cities-database/master/json/countries.json";
const IMG = "https://unpkg.com/three-globe/example/img/";
const TEX_DAY = IMG + "earth-blue-marble.jpg";
const TEX_NIGHT = IMG + "earth-night.jpg";
const TEX_SHADER_DAY = "/img/earth-day.jpg";
const TEX_SHADER_NIGHT = "/img/earth-night.jpg";
const LABEL_FONT_URL =
  "https://cdn.jsdelivr.net/npm/@compai/font-roboto/data/typefaces/normal-400.json";

const el = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const nf = new Intl.NumberFormat("pt-BR");

/* ---------- Boot sequence ---------- */
const bootLines = [
  "[ GLOBO INTERATIVO · NÚCLEO v3.0 ]  inicializando ...",
  "> montando /dev/orbital0 ................... OK",
  "> calibrando matriz giroscópica ........... OK",
  "> uplink com constelação [GX-9] ........... OK",
  "> sincronizando relógio solar (UTC) ....... OK",
  "> carregando fronteiras vetoriais ......... OK",
  "> implantando malha de satélites (LEO/MEO)  OK",
  "> mapeando malha de cabos submarinos ...... OK",
  "> conectando feeds estatísticos ........... OK",
  "> render pipeline (WebGL2) ................ OK",
  "> TERMINAL PLANETÁRIO ONLINE",
];
(function runBoot() {
  const out = el("bootText");
  let i = 0;
  const tick = () => {
    if (i < bootLines.length) {
      out.textContent += bootLines[i++] + "\n";
      setTimeout(tick, 180 + Math.random() * 150);
    } else {
      setTimeout(() => el("boot").classList.add("hidden"), 450);
    }
  };
  tick();
})();

/* ---------- Live UTC clock ---------- */
setInterval(() => {
  el("utcClock").textContent = new Date().toISOString().slice(11, 19) + " UTC";
}, 1000);

/* ---------- Telemetry / code stream ---------- */
const stream = el("codeStream");
const hex = (n) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16))
    .join("")
    .toUpperCase();
const rnd = (a, b, d = 0) => (a + Math.random() * (b - a)).toFixed(d);

const logTemplates = [
  () => `<span class="k">sat</span>.track(<span class="v">0x${hex(4)}</span>) → <span class="ok">LOCKED</span>`,
  () => `vec[<span class="v">${rnd(-180,180,3)}</span>,<span class="v">${rnd(-90,90,3)}</span>] dx=<span class="v">${rnd(0,9,2)}</span>`,
  () => `<span class="k">orbit</span>.alt=<span class="v">${rnd(540,1200,1)}</span>km incl=<span class="v">${rnd(0,98,1)}</span>°`,
  () => `frame ${hex(6)} crc=<span class="ok">PASS</span>`,
  () => `<span class="k">scan</span> setor ${hex(2)} :: ${rnd(0,100,0)}% concluído`,
  () => `térmico ${rnd(-60,42,1)}°C  fluxo=<span class="v">${rnd(0,9,3)}</span>`,
  () => `pkt ${hex(8)} → nó relay <span class="v">${rnd(1,64,0)}</span>`,
  () => `<span class="k">cable</span>.bgp peer ${hex(2)} ........ <span class="ok">UP</span>`,
  () => `anomalia q=<span class="err">${rnd(0,3,2)}</span> filtrada`,
  () => `gnss fix=<span class="ok">3D</span> sats=<span class="v">${rnd(8,22,0)}</span>`,
];
function pushLog(html) {
  const div = document.createElement("div");
  div.className = "ln";
  div.innerHTML = `<span style="opacity:.4">${new Date()
    .toISOString()
    .slice(11, 23)}</span> ${html}`;
  stream.appendChild(div);
  while (stream.children.length > 60) stream.removeChild(stream.firstChild);
  stream.scrollTop = stream.scrollHeight;
}
setInterval(() => {
  pushLog(logTemplates[Math.floor(Math.random() * logTemplates.length)]());
}, 460);

/* =========================================================
   GEO HELPERS
   ========================================================= */
const fmtPop = (n) =>
  !n || n < 0
    ? "—"
    : n >= 1e9
    ? (n / 1e9).toFixed(2) + " B"
    : n >= 1e6
    ? (n / 1e6).toFixed(1) + " M"
    : (n / 1e3).toFixed(0) + " K";

function mainRing(geometry) {
  if (geometry.type === "Polygon") return geometry.coordinates[0];
  let best = [];
  for (const poly of geometry.coordinates) {
    if (poly[0] && poly[0].length > best.length) best = poly[0];
  }
  return best;
}
function sphericalCentroid(ring) {
  let x = 0, y = 0, z = 0;
  for (const [lng, lat] of ring) {
    const la = lat * DEG, lo = lng * DEG;
    x += Math.cos(la) * Math.cos(lo);
    y += Math.cos(la) * Math.sin(lo);
    z += Math.sin(la);
  }
  const n = ring.length || 1;
  x /= n; y /= n; z /= n;
  return {
    lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / DEG,
    lng: Math.atan2(y, x) / DEG,
  };
}
function greatCircle(a, b, steps = 32) {
  const toVec = (p) => {
    const la = p[0] * DEG, lo = p[1] * DEG;
    return new THREE.Vector3(
      Math.cos(la) * Math.cos(lo),
      Math.cos(la) * Math.sin(lo),
      Math.sin(la)
    );
  };
  const va = toVec(a), vb = toVec(b);
  const omega = Math.acos(THREE.MathUtils.clamp(va.dot(vb), -1, 1));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let v;
    if (omega < 1e-6) v = va.clone();
    else {
      const s1 = Math.sin((1 - t) * omega) / Math.sin(omega);
      const s2 = Math.sin(t * omega) / Math.sin(omega);
      v = va.clone().multiplyScalar(s1).add(vb.clone().multiplyScalar(s2));
    }
    v.normalize();
    pts.push([
      Math.asin(THREE.MathUtils.clamp(v.z, -1, 1)) / DEG,
      Math.atan2(v.y, v.x) / DEG,
    ]);
  }
  return pts;
}
// classificação climática aproximada pela latitude
function climateOf(lat) {
  const a = Math.abs(lat);
  if (a < 10) return "Equatorial / Tropical úmido";
  if (a < 23.5) return "Tropical";
  if (a < 35) return "Subtropical / Árido";
  if (a < 55) return "Temperado";
  if (a < 66.5) return "Frio / Boreal";
  return "Polar";
}
// posição solar precisa (globe.gl official + solar-calculator)
function sunPosAt(dt = Date.now()) {
  const day = new Date(+dt).setUTCHours(0, 0, 0, 0);
  const t = solar.century(dt);
  const lng = (day - dt) / 864e5 * 360 - 180 - solar.equationOfTime(t) / 4;
  return { lng, lat: solar.declination(t) };
}
function subsolarPoint(date = new Date()) {
  return sunPosAt(+date);
}
// distância Terra-Sol aprox (órbita elíptica) em km
function earthSunDistance(date = new Date()) {
  const yStart = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date - yStart) / 86400000;
  return 149.6e6 * (1 - 0.0167 * Math.cos((360 / 365) * (doy - 4) * DEG));
}

/* =========================================================
   DADOS: cidades, arcos, cabos, satélites
   ========================================================= */
const CITIES = {
  nyc: [40.71, -74.01], lon: [51.51, -0.13], tky: [35.68, 139.69],
  sgp: [1.35, 103.82], syd: [-33.87, 151.21], sao: [-23.55, -46.63],
  dxb: [25.2, 55.27], mum: [19.08, 72.88], fra: [50.11, 8.68],
  lax: [34.05, -118.24], hkg: [22.32, 114.17], mow: [55.75, 37.62],
  cai: [30.04, 31.24], jnb: [-26.2, 28.04], los: [6.52, 3.38],
  par: [48.85, 2.35], yto: [43.65, -79.38], mex: [19.43, -99.13],
  bue: [-34.6, -58.38], sel: [37.57, 126.98], jkt: [-6.21, 106.85],
  ist: [41.01, 28.98], nbo: [-1.29, 36.82], sfo: [37.77, -122.42],
  ams: [52.37, 4.9],
};
const CK = Object.keys(CITIES);

function buildArcs(n = 24) {
  const arcs = [];
  for (let i = 0; i < n; i++) {
    let a = CK[Math.floor(Math.random() * CK.length)];
    let b = CK[Math.floor(Math.random() * CK.length)];
    while (b === a) b = CK[Math.floor(Math.random() * CK.length)];
    arcs.push({
      startLat: CITIES[a][0], startLng: CITIES[a][1],
      endLat: CITIES[b][0], endLng: CITIES[b][1],
      dashTime: 2500 + Math.random() * 3500,
    });
  }
  return arcs;
}

const CABLES_URL = "/data/cable-geo.json"; // TeleGeography · submarinecablemap.com (CC BY-NC-SA 3.0)

function cableGeoToPaths(geojson) {
  const paths = [];
  for (const { geometry, properties } of geojson.features || []) {
    if (!geometry?.coordinates) continue;
    const segments = geometry.type === "MultiLineString"
      ? geometry.coordinates
      : geometry.type === "LineString"
        ? [geometry.coordinates]
        : [];
    for (const coords of segments) {
      const points = coords.map(([lng, lat]) => [lat, lng, 0.002]);
      if (points.length >= 2) paths.push({ points, name: properties?.name || "" });
    }
  }
  return paths;
}

function loadSubmarineCables() {
  return fetch(CABLES_URL)
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then((geo) => {
      CABLES = cableGeoToPaths(geo);
      if (state.cables) world.pathsData(CABLES);
      pushLog(`<span class="k">cables</span> ${CABLES.length} rotas · TeleGeography <span class="ok">OK</span>`);
    })
    .catch((err) => {
      pushLog(`<span class="err">cables: falha ao carregar (${err})</span>`);
    });
}

function buildSats(n = 18) {
  const sats = [];
  for (let i = 0; i < n; i++) {
    const comm = Math.random() < 0.3;
    sats.push({
      alt: comm ? 0.55 + Math.random() * 0.25 : 0.18 + Math.random() * 0.22,
      incl: (Math.random() * 2 - 1) * (35 + Math.random() * 45),
      raan: Math.random() * 360,
      phase: Math.random() * Math.PI * 2,
      speed: (comm ? 0.05 : 0.12) + Math.random() * 0.08,
      color: comm ? "#ffb454" : "#46e6ff",
      lat: 0, lng: 0,
    });
  }
  return sats;
}
function makeSatObject(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.4, 0),
    new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.85 })
  );
  g.add(body);
  const panelMat = new THREE.MeshLambertMaterial({
    color: "#0a2230", emissive: "#0a3344", emissiveIntensity: 0.4,
  });
  const pL = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.15, 1.3), panelMat);
  pL.position.x = -2.6;
  const pR = pL.clone();
  pR.position.x = 2.6;
  g.add(pL, pR);
  g.add(new THREE.Mesh(
    new THREE.SphereGeometry(2.4, 12, 12),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12 })
  ));
  return g;
}

/* =========================================================
   CAMADA FUSOS HORÁRIOS — meridianos + rótulos UTC (Three.js, não-interativo)
   ========================================================= */
const TZ_STEP = 15;
const TZ_BANDS = [];
let tzMeridiansGroup = null;
let tropicsGroup = null;
let lastTzLabelMin = -1;
const NO_RAYCAST = () => {};

/* Acima do polígono em hover/seleção (0.06) para linhas ficarem sempre visíveis */
const GRID_LINE_ALT = 0.075;
const GRID_LABEL_ALT = 0.085;
const GRID_RENDER_ORDER = 20;
const TROPIC_LAT = 23.436;
const TROPIC_LINES = [
  { lat: 0, opacity: 0.95, name: "EQUADOR", lng: -30 },
  { lat: TROPIC_LAT, opacity: 0.82, name: "TRÓPICO DE CÂNCER", lng: 45 },
  { lat: -TROPIC_LAT, opacity: 0.82, name: "TRÓPICO DE CAPRICÓRNIO", lng: -120 },
];
const TROPIC_LABEL_COLORS = {
  stroke: "rgba(70,230,255,0.7)",
  fill: "#46e6ff",
};

(function buildTzBands() {
  for (let i = 0; i < 24; i++) {
    const lngW = -180 + i * TZ_STEP;
    const centerLng = lngW + TZ_STEP / 2;
    TZ_BANDS.push({ centerLng, offsetH: centerLng / 15 });
  }
})();

function formatUtcOffset(h) {
  const hi = Math.round(h);
  if (hi === 0) return "UTC+0";
  return hi > 0 ? `UTC+${hi}` : `UTC${hi}`;
}

function timeAtOffsetHours(h, now = Date.now()) {
  const utc = now + new Date().getTimezoneOffset() * 60000;
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(utc + Math.round(h) * 3600000));
}

function tzLabelText(band, now = Date.now()) {
  const h = Math.round(band.offsetH);
  return `${formatUtcOffset(h)}: ${timeAtOffsetHours(h, now)}`;
}

const TZ_LABEL_FONT = '600 17px "Share Tech Mono", monospace';
const TZ_LABEL_PAD_X = 16;
const TZ_LABEL_H = 38;
const TZ_LABEL_SCALE_H = 2.15;

function paintGridLabelSprite(sprite, text, { stroke, fill }) {
  const canvas = sprite.userData._canvas;
  const ctx = canvas.getContext("2d");
  ctx.font = TZ_LABEL_FONT;
  const textW = Math.ceil(ctx.measureText(text).width);
  const needW = Math.max(textW + TZ_LABEL_PAD_X * 2, 72);
  if (canvas.width !== needW || canvas.height !== TZ_LABEL_H) {
    canvas.width = needW;
    canvas.height = TZ_LABEL_H;
    sprite.userData._texture.dispose();
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    sprite.userData._texture = tex;
    sprite.material.map = tex;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(3,12,18,0.92)";
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 4);
  ctx.fill();
  ctx.stroke();
  ctx.font = TZ_LABEL_FONT;
  ctx.fillStyle = fill;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  sprite.userData._texture.needsUpdate = true;
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(aspect * TZ_LABEL_SCALE_H, TZ_LABEL_SCALE_H, 1);
}

function paintTzLabelSprite(sprite, text) {
  paintGridLabelSprite(sprite, text, {
    stroke: "rgba(255,180,84,0.7)",
    fill: "#ffb454",
  });
}

function makeGridLabelSprite(text, colors) {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = TZ_LABEL_H;
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: true, depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = GRID_RENDER_ORDER + 2;
  sprite.raycast = NO_RAYCAST;
  sprite.userData._canvas = canvas;
  sprite.userData._texture = texture;
  paintGridLabelSprite(sprite, text, colors);
  return sprite;
}

function makeTzLabelSprite(text) {
  return makeGridLabelSprite(text, {
    stroke: "rgba(255,180,84,0.7)",
    fill: "#ffb454",
  });
}

function meridianPositions(lng, alt = GRID_LINE_ALT) {
  const positions = [];
  for (let lat = -85; lat <= 85; lat += 4) {
    const { x, y, z } = world.getCoords(lat, lng, alt);
    positions.push(x, y, z);
  }
  return positions;
}

function parallelPositions(lat, alt = GRID_LINE_ALT) {
  const positions = [];
  for (let lng = -180; lng <= 180; lng += 4) {
    const { x, y, z } = world.getCoords(lat, lng, alt);
    positions.push(x, y, z);
  }
  return positions;
}

function addGlobeLine(group, positions, color, opacity = 0.88) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
    color, transparent: true, opacity,
    depthTest: true, depthWrite: false,
  }));
  line.frustumCulled = false;
  line.renderOrder = GRID_RENDER_ORDER;
  line.raycast = NO_RAYCAST;
  group.add(line);
}

function buildTzMeridiansGroup() {
  const group = new THREE.Group();
  group.name = "tzMeridians";
  group.renderOrder = GRID_RENDER_ORDER;
  group.raycast = NO_RAYCAST;

  for (let lng = -180; lng <= 180; lng += TZ_STEP) {
    addGlobeLine(group, meridianPositions(lng), 0xffb454);
  }

  const labelsGroup = new THREE.Group();
  labelsGroup.name = "tzLabels";
  labelsGroup.raycast = NO_RAYCAST;
  const now = Date.now();
  for (const band of TZ_BANDS) {
    const sprite = makeTzLabelSprite(tzLabelText(band, now));
    sprite.userData.tzBand = band;
    const { x, y, z } = world.getCoords(14, band.centerLng, GRID_LABEL_ALT);
    sprite.position.set(x, y, z);
    labelsGroup.add(sprite);
  }
  group.add(labelsGroup);
  group.userData.labelsGroup = labelsGroup;
  group.visible = false;
  return group;
}

function buildTropicsGroup() {
  const group = new THREE.Group();
  group.name = "tropics";
  group.renderOrder = GRID_RENDER_ORDER;
  group.raycast = NO_RAYCAST;

  const labelsGroup = new THREE.Group();
  labelsGroup.name = "tropicLabels";
  labelsGroup.raycast = NO_RAYCAST;

  for (const { lat, opacity, name, lng } of TROPIC_LINES) {
    addGlobeLine(group, parallelPositions(lat), 0x46e6ff, opacity);
    const sprite = makeGridLabelSprite(name, TROPIC_LABEL_COLORS);
    const { x, y, z } = world.getCoords(lat, lng, GRID_LABEL_ALT);
    sprite.position.set(x, y, z);
    labelsGroup.add(sprite);
  }

  group.add(labelsGroup);
  group.visible = false;
  return group;
}

function updateTzLabelSprites(now = Date.now()) {
  if (!tzMeridiansGroup || !state.tz) return;
  const labelsGroup = tzMeridiansGroup.userData.labelsGroup;
  if (!labelsGroup) return;
  for (const sprite of labelsGroup.children) {
    paintTzLabelSprite(sprite, tzLabelText(sprite.userData.tzBand, now));
  }
}

function setTzMeridians(on) {
  if (!tzMeridiansGroup) return;
  tzMeridiansGroup.visible = on;
  if (on) updateTzLabelSprites();
}

function setTropics(on) {
  if (!tropicsGroup) return;
  tropicsGroup.visible = on;
}

function polygonDataset() {
  return FEATURES;
}

function activePaths() {
  return state.cables ? CABLES : [];
}

function activeLabels() {
  return state.labels ? LABELS : [];
}

function polygonStrokeColorFn() {
  return state.borders ? "#46e6ff" : "rgba(0,0,0,0)";
}

/* =========================================================
   SHADER DIA/NOITE (oficial globe.gl + solar-calculator)
   ========================================================= */
const DAY_NIGHT_SHADER = {
  vertexShader: `
    varying vec3 vNormal;
    varying vec2 vUv;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    #define PI 3.141592653589793
    uniform sampler2D dayTexture;
    uniform sampler2D nightTexture;
    uniform vec2 sunPosition;
    uniform vec2 globeRotation;
    varying vec3 vNormal;
    varying vec2 vUv;
    float toRad(in float a) { return a * PI / 180.0; }
    vec3 Polar2Cartesian(in vec2 c) {
      float theta = toRad(90.0 - c.x);
      float phi = toRad(90.0 - c.y);
      return vec3(sin(phi) * cos(theta), cos(phi), sin(phi) * sin(theta));
    }
    void main() {
      float invLon = toRad(globeRotation.x);
      float invLat = -toRad(globeRotation.y);
      mat3 rotX = mat3(1,0,0, 0,cos(invLat),-sin(invLat), 0,sin(invLat),cos(invLat));
      mat3 rotY = mat3(cos(invLon),0,sin(invLon), 0,1,0, -sin(invLon),0,cos(invLon));
      vec3 sunDir = rotX * rotY * Polar2Cartesian(sunPosition);
      float intensity = dot(normalize(vNormal), normalize(sunDir));
      vec4 dayColor = texture2D(dayTexture, vUv);
      vec4 nightColor = texture2D(nightTexture, vUv);
      float blend = smoothstep(-0.1, 0.1, intensity);
      gl_FragColor = mix(nightColor, dayColor, blend);
    }
  `,
};
let dayNightMaterial = null;
let dayNightReady = false;
const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin("anonymous");
Promise.all([
  texLoader.loadAsync(TEX_SHADER_DAY),
  texLoader.loadAsync(TEX_SHADER_NIGHT),
]).then(([dayTex, nightTex]) => {
  if ("SRGBColorSpace" in THREE) {
    dayTex.colorSpace = THREE.SRGBColorSpace;
    nightTex.colorSpace = THREE.SRGBColorSpace;
  }
  dayNightMaterial = new THREE.ShaderMaterial({
    uniforms: {
      dayTexture: { value: dayTex },
      nightTexture: { value: nightTex },
      sunPosition: { value: new THREE.Vector2() },
      globeRotation: { value: new THREE.Vector2() },
    },
    vertexShader: DAY_NIGHT_SHADER.vertexShader,
    fragmentShader: DAY_NIGHT_SHADER.fragmentShader,
    toneMapped: false,
  });
  dayNightReady = true;
  if (state.daynight) setDayNight(true);
  pushLog(`<span class="k">shader</span> texturas dia/noite ........ <span class="ok">OK</span>`);
}).catch(() => pushLog(`<span class="err">shader: falha ao carregar texturas</span>`));

function updateDayNightUniforms(dt = Date.now()) {
  if (!dayNightMaterial) return;
  const sp = sunPosAt(dt);
  dayNightMaterial.uniforms.sunPosition.value.set(sp.lng, sp.lat);
}

/* =========================================================
   GLOBO
   ========================================================= */
const state = {
  night: false, daynight: false, rotate: true, borders: false,
  labels: false, sats: false, arcs: false, cables: false, tz: false, tropics: false,
};
let FEATURES = [], LABELS = [], ARCS = [], CABLES = [], SATS = [];
let hoverD = null, selectedD = null;

const capColor = (d) =>
  d === selectedD ? "rgba(93,255,155,0.55)"
    : d === hoverD ? "rgba(70,230,255,0.40)"
    : (state.night || state.daynight) ? "rgba(70,230,255,0.04)" : "rgba(70,230,255,0.06)";
const altOf = (d) => (d === hoverD || d === selectedD ? 0.06 : 0.008);
const refreshPolys = () => world
  .polygonsData(polygonDataset())
  .polygonAltitude(altOf)
  .polygonCapColor(capColor)
  .polygonStrokeColor(polygonStrokeColorFn);

const world = Globe()(el("globeViz"))
  .backgroundColor("rgba(0,0,0,0)")
  .globeImageUrl(TEX_DAY)
  .bumpImageUrl(IMG + "earth-topology.png")
  .showAtmosphere(true)
  .atmosphereColor("#46e6ff")
  .atmosphereAltitude(0.22)
  .arcStartLat((d) => d.startLat).arcStartLng((d) => d.startLng)
  .arcEndLat((d) => d.endLat).arcEndLng((d) => d.endLng)
  .arcColor(() => ["rgba(70,230,255,0.05)", "rgba(93,255,155,0.95)"])
  .arcStroke(0.45).arcDashLength(0.4).arcDashGap(0.18)
  .arcDashAnimateTime((d) => d.dashTime).arcsTransitionDuration(0)
  .pathPoints((d) => d.points)
  .pathPointLat((p) => p[0]).pathPointLng((p) => p[1]).pathPointAlt((p) => p[2])
  .pathColor(() => ["rgba(255,180,84,0.15)", "rgba(255,180,84,0.9)"])
  .pathStroke(1.1).pathDashLength(0.25).pathDashGap(0.12)
  .pathDashAnimateTime(9000).pathTransitionDuration(0)
  .objectLat((d) => d.lat).objectLng((d) => d.lng).objectAltitude((d) => d.alt)
  .objectThreeObject((d) => makeSatObject(d.color))
  .labelLat((d) => d.lat).labelLng((d) => d.lng).labelText((d) => d.text)
  .labelSize(0.42).labelDotRadius(0.18)
  .labelColor(() => "rgba(154,243,255,0.85)")
  .labelResolution(2).labelAltitude(0.012).labelsTransitionDuration(0)
  .onGlobeReady(() => {
    tzMeridiansGroup = buildTzMeridiansGroup();
    tropicsGroup = buildTropicsGroup();
    world.scene().add(tzMeridiansGroup);
    world.scene().add(tropicsGroup);
    tzMeridiansGroup.visible = state.tz;
    tropicsGroup.visible = state.tropics;
  })
  .onGlobeClick(() => deselect());

function applyLabelFont(font) {
  world.labelTypeFace(font);
  world.labelsData(activeLabels());
}

fetch(LABEL_FONT_URL)
  .then((r) => r.json())
  .then((font) => {
    applyLabelFont(font);
    pushLog(`<span class="k">font</span> Roboto · acentos PT-BR <span class="ok">OK</span>`);
  })
  .catch((err) =>
    pushLog(`<span class="warn">fonte labels: fallback ASCII (${err})</span>`)
  );

function syncDayNightRotation() {
  if (!state.daynight || !dayNightMaterial) return;
  const pov = world.pointOfView();
  dayNightMaterial.uniforms.globeRotation.value.set(pov.lng, pov.lat);
}

const defaultGlobeMaterial = world.globeMaterial();
world.onZoom(({ lng, lat }) => {
  if (state.daynight && dayNightMaterial)
    dayNightMaterial.uniforms.globeRotation.value.set(lng, lat);
});

ARCS = buildArcs();
SATS = buildSats();
loadSubmarineCables();

/* ---------- Carrega países ---------- */
fetch(COUNTRIES_URL)
  .then((r) => r.json())
  .then(({ features }) => {
    FEATURES = features;
    el("trackCount").textContent = String(features.length).padStart(3, "0");

    features.forEach((f) => {
      f.properties.__c = sphericalCentroid(mainRing(f.geometry));
    });
    LABELS = features.map((f) => ({
      lat: f.properties.__c.lat,
      lng: f.properties.__c.lng,
      text: ptName(f.properties).toUpperCase(),
    }));

    world
      .polygonsData(polygonDataset())
      .polygonAltitude(altOf)
      .polygonCapColor(capColor)
      .polygonSideColor(() => "rgba(70,230,255,0.12)")
      .polygonStrokeColor(polygonStrokeColorFn)
      .polygonLabel(({ properties: p }) => `
        <div style="font-family:'Share Tech Mono',monospace;background:rgba(3,12,18,.92);
             border:1px solid rgba(70,230,255,.4);padding:6px 10px;color:#9af3ff;
             box-shadow:0 0 14px rgba(70,230,255,.3);letter-spacing:.04em">
          <b style="color:#46e6ff">${ptName(p)}</b><br/>
          <span style="opacity:.7">ISO ${p.ISO_A2 || "--"} · POP ${fmtPop(p.POP_EST)}</span><br/>
          <span style="opacity:.55">LAT ${p.__c.lat.toFixed(2)} · LON ${p.__c.lng.toFixed(2)}</span>
        </div>`)
      .onPolygonHover((d) => {
        hoverD = d;
        el("screen").style.cursor = d ? "pointer" : "default";
        refreshPolys();
        if (d && !selectedD) showCountryQuick(d.properties);
        else if (!d && !selectedD) showEarth();
      })
      .onPolygonClick((d) => {
        if (!d) return deselect();
        selectedD = d;
        refreshPolys();
        showCountryFull(d.properties);
        world.pointOfView(
          { lat: d.properties.__c.lat, lng: d.properties.__c.lng, altitude: 1.4 },
          900
        );
      });

    buildSearchIndex();
    applyAll();
    syncAllToggles();
    showEarth();
  })
  .catch((err) =>
    pushLog(`<span class="err">ERRO: falha ao carregar fronteiras (${err})</span>`)
  );

function deselect() {
  if (!selectedD && !hoverD) return;
  selectedD = null;
  hoverD = null;
  refreshPolys();
  showEarth();
  const si = el("globeSearchInput");
  if (si && document.activeElement !== si) si.value = "";
}

/* =========================================================
   BUSCA DE PAÍSES
   ========================================================= */
const CONTINENT_PT = {
  Africa: "África",
  Europe: "Europa",
  Asia: "Ásia",
  "North America": "América do Norte",
  "South America": "América do Sul",
  Oceania: "Oceania",
  Antarctica: "Antártica",
};
const CONTINENT_ORDER = [
  "África", "América do Sul", "América do Norte", "Ásia", "Europa", "Oceania", "Antártica",
];
let searchGroups = [];

function normSearch(s) {
  return String(s)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function buildSearchIndex() {
  const map = new Map();
  for (const f of FEATURES) {
    const p = f.properties;
    const name = ptName(p);
    const continent = CONTINENT_PT[p.CONTINENT] || p.CONTINENT || "Outros";
    if (!map.has(continent)) map.set(continent, []);
    map.get(continent).push({
      f, name, iso: (p.ISO_A2 || "").toLowerCase(), nameFold: normSearch(name),
    });
  }
  const sortItems = (items) =>
    items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  searchGroups = CONTINENT_ORDER.filter((c) => map.has(c)).map((c) => ({
    continent: c,
    items: sortItems(map.get(c)),
  }));
  for (const [c, items] of map) {
    if (!CONTINENT_ORDER.includes(c))
      searchGroups.push({ continent: c, items: sortItems(items) });
  }
}

function renderSearchDrop(query = "") {
  const list = el("globeSearchList");
  const q = normSearch(query.trim());
  list.innerHTML = "";
  let hasAny = false;
  for (const g of searchGroups) {
    const filtered = q
      ? g.items.filter(
          (i) => i.nameFold.includes(q) || i.iso.includes(q)
        )
      : g.items;
    if (!filtered.length) continue;
    hasAny = true;
    const hdr = document.createElement("div");
    hdr.className = "search-dock__continent";
    hdr.textContent = g.continent;
    list.appendChild(hdr);
    for (const item of filtered) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-dock__item";
      btn.textContent = item.name;
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => selectCountryFromSearch(item.f));
      list.appendChild(btn);
    }
  }
  if (!hasAny) {
    const empty = document.createElement("div");
    empty.className = "search-dock__empty";
    empty.textContent = "Nenhum país encontrado";
    list.appendChild(empty);
  }
}

function openSearchDrop() {
  el("globeSearchDrop").hidden = false;
  renderSearchDrop(el("globeSearchInput").value);
}

function closeSearchDrop() {
  el("globeSearchDrop").hidden = true;
}

function selectCountryFromSearch(f) {
  selectedD = f;
  hoverD = null;
  refreshPolys();
  showCountryFull(f.properties);
  world.pointOfView(
    { lat: f.properties.__c.lat, lng: f.properties.__c.lng, altitude: 1.4 },
    900
  );
  el("globeSearchInput").value = ptName(f.properties);
  closeSearchDrop();
}

(function setupCountrySearch() {
  const input = el("globeSearchInput");
  const wrap = el("globeSearchWrap");
  if (!input || !wrap) return;

  const unlockInput = () => input.removeAttribute("readonly");
  input.addEventListener("focus", unlockInput);
  input.addEventListener("mousedown", unlockInput);
  input.addEventListener("touchstart", unlockInput, { passive: true });

  input.addEventListener("focus", openSearchDrop);
  input.addEventListener("click", openSearchDrop);
  input.addEventListener("input", () => {
    openSearchDrop();
    renderSearchDrop(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeSearchDrop();
      input.blur();
    }
  });
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target)) closeSearchDrop();
  });
})();

/* =========================================================
   POPULAÇÃO EM TEMPO REAL (modelo + âncora via API)
   ========================================================= */
const BIRTHS_YR = 134_000_000, DEATHS_YR = 61_000_000, SEC_YR = 31_557_600;
const NPS = (BIRTHS_YR - DEATHS_YR) / SEC_YR;
let POP_ANCHOR = { value: 8_092_000_000, t: Date.UTC(2025, 0, 1) };

const worldPopNow = (now = Date.now()) =>
  POP_ANCHOR.value + (NPS * (now - POP_ANCHOR.t)) / 1000;
const startOfUTCDay = (now) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
function countryRates(pop) {
  const wp = worldPopNow();
  return { bps: (pop * (BIRTHS_YR / wp)) / SEC_YR, dps: (pop * (DEATHS_YR / wp)) / SEC_YR };
}

function fetchT(url, ms = 9000) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(id));
}

// nomes PT-BR (gist) + metadados (mledoze/countries.json)
const PT_NAMES = {}, PT_GENT = {};
const META_INDEX = { byA2: {}, byA3: {} };
const TZ_INDEX = { byA2: {} };

function tzOffsetMinutes(zoneName, date = new Date()) {
  const utc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const local = new Date(date.toLocaleString("en-US", { timeZone: zoneName }));
  return Math.round((local - utc) / 60000);
}

function fmtUtcOffset(minutes) {
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (!m) return `UTC ${sign}${h}`;
  return `UTC ${sign}${h}:${String(m).padStart(2, "0")}`;
}

function formatLocalTime(zoneName, date = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: zoneName,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatCountryTimezones(iso2, now = Date.now()) {
  const zones = TZ_INDEX.byA2[iso2];
  if (!zones?.length) return "—";
  const date = new Date(now);
  const byOffset = new Map();
  for (const z of zones) {
    const zone = z.zoneName;
    if (!zone) continue;
    try {
      const off = tzOffsetMinutes(zone, date);
      if (!byOffset.has(off)) {
        byOffset.set(off, formatLocalTime(zone, date));
      }
    } catch (e) {}
  }
  if (!byOffset.size) return "—";
  return [...byOffset.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([off, time]) => `${fmtUtcOffset(off)}: ${time}`)
    .join(", ");
}

function refreshCountryTz() {
  if (liveCtx?.type !== "country" || !liveCtx.iso2) return;
  const tz = el("ccTz");
  if (tz) tz.textContent = formatCountryTimezones(liveCtx.iso2);
}

(async () => {
  try {
    const pt = await (await fetchT("pt-countries.json", 8000)).json();
    for (const c of pt) {
      if (c.sigla) { PT_NAMES[c.sigla] = c.nome_pais; PT_GENT[c.sigla] = c.gentilico; }
    }
    pushLog(`<span class="k">i18n</span> ${Object.keys(PT_NAMES).length} nomes PT-BR <span class="ok">OK</span>`);
    if (FEATURES.length) refreshLabels();
  } catch (e) {
    pushLog(`<span class="err">i18n: falha ao carregar nomes PT</span>`);
  }
})();

(async () => {
  try {
    const all = await (await fetchT(META_URL, 20000)).json();
    for (const c of all) {
      if (c.cca2) META_INDEX.byA2[c.cca2] = c;
      if (c.cca3) META_INDEX.byA3[c.cca3] = c;
    }
    pushLog(`<span class="k">geofeed</span> ${all.length} países (mledoze) <span class="ok">OK</span>`);
    if (selectedD && liveCtx?.type === "country") {
      hydrateCountry(selectedD.properties, ptName(selectedD.properties), reqSeq);
    }
  } catch (e) {
    pushLog(`<span class="err">geofeed offline — dados parciais</span>`);
  }
})();

(async () => {
  try {
    const all = await (await fetchT(TZ_URL, 20000)).json();
    for (const c of all) {
      if (c.iso2 && c.timezones?.length) TZ_INDEX.byA2[c.iso2] = c.timezones;
    }
    pushLog(`<span class="k">tzfeed</span> ${Object.keys(TZ_INDEX.byA2).length} países · fusos IANA <span class="ok">OK</span>`);
    refreshCountryTz();
  } catch (e) {
    pushLog(`<span class="err">tzfeed offline — fusos indisponíveis</span>`);
  }
})();
(async () => {
  try {
    const res = await fetchT(
      "https://api.worldbank.org/v2/country/WLD/indicator/SP.POP.TOTL?format=json&mrnev=1",
      9000
    );
    const j = await res.json();
    const rec = j && j[1] && j[1][0];
    if (rec && rec.value && rec.date) {
      POP_ANCHOR = { value: +rec.value, t: Date.UTC(+rec.date, 6, 1) };
      pushLog(`<span class="k">popfeed</span> âncora ${rec.date}: <span class="v">${nf.format(+rec.value)}</span> <span class="ok">OK</span>`);
    }
  } catch (e) {
    pushLog(`<span class="err">popfeed offline — usando estimativa local</span>`);
  }
})();

/* =========================================================
   PAINEL DE INFORMAÇÕES (Terra / país)
   ========================================================= */
const infoTitle = el("infoTitle");
const infoBody = el("infoBody");
let liveCtx = null;

const ph = "data:image/svg+xml," + encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='56' height='38'><rect width='100%' height='100%' fill='%23062028'/></svg>"
);
const isoOk = (s) => s && s !== "-99" && s !== "-1";
function lookupMeta(p) {
  const a3 = isoOk(p.ISO_A3) ? p.ISO_A3 : null;
  const a2 = isoOk(p.ISO_A2) ? p.ISO_A2 : null;
  return (a3 && META_INDEX.byA3[a3]) || (a2 && META_INDEX.byA2[a2]) || null;
}
function ptName(p) {
  const a2 = isoOk(p.ISO_A2) ? p.ISO_A2 : null;
  if (a2 && PT_NAMES[a2]) return PT_NAMES[a2];
  const meta = lookupMeta(p);
  if (meta?.translations?.por?.common) return meta.translations.por.common;
  return p.ADMIN || p.NAME || "—";
}
function refreshLabels() {
  if (!FEATURES.length) return;
  LABELS = FEATURES.map((f) => ({
    lat: f.properties.__c.lat,
    lng: f.properties.__c.lng,
    text: ptName(f.properties).toUpperCase(),
  }));
  if (state.labels) world.labelsData(activeLabels());
}
function flagHTML(iso2, label) {
  if (isoOk(iso2)) {
    const c = iso2.toLowerCase();
    return `<img class="cc__flag" id="ccFlag" alt="bandeira" src="https://flagcdn.com/w80/${c}.png"
      onerror="this.onerror=null;this.src='${ph}'"/>`;
  }
  return `<div class="cc__flag cc__flag--ph" id="ccFlag">${(label || "??").slice(0, 3).toUpperCase()}</div>`;
}

/* ---------- Terra em tempo real ---------- */
function showEarth() {
  liveCtx = { type: "earth" };
  infoTitle.textContent = "PLANETA TERRA // TEMPO REAL";
  infoBody.innerHTML = `
    <div class="earth__pop"><span id="ePop">—</span><small>habitantes · estimativa ao vivo</small></div>
    <div class="rt">
      <div class="rt__item rt--birth"><span id="eBirth">0</span><label>Nascim. hoje</label></div>
      <div class="rt__item rt--death"><span id="eDeath">0</span><label>Óbitos hoje</label></div>
      <div class="rt__item rt--net"><span id="eNet">0</span><label>Cresc. hoje</label></div>
    </div>
    <div class="readout">
      <div class="readout__row"><label>Idade</label><b>~4,54 bilhões de anos</b></div>
      <div class="readout__row"><label>Clima médio</label><b>~15 °C · +1,3 °C anom.</b></div>
      <div class="readout__row"><label>Localização</label><b>Via Láctea · Braço de Órion</b></div>
      <div class="readout__row"><label>Distância do Sol</label><b id="eDist">—</b></div>
      <div class="readout__row"><label>Veloc. orbital</label><b>29,78 km/s</b></div>
      <div class="readout__row"><label>Ponto subsolar</label><b id="eSub">—</b></div>
      <div class="readout__row"><label>Diâmetro</label><b>12.742 km</b></div>
      <div class="readout__row"><label>Satélite natural</label><b>Lua</b></div>
    </div>
    <div class="hint">// passe o cursor ou clique em um país para detalhes</div>`;
  updateLive();
}

/* ---------- País (hover, rápido) ---------- */
function showCountryQuick(p) {
  const name = ptName(p);
  const rates = countryRates(Math.max(p.POP_EST || 0, 0));
  liveCtx = { type: "country", bps: rates.bps, dps: rates.dps };
  infoTitle.textContent = name.toUpperCase();
  const region = [p.CONTINENT, p.SUBREGION].filter(Boolean).join(" · ") || "—";
  infoBody.innerHTML = `
    <div class="cc__top">
      ${flagHTML(p.ISO_A2, p.ISO_A3 || name)}
      <div class="cc__id">
        <b>${name}</b>
        <small>${region}</small>
        <span class="cc__iso">ISO ${p.ISO_A2 || "--"} · ${p.__c.lat.toFixed(1)}, ${p.__c.lng.toFixed(1)}</span>
      </div>
    </div>
    <div class="rt">
      <div class="rt__item rt--birth"><span id="cBirth">0</span><label>Nascim. hoje</label></div>
      <div class="rt__item rt--death"><span id="cDeath">0</span><label>Óbitos hoje</label></div>
      <div class="rt__item rt--net"><span id="cNet">0</span><label>Cresc. hoje</label></div>
    </div>
    <div class="readout">
      <div class="readout__row"><label>População</label><b>${nf.format(p.POP_EST || 0)}</b></div>
      <div class="readout__row"><label>Clima</label><b>${climateOf(p.__c.lat)}</b></div>
      <div class="readout__row"><label>Continente</label><b>${p.CONTINENT || "—"}</b></div>
      <div class="readout__row"><label>Renda</label><b>${(p.INCOME_GRP || "—").replace(/^\d+\.\s*/, "")}</b></div>
    </div>
    <div class="hint">// clique para o dossiê completo</div>`;
  updateLive();
}

/* ---------- Atualizador ao vivo ---------- */
function updateLive() {
  const now = Date.now();
  if (state.tz) {
    const tickMin = Math.floor(now / 60000);
    if (tickMin !== lastTzLabelMin) {
      lastTzLabelMin = tickMin;
      updateTzLabelSprites(now);
    }
  }
  if (!liveCtx) return;
  const secToday = (now - startOfUTCDay(now)) / 1000;
  if (liveCtx.type === "earth") {
    const pop = el("ePop"); if (pop) pop.textContent = nf.format(Math.floor(worldPopNow(now)));
    const b = el("eBirth"); if (b) b.textContent = nf.format(Math.floor((BIRTHS_YR / SEC_YR) * secToday));
    const d = el("eDeath"); if (d) d.textContent = nf.format(Math.floor((DEATHS_YR / SEC_YR) * secToday));
    const n = el("eNet"); if (n) n.textContent = "+" + nf.format(Math.floor(NPS * secToday));
    const dist = el("eDist"); if (dist) dist.textContent = (earthSunDistance() / 1e6).toFixed(2) + " mi km";
    const sub = subsolarPoint(); const s = el("eSub");
    if (s) s.textContent = `${sub.lat.toFixed(1)}, ${sub.lng.toFixed(1)}`;
  } else if (liveCtx.type === "country") {
    const b = el("cBirth"); if (b) b.textContent = nf.format(Math.floor(liveCtx.bps * secToday));
    const d = el("cDeath"); if (d) d.textContent = nf.format(Math.floor(liveCtx.dps * secToday));
    const n = el("cNet"); if (n) n.textContent = "+" + nf.format(Math.floor((liveCtx.bps - liveCtx.dps) * secToday));
    refreshCountryTz();
  }
}
setInterval(updateLive, 250);

/* ---------- País (clique, dossiê completo) ---------- */
const countryCache = {};
let reqSeq = 0;

function lookupRC(p) { return lookupMeta(p); }
function wikiTitles(p, meta, name) {
  const titles = [];
  const pt = ptName(p);
  if (pt && pt !== "—") titles.push(pt);
  if (meta?.translations?.por?.official) titles.push(meta.translations.por.official);
  if (meta?.name?.common) titles.push(meta.name.common);
  return [...new Set(titles.filter(Boolean))];
}
async function fetchWikiSummary(titles) {
  for (const t of titles) {
    try {
      const res = await fetchT(
        "https://pt.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(t),
        8000
      );
      if (!res.ok) continue;
      const w = await res.json();
      const txt = (w.extract || "").trim();
      if (!txt || /pode referir-se a/i.test(txt)) continue;
      const url = w.content_urls?.desktop?.page ||
        "https://pt.wikipedia.org/wiki/" + encodeURIComponent(w.title || t);
      return { text: txt, url, thumb: w.thumbnail?.source };
    } catch (e) {}
  }
  return null;
}
function applyRC(meta, pop, p) {
  const set = (id, v) => { const e = el(id); if (e && v != null && v !== "") e.textContent = v; };
  if (!meta) return pop;
  if (meta.population) { pop = meta.population; set("ccPop", nf.format(pop)); }
  set("ccCap", meta.capital?.[0] || "—");
  if (meta.area) set("ccArea", nf.format(Math.round(meta.area)) + " km²");
  if (meta.area && pop) set("ccDens", (pop / meta.area).toFixed(1) + " hab/km²");
  if (meta.languages) set("ccLang", Object.values(meta.languages).join(", "));
  if (meta.currencies) {
    set("ccCur", Object.entries(meta.currencies)
      .map(([, c]) => `${c.name}${c.symbol ? " (" + c.symbol + ")" : ""}`).join(", "));
  }
  const a2 = isoOk(p?.ISO_A2) ? p.ISO_A2 : null;
  if (a2) set("ccTz", formatCountryTimezones(a2));
  else set("ccTz", "—");
  const flag = el("ccFlag");
  if (flag?.tagName === "IMG" && meta.flags?.svg) flag.src = meta.flags.svg;
  else if (flag?.tagName === "IMG" && meta.flags?.png) flag.src = meta.flags.png;
  const facts = [];
  const a2facts = isoOk(p?.ISO_A2) ? p.ISO_A2 : null;
  if (a2facts && PT_GENT[a2facts]) facts.push(["Gentílico", PT_GENT[a2facts]]);
  else if (meta.demonyms?.por) facts.push(["Gentílico", meta.demonyms.por.m || meta.demonyms.por.f]);
  if (meta.subregion) facts.push(["Sub-região", meta.subregion]);
  if (meta.car?.side) facts.push(["Mão de direção", meta.car.side === "right" ? "Direita" : "Esquerda"]);
  if (meta.idd?.root) facts.push(["Cód. telefônico", meta.idd.root + (meta.idd.suffixes?.[0] || "")]);
  if (meta.tld?.[0]) facts.push(["Domínio", meta.tld[0]]);
  const ul = el("ccFacts");
  if (ul) ul.innerHTML = facts.map(([k, v]) => `<li><span class="fact-k">${k}:</span> ${v}</li>`).join("");
  const rt = countryRates(pop);
  if (liveCtx?.type === "country") { liveCtx.bps = rt.bps; liveCtx.dps = rt.dps; }
  return pop;
}

function showCountryFull(p) {
  const myReq = ++reqSeq;
  const name = ptName(p);
  const region = [p.CONTINENT, p.SUBREGION].filter(Boolean).join(" · ") || "—";
  const rates = countryRates(Math.max(p.POP_EST || 0, 0));
  const iso2 = isoOk(p.ISO_A2) ? p.ISO_A2 : null;
  liveCtx = { type: "country", bps: rates.bps, dps: rates.dps, iso2 };
  infoTitle.textContent = name.toUpperCase();
  infoBody.innerHTML = `
    <div class="cc__top">
      ${flagHTML(p.ISO_A2, p.ISO_A3 || name)}
      <div class="cc__id">
        <b>${name}</b>
        <small>${region}</small>
        <span class="cc__iso">ISO ${p.ISO_A2 || "--"} / ${p.ISO_A3 || "---"} · ${p.__c.lat.toFixed(1)}, ${p.__c.lng.toFixed(1)}</span>
      </div>
    </div>
    <div class="cc__desc loading" id="ccDesc">Carregando descrição…</div>
    <div class="rt">
      <div class="rt__item rt--birth"><span id="cBirth">0</span><label>Nascim. hoje</label></div>
      <div class="rt__item rt--death"><span id="cDeath">0</span><label>Óbitos hoje</label></div>
      <div class="rt__item rt--net"><span id="cNet">0</span><label>Cresc. hoje</label></div>
    </div>
    <div class="readout">
      <div class="readout__row"><label>População</label><b id="ccPop">${nf.format(p.POP_EST || 0)}</b></div>
      <div class="readout__row"><label>Capital</label><b id="ccCap">—</b></div>
      <div class="readout__row"><label>Área</label><b id="ccArea">—</b></div>
      <div class="readout__row"><label>Densidade</label><b id="ccDens">—</b></div>
      <div class="readout__row"><label>Idiomas</label><b id="ccLang">—</b></div>
      <div class="readout__row"><label>Moeda</label><b id="ccCur">—</b></div>
      <div class="readout__row"><label>Clima</label><b>${climateOf(p.__c.lat)}</b></div>
      <div class="readout__row readout__row--tz"><label>Fuso(s)</label><b id="ccTz">${iso2 ? formatCountryTimezones(iso2) : "—"}</b></div>
    </div>
    <ul class="layer-tip__facts" id="ccFacts" style="margin:12px 0"></ul>
    <a class="cc__wiki" id="ccWiki" href="#" role="button">Wikipédia ↗</a>`;
  updateLive();
  hydrateCountry(p, name, myReq);
}

async function hydrateCountry(p, name, myReq) {
  const key = (isoOk(p.ISO_A3) && p.ISO_A3) || (isoOk(p.ISO_A2) && p.ISO_A2) || name;
  const meta = lookupMeta(p);
  countryCache[key] = meta;
  if (myReq !== reqSeq) return;

  let pop = p.POP_EST || 0;
  pop = applyRC(meta, pop, p);

  const titles = wikiTitles(p, meta, name);
  const wikiA = el("ccWiki");
  const defaultUrl = "https://pt.wikipedia.org/wiki/" + encodeURIComponent(titles[0] || name);
  const openWiki = (url) => { window.open(url, "_blank", "noopener,noreferrer"); };
  if (wikiA) {
    wikiA.href = defaultUrl;
    wikiA.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openWiki(wikiA.href); };
  }

  const wiki = await fetchWikiSummary(titles);
  if (myReq !== reqSeq) return;
  const desc = el("ccDesc");
  if (wiki) {
    let txt = wiki.text;
    if (txt.length > 380) txt = txt.slice(0, 377).trim() + "…";
    if (desc) { desc.textContent = txt; desc.classList.remove("loading"); }
    if (wikiA) {
      wikiA.href = wiki.url;
      wikiA.onclick = (e) => { e.preventDefault(); e.stopPropagation(); openWiki(wiki.url); };
    }
  } else if (desc) {
    desc.textContent = "Descrição não encontrada na Wikipédia em português.";
    desc.classList.remove("loading");
  }
}

/* =========================================================
   APLICAÇÃO DE CAMADAS / TOGGLES
   ========================================================= */
function applyAll() {
  world.labelsData(activeLabels());
  world.arcsData(state.arcs ? ARCS : []);
  world.pathsData(activePaths());
  refreshPolys();
  if (!state.sats) world.objectsData([]);
  setTzMeridians(state.tz);
  setTropics(state.tropics);
}
function applyFeature(name) {
  switch (name) {
    case "labels":
      world.labelsData(activeLabels());
      break;
    case "tz":
      setTzMeridians(state.tz);
      break;
    case "tropics":
      setTropics(state.tropics);
      break;
    case "arcs": world.arcsData(state.arcs ? ARCS : []); break;
    case "cables":
      world.pathsData(activePaths());
      break;
    case "sats": if (!state.sats) world.objectsData([]); break;
    case "borders": refreshPolys(); break;
    case "rotate": world.controls().autoRotate = state.rotate; break;
  }
}
function setNight(on) {
  state.night = on;
  if (on && state.daynight) { state.daynight = false; setToggleUI("daynight", false); }
  world.globeMaterial(defaultGlobeMaterial);
  world.globeImageUrl(on ? TEX_NIGHT : TEX_DAY);
  world.atmosphereColor(on ? "#2a9fd6" : "#46e6ff");
  refreshPolys();
}
function setDayNight(on) {
  state.daynight = on;
  if (on) {
    if (state.night) { state.night = false; setToggleUI("night", false); }
    if (!dayNightReady || !dayNightMaterial) return;
    updateDayNightUniforms();
    syncDayNightRotation();
    world.globeMaterial(dayNightMaterial);
    world.atmosphereColor("#7fb2ff");
  } else {
    world.globeMaterial(defaultGlobeMaterial);
    world.globeImageUrl(state.night ? TEX_NIGHT : TEX_DAY);
    world.atmosphereColor(state.night ? "#2a9fd6" : "#46e6ff");
  }
  refreshPolys();
}

const OVERLAYS = ["borders", "labels", "sats", "arcs", "cables", "tz", "tropics"];
function setToggleUI(name, on) {
  const btn = document.querySelector(`.tgl[data-f="${name}"]`);
  if (btn) btn.classList.toggle("active", on);
}
function syncAllToggles() {
  setToggleUI("night", state.night);
  setToggleUI("daynight", state.daynight);
  setToggleUI("rotate", state.rotate);
  OVERLAYS.forEach((o) => setToggleUI(o, state[o]));
  setToggleUI("master", OVERLAYS.some((o) => state[o]));
}

el("toggles").addEventListener("click", (e) => {
  const btn = e.target.closest(".tgl");
  if (!btn) return;
  const f = btn.dataset.f;

  if (f === "reset") { deselect(); world.pointOfView({ lat: 20, lng: 0, altitude: 2.5 }, 900); return; }
  if (f === "master") {
    const on = !btn.classList.contains("active");
    btn.classList.toggle("active", on);
    OVERLAYS.forEach((o) => { state[o] = on; setToggleUI(o, on); applyFeature(o); });
    return;
  }
  if (f === "night") { setNight(!state.night); setToggleUI("night", state.night); return; }
  if (f === "daynight") { setDayNight(!state.daynight); setToggleUI("daynight", state.daynight); return; }

  state[f] = !state[f];
  btn.classList.toggle("active", state[f]);
  applyFeature(f);
  if (OVERLAYS.includes(f)) setToggleUI("master", OVERLAYS.some((o) => state[o]));
});

/* =========================================================
   TOOLTIPS DAS CAMADAS
   ========================================================= */
const SAT_PHOTO = "https://commons.wikimedia.org/wiki/Special:FilePath/GPS_Satellite_NASA_art-iif.jpg?width=320";
const svg = {
  cables: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 86"><defs><linearGradient id="cg" x1="0" x2="1"><stop offset="0" stop-color="#46e6ff"/><stop offset="1" stop-color="#ffb454"/></linearGradient></defs><rect width="240" height="86" fill="#071a22"/><path d="M0 64 Q60 40 120 56 T240 44" fill="none" stroke="url(#cg)" stroke-width="2.5"/><path d="M0 72 Q70 52 130 66 T240 56" fill="none" stroke="#46e6ff" stroke-width="1.2" opacity=".5"/><circle cx="40" cy="52" r="3" fill="#5dff9b"/><circle cx="200" cy="49" r="3" fill="#5dff9b"/></svg>`,
  arcs: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 86"><rect width="240" height="86" fill="#071a22"/><path d="M40 70 Q120 0 200 60" fill="none" stroke="#5dff9b" stroke-width="2"/><path d="M60 72 Q120 18 180 50" fill="none" stroke="#46e6ff" stroke-width="1.4" opacity=".7"/><circle cx="40" cy="70" r="3.5" fill="#46e6ff"/><circle cx="200" cy="60" r="3.5" fill="#ffb454"/></svg>`,
  borders: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 86"><rect width="240" height="86" fill="#071a22"/><path d="M30 60 L60 28 L110 36 L150 20 L200 40 L210 66 L160 70 L120 58 L70 70 Z" fill="rgba(70,230,255,.12)" stroke="#46e6ff" stroke-width="1.5"/></svg>`,
  labels: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 86"><rect width="240" height="86" fill="#071a22"/><rect x="60" y="30" width="120" height="26" rx="3" fill="rgba(70,230,255,.12)" stroke="#46e6ff"/><text x="120" y="48" fill="#9af3ff" font-family="monospace" font-size="13" text-anchor="middle">BRASIL</text></svg>`,
  night: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 86"><rect width="240" height="86" fill="#071a22"/><circle cx="120" cy="43" r="26" fill="#071a22" stroke="#46e6ff"/><circle cx="112" cy="38" r="4" fill="#ffb454"/><circle cx="128" cy="50" r="3" fill="#ffb454"/><circle cx="60" cy="24" r="1.5" fill="#9af3ff"/></svg>`,
  daynight: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 86"><rect width="240" height="86" fill="#071a22"/><defs><clipPath id="c"><circle cx="120" cy="43" r="28"/></clipPath></defs><g clip-path="url(#c)"><rect x="92" y="15" width="28" height="56" fill="#ffb454" opacity=".85"/><rect x="120" y="15" width="28" height="56" fill="#071a22"/></g><circle cx="120" cy="43" r="28" fill="none" stroke="#46e6ff" stroke-width="1.5"/></svg>`,
  rotate: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 86"><rect width="240" height="86" fill="#071a22"/><path d="M150 43 a30 30 0 1 1 -9 -21" fill="none" stroke="#46e6ff" stroke-width="2.5"/><path d="M141 14 l4 12 l-13 1 Z" fill="#46e6ff"/></svg>`,
  master: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 86"><rect width="240" height="86" fill="#071a22"/><path d="M120 22 a22 22 0 1 0 14 5" fill="none" stroke="#5dff9b" stroke-width="2.5"/><line x1="120" y1="18" x2="120" y2="44" stroke="#5dff9b" stroke-width="2.5"/></svg>`,
  reset: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 86"><rect width="240" height="86" fill="#071a22"/><circle cx="120" cy="43" r="22" fill="none" stroke="#ffb454" stroke-width="1.5"/><circle cx="120" cy="43" r="4" fill="#ffb454"/></svg>`,
  tz: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 86"><rect width="240" height="86" fill="#071a22"/><ellipse cx="120" cy="43" rx="38" ry="26" fill="none" stroke="#46e6ff" stroke-width="1.2"/><line x1="82" y1="43" x2="158" y2="43" stroke="#ffb454" stroke-width="1.5"/><line x1="98" y1="20" x2="98" y2="66" stroke="#ffb454" stroke-width="1.2" opacity=".7"/><line x1="120" y1="20" x2="120" y2="66" stroke="#ffb454" stroke-width="1.2" opacity=".7"/><line x1="142" y1="20" x2="142" y2="66" stroke="#ffb454" stroke-width="1.2" opacity=".7"/><text x="120" y="48" fill="#ffb454" font-family="monospace" font-size="11" text-anchor="middle">UTC</text></svg>`,
  tropics: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 86"><rect width="240" height="86" fill="#071a22"/><ellipse cx="120" cy="43" rx="38" ry="26" fill="none" stroke="#46e6ff" stroke-width="1.2"/><line x1="82" y1="43" x2="158" y2="43" stroke="#46e6ff" stroke-width="2"/><line x1="82" y1="30" x2="158" y2="30" stroke="#46e6ff" stroke-width="1.2" opacity=".75"/><line x1="82" y1="56" x2="158" y2="56" stroke="#46e6ff" stroke-width="1.2" opacity=".75"/></svg>`,
};
const artImg = (s) => `<img style="width:100%;height:100%;object-fit:cover" alt="" src="${s}" onerror="this.style.display='none'"/>`;
const artSvg = (k) => `<img style="width:100%;height:100%;object-fit:cover" alt="" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg[k])}"/>`;

const LAYER_INFO = {
  sats: { t: "SATÉLITES EM ÓRBITA", art: artImg(SAT_PHOTO),
    d: "Naves artificiais orbitando a Terra para comunicação, navegação (GPS) e observação.",
    f: [["Ativos em órbita", "cerca de 11.000"], ["Lançados desde 1957", "cerca de 19.000"], ["Constelação Starlink", "mais de 7.000"], ["1º satélite", "Sputnik 1 · 1957"]] },
  cables: { t: "CABOS SUBMARINOS", art: artSvg("cables"),
    d: "Rotas reais de cabos submarinos em serviço, com traçado oceânico e pontos de desembarque.",
    f: [["Fonte", "TeleGeography · submarinecablemap.com"], ["Rotas", "700+ sistemas ativos"], ["Traçado", "GeoJSON oficial"], ["Licença", "CC BY-NC-SA 3.0"]] },
  tz: { t: "FUSOS HORÁRIOS", art: artSvg("tz"),
    d: "Meridianos a cada 15° com rótulo UTC e hora local em tempo real. Camada visual — não interfere na rotação.",
    f: [["Faixas", "24 · 15° cada"], ["Rótulos", "UTC±N: HH:MM"], ["Atualização", "a cada minuto"], ["Interação", "nenhuma"]] },
  tropics: { t: "TRÓPICOS E EQUADOR", art: artSvg("tropics"),
    d: "Paralelos do Equador, Trópico de Câncer (23°26′N) e Trópico de Capricórnio (23°26′S).",
    f: [["Equador", "0° · maior circunferência"], ["Câncer", "23°26′N · solstício jun"], ["Capricórnio", "23°26′S · solstício dez"], ["Cor", "ciano · acima dos países"]] },
  arcs: { t: "ROTAS DE DADOS", art: artSvg("arcs"),
    d: "Fluxos de tráfego entre grandes cidades e pontos de troca de internet (IXPs).",
    f: [["Tráfego IP global", "5,3 ZB/ano"], ["Picos em IXPs", "acima de 1 Pbps"], ["Latência óptica", "5 µs/km"], ["Prefixos BGP", "1 milhão"]] },
  borders: { t: "FRONTEIRAS", art: artSvg("borders"),
    d: "Limites políticos dos países reconhecidos no mundo.",
    f: [["Países (ONU)", "195"], ["Fronteiras terrestres", "cerca de 324"], ["Maior: Canadá–EUA", "8.891 km"], ["Mais vizinhos", "China/Rússia (14)"]] },
  labels: { t: "NOMES DOS PAÍSES", art: artSvg("labels"),
    d: "Rótulos com o nome de cada nação posicionados no seu centro geográfico.",
    f: [["Nações soberanas", "195"], ["Idiomas escritos", "cerca de 4.000"], ["Capital mais populosa", "Tóquio"], ["Zonas horárias", "24 principais"]] },
  night: { t: "MODO NOITE", art: artSvg("night"),
    d: "Textura noturna da Terra mostrando as luzes urbanas vistas do espaço.",
    f: [["Fonte", "NASA Black Marble"], ["Poluição luminosa", "cresce 2%/ano"], ["Quase apagada", "Coreia do Norte"]] },
  daynight: { t: "DIA / NOITE (TERMINADOR)", art: artSvg("daynight"),
    d: "Metade iluminada pelo Sol (textura diurna) e metade na sombra (luzes das cidades), em tempo real.",
    f: [["Velocidade do terminador", "1.600 km/h no equador"], ["Inclinação do eixo", "23,44°"], ["Atualização", "hora UTC atual"]] },
  rotate: { t: "ROTAÇÃO AUTOMÁTICA", art: artSvg("rotate"),
    d: "Gira o globo lentamente de forma contínua.",
    f: [["Rotação real (equador)", "1.674 km/h"], ["Dia sideral", "23h 56min 4s"]] },
  master: { t: "SISTEMAS", art: artSvg("master"),
    d: "Liga ou desliga todas as camadas de uma só vez.",
    f: [["Controla", "fronteiras, nomes, satélites, arcos, cabos, fusos, trópicos"]] },
  reset: { t: "RECENTRAR", art: artSvg("reset"),
    d: "Recentraliza a câmera e limpa a seleção atual.",
    f: [["Ação", "volta à visão inicial"]] },
};

const layerTip = el("layerTip");
const screenEl = el("screen");
function showTip(btn) {
  const info = LAYER_INFO[btn.dataset.f];
  if (!info) return;
  layerTip.innerHTML = `
    <div class="layer-tip__art">${info.art}</div>
    <div class="layer-tip__body">
      <div class="layer-tip__title">${info.t}</div>
      <div class="layer-tip__desc">${info.d}</div>
      <ul class="layer-tip__facts">
        ${info.f.map(([k, v]) => `<li><span class="fact-k">${k}:</span> ${v}</li>`).join("")}
      </ul>
    </div>`;
  layerTip.style.visibility = "hidden";
  layerTip.classList.add("show");
  const sr = screenEl.getBoundingClientRect();
  const br = btn.getBoundingClientRect();
  const tw = layerTip.offsetWidth, th = layerTip.offsetHeight;
  let left = br.left - sr.left + br.width / 2 - tw / 2;
  left = Math.max(10, Math.min(left, sr.width - tw - 10));
  const top = br.top - sr.top - th - 12;
  layerTip.style.left = left + "px";
  layerTip.style.top = Math.max(10, top) + "px";
  layerTip.style.visibility = "visible";
  layerTip.setAttribute("aria-hidden", "false");
}
function hideTip() {
  layerTip.classList.remove("show");
  layerTip.setAttribute("aria-hidden", "true");
}
el("toggles").addEventListener("mouseover", (e) => {
  const btn = e.target.closest(".tgl");
  if (btn) showTip(btn);
});
el("toggles").addEventListener("mouseout", (e) => {
  const btn = e.target.closest(".tgl");
  const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest(".tgl");
  if (btn && to !== btn) hideTip();
});

/* =========================================================
   CONTROLES + LOOPS
   ========================================================= */
(function setupControls() {
  const c = world.controls();
  c.autoRotate = true; c.autoRotateSpeed = 0.45;
  c.enableZoom = true; c.enablePan = false;
  c.minDistance = 130; c.maxDistance = 600;
  c.zoomSpeed = 0.8; c.rotateSpeed = 0.6;
  c.dampingFactor = 0.12; c.enableDamping = true;
  c.addEventListener("change", syncDayNightRotation);
})();

setInterval(() => {
  const pov = world.pointOfView();
  el("coordReadout").textContent =
    `LAT ${pov.lat >= 0 ? "+" : ""}${pov.lat.toFixed(3)}  LON ${pov.lng >= 0 ? "+" : ""}${pov.lng.toFixed(3)}`;
  el("altReadout").textContent = Math.round(pov.altitude * 6371).toLocaleString("pt-BR") + " km";
  el("zoomReadout").textContent = (2.5 / pov.altitude).toFixed(2) + "x";
}, 120);

const t0 = performance.now();
(function animate() {
  const t = (performance.now() - t0) / 1000;
  if (state.sats) {
    for (const s of SATS) {
      const ang = s.phase + t * s.speed;
      s.lat = s.incl * Math.sin(ang);
      let lng = (s.raan + ang / DEG) % 360;
      if (lng > 180) lng -= 360; else if (lng < -180) lng += 360;
      s.lng = lng;
    }
    world.objectsData(SATS);
  }
  if (state.daynight) {
    updateDayNightUniforms();
    syncDayNightRotation();
  }
  requestAnimationFrame(animate);
})();

function resize() {
  const s = el("globeViz");
  world.width(s.clientWidth).height(s.clientHeight);
}
window.addEventListener("resize", resize);
resize();
world.pointOfView({ lat: 20, lng: 0, altitude: 2.5 });
