if ($args -contains '--version') { Write-Output 'ctest version 3.30.0' }
else { Add-Content -LiteralPath $env:AUTO_POKE_LAUNCHER_TEST_LOG -Value 'ctest' }
$global:LASTEXITCODE = 0
