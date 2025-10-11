# Manual CMake path fix script
Write-Host "Manually fixing CMake paths..."

$cmakeFile = "app\build\generated\rncli\src\main\jni\Android-rncli.cmake"

if (Test-Path $cmakeFile) {
    Write-Host "Found CMake file: $cmakeFile"
    
    # Read the file content
    $content = Get-Content $cmakeFile -Raw
    Write-Host "Original content length: $($content.Length)"
    
    # Fix the paths by quoting them
    $fixedContent = $content -replace 'add_subdirectory\(([^"]+)\s+(\w+)\)', 'add_subdirectory("$1" $2)'
    
    Write-Host "Fixed content length: $($fixedContent.Length)"
    
    if ($content -ne $fixedContent) {
        # Write the fixed content back
        Set-Content -Path $cmakeFile -Value $fixedContent -NoNewline
        Write-Host "CMake paths have been fixed!"
        
        # Show the first few lines to verify
        Write-Host "`nFirst 10 lines of fixed file:"
        Get-Content $cmakeFile | Select-Object -First 10 | ForEach-Object { Write-Host "  $_" }
    } else {
        Write-Host "No changes needed - paths are already correct"
    }
} else {
    Write-Host "CMake file not found: $cmakeFile"
}

Write-Host "Manual fix completed."