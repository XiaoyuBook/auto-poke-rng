param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$scriptEnv = Join-Path $projectRoot '.deps/script-python'
if (-not (Test-Path "$scriptEnv/Scripts/python.exe")) {
    & $Python -m venv $scriptEnv
    if ($LASTEXITCODE -ne 0) { throw 'Creating script host environment failed. Python 3.12+ is required.' }
}
& "$scriptEnv/Scripts/python.exe" -m pip install --index-url https://pypi.org/simple -r "$projectRoot/runtime/python/requirements.txt"
if ($LASTEXITCODE -ne 0) { throw 'Installing script host dependencies failed.' }
