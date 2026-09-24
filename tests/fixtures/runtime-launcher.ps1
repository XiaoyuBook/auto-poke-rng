param([string]$Runner, [string]$LogPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$env:AUTO_POKE_LAUNCHER_TEST_LOG = $LogPath
$launcherFixtureTools = Join-Path $PSScriptRoot 'runtime-tools'

# Deterministic discovery of two installed Node candidates. The tiny script
# executables record which one is invoked; this does not recursively run tests.
function Get-Command {
    param([string]$Name, [string]$CommandType, [string]$ErrorAction)
    if ($Name -eq 'node.exe') {
        [pscustomobject]@{ Source = (Join-Path $launcherFixtureTools 'node-first.ps1') }
        [pscustomobject]@{ Source = (Join-Path $launcherFixtureTools 'node-second.ps1') }
    } else {
        Microsoft.PowerShell.Core\Get-Command @PSBoundParameters
    }
}

& $Runner -CTest (Join-Path $launcherFixtureTools 'ctest.ps1')
