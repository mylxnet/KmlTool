// 生成 sample.kmz 并用 turf 计算各要素面积/周长预期值（与 app.js 同一套算法）
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const JSZip = require('../static/libs/jszip.min.js');
const turf = require('../static/libs/turf.min.js');
const toGeoJSON = require('../static/libs/togeojson.umd.js');

const here = path.dirname(fileURLToPath(import.meta.url));

function ringLengthM(geom) {
  const rings = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map(c => c[0]);
  let total = 0;
  for (const r of rings) {
    const closed = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]
      ? r : r.concat([r[0]]);
    total += turf.length({ type: 'LineString', coordinates: closed }, { units: 'kilometers' }) * 1000;
  }
  return total;
}

// 浏览器端解析用 DOMParser（app.js），node 端这里直接构造几何表计算预期值
const cases = [
  { name: '地块A（矩形）', geom: { type: 'Polygon', coordinates: [[[116.30, 39.90], [116.35, 39.90], [116.35, 39.95], [116.30, 39.95], [116.30, 39.90]]] } },
  { name: '长安街段', geom: { type: 'LineString', coordinates: [[116.370, 39.907], [116.425, 39.908]] } },
  { name: '开发区（1）', geom: { type: 'Polygon', coordinates: [[[116.20, 39.85], [116.25, 39.85], [116.225, 39.90], [116.20, 39.85]]] } },
  { name: '开发区（2）', geom: { type: 'Polygon', coordinates: [[[116.26, 39.86], [116.30, 39.86], [116.28, 39.91], [116.26, 39.86]]] } },
  { name: '上海三角地块', geom: { type: 'Polygon', coordinates: [[[121.450, 31.220], [121.500, 31.220], [121.475, 31.260], [121.450, 31.220]]] } }
];

console.log('=== 预期值（米制） ===');
for (const c of cases) {
  const feat = { type: 'Feature', properties: {}, geometry: c.geom };
  const isArea = c.geom.type === 'Polygon' || c.geom.type === 'MultiPolygon';
  const isLine = c.geom.type === 'LineString' || c.geom.type === 'MultiLineString';
  const areaM2 = isArea ? turf.area(feat) : null;
  const perimeterM = isArea ? ringLengthM(c.geom)
    : isLine ? turf.length(feat, { units: 'kilometers' }) * 1000 : null;
  console.log(`${c.name}: 面积=${areaM2 == null ? '—' : areaM2.toFixed(2)} m² | 周长=${perimeterM == null ? '—' : perimeterM.toFixed(2)} m`);
  console.log(`   -> 公顷=${areaM2 == null ? '—' : (areaM2 / 1e4).toFixed(4)} | 亩=${areaM2 == null ? '—' : (areaM2 / 666.6667).toFixed(4)} | 公里=${perimeterM == null ? '—' : (perimeterM / 1000).toFixed(4)}`);
}

// 生成 sample.kmz（内嵌 doc.kml）
(async () => {
  const zip = new JSZip();
  zip.file('doc.kml', readFileSync(path.join(here, 'doc.kml')));
  const buf = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(path.join(here, 'sample.kmz'), buf);
  console.log(`\nsample.kmz 已生成：${buf.length} 字节`);

  // 生成 GBK 编码的 sample_gbk.kml（名称含中文，GBK 字节流）
  const nameGbk = Buffer.from([0xB5, 0xD8, 0xBF, 0xE9, 0x42]); // "地块B"
  const kmlGbk = Buffer.concat([
    Buffer.from('<?xml version="1.0" encoding="GBK"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n<Placemark>\n<name>', 'latin1'),
    nameGbk,
    Buffer.from('</name>\n<Polygon><outerBoundaryIs><LinearRing><coordinates>116.40,39.88,0 116.44,39.88,0 116.42,39.92,0 116.40,39.88,0</coordinates></LinearRing></outerBoundaryIs></Polygon>\n</Placemark>\n</Document>\n</kml>\n', 'latin1')
  ]);
  writeFileSync(path.join(here, 'sample_gbk.kml'), kmlGbk);
  console.log(`sample_gbk.kml 已生成：${kmlGbk.length} 字节（GBK 编码，名称「地块B」）`);
})();
