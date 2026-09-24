param(
    [string]$Python = '',
    [string]$IndexUrl = 'https://pypi.org/simple',
    [string]$EnvironmentPath = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$scriptEnv = if ($EnvironmentPath) {
    if ([System.IO.Path]::IsPathRooted($EnvironmentPath)) { $EnvironmentPath }
    else { Join-Path $projectRoot $EnvironmentPath }
} else { Join-Path $projectRoot '.deps/script-python' }

function Get-PythonExecutable([string]$Requested) {
    $candidates = @()
    if ($Requested) {
        $command = Get-Command $Requested -CommandType Application -ErrorAction SilentlyContinue
        if ($command) { $candidates += $command.Source }
        elseif (Test-Path -LiteralPath $Requested -PathType Leaf) { $candidates += $Requested }
    } else {
        # Prefer the launcher-selected 3.12 interpreter when it is installed;
        # the requirements file also supports 3.14 when that is all that exists.
        $launcher = Get-Command py.exe -CommandType Application -ErrorAction SilentlyContinue
        if ($launcher) {
            $launcherPython = & $launcher.Source -3.12 -c 'import sys; print(sys.executable)' 2>$null | Select-Object -First 1
            if ($launcherPython) { $candidates += $launcherPython.Trim() }
        }
        $pythonCommand = Get-Command python.exe -CommandType Application -ErrorAction SilentlyContinue
        if ($pythonCommand) { $candidates += $pythonCommand.Source }
        foreach ($defaultPath in @(
            (Join-Path ${env:LocalAppData} 'Programs/Python/Python312/python.exe'),
            (Join-Path ${env:ProgramFiles} 'Python312/python.exe'),
            (Join-Path ${env:ProgramFiles} 'Python314/python.exe')
        )) {
            if (Test-Path -LiteralPath $defaultPath -PathType Leaf) { $candidates += $defaultPath }
        }
    }

    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        try {
            $version = & $candidate -c 'import sys; print(sys.version_info.major, sys.version_info.minor, sep=chr(46))' 2>$null | Select-Object -First 1
            if ($version -and ([version]$version.Trim() -ge [version]'3.12')) { return $candidate }
        } catch { }
    }
    throw 'Python 3.12 or newer was not found. Install Python or pass -Python <path>.'
}

$pythonExecutable = Get-PythonExecutable $Python
$venvPython = Join-Path $scriptEnv 'Scripts/python.exe'
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    & $pythonExecutable -m venv $scriptEnv
    if ($LASTEXITCODE -ne 0) { throw 'Creating script host environment failed. Python 3.12+ is required.' }
}

$venvVersion = & $venvPython -c 'import sys; print(sys.version_info.major, sys.version_info.minor, sep=chr(46))' 2>$null | Select-Object -First 1
if (-not $venvVersion -or ([version]$venvVersion.Trim() -lt [version]'3.12')) {
    throw "The existing script environment is not Python 3.12+: $scriptEnv"
}

& $venvPython -m pip install --disable-pip-version-check --upgrade --index-url $IndexUrl -r "$projectRoot/runtime/python/requirements.txt"
if ($LASTEXITCODE -ne 0) { throw 'Installing script host dependencies failed.' }
$ocrModels = Join-Path $projectRoot '.deps/ocr-models'
& $venvPython (Join-Path $projectRoot 'tools/setup-ocr-models.py') --root $ocrModels
if ($LASTEXITCODE -ne 0) { throw 'Installing OCR model assets failed.' }
$checkCode = 'import sys, cv2, numpy, onnxruntime, rapidocr; print(sys.version_info[:3], numpy.__version__, cv2.__version__, onnxruntime.__version__)'
& $venvPython -c $checkCode
if ($LASTEXITCODE -ne 0) { throw 'The script host dependency check failed.' }
