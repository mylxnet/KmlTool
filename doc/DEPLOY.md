# 部署手册（DEPLOY）

## 方式一：双击打开（推荐，零部署）

把整个项目目录拷贝到目标机器，双击 `index.html` 即可使用。前提：浏览器为 Edge / Chrome，且机器联网（加载卫星瓦片）。

## 方式二：本地预览服务

```bash
node scripts/serve.js
# 浏览器访问 http://127.0.0.1:8000
```

仅需 Node.js，无第三方依赖。

## 方式三：任意静态 Web 服务器 / 对象存储

整站为纯静态文件，可原样上传到 Nginx、Apache、GitHub Pages、OSS 等：

- 需部署的最小文件集：`index.html` + `static/` 整个目录；
- 无需构建、无环境变量、无后端接口；
- Nginx 参考配置：

```nginx
server {
    listen 80;
    root /var/www/kml;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
```

## 方式四：Docker 镜像 + 阿里云 ACR（推荐服务器部署）

镜像只包含 `index.html` + `static/`，由 nginx 静态托管；`deploy/` 下已备好 Dockerfile、nginx 配置、compose 与构建/推送脚本。以下命令中的 `<命名空间>` 需替换为你在 ACR 创建的命名空间，地域默认杭州（`registry.cn-hangzhou.aliyuncs.com`，其他地域如北京为 `registry.cn-beijing.aliyuncs.com`）。

### 1. ACR 准备（一次性）

1. 阿里云控制台开通「容器镜像服务 ACR」个人版（免费）；
2. 创建命名空间（如 `mylxnet`）与仓库 `kml-viewer`（私有仓库即可）；仓库也可不预建，命名空间存在时首次推送会自动创建；
3. 在 ACR「访问凭证」中设置固定密码，用于 `docker login`。

### 2. 构建并推送镜像

#### 方式 A：GitHub Actions 自动构建（推荐，无需本地 Docker）

仓库已带 `.github/workflows/acr.yml`：推送 `v*` 标签即自动构建并推送 ACR。

1. 在 GitHub 仓库 Settings → Secrets and variables → Actions 添加：

   | Secret | 说明 |
   | --- | --- |
   | `ACR_REGISTRY` | 如 `registry.cn-hangzhou.aliyuncs.com` |
   | `ACR_NAMESPACE` | ACR 命名空间 |
   | `ACR_USERNAME` | 阿里云账号全名 |
   | `ACR_PASSWORD` | ACR 控制台设置的固定密码 |
   | `TIANDITU_TK` | 可选；天地图 tk，驱动天地图注记与天地图卫星图；不填则注记回退 Esri、卫星图选项隐藏（需在控制台勾选 img/cia 服务） |

2. 打标签并推送，触发构建：

   ```bash
   git tag v1.0.14
   git push origin v1.0.14
   ```

3. Actions 完成后，ACR 中出现 `v1.0.14` 与 `latest`（本次实跑 run 45591544304，digest `sha256:a8d80047…`；上一版本 v1.0.12 为 run 45415825844、digest `sha256:08f2b67…`，命名空间 `mylxnet` 下仓库自动创建）。也可在 Actions 页面手动 `workflow_dispatch` 触发。

需要彻底重建镜像时，在 ACR 控制台删除仓库后重跑对应 tag 的 Actions run 即可（个人版 registry 接口不支持仓库级删除）；重跑只会产出该 tag 与 `latest`。

仓库本身不含 tk：工作流用 Secret 生成 `config.js` 后再打包；本地构建则使用项目根目录的 `config.js`。

#### 方式 B：本地构建（需装有 Docker 的机器，项目根目录执行）

Windows PowerShell：

```powershell
powershell -ExecutionPolicy Bypass -File deploy\build.ps1 -Namespace <命名空间>
powershell -ExecutionPolicy Bypass -File deploy\push-acr.ps1 -Namespace <命名空间> -Username <阿里云账号全名>
```

Linux / macOS：

```bash
NAMESPACE=<命名空间> sh deploy/build.sh
NAMESPACE=<命名空间> sh deploy/push-acr.sh
```

推送完成后，ACR 仓库中会有 `v1.0.14` 与 `latest` 两个标签。脚本默认地址为 `registry.cn-hangzhou.aliyuncs.com/<命名空间>/kml-viewer:v1.0.14`，可用 `-Registry` / `REGISTRY` 覆盖。

### 3. 服务器部署（只需 Docker + Compose）

```bash
# 把 compose 文件拷到服务器
scp deploy/docker-compose.yml root@<服务器>:/opt/kml-viewer/

# 服务器上启动（KML_IMAGE 换成你的 ACR 全路径；私有仓库先登录）
docker login registry.cn-hangzhou.aliyuncs.com
cd /opt/kml-viewer
KML_IMAGE=registry.cn-hangzhou.aliyuncs.com/<命名空间>/kml-viewer:v1.0.14 \
  docker compose up -d
```

浏览器访问 `http://<服务器IP>:8080`（端口可用 `KML_PORT=80` 调整）。容器带健康检查，进程崩溃或服务器重启会自动拉起（`restart: unless-stopped`）。

### 4. 升级与回滚

```bash
# 本地：改完代码后重新构建并推送新标签（如 v1.0.14）
powershell -ExecutionPolicy Bypass -File deploy\build.ps1 -Tag v1.0.14 -Namespace <命名空间>
powershell -ExecutionPolicy Bypass -File deploy\push-acr.ps1 -Tag v1.0.14 -Namespace <命名空间>

# 服务器：拉新镜像并重建
KML_IMAGE=registry.cn-hangzhou.aliyuncs.com/<命名空间>/kml-viewer:v1.0.14 \
  docker compose up -d
```

回滚把 `KML_IMAGE` 换回旧标签即可。入口页 `no-cache`、业务脚本 `no-cache`、第三方库 30 天缓存，升级后刷新即生效。

### 5. Docker 方式注意事项

- 镜像内 `config.js` 由构建时注入（Actions 用 Secret `TIANDITU_TK`，本地构建用项目根目录 `config.js`）；镜像不含 `siteName`，页面标题为通用「卫星图」；如需自用站名，可在本地 `config.js` 写 `siteName` 后本地构建，或在服务器把 `config.js` 挂载覆盖到 `/usr/share/nginx/html/config.js`；仓库本身不含 tk，但镜像内含你的 tk，ACR 仓库仍建议设为**私有**；
- 本地直接 `docker build` 前需保证 `config.js` 存在（可从 `config.example.js` 复制）；`deploy/build.ps1|sh` 会自动补建空配置；
- 无需数据卷、环境变量或后端进程；容器只读文件系统即可运行；
- 服务器需能访问 Esri / 高德 / 天地图瓦片域名（443 端口），浏览器端直连，不经过容器；
- 若 `docker compose` 报镜像找不到，检查 `KML_IMAGE` 是否为 ACR 全路径且已 `docker login`；
- ACR 不接受 buildx 默认附带的 provenance 证明清单，会报 `denied: unknown manifest class for application/vnd.oci.empty.v1+json`；工作流已设 `provenance: false`、`sbom: false`，自建流水线需同样关闭；本地 `docker build` 不受影响；
- 构建依赖 `nginx:1.27-alpine` 基础镜像，可从阿里云镜像加速器拉取。

## 方式五：1Panel Docker 编排

适用于已在服务器安装 1Panel、希望通过面板管理容器的场景。compose 文件见 `deploy/docker-compose.1panel.yml`，只做静态站点，无数据库、无后端进程。

### 1. 登录 ACR 私有仓库

ACR 仓库建议设为私有；未登录时编排会报 `pull access denied`。先在面板添加仓库：

1Panel → 容器 → 镜像 → 镜像仓库 → 创建仓库：

| 字段 | 值 |
| --- | --- |
| 地址 | `registry.cn-hangzhou.aliyuncs.com` |
| 用户名 | ACR 用户名（阿里云账号全名） |
| 密码 | ACR 控制台设置的固定密码 |

保存后可在「镜像」页尝试拉取 `registry.cn-hangzhou.aliyuncs.com/mylxnet/kml-viewer:v1.0.14` 验证。也可在 1Panel 终端执行：

```bash
docker login --username=<ACR用户名> registry.cn-hangzhou.aliyuncs.com
```

### 2. 创建编排

1Panel → 容器 → 编排 → 创建编排：

- 名称：`kml-viewer`
- 来源：选择「输入」或「粘贴」，内容用 `deploy/docker-compose.1panel.yml` 全文
- 安装目录：保持面板默认（通常为 `/opt/1panel/docker/compose/kml-viewer`）
- 确认创建后启动

```yaml
services:
  kml-viewer:
    image: registry.cn-hangzhou.aliyuncs.com/mylxnet/kml-viewer:v1.0.14
    container_name: kml-viewer
    ports:
      - "8080:80"
    restart: unless-stopped
    environment:
      TZ: Asia/Shanghai
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1/"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 5s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

端口冲突时把 `"8080:80"` 左侧改成 `8090` 等；若只经 1Panel 反向代理访问，可写成 `"127.0.0.1:8080:80"` 避免直接暴露公网。

### 3. 放行端口

1Panel → 主机 → 防火墙放行 `8080/tcp`；云服务器还需在安全组放行同一端口。浏览器访问 `http://<服务器IP>:8080`，右下角应显示 `v1.0.14 by Mr lin`。

### 4. 可选：自定义站点名

镜像内 `config.js` 只有构建时注入的天地图 tk，页面标题为通用「卫星图」。需要在服务器显示自用站名时：

1. 在编排安装目录（如 `/opt/1panel/docker/compose/kml-viewer/`）新建 `config.js`：

   ```js
   window.KML_CONFIG = {
     tiandituTk: '<天地图浏览器端 tk>',
     siteName: '<站点名>'
   };
   ```

2. 在编排 YAML 中取消这段注释：

   ```yaml
   volumes:
     - ./config.js:/usr/share/nginx/html/config.js:ro
   ```

3. 保存并重建容器。

注意：挂载目标必须是**已存在的文件**。文件缺失时 Docker 会创建同名目录，导致 `config.js` 返回 403、注记回退 Esri。挂载文件会整体替换镜像内配置，`tiandituTk` 也必须一并填写。

### 5. 升级与回滚

把 YAML 中镜像标签改成新版本（如 `v1.0.14`），在编排页面执行「拉取镜像」→「重建」。回滚把标签换回旧版本再重建即可。生产环境建议固定版本标签，不建议长期用 `latest`。

### 6. 反向代理与 HTTPS（可选）

1. 编排端口改为 `"127.0.0.1:8080:80"` 并重建；
2. 1Panel → 网站 → 创建网站，选择「反向代理」，目标填 `http://127.0.0.1:8080`；
3. 绑定域名并申请证书，之后用 `https://<域名>` 访问；防火墙可只保留 80/443。

### 7. 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `pull access denied` / `unauthorized` | ACR 未登录或密码错误，按第 1 步重新添加镜像仓库 |
| 编排启动失败、端口被占用 | `ss -ltnp \| grep 8080` 查占用进程，或改宿主机端口 |
| 页面正常但天地图注记缺失 | 镜像内 tk 失效；按第 4 步挂载含新 tk 的 `config.js` |
| 挂载后 `config.js` 403 | 宿主机文件不存在被 Docker 建成目录，删除目录并创建文件 |
| 容器状态 unhealthy | `docker logs kml-viewer` 查看；容器内 `wget -qO- http://127.0.0.1/` 应返回页面 |
| 地图空白、瓦片不显示 | 是浏览器直连 Esri/高德/天地图，检查客户端网络与 443 放行，与容器出网无关 |

## 运维说明

- 无后端进程、无数据库、无日志；
- 影像与地图瓦片来自官方服务：Esri（`server.arcgisonline.com`）、高德卫星与普通地图（`webst0{1-4}.is.autonavi.com`、`webrd0{1-4}.is.autonavi.com`）、天地图注记（`t0–t7.tianditu.gov.cn`），如企业内网需放行这些域名（443 端口）；
- 默认 Esri 卫星图 + 天地图注记；高德卫星图在国内访问更快、高德普通地图适合看路网，可在页面顶栏切换；底图都加载失败时地图呈空白，请检查网络；
- 天地图注记需把 `config.example.js` 复制为 `config.js` 并填入自用「浏览器端」tk（天地图控制台申请，域名白名单可留空）；`config.js` 不入库，留空时页面自动禁用该选项、使用 Esri 注记。升级覆盖文件后请确认 `config.js` 仍在；
- 升级 = 覆盖文件即可；版本号见右下角署名与 `CHANGELOG.md`。
