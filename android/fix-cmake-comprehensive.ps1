# Comprehensive CMake fix script for React Native build issues
# This script addresses both path quoting and target linking issues

Write-Host "Starting comprehensive CMake fix..."

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
                    Write-Host "Fixed: $line -> $fixedLine"
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

# Function to check if react-native-vector-icons target exists
function Check-VectorIconsTarget {
    $vectorIconsPath = "C:\Users\penie\Pbmultitechs\CLIENTS\WEBPAGES AND APK DEVELOPMENT\connecthermobile app\node_modules\react-native-vector-icons\android\build\generated\source\codegen\jni"
    $cmakeListsPath = Join-Path $vectorIconsPath "CMakeLists.txt"
    
    if (Test-Path $cmakeListsPath) {
        Write-Host "Vector Icons CMakeLists.txt found at: $cmakeListsPath"
        return $true
    } else {
        Write-Host "Vector Icons CMakeLists.txt not found. Checking if codegen needs to be run..."
        return $false
    }
}

# Function to run codegen for react-native-vector-icons
function Run-VectorIconsCodegen {
    Write-Host "Running codegen for react-native-vector-icons..."
    
    # Change to the project root
    Push-Location "C:\Users\penie\Pbmultitechs\CLIENTS\WEBPAGES AND APK DEVELOPMENT\connecthermobile app"
    
    try {
        # Run React Native codegen
        $result = & npx react-native codegen --platform android --outputPath android/app/build/generated/source/codegen 2>&1
        Write-Host "Codegen result: $result"
        
        # Also try running the specific vector icons codegen
        $vectorIconsResult = & npx react-native-vector-icons-codegen 2>&1
        Write-Host "Vector Icons codegen result: $vectorIconsResult"
        
    } catch {
        Write-Host "Error running codegen: $_"
    } finally {
        Pop-Location
    }
}

# Main execution
$cmakeFile = "app\build\generated\rncli\src\main\jni\Android-rncli.cmake"

# Step 1: Check if vector icons target exists
if (-not (Check-VectorIconsTarget)) {
    Write-Host "Attempting to generate vector icons codegen..."
    Run-VectorIconsCodegen
}

# Step 2: Clean build directory
Write-Host "Cleaning build directory..."
& .\gradlew clean

# Step 3: Try to build and fix paths if needed
$maxAttempts = 3
$attempt = 1

while ($attempt -le $maxAttempts) {
    Write-Host "`n--- Build Attempt $attempt ---"
    
    # Fix paths before build
    if (Test-Path $cmakeFile) {
        Fix-CMakePaths -CmakeFile $cmakeFile
    }
    
    # Run the build
    Write-Host "Running gradlew assembleDebug..."
    $buildResult = & .\gradlew assembleDebug 2>&1
    $buildExitCode = $LASTEXITCODE
    
    if ($buildExitCode -eq 0) {
        Write-Host "BUILD SUCCESSFUL!"
        break
    } else {
        Write-Host "Build failed with exit code: $buildExitCode"
        
        # Check for specific errors
        $cmakeErrors = $buildResult | Select-String "add_subdirectory called with incorrect number of arguments"
        $linkErrors = $buildResult | Select-String "Cannot specify link libraries for target"
        
        if ($cmakeErrors.Count -gt 0) {
            Write-Host "Detected CMake path issues. Fixed paths will be applied on next attempt."
        }
        
        if ($linkErrors.Count -gt 0) {
            Write-Host "Detected target linking issues. This may require manual intervention."
            Write-Host "Link errors found:"
            $linkErrors | ForEach-Object { Write-Host "  $_" }
        }
        
        $attempt++
        
        if ($attempt -le $maxAttempts) {
            Write-Host "Retrying build..."
        } else {
            Write-Host "Maximum attempts reached. Build failed."
            Write-Host "`nLast build output:"
            $buildResult | Select-Object -Last 20 | ForEach-Object { Write-Host $_ }
        }
    }
}

Write-Host "`nComprehensive CMake fix completed."