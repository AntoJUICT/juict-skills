# Zet de HTML van word.mjs om in een Word-bestand via Word-COM, met afbeeldingen ingesloten.
# Aanroep: powershell -NoProfile -ExecutionPolicy Bypass -File naar-word.ps1 -Bron <html> -Doel <docx> [-Pdf <pdf>]
param(
  [Parameter(Mandatory = $true)][string]$Bron,
  [Parameter(Mandatory = $true)][string]$Doel,
  [string]$Pdf
)
$ErrorActionPreference = 'Stop'
$bronPad = [System.IO.Path]::GetFullPath($Bron)
$doelPad = [System.IO.Path]::GetFullPath($Doel)
if (-not (Test-Path -LiteralPath $bronPad)) { Write-Error "Bron niet gevonden: $bronPad"; exit 1 }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$code = 0
$doc = $null
try {
  $doc = $word.Documents.Open($bronPad, $false, $false, $false)
  # Afbeeldingen uit de HTML zijn gekoppeld; sla ze op in het document.
  foreach ($s in @($doc.InlineShapes)) {
    if ($s.LinkFormat) { $s.LinkFormat.SavePictureWithDocument = $true; $s.LinkFormat.BreakLink() }
  }
  $ps = $doc.PageSetup
  $ps.PaperSize = 7          # wdPaperA4
  $ps.TopMargin = 56; $ps.BottomMargin = 56; $ps.LeftMargin = 62; $ps.RightMargin = 62
  $word.ActiveWindow.View.Type = 3   # afdrukweergave
  $doc.SaveAs2($doelPad, 16)  # wdFormatXMLDocument
  Write-Output "Opgeslagen: $doelPad"
  if ($Pdf) {
    $doc.SaveAs2([System.IO.Path]::GetFullPath($Pdf), 17)  # wdFormatPDF
    Write-Output "PDF: $Pdf"
  }
  Write-Output "Pagina's: $($doc.ComputeStatistics(2))"
} catch {
  Write-Output "Word-fout: $_"
  $code = 2
} finally {
  if ($doc) { try { $doc.Close($false) } catch {} }
  try { $word.Quit() } catch {}
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
exit $code
