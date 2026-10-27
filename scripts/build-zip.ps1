<#
.SYNOPSIS
  Crea dist\chrome-mixer-<versione>.zip, pronto da estrarre e caricare in chrome://extensions.
.DESCRIPTION
  Lo zip contiene una sola cartella, chrome-mixer, con manifest, src e icons.
  Se lo zip della stessa versione esiste gia' lo sposta in dist\_da_eliminare invece di cancellarlo.
.EXAMPLE
  .\scripts\build-zip.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $root 'manifest.json') -Raw | ConvertFrom-Json).version
$dist = Join-Path $root 'dist'
$zip = Join-Path $dist "chrome-mixer-$version.zip"
$stage = Join-Path $dist 'stage\chrome-mixer'

if ($PSCmdlet.ShouldProcess($zip, 'Crea il pacchetto')) {
    New-Item -ItemType Directory -Force $dist | Out-Null
    if (Test-Path $zip) {
        $old = Join-Path $dist '_da_eliminare'
        New-Item -ItemType Directory -Force $old | Out-Null
        Move-Item $zip (Join-Path $old ("chrome-mixer-$version-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.zip'))
    }
    if (Test-Path (Join-Path $dist 'stage')) {
        $old = Join-Path $dist '_da_eliminare'
        New-Item -ItemType Directory -Force $old | Out-Null
        Move-Item (Join-Path $dist 'stage') (Join-Path $old ('stage-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
    }
    New-Item -ItemType Directory -Force $stage | Out-Null
    Copy-Item (Join-Path $root 'manifest.json'), (Join-Path $root 'LICENSE') $stage
    Copy-Item (Join-Path $root 'src'), (Join-Path $root 'icons') $stage -Recurse
    # Compress-Archive di PowerShell 5.1 scrive i percorsi con '\', che su Mac e Linux
    # diventano nomi di file: si scrive lo zip a mano con i separatori '/'.
    Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
    $base = Split-Path $stage -Parent
    $archive = [IO.Compression.ZipFile]::Open($zip, 'Create')
    try {
        Get-ChildItem $stage -Recurse -File | ForEach-Object {
            $name = $_.FullName.Substring($base.Length + 1).Replace('\', '/')
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $name, 'Optimal')
        }
    }
    finally { $archive.Dispose() }
    Write-Host "Creato $zip"
}
