# Maakt eenmalig de kleurband voor het voorblad van het PVA: het verloop van het verkoopdeck
# (linear-gradient(135deg, #002345 0%, #FF3862 100%)) als PNG. Word zet geen CSS-verloop om,
# daarom een afbeelding. Het resultaat staat in assets/pva-voorblad.png; alleen opnieuw draaien
# als de huisstijl verandert.
# Aanroep: powershell -NoProfile -ExecutionPolicy Bypass -File maak-voorblad.ps1 [-Doel <png>]
param(
  [string]$Doel = (Join-Path $PSScriptRoot '..\..\assets\pva-voorblad.png'),
  [int]$Breedte = 1240,
  [int]$Hoogte = 700
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$doelPad = [System.IO.Path]::GetFullPath($Doel)
$bmp = New-Object System.Drawing.Bitmap $Breedte, $Hoogte
$g = [System.Drawing.Graphics]::FromImage($bmp)
try {
  $vlak = New-Object System.Drawing.Rectangle 0, 0, $Breedte, $Hoogte
  $navy = [System.Drawing.ColorTranslator]::FromHtml('#002345')
  $roze = [System.Drawing.ColorTranslator]::FromHtml('#FF3862')
  # 135deg in CSS loopt van linksboven naar rechtsonder; in GDI+ is dat 45 graden met de klok mee.
  $kwast = New-Object System.Drawing.Drawing2D.LinearGradientBrush $vlak, $navy, $roze, 45, $true
  $g.FillRectangle($kwast, $vlak)
  $kwast.Dispose()
  $bmp.Save($doelPad, [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "Voorblad: $doelPad ($Breedte x $Hoogte)"
} finally {
  $g.Dispose()
  $bmp.Dispose()
}
