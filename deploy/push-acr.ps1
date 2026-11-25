param(
    [string]$Registry = "registry.cn-hangzhou.aliyuncs.com",
    [string]$Namespace = "your-namespace",
    [string]$Repo = "kml-viewer",
    [string]$Tag = "v1.0.13",
    [string]$Username = ""
)
$ErrorActionPreference = "Stop"

Write-Host "[login] $Registry (use the fixed ACR password set in console, not your Alibaba Cloud password)"
if ($Username) {
    docker login $Registry -u $Username
} else {
    docker login $Registry
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[push] ${Registry}/${Namespace}/${Repo}:${Tag}"
docker push "${Registry}/${Namespace}/${Repo}:${Tag}"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

docker push "${Registry}/${Namespace}/${Repo}:latest"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "[ok] pushed ${Tag} and latest"