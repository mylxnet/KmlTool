param(
    [string]$Registry = "registry.cn-hangzhou.aliyuncs.com",
    [string]$Namespace = "your-namespace",
    [string]$Repo = "kml-viewer",
    [string]$Tag = "v1.0.13"
)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path "$root/config.js")) {
    Copy-Item "$root/config.example.js" "$root/config.js"
    Write-Warning "config.js was missing; copied from config.example.js (Tianditu labels disabled until you fill the tk)"
}

$image = "${Registry}/${Namespace}/${Repo}:${Tag}"

Write-Host "[build] $image"
docker build -f "$root/deploy/Dockerfile" -t $image $root
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

docker tag $image "${Registry}/${Namespace}/${Repo}:latest"
Write-Host "[ok] built: $image (also tagged latest)"