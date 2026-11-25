/* 复制本文件为 config.js，填入天地图「浏览器端」tk 即可启用天地图注记与天地图卫星图
   （控制台需勾选影像 img 与影像注记 cia 服务）。
   config.js 已被 .gitignore 忽略，不会进入仓库；留空则自动使用 Esri 注记、隐藏天地图卫星图。
   siteName 为可选站点名（如自用乡镇名），留空时标题显示「卫星图」。 */
window.KML_CONFIG = {
  tiandituTk: '',
  siteName: ''
};