# Rondt een gevuld Mini PVA af via Word-COM: paginanummers in de inhoudsopgave bijwerken,
# opslaan als .docx en optioneel een PDF maken voor de controle van de opmaak.
# Aanroep (paden als losse argumenten, niet in een string plakken):
#   powershell -NoProfile -ExecutionPolicy Bypass -File afronden.ps1 -Bron <docx> -Doel <docx> [-Pdf <pdf>]
# Word houdt een bestand soms vast na een fout: schrijf dan naar een nieuwe naam.
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
  # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
  $doc = $word.Documents.Open($bronPad, $false, $false, $false)
  foreach ($toc in $doc.TablesOfContents) { $toc.UpdatePageNumbers() | Out-Null }
  $doc.SaveAs2($doelPad, 16)  # wdFormatXMLDocument
  Write-Output "Opgeslagen: $doelPad"
  if ($Pdf) {
    $pdfPad = [System.IO.Path]::GetFullPath($Pdf)
    $doc.SaveAs2($pdfPad, 17)  # wdFormatPDF
    Write-Output "PDF: $pdfPad"
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
