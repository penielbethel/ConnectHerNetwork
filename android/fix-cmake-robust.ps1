# Robust CMake path fix script
Write-Host "Robustly fixing CMake paths..."

$cmakeFile = "app\build\generated\rncli\src\main\jni\Android-rncli.cmake"

if (Test-Path $cmakeFile) {
    Write-Host "Found CMake file: $cmakeFile"
    
    # Read the file line by line
    $lines = Get-Content $cmakeFile
    $fixedLines = @()
    $fixCount = 0
    
    foreach ($line in $lines) {
        if ($line -match '^add_subdirectory\((.+)\)$') {
            # Extract the content inside the parentheses
            $content = $matches[1]
            
            # Check if it contains spaces and isn't already properly quoted
            if ($content -match '\s' -and $content -notmatch '^".*"\s+\w+$') {
                # Split by the last space to separate path and target
                $parts = $content -split '\s+'
                if ($parts.Count -ge 2) {
                    $target = $parts[-1]  # Last part is the target
                    $path = ($parts[0..($parts.Count-2)] -join ' ')  # Everything else is the path
                    
                    # Quote the path if it's not already quoted
                    if (-not $path.StartsWith('"')) {
                        $fixedLine = "add_subdirectory(`"$path`" $target)"
                        $fixedLines += $fixedLine
                        Write-Host "Fixed: $line"
                        Write-Host "   -> $fixedLine"
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
        } else {
            $fixedLines += $line
        }
    }
    
    if ($fixCount -gt 0) {
        # Write the fixed content back
        $fixedLines | Set-Content -Path $cmakeFile
        Write-Host "`nFixed $fixCount CMake path issues!"
        
        # Show the first few lines to verify
        Write-Host "`nFirst 15 lines of fixed file:"
        Get-Content $cmakeFile | Select-Object -First 15 | ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "No changes needed - paths are already correct"
    }
} else {
    Write-Host "CMake file not found: $cmakeFile"
}

Write-Host "`nRobust fix completed."