param(
    [string]$OpenCVDir,
    [string]$CMake,
    [switch]$ConfigureOnly
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$depsRoot = Join-Path $projectRoot '.deps'
New-Item -ItemType Directory -Force $depsRoot | Out-Null

function Get-CMakeExecutable([string]$Requested) {
    $candidates = @()
    if ($Requested) {
        $command = Get-Command $Requested -CommandType Application -ErrorAction SilentlyContinue
        if ($command) { $candidates += $command.Source }
        elseif (Test-Path -LiteralPath $Requested -PathType Leaf) { $candidates += $Requested }
    } else {
        $command = Get-Command cmake.exe -CommandType Application -ErrorAction SilentlyContinue
        if ($command) { $candidates += $command.Source }

        $vswhereCandidates = @(
            (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'),
            (Join-Path ${env:ProgramFiles} 'Microsoft Visual Studio/Installer/vswhere.exe')
        )
        foreach ($vswhere in $vswhereCandidates) {
            if (Test-Path -LiteralPath $vswhere -PathType Leaf) {
                $found = & $vswhere -latest -products '*' -find 'Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe' 2>$null
                if ($found) { $candidates += ($found | Select-Object -First 1) }
            }
        }

        foreach ($defaultPath in @(
            (Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe'),
            (Join-Path ${env:ProgramFiles} 'CMake/bin/cmake.exe')
        )) {
            if (Test-Path -LiteralPath $defaultPath -PathType Leaf) { $candidates += $defaultPath }
        }
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $versionLine = (& $candidate --version 2>$null | Select-Object -First 1)
            if ($versionLine -match 'cmake version ([0-9.]+)') {
                $version = [version]$matches[1]
                if ($version -ge [version]'3.24') { return $candidate }
            }
        }
    }
    throw 'CMake 3.24 or newer was not found. Install it, add it to PATH, or pass -CMake <path>.'
}

$cmakeExecutable = Get-CMakeExecutable $CMake
if (-not $OpenCVDir) {
    $OpenCVDir = Join-Path $depsRoot 'opencv/build'
    if (-not (Test-Path "$OpenCVDir/OpenCVConfig.cmake")) {
        $archive = Join-Path $depsRoot 'opencv-4.12.0-windows.exe'
        $expected = 'B753B14D880B9BC8D89D6ACD3B665C040BAEC0211078435432FCAE117DB707AF'
        if (-not (Test-Path $archive)) {
            Invoke-WebRequest 'https://github.com/opencv/opencv/releases/download/4.12.0/opencv-4.12.0-windows.exe' -OutFile $archive
        }
        if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $expected) { throw 'OpenCV archive checksum mismatch.' }
        $command = Get-Command 7z.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
        $candidates = @(
            if ($command) { $command.Source }
            if ($env:ProgramFiles) { Join-Path $env:ProgramFiles '7-Zip/7z.exe' }
            if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} '7-Zip/7z.exe' }
        )
        $extractor = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        if ($extractor) {
            & $extractor x $archive "-o$depsRoot" -y -bso0
            if ($LASTEXITCODE -ne 0) { throw 'OpenCV extraction failed.' }
        } else {
            # The checksum-verified official SDK is a 7-Zip self-extracting archive.
            # Quote the destination for Start-Process, including project paths with spaces.
            Write-Host 'Extracting OpenCV using its bundled extractor...'
            $unpack = Start-Process -FilePath $archive -ArgumentList @('-y', ('-o"{0}"' -f $depsRoot)) -WindowStyle Hidden -Wait -PassThru
            if ($unpack.ExitCode -ne 0) { throw "OpenCV self-extraction failed (exit code $($unpack.ExitCode))." }
        }
        if (-not (Test-Path -LiteralPath "$OpenCVDir/OpenCVConfig.cmake" -PathType Leaf)) {
            throw 'OpenCV extraction did not produce build/OpenCVConfig.cmake. Check the destination and available disk space.'
        }
    }
}
& $cmakeExecutable -S "$projectRoot/runtime" -B "$projectRoot/runtime/build" -G 'Visual Studio 17 2022' -A x64 "-DOpenCV_DIR=$OpenCVDir"
if ($LASTEXITCODE -ne 0) { throw 'Runtime configuration failed.' }
if (-not $ConfigureOnly) {
    & $cmakeExecutable --build "$projectRoot/runtime/build" --config Release --parallel 4
    if ($LASTEXITCODE -ne 0) { throw 'Runtime build failed.' }
}
