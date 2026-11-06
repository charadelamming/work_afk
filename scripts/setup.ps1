#Requires -Version 5.1
<#
.SYNOPSIS
  一键安装「重生之我挂机上班」的编译环境（Node / VS 生成工具 / Rust / pnpm），并自检。

.DESCRIPTION
  需要管理员权限。若不是以管理员身份运行，脚本会自行弹出 UAC 请求提权。
  安装顺序（每一步都有「已装则跳过」判断）：
    1. Node.js LTS          —— 前端构建运行时
    2. VS 2022 生成工具      —— 提供 cl.exe / link.exe / rc.exe + Windows SDK
    3. Rust stable-msvc      —— 编译 src-tauri
    4. pnpm                  —— 包管理与脚本运行
    5. 项目依赖 + 环境自检
    6.（可选）打包出 NSIS 安装包

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

.EXAMPLE
  # 只装环境、不打包
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -SkipBuild

.EXAMPLE
  # 国内网络拉 crates.io 慢时，走 rsproxy 镜像
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1 -CratesMirror rsproxy -NpmRegistry https://registry.npmmirror.com
#>
param(
    # 只装工具链，不执行 tauri build
    [switch]$SkipBuild,

    # crates.io 镜像：默认直连
    [ValidateSet("none", "rsproxy", "tuna")]
    [string]$CratesMirror = "none",

    # npm 镜像，例如 https://registry.npmmirror.com
    [string]$NpmRegistry = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$script:Warnings = @()

# ── 工具函数 ────────────────────────────────────────────────
function Write-Step($text) {
    Write-Host ""
    Write-Host ("==> " + $text) -ForegroundColor Cyan
}
function Write-Ok($text)   { Write-Host ("    [OK]   " + $text) -ForegroundColor Green }
function Write-Skip($text) { Write-Host ("    [SKIP] " + $text) -ForegroundColor DarkGray }
function Write-Warn2($text) {
    Write-Host ("    [WARN] " + $text) -ForegroundColor Yellow
    $script:Warnings += $text
}

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# 重新读取注册表里的 PATH，让刚装好的工具在本会话立即可用
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $current = $env:Path
    $seen = @{}
    $parts = @()
    foreach ($p in (($machine, $user, $current) -join ";").Split(";")) {
        $t = $p.Trim()
        if ($t -and -not $seen.ContainsKey($t.ToLower())) {
            $seen[$t.ToLower()] = $true
            $parts += $t
        }
    }
    $env:Path = $parts -join ";"
}

function Get-RustupBin { Join-Path $env:USERPROFILE ".cargo\bin" }

function Test-Command($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# 优先解析 .exe / .cmd，避免 `pnpm` / `npm` 落到 *.ps1 shim 被执行策略拦住
function Resolve-Tool($name, $preferExe) {
    $exts = @(".cmd", ".exe")
    if ($preferExe) { $exts = @(".exe", ".cmd") }
    foreach ($e in $exts) {
        $c = Get-Command ($name + $e) -ErrorAction SilentlyContinue
        if ($c) { return $c.Source }
    }
    $c = Get-Command $name -ErrorAction SilentlyContinue
    if ($c -and $c.CommandType -ne "ExternalScript") { return $c.Source }
    return $name
}

# 找已安装的 VS 生成工具
function Get-VsWhere {
    $bases = @(${env:ProgramFiles(x86)}, $env:ProgramFiles) | Where-Object { $_ }
    $candidates = @()
    foreach ($b in $bases) { $candidates += (Join-Path $b "Microsoft Visual Studio\Installer\vswhere.exe") }
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    return $null
}

function Test-MsvcLinker {
    $vswhere = Get-VsWhere
    if ($vswhere) {
        $found = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find "VC\Tools\MSVC\**\bin\Hostx64\x64\link.exe" 2>$null
        if ($found) { return $true }
    }
    $roots = @()
    if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles "Microsoft Visual Studio") }
    if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio") }
    foreach ($base in $roots) {
        if (Test-Path $base) {
            $hit = Get-ChildItem -Path $base -Recurse -Filter "link.exe" -ErrorAction SilentlyContinue |
                   Where-Object { $_.FullName -like "*Hostx64\x64*" } | Select-Object -First 1
            if ($hit) { return $true }
        }
    }
    return $false
}

function Find-WindowsSdkLib {
    $roots = @()
    if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\Lib") }
    if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles "Windows Kits\10\Lib") }
    foreach ($root in $roots) {
        if (Test-Path $root) {
            foreach ($dir in (Get-ChildItem $root -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)) {
                $lib = Join-Path $dir.FullName "um\x64\kernel32.lib"
                if (Test-Path $lib) { return $lib }
            }
        }
    }
    return $null
}

# ── 提权 ────────────────────────────────────────────────────
if (-not (Test-Admin)) {
    Write-Host "需要管理员权限，正在请求提权（请在弹出的 UAC 窗口点「是」）…" -ForegroundColor Yellow
    $hostExe = if ($PSVersionTable.PSEdition -eq "Core") {
        Join-Path $PSHOME "pwsh.exe"
    } else {
        Join-Path $PSHOME "powershell.exe"
    }
    $argString = "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`""
    if ($SkipBuild) { $argString += " -SkipBuild" }
    if ($CratesMirror -ne "none") { $argString += " -CratesMirror $CratesMirror" }
    if ($NpmRegistry) { $argString += " -NpmRegistry `"$NpmRegistry`"" }
    try {
        Start-Process -FilePath $hostExe -ArgumentList $argString -Verb RunAs
    } catch {
        Write-Host "提权被拒绝。请右键 PowerShell →「以管理员身份运行」，再执行本脚本。" -ForegroundColor Red
        exit 1
    }
    exit 0
}

# Windows PowerShell 5.1 默认可能还是 TLS 1.0，下载会失败
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

# 本进程内放开执行策略：否则 `pnpm` / `npm` 会解析到 *.ps1 shim 并被拦住
try { Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force } catch { }

Write-Host ""
Write-Host "重生之我挂机上班 · 编译环境一键安装" -ForegroundColor White
Write-Host ("项目目录：" + $ProjectRoot) -ForegroundColor DarkGray
Write-Host ("PowerShell：" + $PSVersionTable.PSVersion + " (" + $PSVersionTable.PSEdition + ")") -ForegroundColor DarkGray

if (-not (Test-Command "winget")) {
    Write-Host ""
    Write-Host "未找到 winget。请在「Microsoft Store」里安装或更新「应用安装程序 (App Installer)」后重试。" -ForegroundColor Red
    exit 1
}

# 挂起的文件操作会让 VS 安装中途失败，先提醒
$pfro = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager" -Name PendingFileRenameOperations -ErrorAction SilentlyContinue).PendingFileRenameOperations
$pendingReboot = [bool]$pfro -or
    (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending") -or
    (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired")
if ($pendingReboot) {
    Write-Host ""
    Write-Host "注意：系统有挂起的文件操作（等待重启）。" -ForegroundColor Yellow
    Write-Host "      VS 生成工具安装可能因此中断，建议先重启再跑本脚本。" -ForegroundColor Yellow
}

$startedAt = Get-Date

# ── 1. Node.js ─────────────────────────────────────────────
Write-Step "1/5  Node.js LTS"
Update-SessionPath
if (Test-Command "node") {
    Write-Skip ("已安装 " + (& (Resolve-Tool "node" $true) -v))
} else {
    & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements --disable-interactivity
    Update-SessionPath
    if (Test-Command "node") {
        Write-Ok ("node " + (& (Resolve-Tool "node" $true) -v))
    } else {
        throw "Node.js 安装后仍找不到 node，请重开终端后再运行本脚本。"
    }
}

# ── 2. VS 2022 生成工具 + Windows SDK ──────────────────────
Write-Step "2/5  Visual Studio 2022 生成工具（C++ 桌面开发 + Windows SDK）"
if (Test-MsvcLinker) {
    Write-Skip "已检测到 MSVC 链接器 link.exe"
} else {
    Write-Host "    这一步最大（约 3–4 GB），通常 15–30 分钟，请耐心等待…" -ForegroundColor DarkGray
    Write-Host "    安装期间请不要关闭本窗口；中途关掉会留下装了一半的状态。" -ForegroundColor DarkGray
    # --force：VS 可能已注册但缺组件，必须强制重新执行安装
    $vsOverride = "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
    & winget install --id Microsoft.VisualStudio.2022.BuildTools -e --force `
        --accept-source-agreements --accept-package-agreements `
        --override $vsOverride
    if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 3010 -and $LASTEXITCODE -ne 1638 -and $LASTEXITCODE -ne -1978335189) {
        Write-Warn2 ("VS 生成工具返回退出码 " + $LASTEXITCODE + "，稍后自检会再确认")
    }
    Update-SessionPath

    # winget 有时会提前返回，这里轮询等待 link.exe 真正落盘（最多 10 分钟）
    if (-not (Test-MsvcLinker)) {
        for ($i = 1; $i -le 40; $i++) {
            Start-Sleep -Seconds 15
            if (Test-MsvcLinker) { break }
            if ($i % 4 -eq 0) { Write-Host ("    仍在等待 MSVC 安装完成…（" + ($i * 15) + "s）") -ForegroundColor DarkGray }
        }
        Update-SessionPath
    }

    if (Test-MsvcLinker) {
        Write-Ok "MSVC 链接器就绪"
    } else {
        Write-Warn2 "仍未找到 link.exe。请打开「Visual Studio Installer」→ 修改 → 勾选「MSVC v143 - VS 2022 C++ x64/x86 生成工具」→ 安装"
    }
}

# 链接 exe 还需要 Windows SDK 里的 kernel32.lib 等导入库
# 注意：这一段必须放在 MSVC 判断之外 —— 常见情况正是「MSVC 装好了但 SDK 没装」
if (-not (Find-WindowsSdkLib)) {
    Write-Host "    缺少 Windows SDK，定向补装 Windows 11 SDK…" -ForegroundColor DarkGray
    & winget install --id Microsoft.VisualStudio.2022.BuildTools -e --force `
        --accept-source-agreements --accept-package-agreements `
        --override "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
    for ($i = 1; $i -le 20; $i++) {
        Start-Sleep -Seconds 15
        if (Find-WindowsSdkLib) { break }
        if ($i % 4 -eq 0) { Write-Host ("    仍在等待 Windows SDK 安装完成…（" + ($i * 15) + "s）") -ForegroundColor DarkGray }
    }
}

if (Find-WindowsSdkLib) {
    Write-Ok "Windows SDK 就绪"
} else {
    Write-Warn2 "Windows SDK 仍未装全：打开「Visual Studio Installer」→ 修改 → 单个组件 → 勾「Windows 11 SDK (10.0.22621.0)」→ 安装"
}

# ── 3. Rust ───────────────────────────────────────────────
Write-Step "3/5  Rust stable-msvc"
Update-SessionPath
$cargoCmd = Get-Command "cargo" -ErrorAction SilentlyContinue
if (-not $cargoCmd) {
    $cargoExe = Join-Path (Get-RustupBin) "cargo.exe"
    if (Test-Path $cargoExe) { $env:Path = (Get-RustupBin) + ";" + $env:Path; $cargoCmd = Get-Command "cargo" -ErrorAction SilentlyContinue }
}
if ($cargoCmd) {
    Write-Skip ("已安装 " + (& cargo --version))
} else {
    $rustupInit = Join-Path $env:TEMP "rustup-init.exe"
    $downloaded = $false
    try {
        Write-Host "    下载 rustup-init.exe …" -ForegroundColor DarkGray
        Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupInit -UseBasicParsing
        $downloaded = $true
    } catch {
        Write-Warn2 ("rustup 下载失败：" + $_.Exception.Message + "，改用 winget")
    }

    if ($downloaded) {
        & $rustupInit -y --default-toolchain stable-x86_64-pc-windows-msvc --profile minimal
        if ($LASTEXITCODE -ne 0) { throw ("rustup 安装失败，退出码 " + $LASTEXITCODE) }
    } else {
        & winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements --disable-interactivity
        $rustupExe = Join-Path (Get-RustupBin) "rustup.exe"
        if (Test-Path $rustupExe) {
            & $rustupExe default stable-x86_64-pc-windows-msvc
            & $rustupExe component add rust-src 2>$null
        }
    }

    $env:Path = (Get-RustupBin) + ";" + $env:Path
    Update-SessionPath
    if (Test-Command "cargo") {
        Write-Ok (& (Resolve-Tool "cargo" $true) --version)
    } else {
        throw "Rust 安装后仍找不到 cargo，请重开终端后再运行本脚本。"
    }
}

$hostTriple = (& (Resolve-Tool "rustc" $true) -Vv 2>$null | Select-String -Pattern "^host:" | ForEach-Object { $_.ToString().Split(":")[1].Trim() })
if ($hostTriple -and $hostTriple -notlike "*-msvc") {
    Write-Warn2 ("当前 Rust target 是 " + $hostTriple + "，Tauri 需要 -msvc")
    & (Resolve-Tool "rustup" $true) default stable-x86_64-pc-windows-msvc
}

# ── 4. pnpm ───────────────────────────────────────────────
Write-Step "4/5  pnpm"
if (Test-Command "pnpm") {
    Write-Skip ("已安装 pnpm " + (& (Resolve-Tool "pnpm" $false) -v))
} else {
    # corepack 在 Node 22/24 上常因签名校验失败，直接用 npm 全局装
    & (Resolve-Tool "npm" $false) install -g pnpm
    Update-SessionPath
    if (Test-Command "pnpm") {
        Write-Ok ("pnpm " + (& (Resolve-Tool "pnpm" $false) -v))
    } else {
        throw "pnpm 安装失败，请检查 npm 是否可用。"
    }
}

# ── 5. 镜像（可选）+ 项目依赖 + 自检 ───────────────────────
Write-Step "5/5  项目依赖与环境自检"

if ($CratesMirror -ne "none") {
    $cargoDir = Join-Path $env:USERPROFILE ".cargo"
    if (-not (Test-Path $cargoDir)) { New-Item -ItemType Directory -Path $cargoDir -Force | Out-Null }
    $cfgPath = Join-Path $cargoDir "config.toml"
    $index = if ($CratesMirror -eq "tuna") {
        "sparse+https://mirrors.tuna.tsinghua.edu.cn/crates.io-index/"
    } else {
        "sparse+https://rsproxy.cn/index/"
    }
    $existing = if (Test-Path $cfgPath) { Get-Content $cfgPath -Raw } else { "" }
    if ($existing -notmatch "crates-io") {
        $toml = @"
[source.crates-io]
replace-with = "mirror"

[source.mirror]
registry = "$index"

[net]
git-fetch-with-cli = true
"@
        # TOML 不能有 BOM，必须显式用 UTF8Encoding($false) 写
        [IO.File]::WriteAllText($cfgPath, $toml, (New-Object System.Text.UTF8Encoding($false)))
        Write-Ok ("已写入 crates 镜像：" + $CratesMirror)
    } else {
        Write-Skip "已存在 cargo 源配置，未覆盖"
    }
}

Push-Location $ProjectRoot
try {
    $pnpmExe = Resolve-Tool "pnpm" $false
    $installLog = Join-Path $ProjectRoot "install.log"

    # 上次被打断会留下 .ignored_* 残留，先清掉，否则 pnpm 会反复搬家
    $nm = Join-Path $ProjectRoot "node_modules"
    if (Test-Path $nm) {
        Get-ChildItem $nm -Force -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like ".ignored_*" } |
            ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    }

    $installArgs = @("install")
    if ($NpmRegistry) { $installArgs += @("--registry", $NpmRegistry) }
    Write-Host "    执行 pnpm install（日志：install.log）…" -ForegroundColor DarkGray
    & $pnpmExe @installArgs 2>&1 | Tee-Object -FilePath $installLog -Append
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host ("pnpm install 失败，退出码 " + $LASTEXITCODE + "。最后 15 行日志：") -ForegroundColor Red
        Get-Content $installLog -Tail 15 | ForEach-Object { Write-Host ("  " + $_) -ForegroundColor DarkYellow }
        throw "pnpm install 失败：先把上面的报错解决，再重跑本脚本。"
    }
    Write-Ok "前端依赖就绪"

    $checkScript = Join-Path $PSScriptRoot "check-env.ps1"
    if (Test-Path $checkScript) {
        Write-Host ""
        & $checkScript
    }

    if (-not $SkipBuild) {
        Write-Step "开始打包（首次编译 5–15 分钟，要下载 crates）"
        & $pnpmExe tauri build 2>&1 | Tee-Object -FilePath (Join-Path $ProjectRoot "build.log") -Append
        if ($LASTEXITCODE -ne 0) {
            throw ("tauri build 失败，退出码 " + $LASTEXITCODE + "。报错已存到 build.log，也可跑 pnpm check:env 定位。")
        }
        $bundleDir = Join-Path $ProjectRoot "src-tauri\target\release\bundle\nsis"
        Write-Host ""
        Write-Host "打包完成，安装包目录：" -ForegroundColor Green
        Write-Host ("  " + $bundleDir) -ForegroundColor Green
        if (Test-Path $bundleDir) {
            Get-ChildItem $bundleDir -Filter "*.exe" | ForEach-Object {
                Write-Host ("  · " + $_.Name + "  (" + [math]::Round($_.Length / 1MB, 1) + " MB)") -ForegroundColor Green
            }
        }
    }
} finally {
    Pop-Location
}

$elapsed = [math]::Round(((Get-Date) - $startedAt).TotalMinutes, 1)
Write-Host ""
Write-Host ("环境准备结束，用时 " + $elapsed + " 分钟") -ForegroundColor Green
if ($script:Warnings.Count -gt 0) {
    Write-Host ("有 " + $script:Warnings.Count + " 条警告：") -ForegroundColor Yellow
    $script:Warnings | ForEach-Object { Write-Host ("  · " + $_) -ForegroundColor Yellow }
}
Write-Host ""
Write-Host "接下来可以：" -ForegroundColor Cyan
Write-Host "  pnpm tauri dev        # 开发运行" -ForegroundColor Gray
Write-Host "  pnpm tauri build      # 打安装包" -ForegroundColor Gray
Write-Host "  pnpm check:env        # 随时复查环境" -ForegroundColor Gray
