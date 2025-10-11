# PowerShell script to fix CMake path issues in Android-rncli.cmake
# This script quotes all paths containing spaces in add_subdirectory commands

param(
    [string]$CmakeFile = "app\build\generated\rncli\src\main\jni\Android-rncli.cmake"
)

Write-Host "Fixing CMake paths in $CmakeFile..."

# Check if the file exists
if (-not (Test-Path $CmakeFile)) {
    Write-Host "CMake file not found: $CmakeFile"
    exit 1
}

# Read the file content line by line
$lines = Get-Content $CmakeFile

# Process each line
$fixedLines = @()
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

# Write the fixed content back to the file
$fixedLines | Set-Content -Path $CmakeFile

Write-Host "CMake paths fixed successfully!"

# Verify the fix by showing the first few lines
Write-Host "`nFirst 10 lines of fixed file:"
Get-Content $CmakeFile | Select-Object -First 10