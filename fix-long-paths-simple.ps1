# Simple script to fix long path issues in React Native builds
Write-Host "=== React Native Long Path Fix Script ===" -ForegroundColor Green

# Function to check if running as administrator
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Function to clean build directories
function Clean-BuildDirectories {
    Write-Host "Cleaning build directories..." -ForegroundColor Yellow
    
    $directories = @(
        "android\.cxx",
        "android\app\.cxx", 
        "android\app\build",
        "node_modules\react-native-gesture-handler\android\.cxx",
        "node_modules\react-native-gesture-handler\android\build"
    )
    
    foreach ($dir in $directories) {
        $fullPath = Join-Path (Get-Location) $dir
        if (Test-Path $fullPath) {
            try {
                Remove-Item -Path $fullPath -Recurse -Force
                Write-Host "Cleaned: $dir" -ForegroundColor Green
            } catch {
                Write-Host "Could not clean $dir" -ForegroundColor Yellow
            }
        }
    }
}

# Function to enable Git long path support
function Enable-GitLongPaths {
    try {
        git config --global core.longpaths true
        Write-Host "Git long path support enabled" -ForegroundColor Green
    } catch {
        Write-Host "Could not enable Git long path support" -ForegroundColor Yellow
    }
}

# Main execution
Write-Host "Current directory: $(Get-Location)" -ForegroundColor Cyan
Write-Host "Current path length: $((Get-Location).Path.Length) characters" -ForegroundColor Cyan

if (-not (Test-Administrator)) {
    Write-Host "Not running as Administrator. Some fixes may not work." -ForegroundColor Yellow
    Write-Host "To enable Windows long path support, run as Administrator:" -ForegroundColor Yellow
    Write-Host "Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name 'LongPathsEnabled' -Value 1" -ForegroundColor Cyan
}

Enable-GitLongPaths
Clean-BuildDirectories

Write-Host "Attempting to build..." -ForegroundColor Yellow
Set-Location "android"

try {
    $env:GRADLE_OPTS = "-Dorg.gradle.jvmargs=-Xmx4096m"
    .\gradlew clean assembleDebug
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Build successful!" -ForegroundColor Green
    } else {
        Write-Host "Build failed. Consider moving project to shorter path like C:\RNApp" -ForegroundColor Red
    }
} catch {
    Write-Host "Build execution failed" -ForegroundColor Red
}

Write-Host "Script complete" -ForegroundColor Green