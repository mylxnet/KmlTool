# 项目开发技术文档（PROJECT）

## 1. 概述

KML 卫星地图查看器：纯前端静态网页，本地解析 KML/KMZ 并叠加到 Esri / 高德卫星影像或高德普通地图，勾选 / 筛选控制地块显示，点击要素选中后立即查看名称、周长、面积等信息；首尾闭合的线自动按地块处理。Esri 卫星图可叠加天地图中文注记（镇、村、社名与主要地名）。清空后地图平滑飞回初始全球视野。提供 Docker / 阿里云 ACR 镜像部署。站点名称默认通用，可通过 `config.js` 的 `siteName` 自定义。版本 v1.0.12。

## 2. 运行环境

| 项 | 要求 |
| --- | --- |
| 浏览器 | Edge / Chrome（推荐；Firefox 亦可用，仅失去 GBK 自动识别） |
| 网络 | 需要联网加载 Esri / 高德卫星瓦片；选用天地图注记时还需访问 `t0–t7.tianditu.gov.cn` |
| 运行时 | 无（双击 index.html 即用）；可选 Node.js 用于本地预览服务 |

## 3. 模块划分（static/js/app.js）

| 区块 | 职责 |
| --- | --- |
| 全局状态 `state` | 文件集合（Map）、面积单位、底图（esri/gaode/gaode-vec）、注记来源（tdt/esri/off）、筛选关键字、当前选中记录 |
| 地图初始化 | Leaflet 地图、初始视野常量 `HOME_VIEW`（`[34,108]` 4 级，清空复位共用）、Esri 影像/注记层、高德影像/注记层、高德普通地图层、天地图注记层（6 层常驻按需增删）、缩放/比例尺控件 |
| GCJ-02 纠偏 | `wgs84ToGcj02`（标准火星坐标算法）、`displayGeom`（各几何类型递归偏移，切底图时重渲染） |
| 工具函数 | 数值格式化（中文千分位）、长度/面积/坐标格式化、toast、加载层、HTML 净化（剥离危险标签/事件属性/表现属性）、`stripHtml` |
| 解析链 | `decodeKml`（编码识别）→ `parseKml`（DOMParser + toGeoJSON）→ `unzipKmz`（JSZip） |
| 记录建模 | `buildRecords`（几何拆分、样式、turf 计算、默认勾选、纯文本备注）、`closedRingOf`（闭合线转面）、`ringLengthM`（周长口径）、`centroidOf`（中心点） |
| 显示规则 | `matchesFilter`（全字段子串匹配）、`recVisible`（文件显隐 × 勾选/筛选）、`applyVisibility`（统一增删图层） |
| 渲染 | `createFeatureLayer`（L.geoJSON 图层 + 信息卡，移除点击自动弹卡、点击选中即弹卡）、`rerenderFeatures`（切底图重建并恢复选中/信息卡）、`highlight`、`flyToFeature`（带 maxZoom 封顶）、`detailContent` |
| 选中状态机 | `setSelected`（同色加深覆盖层 + 行高亮，不隐藏其他要素）、`clearSelected`（移除覆盖层、关信息卡）、`ensureHalo` + `darkenHex`（同色压暗覆盖层） |
| 侧栏 | `renderSidebar`（只列面要素，含闭合线：文件分组、筛选后地块行、勾选框、统计、显隐/移除） |
| 文件加载 | `handleFiles` / `loadFile`（读文件、解析、入组、定位） |
| 事件绑定 | 上传按钮、清空、筛选输入、单位切换、底图切换、注记来源下拉、地图空白点击与 Esc 取消选中、拖拽上传（dragenter/over/leave/drop 计数器防闪烁） |

## 4. 数据模型

```js
// 文件记录
{ id, name, group: L.featureGroup, features: [record], visible }

// 要素记录
{
  name,            // 名称（未命名兜底；MultiGeometry 拆分为「名称（1）」…）
  desc,            // 备注（净化后渲染）
  plainDesc,       // 备注纯文本（供筛选匹配）
  style,           // { stroke, fill, strokeOpacity, fillOpacity, strokeWidth }
  geometry,        // GeoJSON geometry（始终为原始 WGS84 坐标）
  type,            // '点' | '线' | '面'
  areaM2,          // 面积（平方米，仅面）
  perimeterM,      // 周长/长度（米，面与线）
  centroid,        // [经度, 纬度]
  checked,         // 勾选框状态（默认 true，决定是否显示在地图）
  layer,           // L.geoJSON 图层引用（渲染坐标按底图偏移）
  row,             // 侧栏行元素引用（仅面要素有）
  fileGroup, fileId, _halo  // 文件组引用、所属文件 id、选中同色覆盖层引用
}
```

## 5. 关键实现细节

### 5.1 编码识别（decodeKml）

1. 读前 512 字节，正则取 `<?xml ... encoding="..."?>`;
2. 声明非 UTF-8 时优先按声明解码并试解析；
3. 再试 UTF-8，结果含 `\uFFFD`（乱码特征）则视为编码不符；
4. 依次回退 GB18030 → GBK（Chromium 的 TextDecoder 支持）；
5. 全部失败抛出最后错误。

### 5.2 样式还原（pickStyle）

togeojson 会把 KML `<Style>`（aabbggrr 颜色、透明度）转成属性 `stroke`/`fill`（#rrggbb 字符串）与 `stroke-opacity`/`fill-opacity`（0-1）。无样式要素回退到 8 色调色板，按文件序号错开。

### 5.3 渲染与交互

- 每条记录 = 一个 `L.geoJSON`（FeatureGroup），避免手写坐标翻转出错；
- 渲染几何经 `displayGeom()`：高德底图（卫星或普通地图）时整体偏移到 GCJ-02，Esri 时原样；计算（面积/周长/中心）始终用原始 WGS84 几何；
- 面填充透明度上限 0.45，悬停时线宽 +2、填充 +0.2，`bringToFront` 防遮挡（选中态跳过悬停高亮）；悬停不弹任何浮层；
- 信息卡（`bindPopup`，半透明深色、带 ×）内容由 `detailContent()` 构建；`bindPopup` 后执行 `layer.off('click', layer._openPopup)` 拆除 Leaflet 自带点击弹卡；
- 点击要素 / 侧栏行 → 选中并立即 `openPopup()`；面要素再调 `centerOnRecord()` 平滑平移到屏幕中央（`flyTo` 外接矩形中心、保持当前 zoom、0.6s），点 / 线不移动；再点同一要素 / 点空白 / Esc / 点 × → `clearSelected()`；
- 选中视觉：`ensureHalo()` 用 `darkenHex(原色, 0.7)` 生成同色加深覆盖层（面=半透明深色填充 0.5–0.7、线=线宽 +2、点=半径 10 圆点），`interactive:false` 不拦截点击，`bringToFront` 置顶；
- 双击侧栏行 → 选中并 `flyToBounds(bounds.pad(0.5), { maxZoom: currentMaxZoom() })` 封顶（Esri / 高德均 18），点为 flyTo 到 zoom≥15；乡村区域 Esri 19 级为占位图，故上限 18；
- 要素层 `bubblingMouseEvents:false`，地图空白点击与 Esc 触发取消选中；
- `popupclose` 联动取消，但仅当 `map.hasLayer(layer)` 时生效——底图切换重建（旧层移除）触发的 popupclose 不清选中；切换前信息卡已打开则重建后自动重开；
- 面积单位切换只 `setPopupContent()` 原地刷新（打开状态 Leaflet 即时重排），不关卡重开，避免 popupclose 误清选中；
- 清空 → `state.files.forEach(map.removeLayer)`、取消选中、清筛选框后 `flyTo(HOME_VIEW.center, HOME_VIEW.zoom, 0.8s)` 平滑飞回初始全球视野，空状态主题面板重现；底图 / 注记来源 / 面积单位偏好不重置。

### 5.4 显示规则（勾选 + 筛选）

- `recVisible(rec) = fileRec.visible && (state.filter ? matchesFilter(rec) : rec.checked)`；
- `matchesFilter` 把名称、`plainDesc`、类型、文件名、格式化周长/面积/中心坐标及原始数值拼接为小写串做子串匹配；
- `applyVisibility()` 每次全量遍历：文件隐藏则整组移除，否则组入图后逐要素按 `recVisible` 增删；末尾若选中要素已不在图上则 `clearSelected()`；
- 筛选激活时侧栏只列命中地块，统计显示「匹配 N 个地块」；筛选临时覆盖勾选，清空后恢复。

### 5.5 周长口径

面只算外边界环（地块惯例）；多面为各面外边界之和；不闭合环自动闭合后计算。

### 5.6 GCJ-02 偏移（wgs84ToGcj02）

标准算法：a=6378245.0、ee=0.00669342162296594323、transformLat/transformLng 多项式。仅对中国范围（经度 72.004–137.8347、纬度 0.8293–55.8271）内的坐标偏移；高度维保留。北京地区偏移量约 0.006°（数百米），不做纠偏在高德底图（卫星与普通地图）上要素会明显错位。

### 5.7 闭合线按面处理（closedRingOf）

- 判定条件：几何为 `LineString`、点数 ≥ 4、首尾点 `turf.distance` ≤ 1 米；
- 转换：`{ type:'Polygon', coordinates:[原坐标数组] }`，原始坐标不变，仅类型升级；
- 派生：记录 `type='面'`，计算 `areaM2`/`perimeterM`/`centroid`，`recStyle` 用线色作 25% 透明填充；侧栏行、勾选、筛选、选中覆盖层均按面工作；
- 反例：首尾未闭合的线仍为 `type='线'`，只渲染不入侧栏。

### 5.8 天地图注记层（tdtLabels）

- 地址：`https://t{0-7}.tianditu.gov.cn/cva_w/wmts?...TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=...`，`subdomains: ['0'..'7']`；
- 创建条件：`TIANDITU_TK` 非空才创建 `tdtLabels`，否则为 `null`，下拉中「天地图注记」禁用并在 `state.labels='tdt'` 时回退 `'esri'`；
- tk 来源：`window.KML_CONFIG.tiandituTk`（项目根目录 `config.js`，不入库；`config.example.js` 为模板；Docker 构建时由 Actions Secret / 本地脚本注入），未定义视为空；可选 `window.KML_CONFIG.siteName` 前置到页面标题与品牌，留空显示通用「卫星图」；
- `applyTiles()` 规则：Esri 底图下 `state.labels==='tdt'` 用天地图注记、`'esri'` 用 Esri 注记、`'off'` 无注记；高德底图始终用高德自带注记；
- `maxZoom: 18`、不设 `maxNativeZoom`：注记按天地图原生层级显示，18 级字号与低级一致、不放大（乡村 18 级仅有零星 POI，属数据限制）；
- 坐标系：CGCS2000（≈WGS84），直接叠在 Esri 影像上无偏移；空瓦片（213B 透明 PNG）属正常，不报错。

## 6. 构建与发布

无前端构建。发布即分发静态目录；版本号需同步 `index.html`（title、署名）与文档。打包/发布动作须经用户确认后执行。

Docker / ACR：

- `deploy/Dockerfile`：`nginx:1.27-alpine`，COPY `index.html`、`config.js` 与 `static/`，带 HEALTHCHECK，暴露 80；
- `deploy/nginx.conf`：`index.html`、`config.js` 与 `static/js|css` 不缓存（升级镜像立即生效），`static/libs/` 30 天 immutable，开启 gzip；
- `.github/workflows/acr.yml`：推送 `v*` 标签自动构建并推送 ACR；显式关闭 `provenance`/`sbom`（ACR 不接受 buildx 默认证明清单）；
- `deploy/docker-compose.yml`：镜像由 `KML_IMAGE` 指定（默认 ACR 占位地址），端口 `KML_PORT`（默认 8080→80），`restart: unless-stopped`；
- `deploy/docker-compose.1panel.yml`：1Panel 编排专用，固定镜像地址与端口，内置健康检查与日志轮转，可选挂载 `config.js`；
- `deploy/build.ps1|sh`、`push-acr.ps1|sh`：参数化 Registry / Namespace / Repo / Tag，默认 `registry.cn-hangzhou.aliyuncs.com`；
- 根目录 `.dockerignore` 排除文档、测试、脚本与部署脚本，构建上下文最小化；
- 完整流程见 `doc/DEPLOY.md` 方式四；1Panel 面板部署见方式五。

## 7. 代码规范

- 注释与文档一律中文；无第三方构建链；
- 用户数据入 DOM 一律 `textContent`，唯一 innerHTML 入口经过 `sanitizeHtml`；
- 常量集中（调色板、SVG 图标、数字格式器、瓦片 URL、缩放上限）。

## 8. 测试

见 `doc/TEST.md`（用例、实测结果、已知限制）；样例与预期值生成脚本 `test/make_samples.mjs`。
