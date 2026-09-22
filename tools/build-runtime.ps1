param([string]$OpenCVDir, [switch]$ConfigureOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$depsRoot = Join-Path $projectRoot '.deps'
New-Item -ItemType Directory -Force $depsRoot | Out-Null
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
& cmake -S "$projectRoot/runtime" -B "$projectRoot/runtime/build" -G 'Visual Studio 17 2022' -A x64 "-DOpenCV_DIR=$OpenCVDir"
if ($LASTEXITCODE -ne 0) { throw 'Runtime configuration failed.' }
if (-not $ConfigureOnly) {
    & cmake --build "$projectRoot/runtime/build" --config Release --parallel 4
    if ($LASTEXITCODE -ne 0) { throw 'Runtime build failed.' }
}
