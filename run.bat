@echo off
set CONDA_ENV=C:\Users\FrancisAsanteNsiah\anaconda3\envs\geopandas-env

set PATH=%CONDA_ENV%;%CONDA_ENV%\Scripts;%CONDA_ENV%\Library\bin;%CONDA_ENV%\Library\mingw-w64\bin;%PATH%
set PROJ_DATA=%CONDA_ENV%\Library\share\proj

cd /d "%~dp0"
"%CONDA_ENV%\python.exe" -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
