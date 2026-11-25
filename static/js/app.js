'use strict';

/* ================= 常量 ================= */
const ESRI_MAX_ZOOM = 18; // 19 级在乡村多为「Map data not yet available」占位图，统一封顶 18
const GAODE_MAX_ZOOM = 18;
// 天地图 tk：控制台创建「浏览器端」应用获取（域名白名单可留空）
// 本地放在项目根目录 config.js（不入库）；Docker 构建时由 Actions Secret / build 脚本注入
const TIANDITU_TK = (window.KML_CONFIG && window.KML_CONFIG.tiandituTk) || '';
// 可选站点名：config.js 的 siteName；留空时页面使用通用「卫星图」标题
const SITE_NAME = ((window.KML_CONFIG && window.KML_CONFIG.siteName) || '').trim();
const TDT_MAX_ZOOM = 18; // 19 级起返回「此级别下，该区域无影像」占位图
const tdtWmtsUrl = layer => 'https://t{s}.tianditu.gov.cn/' + layer + '_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=' + layer + '&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=' + encodeURIComponent(TIANDITU_TK);
const TDT_LABEL_URL = tdtWmtsUrl('cva');
const TDT_IMG_URL = tdtWmtsUrl('img');
const TDT_CIA_URL = tdtWmtsUrl('cia');
const QQ_MAX_ZOOM = 18; // 19 级起为占位图（约 1.2KB PNG）
// 腾讯卫星瓦片：TMS 行号（y 翻转）同时用于目录分组与文件名，x16/y16 为 16 格分组
// 示例：z16 / 3372 / 2543 / 53957_40703.jpg
const QQBase = L.TileLayer.extend({
  getTileUrl(coords) {
    const z = this._getZoomForUrl();
    const yt = Math.pow(2, z) - 1 - coords.y;
    return 'https://p' + this._getSubdomain(coords) + '.map.gtimg.com/sateTiles/' +
      z + '/' + Math.floor(coords.x / 16) + '/' + Math.floor(yt / 16) + '/' + coords.x + '_' + yt + '.jpg';
  }
});
// 腾讯注记：type=vector 实际返回透明 PNG 注记瓦片（Content-Type 标为 octet-stream，浏览器按图片解码）
const QQ_LABEL_URL = 'https://rt{s}.map.gtimg.com/tile?z={z}&x={x}&y={y}&type=vector&styleid=3&version=376';
const PALETTE = ['#e53935', '#1e88e5', '#43a047', '#fb8c00', '#8e24aa', '#00acc1', '#d81b60', '#6d4c41'];

/* ================= 全局状态 ================= */
const state = {
  files: new Map(), // id -> { id, name, group, features: [] }
  nextId: 1,
  unit: localStorage.getItem('kmlUnit') || 'ha',
  basemap: localStorage.getItem('kmlBasemap') || 'esri', // esri | tdt | gaode | gaode-vec | qq
  labels: localStorage.getItem('kmlLabels') || (TIANDITU_TK ? 'tdt' : 'esri'), // off | esri | tdt
  filter: '', // 筛选关键词（小写、已 trim）
  selected: null // 当前选中的要素记录
};

const $ = id => document.getElementById(id);

if (!TIANDITU_TK && state.basemap === 'tdt') {
  state.basemap = 'esri';
  localStorage.setItem('kmlBasemap', 'esri');
}

if (SITE_NAME) {
  const withSite = s => s.replace(/^卫星图/, SITE_NAME + '卫星图');
  document.title = withSite(document.title);
  document.querySelectorAll('.brand, .hero-title').forEach(el => { el.textContent = withSite(el.textContent); });
}

/* ================= 地图与底图 ================= */
const HOME_VIEW = { center: [34, 108], zoom: 4 }; // 初始视野：清空后也回到这里
const map = L.map('map', { zoomControl: false, worldCopyJump: true }).setView(HOME_VIEW.center, HOME_VIEW.zoom);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

const esriBase = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: ESRI_MAX_ZOOM, attribution: '影像 © Esri, Maxar, Earthstar Geographics' }
);
const esriLabels = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: ESRI_MAX_ZOOM, attribution: '注记 © Esri' }
);
const gaodeBase = L.tileLayer(
  'https://webst0{s}.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}',
  { subdomains: ['1', '2', '3', '4'], maxZoom: GAODE_MAX_ZOOM, attribution: '影像 © 高德地图' }
);
const gaodeLabels = L.tileLayer(
  'https://webst0{s}.is.autonavi.com/appmaptile?style=8&x={x}&y={y}&z={z}',
  { subdomains: ['1', '2', '3', '4'], maxZoom: GAODE_MAX_ZOOM, attribution: '注记 © 高德地图' }
);
const gaodeVec = L.tileLayer(
  'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
  { subdomains: ['1', '2', '3', '4'], maxZoom: GAODE_MAX_ZOOM, attribution: '地图 © 高德地图' }
);
// 天地图注记：CGCS2000≈WGS84，可直接叠在 Esri 影像上；未配置 tk 时不创建
const tdtLabels = TIANDITU_TK
  ? L.tileLayer(TDT_LABEL_URL, {
      subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
      maxZoom: ESRI_MAX_ZOOM, attribution: '注记 © 天地图'
    })
  : null;
// 天地图卫星：CGCS2000≈WGS84，不做 GCJ-02 偏移；未配置 tk 时不创建
const tdtSat = TIANDITU_TK
  ? L.tileLayer(TDT_IMG_URL, {
      subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
      maxZoom: TDT_MAX_ZOOM, attribution: '影像 © 天地图'
    })
  : null;
const tdtSatLabels = TIANDITU_TK
  ? L.tileLayer(TDT_CIA_URL, {
      subdomains: ['0', '1', '2', '3', '4', '5', '6', '7'],
      maxZoom: TDT_MAX_ZOOM, attribution: '注记 © 天地图'
    })
  : null;
// 腾讯卫星图（GCJ-02）：p0–p3 子域，18 级封顶；注记层用 tms 翻转 y 取瓦片
const qqBase = new QQBase('', {
  subdomains: ['0', '1', '2', '3'], maxZoom: QQ_MAX_ZOOM, attribution: '影像 © 腾讯地图'
});
const qqLabels = L.tileLayer(QQ_LABEL_URL, {
  subdomains: ['0', '1', '2', '3'], tms: true, maxZoom: QQ_MAX_ZOOM, attribution: '注记 © 腾讯地图'
});

let tdtWarned = false;
if (tdtSat) tdtSat.on('tileerror', () => {
  if (tdtWarned || state.basemap !== 'tdt') return;
  tdtWarned = true;
  toast('天地图瓦片加载失败，请确认 tk 已开通影像与影像注记服务', true);
});

let qqWarned = false;
qqBase.on('tileerror', () => {
  if (qqWarned || state.basemap !== 'qq') return;
  qqWarned = true;
  toast('腾讯地图影像仅覆盖中国境内，境外或网络受限区域可能空白', true);
});

function isGcjBasemap() {
  return state.basemap === 'gaode' || state.basemap === 'gaode-vec' || state.basemap === 'qq';
}
function currentMaxZoom() {
  if (state.basemap === 'tdt') return TDT_MAX_ZOOM;
  if (state.basemap === 'qq') return QQ_MAX_ZOOM;
  return state.basemap === 'esri' ? ESRI_MAX_ZOOM : GAODE_MAX_ZOOM;
}

function applyTiles() {
  [esriBase, esriLabels, gaodeBase, gaodeLabels, gaodeVec, tdtLabels, tdtSat, tdtSatLabels, qqBase, qqLabels].forEach(l => { if (l) map.removeLayer(l); });
  if (state.basemap === 'qq') {
    qqBase.addTo(map);
    if (state.labels !== 'off') qqLabels.addTo(map); // 腾讯注记只与腾讯影像配套，tms 对齐
  } else if (state.basemap === 'tdt') {
    if (tdtSat) tdtSat.addTo(map);
    if (tdtSatLabels && state.labels !== 'off') tdtSatLabels.addTo(map);
  } else if (state.basemap === 'gaode') {
    gaodeBase.addTo(map);
    if (state.labels !== 'off') gaodeLabels.addTo(map);
  } else if (state.basemap === 'gaode-vec') {
    gaodeVec.addTo(map); // 普通地图自带注记
  } else {
    esriBase.addTo(map);
    if (state.labels === 'tdt' && tdtLabels) tdtLabels.addTo(map);
    else if (state.labels !== 'off') esriLabels.addTo(map);
  }
}

/* ================= GCJ-02 偏移（高德 / 腾讯瓦片为火星坐标，KML 是 WGS84） ================= */
function gcjTransformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function gcjTransformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}

function wgs84ToGcj02(lng, lat) {
  if (lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271) return [lng, lat];
  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  let dLat = gcjTransformLat(lng - 105.0, lat - 35.0);
  let dLng = gcjTransformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return [lng + dLng, lat + dLat];
}

/* 当前底图为高德 / 腾讯时，把几何坐标整体偏移到 GCJ-02 再渲染 */
function displayGeom(geom) {
  if (!isGcjBasemap() || !geom) return geom;
  const pt = c => wgs84ToGcj02(c[0], c[1]).concat(c.slice(2));
  const clone = { type: geom.type, coordinates: null };
  switch (geom.type) {
    case 'Point': clone.coordinates = pt(geom.coordinates); break;
    case 'MultiPoint':
    case 'LineString': clone.coordinates = geom.coordinates.map(pt); break;
    case 'MultiLineString':
    case 'Polygon': clone.coordinates = geom.coordinates.map(r => r.map(pt)); break;
    case 'MultiPolygon': clone.coordinates = geom.coordinates.map(p => p.map(r => r.map(pt))); break;
    default: clone.coordinates = geom.coordinates;
  }
  return clone;
}

/* ================= 工具函数 ================= */
const NUM = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });

function fmtLen(m) {
  if (m == null) return '—';
  if (m >= 1000) return `${NUM.format(m / 1000)} 公里`;
  return `${NUM.format(m)} 米`;
}

function fmtArea(m2, unit) {
  if (m2 == null) return '—';
  let v, suffix;
  switch (unit) {
    case 'm2': v = m2; suffix = '平方米'; break;
    case 'mu': v = m2 / 666.6667; suffix = '亩'; break;
    case 'km2': v = m2 / 1e6; suffix = '平方公里'; break;
    default: v = m2 / 1e4; suffix = '公顷';
  }
  return `${NUM.format(v)} ${suffix}`;
}

function fmtCoord(c) {
  if (!c) return '—';
  return `${c[0].toFixed(6)}, ${c[1].toFixed(6)}`;
}

let toastTimer = null;
function toast(msg, isError) {
  const el = $('toast');
  el.textContent = msg;
  el.className = isError ? 'error show' : 'show';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 4200);
}

/* HTML 描述净化：去掉脚本等危险内容与自带表现样式，防注入并统一外观 */
const DESC_DROP_ATTRS = new Set(['style', 'bgcolor', 'color', 'face', 'size', 'width', 'height', 'border', 'align', 'valign', 'cellpadding', 'cellspacing', 'background', 'class', 'id']);

function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,iframe,object,embed,style,link,meta,base,form,input,button,select,textarea,img,svg,video,audio').forEach(n => n.remove());
  doc.body.querySelectorAll('*').forEach(n => {
    for (const a of [...n.attributes]) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc') n.removeAttribute(a.name);
      else if (name === 'href' && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
      else if (DESC_DROP_ATTRS.has(name)) n.removeAttribute(a.name);
    }
  });
  doc.body.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  return doc.body.innerHTML;
}

function stripHtml(html) {
  if (!html) return '';
  const d = document.createElement('div');
  d.innerHTML = sanitizeHtml(html);
  return d.textContent || '';
}

/* ================= 解析 ================= */
function parseKml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML 解析失败');
  const fc = toGeoJSON.kml(doc);
  if (!fc || !fc.features || !fc.features.length) throw new Error('文件中没有可显示的要素');
  return fc;
}

/* 编码兼容：优先按 XML 声明的 encoding 解码，UTF-8 结果含乱码时再试 GB18030/GBK */
function decodeKml(buf) {
  const head = new TextDecoder('ascii').decode(buf.slice(0, 512));
  const m = /<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i.exec(head);
  const declared = (m ? m[1] : 'utf-8').toLowerCase();
  let lastErr = null;
  const tryDecode = enc => {
    try {
      const t = new TextDecoder(enc).decode(buf);
      const clean = t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t;
      parseKml(clean);
      return clean;
    } catch (e) { lastErr = e; return null; }
  };
  if (declared !== 'utf-8' && declared !== 'utf8') {
    const t = tryDecode(declared);
    if (t != null) return t;
  }
  const t = tryDecode('utf-8');
  if (t != null && !t.includes('\uFFFD')) return t;
  for (const enc of ['gb18030', 'gbk']) {
    const t2 = tryDecode(enc);
    if (t2 != null) return t2;
  }
  if (t != null) return t;
  throw lastErr || new Error('无法识别文件编码');
}

async function unzipKmz(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(n => !zip.files[n].dir && /\.kml$/i.test(n));
  if (!names.length) throw new Error('压缩包内未找到 KML 文件');
  const target = names.find(n => /doc\.kml$/i.test(n)) || names[0];
  return decodeKml(await zip.file(target).async('uint8array'));
}

/* ================= 建模 ================= */
function typeLabel(type) {
  if (/Polygon/.test(type)) return '面';
  if (/LineString/.test(type)) return '线';
  return '点';
}

/* 周长：面取外边界长度（多面为各面外边界之和），线取总长度 */
function ringLengthM(geom) {
  const rings = geom.type === 'Polygon'
    ? [geom.coordinates[0]]
    : geom.coordinates.map(c => c[0]);
  let total = 0;
  for (const r of rings) {
    const closed = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]
      ? r : r.concat([r[0]]);
    total += turf.length({ type: 'LineString', coordinates: closed }, { units: 'kilometers' }) * 1000;
  }
  return total;
}

function centroidOf(geom) {
  if (geom.type === 'Point') return geom.coordinates;
  if (geom.type === 'MultiPoint') {
    const n = geom.coordinates.length;
    const s = geom.coordinates.reduce((a, c) => [a[0] + c[0], a[1] + c[1]], [0, 0]);
    return [s[0] / n, s[1] / n];
  }
  try {
    return turf.centroid({ type: 'Feature', properties: {}, geometry: geom }).geometry.coordinates;
  } catch (e) { return null; }
}

/* KML 样式（togeojson 输出 #rrggbb 及 0-1 透明度），无样式时用调色板 */
function pickStyle(props, paletteIndex) {
  const fallback = PALETTE[paletteIndex % PALETTE.length];
  const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  const col = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
  return {
    stroke: col(props.stroke, fallback),
    fill: col(props.fill, fallback),
    strokeOpacity: num(props['stroke-opacity'], 1),
    fillOpacity: num(props['fill-opacity'], 0.35),
    strokeWidth: num(props['stroke-width'], 2)
  };
}

/* 首尾重合（1 米内）的线按面处理：常见于用线画的边界（如闭合线示例.kmz） */
function closedRingOf(geom) {
  if (geom.type !== 'LineString') return null;
  const c = geom.coordinates;
  if (c.length < 4) return null;
  try {
    if (turf.distance(c[0], c[c.length - 1], { units: 'meters' }) > 1) return null;
  } catch (e) { return null; }
  return { type: 'Polygon', coordinates: [c] };
}

/* 要素 → 展示记录（MultiGeometry 拆分为多个记录） */
function buildRecords(fc, paletteIndex) {
  const records = [];
  for (const feat of fc.features) {
    const props = feat.properties || {};
    const name = String(props.name || '').trim() || '未命名';
    // toGeoJSON 会把含 CDATA 的 description 解析成 {@type, value} 对象
    const rawDesc = props.description || '';
    const desc = typeof rawDesc === 'string' ? rawDesc : String(rawDesc.value || '');
    const style = pickStyle(props, paletteIndex);
    const parts = [];
    if (feat.geometry && feat.geometry.type === 'GeometryCollection') {
      feat.geometry.geometries.forEach(g => parts.push(g));
    } else if (feat.geometry) {
      parts.push(feat.geometry);
    }
    parts.forEach((geom, i) => {
      const ring = closedRingOf(geom);
      const g = ring || geom;
      const isArea = g.type === 'Polygon' || g.type === 'MultiPolygon';
      const isLine = g.type === 'LineString' || g.type === 'MultiLineString';
      const recStyle = ring
        ? { ...style, fill: style.stroke, fillOpacity: 0.25 } // 闭合线无填充定义，用线色做半透明填充
        : style;
      records.push({
        name: parts.length > 1 ? `${name}（${i + 1}）` : name,
        desc,
        plainDesc: stripHtml(desc),
        style: recStyle,
        geometry: g,
        type: typeLabel(g.type),
        areaM2: isArea ? turf.area({ type: 'Feature', properties: {}, geometry: g }) : null,
        perimeterM: (isArea || isLine) ? (isArea ? ringLengthM(g) : turf.length({ type: 'Feature', properties: {}, geometry: g }, { units: 'kilometers' }) * 1000) : null,
        centroid: centroidOf(g),
        checked: true, // 勾选框默认全部勾选（显示）
        layer: null, row: null, fileGroup: null, fileId: null, _halo: null
      });
    });
  }
  return records;
}

/* ================= 渲染 ================= */
// 左侧留出侧栏宽度（300px + 边距），信息卡不被半透明侧栏遮住
const POPUP_OPTS = {
  className: 'pp-card', maxWidth: 340, autoPan: true, keepInView: true,
  autoPanPaddingTopLeft: L.point(330, 72), autoPanPaddingBottomRight: L.point(12, 56)
};

/* 手机端信息卡限宽，并避开顶部工具栏与底部抽屉 */
function syncPopupLayout(rec) {
  const popup = rec.layer && rec.layer.getPopup && rec.layer.getPopup();
  if (!popup) return;
  const mobile = isMobileView();
  popup.options.maxWidth = mobile ? Math.max(240, window.innerWidth - 56) : 340;
  popup.options.autoPanPaddingTopLeft = mobile ? L.point(12, 100) : L.point(330, 72);
  popup.options.autoPanPaddingBottomRight = mobile ? L.point(12, sheetHeight() + 16) : L.point(12, 56);
}

function openCard(rec) {
  syncPopupLayout(rec);
  rec.layer.openPopup();
}

function createFeatureLayer(rec) {
  const layer = L.geoJSON(
    { type: 'Feature', properties: {}, geometry: displayGeom(rec.geometry) },
    {
      bubblingMouseEvents: false,
      style: () => ({
        color: rec.style.stroke,
        weight: rec.style.strokeWidth,
        opacity: rec.style.strokeOpacity,
        fillColor: rec.style.fill,
        fillOpacity: Math.min(0.45, rec.style.fillOpacity)
      }),
      pointToLayer: (f, latlng) => L.circleMarker(latlng, {
        radius: 7, color: '#ffffff', weight: 2,
        fillColor: rec.style.fill, fillOpacity: 1,
        bubblingMouseEvents: false
      })
    }
  );
  layer.bindPopup(() => detailContent(rec), POPUP_OPTS);
  layer.off('click', layer._openPopup); // 弹卡统一由选中流程处理，避免自动弹卡与取消冲突
  layer.on('click', () => {
    if (state.selected === rec) clearSelected();
    else { setSelected(rec); openCard(rec); centerOnRecord(rec); }
  });
  layer.on('popupclose', () => {
    // 仅当图层仍在地图上才视为用户关闭；底图切换重建时旧层已移除，不应误清选中
    if (state.selected === rec && map.hasLayer(layer)) clearSelected();
  });
  layer.on('mouseover', () => highlight(rec, true));
  layer.on('mouseout', () => highlight(rec, false));
  rec.layer = layer;
  return layer;
}

/* 选中：同色加深覆盖整个要素；点击选中即弹出信息卡 */
function setSelected(rec) {
  if (state.selected === rec) return;
  if (state.selected) clearSelected();
  state.selected = rec;
  ensureHalo(rec);
  setActiveRow(rec);
}

/* 取消选中：再点同一要素 / 点地图空白 / Esc / 信息卡 × 均走这里 */
function clearSelected() {
  const rec = state.selected;
  if (!rec) return;
  state.selected = null;
  rec.layer.closePopup();
  if (rec._halo) { rec._halo.remove(); rec._halo = null; }
  setActiveRow(null);
}

function darkenHex(hex, f) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = s => Math.round(((n >> s) & 255) * f).toString(16).padStart(2, '0');
  return '#' + ch(16) + ch(8) + ch(0);
}

/* 选中覆盖层：同色压暗后整体加深（面=半透明深色填充，线=加粗，点=加深圆点） */
function ensureHalo(rec) {
  if (rec._halo) { rec._halo.remove(); rec._halo = null; }
  const geom = displayGeom(rec.geometry);
  const deepStroke = darkenHex(rec.style.stroke, 0.7);
  const deepFill = darkenHex(rec.style.fill || rec.style.stroke, 0.7);
  const opts = rec.type === '点'
    ? {
        interactive: false,
        pointToLayer: (f, latlng) => L.circleMarker(latlng, {
          radius: 10, color: deepStroke, weight: 2,
          fillColor: deepFill, fillOpacity: 0.95, interactive: false
        })
      }
    : {
        interactive: false,
        style: {
          color: deepStroke,
          weight: rec.style.strokeWidth + 2,
          opacity: 1,
          fillColor: deepFill,
          fillOpacity: rec.type === '面' ? Math.min(0.7, Math.max(0.5, rec.style.fillOpacity + 0.25)) : 0
        }
      };
  const overlay = L.geoJSON({ type: 'Feature', properties: {}, geometry: geom }, opts);
  rec.fileGroup.addLayer(overlay);
  rec._halo = overlay;
  rec.layer.bringToFront();
}

function highlight(rec, on) {
  if (state.selected === rec || !rec.layer) return; // 选中要素由同色覆盖层表达，不做悬停样式
  if (on) {
    rec.layer.setStyle({
      weight: rec.style.strokeWidth + 2,
      fillOpacity: Math.min(0.65, rec.style.fillOpacity + 0.2)
    });
    rec.layer.bringToFront();
  } else {
    rec.layer.setStyle({
      weight: rec.style.strokeWidth,
      fillOpacity: Math.min(0.45, rec.style.fillOpacity)
    });
  }
  if (rec.row) rec.row.classList.toggle('active', on);
}

function setActiveRow(rec) {
  document.querySelectorAll('.feat-row.selected').forEach(r => r.classList.remove('selected'));
  if (rec && rec.row) rec.row.classList.add('selected');
}

const MOBILE_VIEW = window.matchMedia('(max-width: 768px)');
const isMobileView = () => MOBILE_VIEW.matches;

function sheetHeight() {
  if (!isMobileView()) return 0;
  const el = $('sidebar');
  if (!el || el.classList.contains('hidden')) return 0;
  return el.getBoundingClientRect().height;
}

/* 手机上底部抽屉会遮住下半屏，把目标点映射到可见区域中心 */
function centerForVisibleMap(center) {
  const sh = sheetHeight();
  if (!sh) return center;
  const z = map.getZoom();
  return map.unproject(map.project(center, z).add([0, sh / 2]), z);
}

function boundsOptions(extra) {
  const opts = Object.assign({ maxZoom: currentMaxZoom() }, extra);
  const sh = sheetHeight();
  if (sh) opts.paddingBottomRight = [0, sh + 12];
  return opts;
}

function flyToFeature(rec) {
  const b = rec.layer.getBounds();
  const mz = currentMaxZoom(); // 封顶在卫星图有瓦片的层级，避免放大后空白
  if (rec.type === '点') {
    map.flyTo(centerForVisibleMap(b.getCenter()), Math.max(map.getZoom(), 15), { maxZoom: mz });
  } else {
    map.flyToBounds(b.pad(0.5), boundsOptions());
  }
}

/* 点击地块：把地块外接矩形中心平移到可见区域中央（缩放不变）；点、线不处理 */
function centerOnRecord(rec) {
  if (rec.type !== '面') return;
  map.flyTo(centerForVisibleMap(rec.layer.getBounds().getCenter()), map.getZoom(), { animate: true, duration: 0.6 });
}

function detailContent(rec) {
  const el = document.createElement('div');
  el.className = 'pp';
  const title = document.createElement('div');
  title.className = 'pp-title';
  title.textContent = rec.name;
  el.appendChild(title);
  const grid = document.createElement('div');
  grid.className = 'pp-grid';
  const rows = [
    ['类型', rec.type],
    ['周长', fmtLen(rec.perimeterM)],
    ['面积', fmtArea(rec.areaM2, state.unit)],
    ['中心', fmtCoord(rec.centroid)]
  ].filter(r => r[1] !== '—' || r[0] === '类型');
  rows.forEach(([k, v]) => {
    const ks = document.createElement('span'); ks.className = 'k'; ks.textContent = k;
    const vs = document.createElement('span'); vs.textContent = v;
    grid.append(ks, vs);
  });
  el.appendChild(grid);
  if (rec.desc) {
    const d = document.createElement('div');
    d.className = 'pp-desc';
    d.innerHTML = sanitizeHtml(rec.desc);
    el.appendChild(d);
  }
  return el;
}

/* ================= 显示规则：勾选框 + 筛选 ================= */

/* 筛选匹配：名称、备注、类型、文件名、周长、面积、中心坐标（含原始数值） */
function matchesFilter(rec) {
  if (!state.filter) return true;
  const f = state.files.get(rec.fileId);
  const nums = [rec.perimeterM, rec.areaM2]
    .filter(v => v != null)
    .map(v => v.toFixed(2));
  const hay = [
    rec.name, rec.plainDesc, rec.type, f ? f.name : '',
    fmtLen(rec.perimeterM), fmtArea(rec.areaM2, state.unit), fmtCoord(rec.centroid),
    nums.join(' ')
  ].join(' ').toLowerCase();
  return hay.indexOf(state.filter) >= 0;
}

/* 单个要素是否应显示：筛选时按匹配，否则按勾选 */
function recVisible(rec) {
  if (!state.files.has(rec.fileId)) return false;
  return state.filter ? matchesFilter(rec) : rec.checked;
}

function applyVisibility() {
  state.files.forEach(f => {
    f.group.addTo(map);
    f.features.forEach(rec => {
      if (!rec.layer) return;
      const v = state.filter ? matchesFilter(rec) : rec.checked;
      if (v && !map.hasLayer(rec.layer)) map.addLayer(rec.layer);
      else if (!v && map.hasLayer(rec.layer)) map.removeLayer(rec.layer);
    });
  });
  if (state.selected && !map.hasLayer(state.selected.layer)) clearSelected();
}

/* 底图切换后重建全部要素层（坐标体系可能变了），并按显示规则恢复 */
function rerenderFeatures() {
  const selectedRec = state.selected;
  const wasPopupOpen = !!(selectedRec && selectedRec.layer && selectedRec.layer.isPopupOpen());
  state.selected = null;
  state.files.forEach(f => {
    map.removeLayer(f.group);
    const ng = L.featureGroup();
    f.features.forEach(rec => {
      rec.fileGroup = ng;
      rec._halo = null;
      createFeatureLayer(rec).addTo(ng);
      rec.row = null;
    });
    f.group = ng;
  });
  applyVisibility();
  renderSidebar();
  if (selectedRec && state.files.has(selectedRec.fileId)) {
    if (recVisible(selectedRec)) {
      setSelected(selectedRec);
      if (wasPopupOpen) openCard(selectedRec); // 信息卡跨底图切换保持可见
    }
  }
}

/* ================= 侧栏（只列地块） ================= */
/* 侧栏当前列表中的地块：所有文件的面，筛选时只留匹配行 */
function sidebarFaces() {
  const out = [];
  state.files.forEach(f => {
    f.features.forEach(rec => {
      if (rec.type !== '面') return;
      if (state.filter && !matchesFilter(rec)) return;
      out.push(rec);
    });
  });
  return out;
}

function applyAllChecked(on) {
  sidebarFaces().forEach(rec => { rec.checked = on; });
  applyVisibility();
  renderSidebar();
}

/* 全选框三态与导出按钮可用状态，跟随当前列表 */
function syncSideActions() {
  const faces = sidebarFaces();
  const n = faces.filter(rec => rec.checked).length;
  const all = $('check-all');
  all.disabled = faces.length === 0;
  all.checked = faces.length > 0 && n === faces.length;
  all.indeterminate = n > 0 && n < faces.length;
  $('btn-export-csv').disabled = !faces.some(recVisible);
}

function renderSidebar() {
  const listEl = $('file-list');
  listEl.innerHTML = '';
  let total = 0;
  state.files.forEach(fileRec => {
    let faces = fileRec.features.filter(r => r.type === '面');
    if (state.filter) faces = faces.filter(matchesFilter); // 筛选时列表只留匹配行
    if (!faces.length) return; // 没有（匹配的）地块的文件不进列表
    const box = document.createElement('div');
    box.className = 'file-item';

    const head = document.createElement('div');
    head.className = 'file-head';
    const title = document.createElement('span');
    title.className = 'file-title';
    title.textContent = `${fileRec.name}（${faces.length}）`;
    title.title = fileRec.name;
    head.appendChild(title);
    box.appendChild(head);

    faces.forEach(rec => {
      const row = document.createElement('div');
      row.className = 'feat-row';
      if (state.selected === rec) row.classList.add('selected');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'feat-check';
      cb.checked = rec.checked;
      cb.title = '勾选后在地图显示';
      cb.addEventListener('click', e => e.stopPropagation()); // 不触发行选中
      cb.addEventListener('change', () => {
        rec.checked = cb.checked;
        applyVisibility();
        syncSideActions();
      });
      const sw = document.createElement('span');
      sw.className = 'feat-swatch';
      sw.style.background = rec.style.fill;
      const nm = document.createElement('span');
      nm.className = 'feat-name';
      nm.textContent = rec.name;
      nm.title = rec.name;
      row.append(cb, sw, nm);
      row.addEventListener('click', () => {
        if (state.selected === rec) clearSelected();
        else { setSelected(rec); openCard(rec); centerOnRecord(rec); }
      });
      row.addEventListener('dblclick', () => {
        setSelected(rec);
        openCard(rec);
        flyToFeature(rec);
      });
      row.addEventListener('mouseenter', () => highlight(rec, true));
      row.addEventListener('mouseleave', () => highlight(rec, false));
      rec.row = row;
      box.appendChild(row);
      total++;
    });

    listEl.appendChild(box);
  });

  $('stat-line').textContent = state.filter
    ? `匹配 ${total} 个地块`
    : (total ? `${total} 个地块` : '0 个地块');
  updateEmptyState();
  syncSideActions();
}

function updateEmptyState() {
  const empty = state.files.size === 0;
  $('dropzone').classList.toggle('hidden', !empty);
  $('sidebar').classList.toggle('hidden', empty);
  document.body.classList.toggle('has-files', !empty);
  $('btn-clear').disabled = empty;
}


/* ================= CSV 导出（当前可显示地块：筛选优先，否则按勾选） ================= */
const UNIT_LABEL = { ha: '公顷', mu: '亩', m2: '平方米', km2: '平方公里' };

function csvCell(v) {
  let s = v == null ? '' : String(v);
  s = s.replace(/\s+/g, ' ').trim();
  if (/^[=+\-@]/.test(s)) s = "'" + s; // 防 Excel 公式注入
  return '"' + s.replace(/"/g, '""') + '"';
}

function csvNum(v, digits) {
  return v == null || !isFinite(v) ? '""' : '"' + Number(v).toFixed(digits) + '"';
}

function exportableFaces() {
  return sidebarFaces().filter(recVisible);
}

function buildCsv() {
  const unitName = UNIT_LABEL[state.unit] || UNIT_LABEL.ha;
  const div = state.unit === 'mu' ? 666.6667
    : state.unit === 'm2' ? 1
    : state.unit === 'km2' ? 1e6
    : 1e4;
  const lines = [[
    '文件名', '名称', '类型', '周长(米)', '面积(平方米)', '面积(当前单位)',
    '面积单位', '中心经度', '中心纬度', '备注'
  ].map(csvCell).join(',')];
  state.files.forEach(f => {
    f.features.forEach(rec => {
      if (rec.type !== '面' || !recVisible(rec)) return;
      const c = rec.centroid;
      lines.push([
        csvCell(f.name), csvCell(rec.name), csvCell(rec.type),
        csvNum(rec.perimeterM, 2),
        csvNum(rec.areaM2, 2),
        csvNum(rec.areaM2 == null ? null : rec.areaM2 / div, 2),
        csvCell(unitName),
        csvNum(c ? c[0] : null, 6),
        csvNum(c ? c[1] : null, 6),
        csvCell(rec.plainDesc)
      ].join(','));
    });
  });
  return '\ufeff' + lines.join('\r\n') + '\r\n';
}

function exportCsv() {
  const n = exportableFaces().length;
  if (!n) { toast('没有可导出的地块', true); return; }
  const d = new Date();
  const p = v => String(v).padStart(2, '0');
  const name = 'kml_plots_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
    '_' + p(d.getHours()) + p(d.getMinutes()) + '.csv';
  const blob = new Blob([buildCsv()], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`已导出 ${n} 个地块`);
}

/* ================= 文件加载 ================= */
async function handleFiles(fileList) {
  const all = [...fileList];
  const files = all.filter(f => /\.(kml|kmz)$/i.test(f.name));
  if (all.length !== files.length) toast(`已忽略 ${all.length - files.length} 个非 KML/KMZ 文件`, true);
  if (!files.length) return;
  for (const f of files) {
    try {
      await loadFile(f);
    } catch (err) {
      console.error(err);
      toast(`「${f.name}」解析失败：${err.message || '未知错误'}`, true);
    }
  }
}

async function loadFile(file) {
  $('loading-text').textContent = `正在解析 ${file.name} …`;
  $('loading').classList.remove('hidden');
  await new Promise(r => setTimeout(r, 30)); // 让加载层先渲染
  const buf = await file.arrayBuffer();
  let fc;
  try {
    if (/\.kmz$/i.test(file.name)) {
      fc = parseKml(await unzipKmz(buf));
    } else {
      fc = parseKml(decodeKml(buf));
    }
  } finally {
    $('loading').classList.add('hidden');
  }

  const fileRec = {
    id: state.nextId++,
    name: file.name,
    group: L.featureGroup(),
    features: buildRecords(fc, state.files.size)
  };
  if (!fileRec.features.length) {
    toast(`「${file.name}」没有可显示的地理要素`, true);
    return;
  }
  fileRec.features.forEach(rec => {
    rec.fileId = fileRec.id;
    rec.fileGroup = fileRec.group;
    createFeatureLayer(rec).addTo(fileRec.group);
  });
  fileRec.group.addTo(map);
  state.files.set(fileRec.id, fileRec);
  applyVisibility();
  renderSidebar();
  map.flyToBounds(fileRec.group.getBounds().pad(0.3), boundsOptions());
  toast(`已加载「${file.name}」：${fileRec.features.length} 个要素`);
}

/* ================= 事件绑定 ================= */
const unitSel = $('sel-unit');
if ([...unitSel.options].some(o => o.value === state.unit)) unitSel.value = state.unit; // 与 localStorage 恢复的单位同步
unitSel.addEventListener('change', e => {
  state.unit = e.target.value;
  localStorage.setItem('kmlUnit', state.unit);
  state.files.forEach(f => f.features.forEach(rec => {
    if (!rec.layer) return;
    rec.layer.setPopupContent(() => detailContent(rec)); // 打开状态下 Leaflet 会即时刷新布局
  }));
  if (state.filter) { renderSidebar(); applyVisibility(); } // 面积/周长格式变了，筛选结果可能变化
});

const basemapSel = $('sel-basemap');
const tdtBaseOption = [...basemapSel.options].find(o => o.value === 'tdt');
if (!tdtSat) {
  tdtBaseOption.disabled = true;
  tdtBaseOption.title = '未配置天地图 tk';
}
if ([...basemapSel.options].some(o => o.value === state.basemap)) basemapSel.value = state.basemap;

const labelsSel = $('sel-labels');
const LABELS_HINT = labelsSel.title;
function syncLabelsHint() {
  if (state.basemap === 'tdt') labelsSel.title = '天地图卫星图自带注记；选「不显示注记」可隐藏';
  else if (state.basemap === 'qq') labelsSel.title = '腾讯卫星图自带腾讯注记；选「不显示注记」可隐藏';
  else labelsSel.title = LABELS_HINT;
}
syncLabelsHint();

basemapSel.addEventListener('change', e => {
  state.basemap = e.target.value;
  localStorage.setItem('kmlBasemap', state.basemap);
  applyTiles();
  rerenderFeatures();
  syncLabelsHint();
});

const tdtOption = [...labelsSel.options].find(o => o.value === 'tdt');
if (!tdtLabels) {
  tdtOption.disabled = true;
  tdtOption.title = '未配置天地图 tk';
  if (state.labels === 'tdt') state.labels = 'esri';
}
if ([...labelsSel.options].some(o => o.value === state.labels)) labelsSel.value = state.labels;
labelsSel.addEventListener('change', e => {
  state.labels = e.target.value;
  localStorage.setItem('kmlLabels', state.labels);
  applyTiles();
});

const filterInput = $('filter-input');
filterInput.addEventListener('input', () => {
  state.filter = filterInput.value.trim().toLowerCase();
  renderSidebar();
  applyVisibility();
});

const checkAll = $('check-all');
checkAll.addEventListener('change', () => applyAllChecked(checkAll.checked));
$('btn-export-csv').addEventListener('click', exportCsv);

/* 取消选中：点地图空白处或按 Esc */
map.on('click', () => clearSelected());
document.addEventListener('keydown', e => { if (e.key === 'Escape') clearSelected(); });

const fileInput = $('file-input');
$('btn-upload').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
  fileInput.value = '';
});

$('btn-clear').addEventListener('click', () => {
  state.files.forEach(f => map.removeLayer(f.group));
  state.files.clear();
  state.selected = null;
  state.filter = '';
  filterInput.value = '';
  map.closePopup();
  renderSidebar();
  map.flyTo(HOME_VIEW.center, HOME_VIEW.zoom, { animate: true, duration: 0.8 });
  toast('已清空所有图层');
});

/* 拖拽上传 */
let dragDepth = 0;
window.addEventListener('dragenter', e => {
  e.preventDefault();
  if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
    dragDepth++;
    $('drag-overlay').classList.add('show');
  }
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('dragleave', e => {
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('drag-overlay').classList.remove('show');
});
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  $('drag-overlay').classList.remove('show');
  if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
});

/* ================= 初始化 ================= */
applyTiles();
renderSidebar();

/* 浏览器自动化测试钩子 */
window.__kml = { state, map, applyTiles, rerenderFeatures, setSelected, clearSelected, applyVisibility, matchesFilter, flyToFeature, displayGeom, wgs84ToGcj02, sidebarFaces, applyAllChecked, buildCsv, exportCsv };