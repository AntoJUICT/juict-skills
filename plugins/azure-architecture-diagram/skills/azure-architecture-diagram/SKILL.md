---
name: azure-architecture-diagram
description: Use when producing or updating an Azure architecture diagram, visualising a target or current cloud landscape, turning Bicep/Terraform/ARM into a picture, or when a generated diagram has unreadable layout, crossing connector lines, or Azure icons that fail to render. Also for diagrams that must live in git and be reviewable in a PR.
---

# Azure-architectuurdiagram

Genereert een Azure-architectuurplaat als `.drawio` bronbestand (bewerkbaar door mensen) plus
een standalone `.svg` (voor wiki, Word, README). Het diagram is code, dus het staat in git en
is te reviewen in een PR.

## Wanneer gebruiken

- Een doel- of huidige Azure-architectuur visualiseren
- Een plaat afleiden uit `main.bicep`, Terraform of ARM
- Een bestaande plaat bijwerken omdat de infra veranderde
- Een AI-gegenereerd diagram is onleesbaar, of iconen renderen niet

**Niet** voor: een bestaande omgeving inventariseren (gebruik daarvoor Azure Resource Inventory
of de `azure-resource-visualizer` skill uit `microsoft/azure-skills`), of voor niet-Azure
diagrammen.

## Quick start

```bash
cd <skill-map>                                  # of zet de map op PYTHONPATH
python azure_drawio.py index                    # shape-index bouwen (eenmalig, cachet)
python azure_drawio.py find "key vault"         # ALTIJD eerst: zoek de shape op
cp example_scene.py <project>/scene.py          # kopieer, pas de scene aan
python scene.py <naam>                          # schrijft <naam>.drawio + <naam>.svg
node render-png.mjs <naam>.svg <naam>.png 1680 1320   # optioneel, voor Word
```

Geen dependencies buiten de Python-standaardlibrary. De PNG-stap heeft Playwright nodig.

## De twee dingen die standaard misgaan

**Iconen renderen niet.** Azure2-shapes in draw.io zijn geen mxgraph-stencils maar SVG-images
met een pad (`image=img/lib/azure2/<categorie>/<Naam>.svg`). Verzin je zo'n pad, dan rendert er
niets en zie je dat pas in de editor. Daarom: `find` eerst, en `Diagram.shape()` faalt hard met
een suggestie als het paar niet in de index staat. Nooit een icoonpad uit je hoofd typen.

**Lijnen lopen door labels en door elkaar.** Zie Layout-discipline.

## Layout-discipline

Dit is het inzicht dat de plaat leesbaar maakt: **geef elke lijn die door de plaat heen moet zijn
eigen vrije verticale baan, en zet niets tussen de twee uiteinden.**

```python
COR_DEPLOY = 620
d.corridor(COR_DEPLOY, 'deploy-corridor')
pipeline = d.cell(..., cx=COR_DEPLOY, top=126)   # begin staat op de baan
app      = d.cell(..., cx=COR_DEPLOY, top=984)   # eind staat op de baan
d.link(pipeline, app, 'rolt uit', route='v')     # recht omlaag, niets ertussen
```

Alles wat géén eigen lijn nodig heeft, zet je als subtekst bij de resource. Vier lijnen op een
plaat is beter dan twaalf. `check()` handhaaft dit en `write()` weigert te schrijven bij:

| Melding | Betekenis |
|---------|-----------|
| `lijn "X -> Y" loopt door "Z"` | Er staat een resource tussen de uiteinden. Verplaats Z, of geef de lijn een andere baan. |
| `<naam> geblokkeerd door "Z"` | Z staat op een gereserveerde baan. |
| `cellen overlappen: "A" en "B"` | Kolommen te dicht op elkaar; houd 200px hart-op-hart. |
| `"A" loopt N px buiten groep "G"` | Groep te laag voor icoon plus twee tekstregels; maak hem ~164px hoog. |

Routes: `v` (verticaal), `h` (horizontaal), `vhv` (omlaag, over, omlaag), `hv`, `vh`.
Gebruik `mid=` voor een vaste tussencoördinaat, `sdx`/`edx` om parallelle lijnen te ontstapelen.

## Bekende beperkingen

- **Container Apps heeft geen eigen Azure2-icoon.** De set biedt `Container_App_Environments` en
  `Worker_Container_App`. Gebruik de laatste voor de app zelf.
- **Resource locks hebben geen icoon.** Zet ze als tekst in de groepskop.
- **draw.io routeert iets anders dan de SVG.** Waypoints en exit/entry gaan mee, maar draw.io
  rekent het label bij de node terwijl de SVG het eronder zet. De SVG is de nette versie, de
  `.drawio` is om in te bewerken.
- De `.drawio` verwijst naar `img/lib/azure2/...`, paden die draw.io zelf meelevert. Buiten
  draw.io renderen die niet: distribueer de SVG.

## Werkwijze

1. Lees de bron (Bicep/Terraform) en maak de lijst resources die op de plaat moeten.
2. `find` elke shape op. Noteer categorie en bestandsnaam.
3. Bepaal welke relaties een lijn verdienen. Meestal 3 tot 6. De rest wordt subtekst.
4. Kies een baan per lijn, en leg de kolommen zo dat de banen vrij blijven.
5. Draai, lees de meldingen van `check()`, en corrigeer tot het schoon is.
6. Bekijk de PNG voordat je zegt dat het klaar is. De checks vangen geometrie, geen betekenis.

## Bestanden

- `azure_drawio.py` — de engine: shape-index, `Diagram`, checks, twee renderers
- `example_scene.py` — werkende scene om te kopiëren
- `render-png.mjs` — SVG naar PNG via Playwright
- `.cache/` — shape-index en gedownloade iconen (niet committen)

Iconen komen uit [jgraph/drawio](https://github.com/jgraph/drawio) (Apache 2.0), dat de
officiële Microsoft Azure-iconenset bundelt. Microsoft staat gebruik toe in
architectuurdocumentatie, niet los of in andere producten.
