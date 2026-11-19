@echo off
REM Jalankan salinan sementara supaya fail ini selamat dikemas kini oleh git pull
if not "%~1"=="_run" (
  copy /y "%~f0" "%TEMP%\pa_deploy_run.bat" >nul
  call "%TEMP%\pa_deploy_run.bat" _run "%~dp0"
  exit /b
)
chcp 65001 >nul
title ProAttendance - Deploy
cd /d "%~2"

echo ==================================================
echo   ProAttendance - Deploy ke Firebase (kukusanmy)
echo ==================================================
echo.

REM ---------- 1) Ambil kod terkini dari GitHub ----------
where git >nul 2>nul
if errorlevel 1 (
  echo [!] Git tidak dijumpai - langkau ambil kod dari GitHub.
  goto deploy
)
if not exist ".git" (
  echo [1/3] Sambung folder ini ke GitHub alemmaxx/ProAttendance ...
  git init -b main >nul
  git remote add origin https://github.com/alemmaxx/ProAttendance.git
  git fetch origin main
  git reset --hard origin/main
  git branch --set-upstream-to=origin/main main >nul
) else (
  echo [1/3] Ambil kod terkini dari GitHub ...
  git fetch origin main
  if errorlevel 1 (
    echo [X] Gagal ambil kod dari GitHub. Semak internet, kemudian cuba lagi.
    pause
    exit /b 1
  )
  git reset --hard origin/main
)
echo Versi kod GitHub:
git log -1 --format="  %%h  %%s"
echo.

:deploy
REM ---------- 2) Pasang modul Cloud Functions (sekali sahaja) ----------
if not exist "functions\node_modules" (
  echo [2/3] Pasang modul Cloud Functions ...
  pushd functions
  call npm install
  popd
) else (
  echo [2/3] Modul Cloud Functions sudah ada.
)
echo.

REM ---------- 3) Deploy (HANYA bahagian ProAttendance) ----------
echo [3/3] Deploy hosting + rules + functions ProAttendance ...
call firebase deploy --project kukusanmy --only hosting:proattendance,firestore:proattendance,functions:proattendance

echo.
if errorlevel 1 (
  echo [X] Deploy GAGAL. Semak mesej di atas.
) else (
  echo [OK] Siap! Buka https://proattendancemy.web.app
)
echo.
pause
