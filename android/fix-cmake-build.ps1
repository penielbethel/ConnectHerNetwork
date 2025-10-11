# PowerShell script to build React Native APK with automatic CMake path fixing
# This script runs the build and fixes CMake paths whenever they are regenerated

Write-Host "Starting React Native APK build with automatic CMake path fixing..."

# Function to fix CMake paths
function Fix-CMakePaths {
    param([string]$CmakeFile)
    
    if (-not (Test-Path $CmakeFile)) {
        Write-Host "CMake file not found: $CmakeFile"
        return $false
    }
    
    Write-Host "Fixing CMake paths in $CmakeFile..."
    
    # Read the file content line by line
    $lines = Get-Content $CmakeFile
    
    # Process each line
    $fixedLines = @()
    $fixCount = 0
    foreach ($line in $lines) {
        if ($line -match '^add_subdirectory\(([^"]+)\s+(\w+)\)$' -and $line -match '\s') {
            # Extract the path and target name
            if ($line -match '^add_subdirectory\((.+?)\s+(\w+)\)$') {
                $path = $matches[1]
                $target = $matches[2]
                # Quote the path if it contains spaces and isn't already quoted
                if ($path -match '\s' -and $path -notmatch '^".*"$') {
                    $fixedLine = "add_subdirectory(`"$path`" $target)"
                    $fixedLines += $fixedLine
                    $fixCount++
                } else {
                    $fixedLines += $line
                }
            } else {
                $fixedLines += $line
            }
        } else {
            $fixedLines += $line
        }
    }
    
    if ($fixCount -gt 0) {
        # Write the fixed content back to the file
        $fixedLines | Set-Content -Path $CmakeFile
        Write-Host "Fixed $fixCount CMake path issues"
        return $true
    } else {
        Write-Host "No CMake path issues found"
        return $false
    }
}

# Main build loop
$maxAttempts = 3
$attempt = 1
$cmakeFile = "app\build\generated\rncli\src\main\jni\Android-rncli.cmake"

while ($attempt -le $maxAttempts) {
    Write-Host "`n--- Build Attempt $attempt ---"
    
    # Run the build
    Write-Host "Running gradlew assembleDebug..."
    $buildResult = & .\gradlew assembleDebug 2>&1
    $buildExitCode = $LASTEXITCODE
    
    if ($buildExitCode -eq 0) {
        Write-Host "BUILD SUCCESSFUL!"
        break
    } else {
        Write-Host "Build failed with exit code: $buildExitCode"
        
        # Check if it's a CMake path issue
        $cmakeErrors = $buildResult | Select-String "add_subdirectory called with incorrect number of arguments"
        
        if ($cmakeErrors.Count -gt 0) {
            Write-Host "Detected CMake path issues. Attempting to fix..."
            
            if (Fix-CMakePaths -CmakeFile $cmakeFile) {
                Write-Host "CMake paths fixed. Retrying build..."
                $attempt++
            } else {
                Write-Host "Could not fix CMake paths. Exiting."
                break
            }
        } else {
            Write-Host "Build failed for reasons other than CMake paths:"
            $buildResult | Select-String "Error|Failed" | Select-Object -First 10
            break
        }
    }
}

if ($attempt -gt $maxAttempts) {
    Write-Host "Maximum build attempts reached. Build failed."
    exit 1
}