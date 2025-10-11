# Fix long path issues for React Native build
Write-Host "Fixing long path issues..."

# Check if we're running as administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")

if ($isAdmin) {
    Write-Host "Running as administrator - enabling long path support..."
    
    # Enable long path support in Windows
    try {
        Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1
        Write-Host "Long path support enabled in registry"
    } catch {
        Write-Host "Failed to enable long path support: $_"
    }
    
    # Enable long path support for Git
    try {
        & git config --global core.longpaths true
        Write-Host "Git long path support enabled"
    } catch {
        Write-Host "Failed to enable Git long path support: $_"
    }
} else {
    Write-Host "Not running as administrator - cannot modify registry"
    Write-Host "Please run PowerShell as Administrator and execute this script again"
}

# Alternative solution: suggest moving project to shorter path
$currentPath = Get-Location
Write-Host "`nCurrent project path: $currentPath"
Write-Host "Path length: $($currentPath.Path.Length) characters"

if ($currentPath.Path.Length -gt 100) {
    Write-Host "`nWARNING: Project path is quite long ($($currentPath.Path.Length) characters)"
    Write-Host "Consider moving the project to a shorter path like:"
    Write-Host "  C:\dev\connecthermobile"
    Write-Host "  C:\projects\connecthermobile"
    Write-Host "  C:\rn\connecthermobile"
}

# Check if long paths are enabled
try {
    $longPathsEnabled = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -ErrorAction SilentlyContinue
    if ($longPathsEnabled.LongPathsEnabled -eq 1) {
        Write-Host "`nLong path support is ENABLED in Windows"
    } else {
        Write-Host "`nLong path support is DISABLED in Windows"
        Write-Host "Run this script as Administrator to enable it"
    }
} catch {
    Write-Host "`nCould not check long path support status"
}

Write-Host "`nLong path fix script completed."