FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="kml-viewer" \
      org.opencontainers.image.description="KML 卫星图定位查询（纯静态）" \
      org.opencontainers.image.version="1.0.11" \
      org.opencontainers.image.licenses="MIT"

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html /usr/share/nginx/html/index.html
COPY config.js /usr/share/nginx/html/config.js
COPY static/ /usr/share/nginx/html/static/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1