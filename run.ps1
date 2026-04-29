$CONDA_ENV = "C:\Users\FrancisAsanteNsiah\anaconda3\envs\geopandas-env"

$env:PATH = "$CONDA_ENV;$CONDA_ENV\Scripts;$CONDA_ENV\Library\bin;$CONDA_ENV\Library\mingw-w64\bin;$env:PATH"
$env:PROJ_DATA = "$CONDA_ENV\Library\share\proj"

Set-Location $PSScriptRoot

& "$CONDA_ENV\python.exe" -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
