@echo off
setlocal

cd /d "%~dp0"

rem Development GUI uses the supervised mock devices so the EasyCon panel
rem always exposes a mock serial port for local UI and virtual-pad testing.
set "AUTO_POKE_TEST_DEVICES=1"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo.
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

call npm run dev
if errorlevel 1 (
  echo.
  echo GUI stopped with an error.
  pause
)

endlocal
