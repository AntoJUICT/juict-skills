# Maakt van de HTML van pva.mjs een Word-bestand via Word-COM: afbeeldingen ingesloten, A4, de kleurband
# van het voorblad achter de tekst tot de rand van de pagina, inhoudsopgave op de plek van [[INHOUDSOPGAVE]],
# paginanummers in de voettekst (niet op het voorblad), opslaan als .docx en optioneel een PDF.
# Aanroep (paden als losse argumenten, niet in een string plakken):
#   powershell -NoProfile -ExecutionPolicy Bypass -File naar-pva.ps1 -Bron <html> -Doel <docx> [-Pdf <pdf>]
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

$NAVY = 0x452300   # #002345 als BGR, zoals Word kleuren opslaat
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$code = 0
$doc = $null
try {
  $doc = $word.Documents.Open($bronPad, $false, $false, $false)

  $ps = $doc.PageSetup
  $ps.PaperSize = 7          # wdPaperA4
  $ps.TopMargin = 56; $ps.BottomMargin = 56; $ps.LeftMargin = 62; $ps.RightMargin = 62
  $ps.DifferentFirstPageHeaderFooter = -1
  $word.ActiveWindow.View.Type = 3   # afdrukweergave

  # Inhoudsopgave, voettekst en paginanummer in Arial, zoals de rest (Word gebruikt anders Times New Roman).
  # Ingebouwde stijlen via hun nummer, zodat het in elke taal van Word werkt.
  foreach ($nr in @(-1, -20, -21, -32, -33, -42)) {   # Normal, TOC 1, TOC 2, Header, Footer, Page Number
    try { $st = $doc.Styles.Item($nr); $st.Font.Name = 'Arial'; if ($nr -ne -1) { $st.Font.Size = 10 } } catch {}
  }
  try { $doc.Styles.Item(-42).Font.Color = 0x77655D } catch {}   # paginanummer grijs (#5d6577)

  # Afbeeldingen uit de HTML zijn gekoppeld; sla ze op in het document.
  foreach ($s in @($doc.InlineShapes)) {
    if ($s.LinkFormat) { $s.LinkFormat.SavePictureWithDocument = $true; $s.LinkFormat.BreakLink() }
  }

  # Voorblad: de kleurband achter de tekst, van rand tot rand bovenaan de pagina.
  $band = @($doc.InlineShapes) | Where-Object { $_.AlternativeText -eq 'voorblad' } | Select-Object -First 1
  if ($band) {
    try {
      $breedte = $ps.PageWidth
      $hoogte = [Math]::Round($breedte * 700 / 1240, 1)
      $vorm = $band.ConvertToShape()
      $vorm.LockAspectRatio = 0
      $vorm.WrapFormat.Type = 5                # wdWrapBehind
      $vorm.RelativeHorizontalPosition = 1     # wdRelativeHorizontalPositionPage
      $vorm.RelativeVerticalPosition = 1       # wdRelativeVerticalPositionPage
      $vorm.Width = $breedte; $vorm.Height = $hoogte
      $vorm.Left = 0; $vorm.Top = 0
    } catch {
      # Zonder zwevende band is witte tekst onleesbaar: maak het voorblad dan navy.
      Write-Output "Waarschuwing: kleurband niet achter de tekst gezet ($_); voorbladtekst wordt navy."
      $m = $doc.Content; $m.Find.ClearFormatting()
      if ($m.Find.Execute('[[INHOUDSOPGAVE]]')) { $doc.Range(0, $m.Start).Font.Color = $NAVY }
    }
  } else {
    Write-Output "Waarschuwing: geen kleurband voor het voorblad gevonden."
  }

  # Inhoudsopgave op de plek van de markering: koppen 1 en 2.
  $r = $doc.Content
  $r.Find.ClearFormatting()
  if ($r.Find.Execute('[[INHOUDSOPGAVE]]')) {
    $r.Text = ''
    $toc = $doc.TablesOfContents.Add($r, $true, 1, 2)
    $toc.Update() | Out-Null
  } else {
    Write-Output "Waarschuwing: markering [[INHOUDSOPGAVE]] niet gevonden; geen inhoudsopgave."
  }

  # Paginanummers rechts in de voettekst, niet op het voorblad.
  try {
    $voet = $doc.Sections.Item(1).Footers.Item(1)   # wdHeaderFooterPrimary
    $voet.PageNumbers.Add(2, $false) | Out-Null     # wdAlignPageNumberRight, niet op de eerste pagina
  } catch {
    Write-Output "Waarschuwing: paginanummers niet toegevoegd ($_)."
  }

  foreach ($t in $doc.TablesOfContents) { $t.UpdatePageNumbers() | Out-Null }
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
