[CmdletBinding()]
param(
    [string]$InputPath,
    [string]$OutputPath,
    [ValidateRange(-10, 10)]
    [int]$Rate = 1
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($InputPath)) {
    $InputPath = Join-Path $PSScriptRoot "..\submission-assets\narration.txt"
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $PSScriptRoot "..\submission-assets\rai-narration.wav"
}

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..")).TrimEnd('\', '/')
$assetsRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "submission-assets")).TrimEnd('\', '/')
$inputFile = (Resolve-Path -LiteralPath $InputPath).Path
$outputFile = [System.IO.Path]::GetFullPath($OutputPath)
$assetsPrefix = $assetsRoot + [System.IO.Path]::DirectorySeparatorChar

if (
    -not $outputFile.StartsWith($assetsPrefix, [System.StringComparison]::OrdinalIgnoreCase) -or
    [System.IO.Path]::GetExtension($outputFile) -ne ".wav"
) {
    throw "Narration output must be a WAV inside submission-assets: $outputFile"
}

$text = Get-Content -Raw -LiteralPath $inputFile
if ([string]::IsNullOrWhiteSpace($text)) {
    throw "Narration source is empty: $inputFile"
}
if ($text.Length -gt 10000) {
    throw "Narration source exceeds the 10,000-character safety limit."
}

if (Test-Path -LiteralPath $outputFile) {
    Remove-Item -Force -LiteralPath $outputFile
}

$voice = $null
$fileStream = $null
$audioFormat = $null
try {
    # SAPI works in both Windows PowerShell 5.1 and modern PowerShell without
    # depending on the framework-specific System.Speech voice registry.
    $voice = New-Object -ComObject SAPI.SpVoice
    $fileStream = New-Object -ComObject SAPI.SpFileStream
    $audioFormat = New-Object -ComObject SAPI.SpAudioFormat
    $audioFormat.Type = 22 # SAFT22kHz16BitMono
    $fileStream.Format = $audioFormat
    $fileStream.Open($outputFile, 3, $false) # SSFMCreateForWrite
    $voice.AudioOutputStream = $fileStream
    $voice.Rate = $Rate
    $voice.Volume = 100
    [void]$voice.Speak($text, 0)
}
finally {
    if ($null -ne $fileStream) {
        $fileStream.Close()
    }
    foreach ($comObject in @($audioFormat, $fileStream, $voice)) {
        if ($null -ne $comObject) {
            [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject)
        }
    }
}

$output = Get-Item -LiteralPath $outputFile
Write-Output "Created local narration: $($output.FullName) ($($output.Length) bytes)."
Write-Output "No microphone, network upload, or public service was used."
