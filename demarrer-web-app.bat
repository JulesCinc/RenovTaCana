@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM Lance FastAPI + fichiers statiques (uvicorn sur :8000)
REM Sous PowerShell : .\demarrer-web-app.bat   (le .\ est obligatoire pour le dossier courant)
REM Option : set RTC_WEB_DEPS_ONLY=1 pour ne verifier que fastapi + uvicorn ^(sans stack build^)
cd /d "%~dp0"

set "PY="

REM --- 1. Environnement explicite -------------------------------------------
if defined RTC_PYTHON if exist "!RTC_PYTHON!" set "PY=!RTC_PYTHON!" & goto :found
if defined PYTHON_EXE if exist "!PYTHON_EXE!" set "PY=!PYTHON_EXE!" & goto :found
if defined PYTHON_HOME if exist "!PYTHON_HOME!\python.exe" set "PY=!PYTHON_HOME!\python.exe" & goto :found

REM --- 2. Venv du projet ----------------------------------------------------
if exist "%~dp0.venv\Scripts\python.exe" set "PY=%~dp0.venv\Scripts\python.exe" & goto :found
if exist "%~dp0venv\Scripts\python.exe" set "PY=%~dp0venv\Scripts\python.exe" & goto :found

REM --- 3. Portables / dossiers courants sous le depot -----------------------
if exist "%~dp0python\python.exe" set "PY=%~dp0python\python.exe" & goto :found
if exist "%~dp0Python\python.exe" set "PY=%~dp0Python\python.exe" & goto :found
if exist "%~dp0portable\python.exe" set "PY=%~dp0portable\python.exe" & goto :found
if exist "%~dp0PortablePython\python.exe" set "PY=%~dp0PortablePython\python.exe" & goto :found
if exist "%~dp0tools\python\python.exe" set "PY=%~dp0tools\python\python.exe" & goto :found
if exist "%~dp0runtime\python\python.exe" set "PY=%~dp0runtime\python\python.exe" & goto :found

REM --- 4. Lanceur Windows "py" -> chemin reel de Python 3 -------------------
where py >nul 2>&1
if !ERRORLEVEL! equ 0 (
  for /f "delims=" %%i in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do (
    if exist "%%i" set "PY=%%i" & goto :found
  )
)

REM --- 5. Installations utilisateur (AppData) -------------------------------
for %%V in (Python313 Python312 Python311 Python310 Python39 Python38) do (
  if exist "!LOCALAPPDATA!\Programs\Python\%%V\python.exe" (
    set "PY=!LOCALAPPDATA!\Programs\Python\%%V\python.exe"
    goto :found
  )
)

REM --- 6. Program Files -------------------------------------------------------
for %%V in (Python313 Python312 Python311 Python310) do (
  if exist "%ProgramFiles%\%%V\python.exe" set "PY=%ProgramFiles%\%%V\python.exe" & goto :found
)
if defined ProgramFiles(x86) for %%V in (Python313 Python312 Python311 Python310) do (
  if exist "%ProgramFiles(x86)%\%%V\python.exe" set "PY=%ProgramFiles(x86)%\%%V\python.exe" & goto :found
)

REM --- 7. pyenv-win : derniere version installee (nom de dossier tri desc) --
if exist "!USERPROFILE!\.pyenv\pyenv-win\versions\" (
  for /f "delims=" %%d in ('dir /b /ad /o-n "!USERPROFILE!\.pyenv\pyenv-win\versions" 2^>nul') do (
    if exist "!USERPROFILE!\.pyenv\pyenv-win\versions\%%d\python.exe" (
      set "PY=!USERPROFILE!\.pyenv\pyenv-win\versions\%%d\python.exe"
      goto :found
    )
  )
)

REM --- 8. Conda / Miniconda ---------------------------------------------------
if exist "!USERPROFILE!\miniconda3\python.exe" set "PY=!USERPROFILE!\miniconda3\python.exe" & goto :found
if exist "!USERPROFILE!\miniconda\python.exe" set "PY=!USERPROFILE!\miniconda\python.exe" & goto :found
if exist "!USERPROFILE!\anaconda3\python.exe" set "PY=!USERPROFILE!\anaconda3\python.exe" & goto :found
if exist "!LOCALAPPDATA!\miniconda3\python.exe" set "PY=!LOCALAPPDATA!\miniconda3\python.exe" & goto :found

REM --- 9. PATH : premier "python" ou "python3" ------------------------------
for /f "delims=" %%i in ('where python 2^>nul') do (
  if exist "%%i" set "PY=%%i" & goto :found
)
for /f "delims=" %%i in ('where python3 2^>nul') do (
  if exist "%%i" set "PY=%%i" & goto :found
)

echo Python introuvable.
echo.
echo Essaye par exemple :
echo   - Creer un venv :  python -m venv .venv
echo   - Ou definir     set RTC_PYTHON=C:\chemin\vers\python.exe
echo   - Ou ajouter Python au PATH
echo.
pause
exit /b 1

:found
echo Python : !PY!

REM --- Paquets pip (alignes sur requirements.txt) -------------------------
"!PY!" -m pip --version >nul 2>&1
if errorlevel 1 (
    echo pip introuvable ^(Python embarque sans pip ?^). Installe pip ou un environnement complet.
    pause
    exit /b 1
)
echo Verification des paquets pip...
set "PYPKGLIST=fastapi uvicorn numpy pandas geopandas openpyxl"
if defined RTC_WEB_DEPS_ONLY set "PYPKGLIST=fastapi uvicorn"
set "REQMISS="
for %%p in (!PYPKGLIST!) do (
    "!PY!" -m pip show "%%p" >nul 2>&1
    if errorlevel 1 (
        echo   Manquant : %%p
        set "REQMISS=1"
    )
)
if defined REQMISS (
    echo.
    echo Installe les dependances avec :
    echo   "!PY!" -m pip install -r "%~dp0requirements.txt"
    pause
    exit /b 1
)

set "PORT="
for /L %%P in (8000,1,8010) do (
    netstat -ano | findstr /R /C:":%%P .*LISTENING" >nul
    if errorlevel 1 (
        set "PORT=%%P"
        goto :port_found
    )
)

echo Aucun port libre trouve entre 8000 et 8010.
echo Ferme un processus qui occupe ces ports, puis relance.
pause
exit /b 1

:port_found
echo Ouverture du navigateur dans ~2 s sur http://127.0.0.1:!PORT!/
echo Serveur ^(Ctrl+C pour arreter^) sur le port !PORT!
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:!PORT!/'"
"!PY!" -m uvicorn script.main:app --reload --host 127.0.0.1 --port !PORT!
pause
exit /b 0
