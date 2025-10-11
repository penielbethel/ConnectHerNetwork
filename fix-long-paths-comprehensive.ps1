# Comprehensive script to fix long path issues in React Native builds
param(
    [switch]$EnableLongPaths,
    [switch]$MoveProject,
    [string]$NewPath = "C:\RNApp"
)

Write-Host "=== React Native Long Path Fix Script ===" -ForegroundColor Green

# Function to check if running as administrator
function Test-Administrator {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Function to enable long path support
function Enable-LongPathSupport {
    if (-not (Test-Administrator)) {
        Write-Host "ERROR: Administrator privileges required to enable long path support." -ForegroundColor Red
        Write-Host "Please run PowerShell as Administrator and execute:" -ForegroundColor Yellow
        Write-Host "Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name 'LongPathsEnabled' -Value 1" -ForegroundColor Yellow
        return $false
    }
    
    try {
        Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name 'LongPathsEnabled' -Value 1
        Write-Host "✓ Long path support enabled in Windows registry" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "ERROR: Failed to enable long path support: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# Function to enable Git long path support
function Enable-GitLongPaths {
    try {
        git config --global core.longpaths true
        Write-Host "✓ Git long path support enabled" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "WARNING: Failed to enable Git long path support: $($_.Exception.Message)" -ForegroundColor Yellow
        return $false
    }
}

# Function to create symbolic links for problematic directories
function Create-SymbolicLinks {
    $projectRoot = Get-Location
    $nodeModules = Join-Path $projectRoot "node_modules"
    
    if (Test-Path $nodeModules) {
        $shortNodeModules = "C:\nm_$(Get-Random)"
        
        try {
            # Create short path directory
            New-Item -ItemType Directory -Path $shortNodeModules -Force | Out-Null
            
            # Move node_modules to short path
            Write-Host "Moving node_modules to shorter path: $shortNodeModules" -ForegroundColor Yellow
            Move-Item -Path $nodeModules -Destination "$shortNodeModules\node_modules" -Force
            
            # Create symbolic link
            New-Item -ItemType SymbolicLink -Path $nodeModules -Target "$shortNodeModules\node_modules" -Force | Out-Null
            
            Write-Host "✓ Created symbolic link for node_modules" -ForegroundColor Green
            return $true
        } catch {
            Write-Host "ERROR: Failed to create symbolic link: $($_.Exception.Message)" -ForegroundColor Red
            return $false
        }
    }
    
    return $false
}

# Function to clean build directories
function Clean-BuildDirectories {
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
                Write-Host "✓ Cleaned: $dir" -ForegroundColor Green
            } catch {
                Write-Host "WARNING: Could not clean $dir : $($_.Exception.Message)" -ForegroundColor Yellow
            }
        }
    }
}

# Function to modify gradle.properties for shorter paths
function Optimize-GradleProperties {
    $gradlePropsPath = Join-Path (Get-Location) "android\gradle.properties"
    
    if (Test-Path $gradlePropsPath) {
        $content = Get-Content $gradlePropsPath
        $modified = $false
        
        # Add or update properties to reduce path lengths
        $properties = @{
            "android.enableJetifier" = "true"
            "android.useAndroidX" = "true"
            "org.gradle.jvmargs" = "-Xmx4096m -XX:MaxMetaspaceSize=512m"
            "org.gradle.parallel" = "true"
            "org.gradle.configureondemand" = "true"
            "org.gradle.daemon" = "true"
            "android.enableR8.fullMode" = "false"
        }
        
        foreach ($prop in $properties.GetEnumerator()) {
            $pattern = "^$($prop.Key)="
            $line = "$($prop.Key)=$($prop.Value)"
            
            if ($content -match $pattern) {
                $content = $content -replace $pattern, $line
            } else {
                $content += $line
                $modified = $true
            }
        }
        
        if ($modified) {
            $content | Set-Content $gradlePropsPath
            Write-Host "✓ Optimized gradle.properties" -ForegroundColor Green
        }
    }
}

# Main execution
Write-Host "Current directory: $(Get-Location)" -ForegroundColor Cyan
Write-Host "Current path length: $((Get-Location).Path.Length) characters" -ForegroundColor Cyan

if ($EnableLongPaths) {
    Write-Host "`n--- Enabling Long Path Support ---" -ForegroundColor Yellow
    Enable-LongPathSupport | Out-Null
    Enable-GitLongPaths | Out-Null
}

if ($MoveProject) {
    Write-Host "`n--- Moving Project to Shorter Path ---" -ForegroundColor Yellow
    if (Test-Path $NewPath) {
        Write-Host "ERROR: Target path already exists: $NewPath" -ForegroundColor Red
        exit 1
    }
    
    try {
        $currentPath = Get-Location
        Copy-Item -Path $currentPath -Destination $NewPath -Recurse -Force
        Write-Host "✓ Project copied to: $NewPath" -ForegroundColor Green
        Write-Host "Please navigate to the new location and run the build from there." -ForegroundColor Yellow
        exit 0
    } catch {
        Write-Host "ERROR: Failed to move project: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

Write-Host "`n--- Cleaning Build Directories ---" -ForegroundColor Yellow
Clean-BuildDirectories

Write-Host "`n--- Creating Symbolic Links ---" -ForegroundColor Yellow
Create-SymbolicLinks | Out-Null

Write-Host "`n--- Optimizing Gradle Properties ---" -ForegroundColor Yellow
Optimize-GradleProperties

Write-Host "`n--- Attempting Build ---" -ForegroundColor Yellow
Set-Location "android"
try {
    $buildResult = & .\gradlew clean assembleDebug 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Build successful!" -ForegroundColor Green
    } else {
        Write-Host "Build failed. Checking for long path errors..." -ForegroundColor Yellow
        $longPathErrors = $buildResult | Select-String "Filename longer than 260 characters"
        if ($longPathErrors) {
            Write-Host "ERROR: Long path issues still exist. Consider:" -ForegroundColor Red
            Write-Host "1. Run as Administrator: .\fix-long-paths-comprehensive.ps1 -EnableLongPaths" -ForegroundColor Yellow
            Write-Host "2. Move project: .\fix-long-paths-comprehensive.ps1 -MoveProject -NewPath 'C:\RNApp'" -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host "ERROR: Build execution failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== Script Complete ===" -ForegroundColor Green