#Requires -Version 5.1
<#
.SYNOPSIS
  检查「重生之我挂机上班」的编译环境是否齐全。

.DESCRIPTION
  纯只读检查：不安装、不修改任何东西，只报告每一项的状态。
  可独立运行，也会被 setup.ps1 在安装结束后自动调用。

  会区分「完全没装」和「装了一半」——半装是最容易被误判成已装的状态。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\check-env.ps1
#>

$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot

$script:Critical = @()   # 缺失即无法编译
$script:Optional = @()   # 缺失只是不方便

# 中文占两个字符宽度，PadRight 会错位，按显示宽度补齐
function Get-DisplayWidth($s) {
    $w = 0
    foreach ($ch in $s.ToCharArray()) {
        $c = [int]$ch
        if (($c -ge 0x1100 -and $c -le 0x115F) -or
            ($c -ge 0x2E80 -and $c -le 0xA4CF) -or
            ($c -ge 0xAC00 -and $c -le 0xD7A3) -or
            ($c -ge 0xF900 -and $c -le 0xFAFF) -or
            ($c -ge 0xFE30 -and $c -le 0xFE6F) -or
            ($c -ge 0xFF00 -and $c -le 0xFF60) -or
            ($c -ge 0xFFE0 -and $c -le 0xFFE6)) { $w += 2 } else { $w += 1 }
    }
    return $w
}

function Pad-Display($s, $width) {
    $pad = $width - (Get-DisplayWidth $s)
    if ($pad -lt 0) { $pad = 0 }
    return $s + (" " * $pad)
}

function Add-Row($status, $name, $detail) {
    $padded = Pad-Display $name 24
    switch ($status) {
        "ok"   { Write-Host ("  [OK]   " + $padded) -ForegroundColor Green    -NoNewline }
        "skip" { Write-Host ("  [--]   " + $padded) -ForegroundColor DarkGray -NoNewline }
        "warn" { Write-Host ("  [WARN] " + $padded) -ForegroundColor Yellow   -NoNewline }
        "fail" { Write-Host ("  [FAIL] " + $padded) -ForegroundColor Red      -NoNewline }
    }
    Write-Host $detail
}

# 优先解析 .exe / .cmd，避免落到 .ps1 shim（执行策略受限时会直接报错）
function Resolve-Tool($name, $preferExe) {
    $exts = @(".cmd", ".exe")
    if ($preferExe) { $exts = @(".exe", ".cmd") }
    foreach ($e in $exts) {
        $c = Get-Command ($name + $e) -ErrorAction SilentlyContinue
        if ($c) { return $c.Source }
    }
    $c = Get-Command $name -ErrorAction SilentlyContinue
    if ($c -and $c.CommandType -ne "ExternalScript") { return $c.Source }
    return $null
}

function Get-VsWhere {
    $bases = @(${env:ProgramFiles(x86)}, $env:ProgramFiles) | Where-Object { $_ }
    foreach ($b in $bases) {
        $p = Join-Path $b "Microsoft Visual Studio\Installer\vswhere.exe"
        if (Test-Path $p) { return $p }
    }
    return $null
}

function Find-Linker {
    $vswhere = Get-VsWhere
    if ($vswhere) {
        $found = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find "VC\Tools\MSVC\**\bin\Hostx64\x64\link.exe" 2>$null
        if ($found) { return ($found | Select-Object -First 1) }
    }
    $roots = @()
    if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles "Microsoft Visual Studio") }
    if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio") }
    foreach ($base in $roots) {
        if (Test-Path $base) {
            $hit = Get-ChildItem -Path $base -Recurse -Filter "link.exe" -ErrorAction SilentlyContinue |
                   Where-Object { $_.FullName -like "*Hostx64\x64*" } | Select-Object -First 1
            if ($hit) { return $hit.FullName }
        }
    }
    return $null
}

function Get-VsRoot {
    $roots = @()
    if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\2022") }
    if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles "Microsoft Visual Studio\2022") }
    foreach ($r in $roots) { if (Test-Path $r) { return $r } }
    return $null
}

function Find-WindowsSdkLib {
    $roots = @()
    if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\Lib") }
    if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles "Windows Kits\10\Lib") }
    foreach ($root in $roots) {
        if (Test-Path $root) {
            # 注意：这里必须用 foreach 语句，不能把 return 放进 ForEach-Object
            # （脚本块里的 return 只结束当前迭代，外层函数会继续走到末尾的 return $null）
            $dirs = Get-ChildItem -Path $root -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending
            foreach ($dir in $dirs) {
                $lib = Join-Path $dir.FullName "um\x64\kernel32.lib"
                if (Test-Path $lib) { return $lib }
            }
        }
    }
    return $null
}

function Get-WindowsKitsRoot {
    $roots = @()
    if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10") }
    if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles "Windows Kits\10") }
    foreach ($r in $roots) { if (Test-Path $r) { return $r } }
    return $null
}

function Find-WebView2 {
    $keys = @(
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    )
    foreach ($k in $keys) {
        $v = (Get-ItemProperty $k -ErrorAction SilentlyContinue).pv
        if ($v) { return $v }
    }
    $dirs = @()
    if (${env:ProgramFiles(x86)}) { $dirs += (Join-Path ${env:ProgramFiles(x86)} "Microsoft\EdgeWebView\Application") }
    if ($env:ProgramFiles) { $dirs += (Join-Path $env:ProgramFiles "Microsoft\EdgeWebView\Application") }
    foreach ($d in $dirs) {
        if (Test-Path $d) {
            $exe = Get-ChildItem $d -Recurse -Filter "msedgewebview2.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($exe) { return ("已安装（版本目录 " + $exe.Directory.Name + "）") }
        }
    }
    return $null
}

Write-Host ""
Write-Host "重生之我挂机上班 · 环境自检" -ForegroundColor White
Write-Host ("项目目录：" + $ProjectRoot) -ForegroundColor DarkGray
Write-Host ""

# ── 系统 ───────────────────────────────────────────────────
$os = [Environment]::OSVersion.Version
$osText = "Windows " + $os.Major + "." + $os.Minor + " (build " + $os.Build + ")"
if ($os.Build -ge 19041) { Add-Row "ok" "操作系统" $osText }
else { Add-Row "warn" "操作系统" ($osText + "；建议 Win10 2004(19041) 以上") }

# ── WebView2（运行期必需）──────────────────────────────────
$wv = Find-WebView2
if ($wv) { Add-Row "ok" "WebView2 Runtime" $wv }
else {
    Add-Row "fail" "WebView2 Runtime" "未检测到，程序无法打开窗口"
    $script:Critical += "WebView2 Runtime 缺失：装 https://go.microsoft.com/fwlink/p/?LinkId=2124703"
}

# ── Node / pnpm ────────────────────────────────────────────
$nodeExe = Resolve-Tool "node" $true
if ($nodeExe) {
    $v = (& $nodeExe -v) 2>$null
    Add-Row "ok" "Node.js" $v
} else {
    Add-Row "fail" "Node.js" "未安装或不在 PATH"
    $script:Critical += "Node.js 缺失：winget install OpenJS.NodeJS.LTS"
}

$pnpmExe = Resolve-Tool "pnpm" $false
if ($pnpmExe) {
    $v = (& $pnpmExe -v) 2>$null
    if (-not $v) { $v = "已安装（版本读取被策略拦截，用 pnpm.cmd 可绕开）" }
    Add-Row "ok" "pnpm" $v
} else {
    Add-Row "fail" "pnpm" "未安装或不在 PATH"
    $script:Critical += "pnpm 缺失：npm install -g pnpm"
}

# ── Rust ───────────────────────────────────────────────────
$cargoExe = Resolve-Tool "cargo" $true
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if ($cargoExe) {
    $v = (& $cargoExe --version) 2>$null
    Add-Row "ok" "cargo" $v
} elseif (Test-Path (Join-Path $cargoBin "cargo.exe")) {
    Add-Row "warn" "cargo" ("已装在 " + $cargoBin + "，但不在 PATH 里（重开终端即可）")
    $script:Critical += "cargo 在 PATH 外：把 $cargoBin 加入 PATH 或重开终端"
} else {
    Add-Row "fail" "cargo" "未安装（Rust 缺失）"
    $script:Critical += "Rust 缺失：winget install Rustlang.Rustup"
}

$rustcExe = Resolve-Tool "rustc" $true
if ($rustcExe) {
    $vv = (& $rustcExe -Vv) 2>$null
    $hostLine = ($vv | Select-String -Pattern "^host:" | Select-Object -First 1)
    if ($hostLine) {
        $triple = $hostLine.ToString().Split(":")[1].Trim()
        if ($triple -like "*-msvc") { Add-Row "ok" "Rust target" $triple }
        else {
            Add-Row "fail" "Rust target" ($triple + "（Tauri 需要 -msvc）")
            $script:Critical += "Rust target 不对：rustup default stable-x86_64-pc-windows-msvc"
        }
    } else {
        Add-Row "warn" "Rust target" "无法读取 rustc -Vv"
    }
} else {
    Add-Row "fail" "Rust target" "无法检查（rustc 不在 PATH）"
}

# ── MSVC 链接器（重点区分「没装」和「装了一半」）───────────
$linker = Find-Linker
$vsRoot = Get-VsRoot
if ($linker) {
    Add-Row "ok" "MSVC link.exe" $linker
} elseif ($vsRoot) {
    $sizeMb = 0
    $fileSum = (Get-ChildItem $vsRoot -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum)
    if ($fileSum.Sum) { $sizeMb = [math]::Round($fileSum.Sum / 1MB, 0) }
    Add-Row "fail" "MSVC link.exe" ("VS 目录已存在（约 " + $sizeMb + " MB）但缺 link.exe —— 安装未完成")
    $script:Critical += "VS 生成工具装了一半：需在 VS Installer 里「修改」，勾选「MSVC v143 - VS 2022 C++ x64/x86 生成工具」"
} else {
    Add-Row "fail" "MSVC link.exe" "未找到（exe 链接阶段会失败）"
    $script:Critical += "MSVC 缺失：装 VS 2022 生成工具，勾「使用 C++ 的桌面开发」"
}

# ── Windows SDK ────────────────────────────────────────────
$sdkLib = Find-WindowsSdkLib
$kitsRoot = Get-WindowsKitsRoot
if ($sdkLib) {
    # ...\Windows Kits\10\Lib\10.0.26100.0\um\x64\kernel32.lib
    #   File -> x64 -> um -> 10.0.26100.0
    $sdkVer = (Get-Item $sdkLib).Directory.Parent.Parent.Name
    Add-Row "ok" "Windows SDK" ($sdkVer + "（kernel32.lib 就位）")
} elseif ($kitsRoot) {
    $sub = (Get-ChildItem $kitsRoot -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) -join ", "
    Add-Row "fail" "Windows SDK" ("Windows Kits 目录存在但只有 [" + $sub + "]，缺 Lib/Include —— 安装未完成")
    $script:Critical += "Windows SDK 未装全：VS Installer 里补勾「Windows 11 SDK」"
} else {
    Add-Row "fail" "Windows SDK" "未找到 kernel32.lib（链接会失败）"
    $script:Critical += "Windows SDK 缺失：VS Installer 里补勾「Windows 11 SDK」"
}

# ── 待重启（会打断安装程序）───────────────────────────────
$pending = $false
if (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending") { $pending = $true }
if (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired") { $pending = $true }
$pfro = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager" -Name PendingFileRenameOperations -ErrorAction SilentlyContinue).PendingFileRenameOperations
if ($pfro) { $pending = $true }
if ($pending) { Add-Row "warn" "待重启" "系统有挂起的文件操作，安装程序可能被打断，建议先重启" }
else { Add-Row "ok" "待重启" "无" }

# ── 项目自身 ───────────────────────────────────────────────
$nm = Join-Path $ProjectRoot "node_modules"
$stale = @()
if (Test-Path $nm) { $stale = @(Get-ChildItem $nm -Force -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like ".ignored_*" }) }

if (Test-Path (Join-Path $nm "vite")) {
    Add-Row "ok" "项目依赖" "node_modules 已就绪"
} else {
    $detail = "node_modules 缺失或不完整"
    if ($stale.Count -gt 0) { $detail += ("（残留 " + $stale.Count + " 个 .ignored_* 目录，说明上次安装被打断）") }
    Add-Row "fail" "项目依赖" $detail
    $script:Critical += "依赖不完整：在项目目录执行 pnpm install（让它跑完，不要中途关窗口）"
}

$distIndex = Join-Path $ProjectRoot "dist\index.html"
if (Test-Path $distIndex) { Add-Row "ok" "前端产物" "dist/ 已存在" }
else { Add-Row "skip" "前端产物" "dist/ 尚未构建（tauri build 会自动生成）" }

# ── 可选：NSIS / 图标 ──────────────────────────────────────
$nsis = Join-Path $env:LOCALAPPDATA "tauri\NSIS\makensis.exe"
if (Test-Path $nsis) { Add-Row "ok" "NSIS" "已缓存，可离线打包" }
else { Add-Row "skip" "NSIS" "未缓存；首次打包会自动下载（约 3 MB）" }

$ico = Join-Path $ProjectRoot "src-tauri\icons\icon.ico"
if (Test-Path $ico) { Add-Row "ok" "应用图标" "src-tauri/icons/icon.ico" }
else {
    Add-Row "warn" "应用图标" "缺少 icon.ico"
    $script:Optional += "图标缺失：pnpm tauri icon <你的png>"
}

# ── 结论 ───────────────────────────────────────────────────
Write-Host ""
if ($script:Critical.Count -eq 0) {
    Write-Host "结论：环境就绪，可以 pnpm tauri dev / pnpm tauri build。" -ForegroundColor Green
    if ($script:Optional.Count -gt 0) {
        foreach ($o in $script:Optional) { Write-Host ("  · " + $o) -ForegroundColor DarkYellow }
    }
    exit 0
}

Write-Host ("结论：缺 " + $script:Critical.Count + " 项，暂时无法编译。") -ForegroundColor Red
foreach ($c in $script:Critical) { Write-Host ("  · " + $c) -ForegroundColor Yellow }
Write-Host ""
Write-Host "一键补齐：右键 PowerShell →「以管理员身份运行」，执行" -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1" -ForegroundColor Gray
exit 1
