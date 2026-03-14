@echo off
REM Build backend and frontend with a unique tag, load into Minikube, and deploy.
REM Run from repo root. Set NEXT_PUBLIC_API_URL before running if needed (default in script).

cd /d "%~dp0\.."

REM Unique tag: build-YYYYMMDD-HHMMSS-RANDOM (time has colons replaced with -)
set "PART_DATE=%date:~10,4%%date:~4,2%%date:~7,2%"
set "PART_TIME=%time:~0,2%%time:~3,2%%time:~6,2%"
set "PART_TIME=%PART_TIME: =0%"
set "PART_TIME=%PART_TIME::=-%"
set "TAG=build-%PART_DATE%-%PART_TIME%-%RANDOM%"

if not defined NEXT_PUBLIC_API_URL set "NEXT_PUBLIC_API_URL=https://api.ec2-18-118-6-21.us-east-2.compute.amazonaws.com"

echo Tag: %TAG%
echo Building backend...
docker build --no-cache -t "atoms-backend:%TAG%" ./backend
if errorlevel 1 exit /b 1
echo Building frontend (NEXT_PUBLIC_API_URL=%NEXT_PUBLIC_API_URL%)...
docker build --no-cache -t "atoms-frontend:%TAG%" --build-arg "NEXT_PUBLIC_API_URL=%NEXT_PUBLIC_API_URL%" ./frontend
if errorlevel 1 exit /b 1
echo Loading images into Minikube (save to tar then load in cluster)...
set "TAR=atoms-images-%TAG%.tar"
docker save -o "%TAR%" "atoms-backend:%TAG%" "atoms-frontend:%TAG%"
if errorlevel 1 exit /b 1
minikube cp "%TAR%" "/tmp/atoms-images.tar"
minikube ssh docker load -i /tmp/atoms-images.tar
minikube ssh "rm -f /tmp/atoms-images.tar"
del /q "%TAR%" 2>nul
echo Updating deployments to use %TAG%...
kubectl set image deployment/backend backend=atoms-backend:%TAG% -n atoms-demo
kubectl set image deployment/frontend frontend=atoms-frontend:%TAG% -n atoms-demo
echo Waiting for rollout...
kubectl rollout status deployment/backend -n atoms-demo
kubectl rollout status deployment/frontend -n atoms-demo
echo Done. Backend and frontend now use tag: %TAG%
