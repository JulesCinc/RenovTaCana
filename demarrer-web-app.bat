@echo off
REM Lance FastAPI + fichiers statiques (uvicorn sur :8000)
REM Sous PowerShell : .\demarrer-web-app.bat   (le .\ est obligatoire pour le dossier courant)
cd /d "%~dp0"

set "PY=%LOCALAPPDATA%\Programs\Python\Python312\python.exe"

if exist "%PY%" goto :run
where python >nul 2>&1
if %ERRORLEVEL% equ 0 (
  set "PY=python"
  goto :run
)

echo Python introuvable ^(%LOCALAPPDATA%\Programs\Python\Python312\python.exe non trouve^).
echo Installe Python 3.12 ou ajoute Python au PATH puis relance ce fichier.
pause
exit /b 1

:run
echo Ouverture du navigateur dans ~2 s sur http://127.0.0.1:8000/
echo Serveur ^(Ctrl+C pour arreter^)
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8000/'"
"%PY%" -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
pause
