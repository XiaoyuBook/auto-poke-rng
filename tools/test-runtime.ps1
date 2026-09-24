param([string]$CTest)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent

function Get-CTestExecutable([string]$Requested) {
    $candidates = @()
    if ($Requested) {
        $command = Get-Command $Requested -CommandType Application -ErrorAction SilentlyContinue
        if ($command) { $candidates += $command.Source }
        elseif (Test-Path -LiteralPath $Requested -PathType Leaf) { $candidates += $Requested }
    } else {
        $command = Get-Command ctest.exe -CommandType Application -ErrorAction SilentlyContinue
        if ($command) { $candidates += $command.Source }
        $vswhereCandidates = @(
            (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'),
            (Join-Path ${env:ProgramFiles} 'Microsoft Visual Studio/Installer/vswhere.exe')
        )
        foreach ($vswhere in $vswhereCandidates) {
            if (Test-Path -LiteralPath $vswhere -PathType Leaf) {
                $found = & $vswhere -latest -products '*' -find 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/ctest.exe' 2>$null
                if ($found) { $candidates += ($found | Select-Object -First 1) }
            }
        }
        foreach ($defaultPath in @(
            (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/ctest.exe'),
            (Join-Path ${env:ProgramFiles} 'CMake/bin/ctest.exe')
        )) {
            if (Test-Path -LiteralPath $defaultPath -PathType Leaf) { $candidates += $defaultPath }
        }
    }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $versionLine = (& $candidate --version 2>$null | Select-Object -First 1)
            if ($versionLine -match 'ctest version ([0-9.]+)') {
                $version = [version]$matches[1]
                if ($version -ge [version]'3.24') { return $candidate }
            }
        }
    }
    throw 'CTest 3.24 or newer was not found. Install CMake 3.24+ or pass -CTest <path>.'
}

$ctestExecutable = Get-CTestExecutable $CTest
$pythonPath = if ($env:AUTO_POKE_PYTHON) { $env:AUTO_POKE_PYTHON } else { Join-Path $projectRoot '.deps/script-python/Scripts/python.exe' }
if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) {
    $python = Get-Command python.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($python) { $pythonPath = $python.Source }
}
if (-not (Test-Path -LiteralPath $pythonPath -PathType Leaf)) { throw 'Python 3.12+ was not found.' }
& $pythonPath -X utf8 -m unittest runtime/tests/test_ocr.py
if ($LASTEXITCODE -ne 0) { throw 'OCR adapter tests failed.' }
& $ctestExecutable --test-dir (Join-Path $projectRoot 'runtime/build') -C Release --output-on-failure
if ($LASTEXITCODE -ne 0) { throw 'C++ runtime tests failed.' }

$node = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) { throw 'Node.js was not found in PATH.' }
$testFiles = @(
    'tests/runtime-integration.cjs'
    'tests/controller-integration.cjs'
    'tests/device-regressions.cjs'
    'tests/frame-reader-regressions.cjs'
    'tests/runtime-launcher-regressions.cjs'
) | ForEach-Object { Join-Path $projectRoot $_ }
# Synthetic capture uses the same cross-process ownership mutex as real capture.
# Separate test files must not compete for it.
& $node.Source --test --test-concurrency=1 @testFiles
if ($LASTEXITCODE -ne 0) { throw 'Runtime integration tests failed.' }
