param(
  [Parameter(Mandatory)] [string] $Owner,
  [Parameter(Mandatory)] [string] $Repo,
  [string] $Tag,                              # 缺省按 tauri.conf.json 的 version 推成 vX.Y.Z
  [string] $BundleDir = "src-tauri\target\release\bundle\nsis",
  [string] $AssetName                         # 缺省用包内最新那个 setup.exe 的文件名
)

$ErrorActionPreference = 'Stop'

$conf = Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json
$version = $conf.version
if (-not $Tag) { $Tag = "v$version" }

# 关键：bundle 目录里可能有历史版本，必须按版本号筛，不能盲取第一个
$candidates = Get-ChildItem $BundleDir -Filter "*_${version}_*-setup.exe" |
  Sort-Object LastWriteTime -Descending
if (-not $candidates) { throw "找不到 $version 的安装包：$BundleDir（先跑 pnpm tauri build）" }
$setup = $candidates | Select-Object -First 1

$sigPath = "$($setup.FullName).sig"
if (-not (Test-Path $sigPath)) {
  throw "找不到签名：$sigPath（构建时是否设置了 TAURI_SIGNING_PRIVATE_KEY / _PASSWORD？）"
}

$name = if ($AssetName) { $AssetName } else { $setup.Name }
$sig = (Get-Content $sigPath -Raw).Trim()
$encodedName = [Uri]::EscapeDataString($name)
$url = "https://github.com/$Owner/$Repo/releases/download/$Tag/$encodedName"

$payload = [ordered]@{
  version   = $version
  notes     = "详见 docs/更新记录.md"
  pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{ signature = $sig; url = $url }
  }
}

$json = $payload | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $PWD "latest.json"), $json, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "已生成 latest.json"
Write-Host "  version = $version"
Write-Host "  file    = $($setup.Name)"
Write-Host "  url     = $url"
Write-Host "  上传时请用这个文件名：$name"
