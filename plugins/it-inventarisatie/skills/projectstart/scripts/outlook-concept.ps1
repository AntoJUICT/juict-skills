<#
  Maakt een concept-mail in Outlook (desktop, COM) uit de json van `teksten.mjs mail --json`.
  Verstuurt NOOIT: er staat bewust geen .Send() in dit script. Het concept wordt alleen opgeslagen (map Concepten);
  de projectleider controleert en verstuurt zelf.

  Gebruik:
    powershell -NoProfile -ExecutionPolicy Bypass -File outlook-concept.ps1 -Json <mail.json> [-Bijlage <pdf>]
#>
param(
  [Parameter(Mandatory = $true)][string]$Json,
  [string]$Bijlage
)
$ErrorActionPreference = 'Stop'

$mail = Get-Content -Raw -Encoding UTF8 -LiteralPath $Json | ConvertFrom-Json
if ($Bijlage -and -not (Test-Path -LiteralPath $Bijlage)) { throw "Bijlage niet gevonden: $Bijlage" }

$outlook = New-Object -ComObject Outlook.Application
$item = $outlook.CreateItem(0)   # 0 = olMailItem
$item.To = [string]$mail.aan
$item.CC = [string]$mail.cc
$item.Subject = [string]$mail.onderwerp
$item.HTMLBody = [string]$mail.html
if ($Bijlage) { [void]$item.Attachments.Add((Resolve-Path -LiteralPath $Bijlage).Path) }
$item.Save()   # landt in Concepten; nooit .Send()

Write-Output ("Concept opgeslagen in map: " + $item.Parent.Name)
Write-Output ("Onderwerp: " + $item.Subject)
Write-Output ("Aan: " + $item.To)
if ($item.CC) { Write-Output ("Cc: " + $item.CC) }
Write-Output ("Bijlagen: " + $item.Attachments.Count)
foreach ($b in $item.Attachments) { Write-Output ("  - " + $b.FileName) }
