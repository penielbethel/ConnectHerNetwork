@echo off
setlocal

REM Helper script to accept Android SDK licenses and install required components
REM Requires ANDROID_HOME to be set (e.g., C:\Users\<user>\AppData\Local\Android\Sdk)

REM Prefer sdkmanager in cmdline-tools\bin; fall back to cmdline-tools\latest\bin
set "SDKROOT=%ANDROID_HOME%"
if not defined SDKROOT set "SDKROOT=%LOCALAPPDATA%\Android\Sdk"

if exist "%SDKROOT%\cmdline-tools\bin\sdkmanager.bat" (
  set "SDKMANAGER=%SDKROOT%\cmdline-tools\bin\sdkmanager.bat"
) else if exist "%SDKROOT%\cmdline-tools\latest\bin\sdkmanager.bat" (
  set "SDKMANAGER=%SDKROOT%\cmdline-tools\latest\bin\sdkmanager.bat"
) else (
  echo ERROR: sdkmanager not found under "%SDKROOT%\cmdline-tools".
  exit /b 1
)

if not exist "%SDKMANAGER%" (
  echo ERROR: sdkmanager not found at "%SDKMANAGER%".
  echo Please ensure Android Command-line Tools (latest) are installed under ANDROID_HOME\cmdline-tools\latest.
  exit /b 1
)

echo Accepting Android SDK licenses...
echo y | "%SDKMANAGER%" --licenses || (
  echo ERROR: Failed to accept licenses.
  exit /b 1
)

echo Installing Android SDK platforms/build-tools and platform-tools...
"%SDKMANAGER%" "platforms;android-35" "build-tools;35.0.0" "platform-tools" || (
  echo ERROR: Failed to install SDK components.
  exit /b 1
)

echo Android SDK components installed successfully.
endlocal