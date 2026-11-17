# Leest een Outlook .msg via Outlook-COM en schrijft onderwerp, afzender, ontvangers, datum en tekst als UTF-8 naar stdout.
param([Parameter(Mandatory = $true)][string]$Pad)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$outlook = New-Object -ComObject Outlook.Application
$item = $outlook.Session.OpenSharedItem((Resolve-Path -LiteralPath $Pad).Path)
try {
  "Onderwerp: $($item.Subject)"
  "Van: $($item.SenderName) <$($item.SenderEmailAddress)>"
  "Aan: $($item.To)"
  "Datum: $($item.SentOn)"
  ""
  $item.Body
} finally {
  $item.Close(1)
}
