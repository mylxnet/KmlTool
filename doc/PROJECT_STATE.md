# 项目状态 / 交接文档（PROJECT_STATE）

## 当前版本

v1.0.12（2026-11-24）

## 已完成功能

- KML / KMZ 上传（多选、拖拽），KMZ 解压并优先读取 doc.kml
- 三种底图切换：Esri World Imagery（默认）+ 高德卫星图（含注记）+ 高德普通地图（webrd 路网，自带注记），选择记忆
- 天地图中文注记：Esri 卫星图可叠加天地图透明注记（镇、村、社名与主要 POI / 道路），顶栏「注记来源」三档（天地图 / Esri / 不显示）并记忆；注记按原生层级显示、字号不放大
- 天地图注记配置：把 `config.example.js` 复制为 `config.js` 填入自用「浏览器端」tk（`config.js` 不入库），留空则自动禁用该选项、回退 Esri 注记
- 高德底图 GCJ-02 自动纠偏（渲染坐标偏移，计算仍基于 WGS84）
- 点 / 线 / 面渲染，还原 KML 样式，无样式用调色板
- 地块勾选显隐：每行前复选框，默认全部勾选，勾选状态跨底图保持
- 全字段筛选：侧栏筛选框匹配名称/备注/类型/文件名/周长/面积/坐标，地图同步只显示匹配要素（含点、线），清空恢复勾选状态
- 谷歌式选中 / 取消选中：点击要素或侧栏行选中并**立即弹出信息卡**，选中区域**同色加深**（面=深色半透明叠层、线=加粗、点=加深圆点，无白边）；面（地块）选中后自动平滑居中到屏幕中央（缩放不变，点/线不移动）；再点同一要素、点空白、Esc、× 四种取消方式；选中与信息卡跨底图切换保持
- 悬停仅做高亮（线宽/填充加深、行同步），不弹任何提示浮层
- 闭合线按面处理：首尾重合（≤1 米）的 LineString 自动转面——填充、算面积周长、进侧栏、可勾选筛选（如闭合线示例.kmz）；非闭合线、点只上图不入栏
- 双击侧栏条目定位，缩放封顶（Esri / 高德均 18 级；Esri 乡村 19 级为占位图）
- 侧栏只列地块（面要素，含闭合线）：勾选框 + 色块 + 名称，半透明毛玻璃背景
- 首页半透明主题面板「卫星图 KML 定位查询」+ 署名，无选择文件按钮（工具条上传或拖拽）；标题默认通用，`config.js` 的 `siteName` 可前置自用站点名
- 清空复位：移除全部图层后地图平滑飞回初始全球视野（`HOME_VIEW` `[34,108]` 4 级），首页主题面板重现；底图/注记/单位偏好保留
- Docker / ACR 部署：`deploy/Dockerfile`（nginx:1.27-alpine）+ `nginx.conf` + `docker-compose.yml` + 构建/推送脚本（PowerShell / sh），部署手册见 `doc/DEPLOY.md` 方式四
- GitHub Actions 自动发布：`.github/workflows/acr.yml`，推送 `v*` 标签自动构建并推送到 ACR（Secrets：ACR_REGISTRY / ACR_NAMESPACE / ACR_USERNAME / ACR_PASSWORD / TIANDITU_TK；v1.0.12 实跑成功 run 45415825844，ACR 现有 v1.0.11、v1.0.12、latest，关闭 provenance/sbom 以兼容 ACR）
- tk 外置：源码不含天地图 tk，本地 `config.js`（不入库）提供，新增 `config.example.js` 模板
- 面积单位切换（平方米/公顷/亩/平方公里）并记忆，顶栏下拉
- 编码兼容 UTF-8 / GB18030 / GBK
- 详情：名称、类型、周长、面积、中心坐标、备注（HTML 净化）
- 本地化第三方库，双击 index.html 即用
- 手机端适配：≤768px 工具栏分两行，侧栏改为底部抽屉（42dvh）并加大触控区；首页标题自适应折行、信息卡限宽；触屏隐藏 +/- 与比例尺；选地块/加载文件时按抽屉高度上移可见中心
- 测试样例与预期值脚本（test/make_samples.mjs）

## 踩过的坑

| # | 现象 | 根因 | 修复 | 教训 |
| --- | --- | --- | --- | --- |
| 1 | 加载后报「fileRec.group.getBounds is not a function」 | Leaflet 中 `getBounds()` 只存在于 FeatureGroup，`L.layerGroup()` 返回的 LayerGroup 没有 | 文件分组改用 `L.featureGroup()` | 调用 Leaflet API 前先确认方法归属层级 |
| 2 | 要素列表正常但地图上无图层，getBounds 返回空 | `buildRecords` 拼记录时漏存 `geometry` 字段，L.geoJSON 收到 undefined | 补上 `geometry: geom` | 记录模型字段与消费方逐一对账；空 FeatureGroup 不报错，属静默失败，易漏检 |
| 3 | 备注显示「[object Object]」 | toGeoJSON 把含 CDATA 的 `<description>` 解析为 `{@type, value}` 对象 | 取 `rawDesc.value` | 上游库对 CDATA 的处理要做类型防御 |
| 4 | 备注中的 `<img onerror>` 未移除 | 净化白名单漏了 img 标签（onerror 已被剥，但坏图会显示且可加载外链图） | 把 img/svg/video/audio 一并加入移除列表 | 白名单要按「全部危险标签」而非「已见标签」维护 |
| 5 | 刷新后单位数值与下拉框不一致 | `state.unit` 从 localStorage 恢复，但 `<select>` 未同步 | 初始化时按 state.unit 设置 select.value | 持久化状态与控件要双向同步 |
| 6 | GBK 编码文件中文名乱码 | UTF-8 解码 GBK 字节不报错，只产生 U+FFFD，原「解析失败再换编码」逻辑不触发 | 改为优先按 XML 声明编码解码 + U+FFFD 乱码启发式兜底 | 编码识别不能只依赖「解析失败」信号 |
| 7 | 侧栏统计行被截断 | 300px 侧栏内统计文本 + 下拉框超宽，text-overflow 截断 | side-head 允许 flex-wrap，统计行 white-space: normal | 统计信息必须完整可见 |
| 8 | 高德底图下要素偏移数百米 | 高德瓦片是 GCJ-02 火星坐标，KML 是 WGS84，直接叠加必偏移 | 渲染前 displayGeom() 做 wgs84→gcj02 偏移（中国范围外不转），切底图重渲染 | 国内底图必须先确认坐标系；显示坐标与计算坐标分离（计算始终用 WGS84） |
| 9 | 双击侧栏行会先触发两次单击 | dblclick 前必然伴随两次 click，点选开关会闪两下（选中→取消→选中） | dblclick 处理器统一 setSelected + flyToFeature，最终态正确 | 单击/双击并存的控件要按「最终态」设计处理器 |
| 10 | 选中的要素点击时会把「取消选中」冒泡成地图空白点击 | 要素层的 click 会冒泡到 map，触发空白取消逻辑，与要素自身点击处理冲突 | 要素层设 `bubblingMouseEvents:false`，光晕层 `interactive:false` | 地图级点击事件与要素级点击事件必须显式隔离 |
| 11 | 隐藏文件后其要素仍在地图上 | 误读测试结果：`.every(!hasLayer)` 为真表示「全部已移除」，命名歧义导致误判 | 复核 Leaflet 源码确认 LayerGroup.onRemove 会递归移除子层 | 测试变量命名要无歧义（`allOffMap` 优于 `layersOnMap`） |
| 12 | 点击选中后信息卡立即弹出，与「选中后默认不显示」冲突 | `bindPopup` 会向图层注册 `click: _openPopup`，点击自动弹卡 | `bindPopup` 后执行 `layer.off('click', layer._openPopup)`；v1.0.2 用 3 秒悬停计时，v1.0.3 起改为选中即手动 `openPopup()` | 第三方库绑定的隐式交互要显式拆除 |
| 13 | 切换底图后选中态丢失 | 重建图层时旧层移除触发 `remove: closePopup` → `popupclose`，事件可能在恢复选中之后到达，把新选中清掉 | popupclose 处理器加 `map.hasLayer(layer)` 守卫，仅图层仍在地图上才视为用户取消 | 销毁路径触发的同类事件要按「对象是否仍在场景中」区分 |
| 14 | 点击要素后光标一直停在上面，满 3 秒不出卡 | 计时只在 `mouseover` 启动，而点击时鼠标早已进入，不会再触发 mouseover | v1.0.2 在选中动作上补启计时；v1.0.3 已删除整套悬停计时 | 依赖「进入」事件的计时要在动作上补启一次 |
| 15 | 双击地块后地图放大到空白 | Esri 乡村区域 19 级瓦片为「Map data not yet available」占位图（约 2.5KB），18 级才是真实影像 | `ESRI_MAX_ZOOM` 19 → 18，所有定位与加载封顶统一走 `currentMaxZoom()` | 影像可用层级要实测瓦片内容，不能只看服务声明的 maxZoom |
| 16 | 切换面积单位时抛 `TypeError`、信息卡不刷新 | 删除提示层后仍保留 `setTooltipContent()` 调用，图层无 tooltip 时 Leaflet 抛错并中断 handler | 删除该调用，仅保留 `setPopupContent()` | 删除功能要全量清理引用（grep 关键字） |
| 17 | 切换面积单位后选中被取消、信息卡消失 | 用 `closePopup()+openPopup()` 刷新内容，`closePopup` 触发 `popupclose` → `clearSelected()`，随后访问 `state.selected.layer` 报错 | 改为仅 `setPopupContent()`（打开状态 Leaflet 会即时重排） | 自身的关闭动作也会触发联动取消，避免用关卡重开实现刷新 |
| 18 | 切换底图后选中恢复但信息卡消失 | `rerenderFeatures()` 重建图层时弹出层必然关闭，恢复选中时未重开 | 记录 `wasPopupOpen`，恢复选中后自动 `openPopup()` | 重建路径要恢复全部可见状态，不只数据状态 |
| 19 | 用闭合线画的边界（闭合线示例.kmz）不进侧栏、无面积 | 文件只有 LineString，「只列面」规则把它过滤掉 | `closedRingOf()` 首尾 ≤1 米判定为闭合，转 Polygon 记录（填充线色 25%），参与面积/周长/侧栏/勾选 | 「面」不能只看几何类型，要兼容用线画边界的导出习惯 |
| 20 | 天地图瓦片用 curl 直接请求返回 403「Key权限类型为:浏览器端」 | tk 为浏览器端密钥，服务端会校验 UA / Referer；命令行默认 UA 被拒 | 浏览器请求天然带 UA；自测时给 curl 加 Chrome UA + Referer 即 200。实测无 Referer / `file://` 场景同样放行 | 「浏览器端」密钥的校验口径要按真实浏览器环境验证 |
| 21 | Esri 影像上放大到 18 级后天地图镇村名消失 | 天地图乡村 18 级注记数据只剩零星 POI 图标，大部分瓦片为空白 | v1.0.4 曾设 `maxNativeZoom: 17` 沿用 17 级注记放大显示；用户反馈字号变大，v1.0.5 取消，按原生 18 级显示 | 注记方案要在「放大后仍有名」与「字号不变」之间取舍，由用户裁决；注记覆盖度必须按层级实测 |
| 22 | 自动化截图报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`（visibilityState=hidden） | 内置浏览器窗口不可见时无法取帧 | 本轮改用本机 Chrome `--headless=new` + CDP（`Page.captureScreenshot`）截真实页面；内置浏览器重导航偶尔可恢复 | 截图通道不可用时，优先换真实浏览器渲染，而不是伪造合成图 |
| 23 | 自动化断言「点击后中心误差 0.047°」 | 隐藏标签页 rAF 被暂停，`flyTo` 动画不推进，读取到的是中途坐标 | 交互/动画类断言改在无头 Chrome（可见渲染）中跑，误差 0（行点击）/ 4e-5°（地图点击，popup 自动避让后微调） | 页面不可见时动画不会按时间推进，不能以 hidden 页结果判断动画逻辑 |
| 24 | `DELETE /repos/mylxnet/KmlTool` 返回 403 | classic PAT 仅有 `repo, workflow, write:packages`，删除仓库需要 `delete_repo` scope，管理员权限不能替代 | 改由仓库所有者在网页 Settings → Danger Zone 删除，再同名重建 | 涉及删除的自动化先核对 token scopes，不要假设 admin 权限足够 |
| 25 | 重建仓库的 `POST /user/repos` 返回 400「Problems parsing JSON」 | Git Bash 下 `curl -d` 携带中文描述时请求体被转写损坏 | 用 UTF-8 JSON 文件配合 `--data-binary @file`，或改用纯 ASCII 描述 | 含非 ASCII 的 JSON 一律走文件体，避免命令行编码问题 |
| 26 | ACR registry 接口无法删除仓库或 manifest | 个人版 ACR 的 token 只授予 `pull`，`DELETE .../manifests/<digest>` 返回 401，`DELETE /v2/<repo>/` 返回 404 | 在 ACR 控制台删除仓库；随后重跑原 tag 的 Actions run，推送时自动重建仓库与标签 | 仓库级删除属 ACR 控制面能力，不能依赖 Docker Registry v2 接口 |

## 架构决策

- **Leaflet + GeoJSON 图层逐要素渲染**：每条要素一个 L.geoJSON 图层，坐标翻转交给库处理，悬停/信息卡/定位/选中按记录统一管理；
- **显示坐标与计算坐标分离**：渲染几何经 displayGeom 按底图偏移（GCJ-02），面积/周长/中心始终基于原始 WGS84 几何；
- **显示规则集中**：勾选（checked）与筛选（filter）由 `recVisible` 统一裁决，`applyVisibility` 全量增删图层；选中只负责高亮，不再控制显隐；
- **点击即弹卡 + 同色加深**：`bindPopup` 绑定信息卡后拆除 Leaflet 默认点击弹卡，点击由选中流程统一开关；覆盖层用原色压暗（darkenHex 0.7）整体加深，不使用白色光晕；
- **闭合线归一**：`closedRingOf` 在建模阶段把首尾重合的线升级为 Polygon，后续链路（样式/计算/侧栏/筛选/选中）无需分支；
- **注记层选型**：叠加 Esri 影像的中文注记选天地图 `cva_w`——CGCS2000≈WGS84 可直叠无偏移；高德注记 GCJ-02 偏移数百米且栅格无法纠偏，不采用；
- **全库本地化**：不依赖 CDN，国内网络环境双击即用；
- **单位/底图记忆**：localStorage 保存，下拉框与状态双向同步；
- **渲染安全**：唯一 innerHTML 入口 + 白名单净化。

## 已知限制

- 卫星影像清晰度取决于 Esri / 高德服务本身；Esri 乡村区域最细仅到 18 级；
- 天地图乡村注记本身稀疏（17 级约 7/25 瓦片有内容），18 级数据几乎只有 POI；注记按原生层级显示、字号不放大，放大到 18 级后乡村地名会更少；高德 / 腾讯注记为 GCJ-02，无法直接叠 Esri 影像；
- 天地图注记依赖个人申请的 tk（浏览器端），tk 失效或超额时注记缺失，影像与地块功能不受影响；
- 点击居中按「整页屏幕中心」计算（地图容器满屏，x≈720）；侧栏 300px 浮层在左侧，居中位置不受其影响，也不会被遮挡；点、线要素点击不移动地图；
- 清空只复位视野与图层，不重置底图、注记来源、面积单位（偏好属于用户设置，跨清空保留）；
- 闭合线判定阈值为首尾相距 ≤1 米，未真正闭合的线不会自动转面；
- 高德瓦片 GCJ-02 纠偏为近似转换（误差米级），且仅对中国范围生效；
- 筛选按「当前单位下格式化的数值文本」匹配，切换单位后同一数字关键字可能不再命中；
- 面周长只计外边界（不含内部洞）；跨 180° 经线的要素显示会异常；
- GroundOverlay（贴地图片）、gx:Track（轨迹回放）等冷门 KML 元素不渲染；
- 超大文件（>100MB）解析较慢（加载层有提示）；
- Docker 镜像构建与推送已由 GitHub Actions 实跑验证（v1.0.12，run 45415825844，ACR 命名空间 `mylxnet`）；开发机未安装 Docker，容器运行与 nginx 配置仍仅静态核对；
- 阿里云 ACR 不接受 buildx 默认 provenance 证明清单，工作流已显式关闭 `provenance`/`sbom`，后续修改构建步骤需保留；
- Firefox 无 GBK TextDecoder，GBK 文件会回退报错或乱码（建议 Edge/Chrome）。

## 待办清单

- [ ] 地图手动测量工具（画线/画面直接出周长面积）
- [ ] 要素导出 GeoJSON / 截图
- [ ] 更多底图源切换（天地图注记已接入，可再补天地图影像底图）
- [ ] 点聚合

## 构建发布命令

```bash
node scripts/serve.js            # 本地预览 http://127.0.0.1:8000
node test/make_samples.mjs       # 重新生成测试样例与预期值

# GitHub Actions（推荐）：打标签推送即自动构建并推 ACR
git tag v1.0.12 && git push origin v1.0.12

# 或本地构建推送（需装有 Docker 的机器；命名空间、Registry 可用参数覆盖）
powershell -ExecutionPolicy Bypass -File deploy\build.ps1 -Namespace <命名空间>
powershell -ExecutionPolicy Bypass -File deploy\push-acr.ps1 -Namespace <命名空间> -Username <阿里云账号全名>
# 服务器
KML_IMAGE=registry.cn-hangzhou.aliyuncs.com/<命名空间>/kml-viewer:v1.0.12 docker compose -f deploy/docker-compose.yml up -d
```

无构建步骤；发布 = 拷贝 `index.html` + `static/`（+ 可选 doc/）。
