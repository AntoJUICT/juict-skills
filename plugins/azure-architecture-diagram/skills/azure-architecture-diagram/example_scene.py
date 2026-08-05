"""Voorbeeldscene: een web-app op Azure met private networking.

Kopieer dit bestand naar het doelproject, pas de scene aan, en draai het.
Het laat de drie dingen zien die je in elke scene nodig hebt:

  1. corridor()  reserveert vrije verticale banen, zodat lijnen niet kruisen
  2. cell()      plaatst een Azure-resource; een fout icoonpad faalt hard
  3. write()     valideert de layout en schrijft .drawio plus .svg

Draai:  python example_scene.py webapp
"""
import sys
from azure_drawio import Diagram, Theme

# Eigen huisstijl: vervang deze zes kleuren en de hele plaat volgt.
theme = Theme(
    primary='#0e7c86', primary_wash='#e2f2f3',     # de vaste basis
    accent='#b0700a', accent_wash='#f8efdd',       # wat per omgeving verschilt
    outside='#5b53c2', outside_wash='#ecebf8',     # buiten de subscription
)
d = Diagram(width=1560, height=980, theme=theme, name='Web-app landschap')
t = theme

# Drie vrije banen. Elke lijn die door de plaat heen moet, krijgt zijn eigen baan
# en beide uiteinden staan erop. Zet nooit een derde resource tussen de uiteinden:
# check() meldt dat als "lijn loopt door ...".
COR_INGRESS = 300    # gebruiker naar de rand
COR_DEPLOY = 520     # pipeline naar de app
COR_SECRET = 1290    # beheerportaal naar de vault
d.corridor(COR_INGRESS, 'ingress-corridor')
d.corridor(COR_DEPLOY, 'deploy-corridor')
d.corridor(COR_SECRET, 'secret-corridor')

d.text('Web-app op Azure — doelarchitectuur', 40, 30, 900, t.ink, 19, True)
d.text('Voorbeeldscene bij de azure-architecture-diagram skill. Namen zijn illustratief.',
       40, 58, 1000, t.ink2, 10)

# ----------------------------------------------------------- buiten Azure
d.group('Buiten de subscription', 40, 94, 1480, 150, t.outside, t.outside_wash, dashed=True)
gebruiker = d.box('Gebruiker', 'browser, publiek internet',
                  cx=COR_INGRESS, top=132, w=220, h=48, color=t.outside)
pipeline = d.cell('devops', 'Azure_DevOps.svg', 'CI/CD-pipeline',
                  'bouwt image, pusht naar de registry',
                  cx=COR_DEPLOY, top=126, color=t.outside)
beheer = d.box('Beheerportaal', 'schrijft secrets, leest ze nooit terug',
               cx=COR_SECRET, top=132, w=240, h=48, color=t.outside)

# ----------------------------------------------------------- subscription
d.group('Subscription — productie', 40, 276, 1480, 570, t.ink2, t.paper, dashed=True, size=13)

d.group('Randbeveiliging', 76, 312, 1408, 160, t.primary, t.primary_wash)
fd = d.cell('networking', 'Front_Doors.svg', 'Front Door + WAF',
            'TLS-terminatie, geo-filtering', COR_INGRESS, 348, t.primary)
d.cell('management_governance', 'Policy.svg', 'Azure Policy',
       'blokkeert publieke endpoints\nen niet-toegestane SKUs', 900, 348, t.primary)
d.cell('general', 'Cost_Budgets.svg', 'Maandbudget',
       'alerts op 80 en 100 procent', 1120, 348, t.primary)

d.group('Resource group   rg-webapp-prod', 76, 496, 1408, 320, t.ink2, t.paper2)

d.group('Applicatielaag', 112, 532, 1372, 260, t.accent, t.accent_wash)
app = d.cell('app_services', 'App_Services.svg', 'App Service',
             'private inbound, VNet-integratie\nsysteem-assigned identity',
             COR_DEPLOY, 568, t.accent)
db = d.cell('databases', 'SQL_Database.svg', 'SQL Database',
            'private endpoint, Entra-auth', 760, 568, t.accent)
d.cell('databases', 'Cache_Redis.svg', 'Redis-cache',
       'sessies en read-cache', cx=1000, top=568, color=t.accent)
kv = d.cell('security', 'Key_Vaults.svg', 'Key Vault',
            'app leest op runtime via identity\nalleen referenties in config',
            COR_SECRET, 568, t.accent)

# ----------------------------------------------------------- relaties
# Elke lijn loopt in een corridor. Wat geen lijn nodig heeft, staat als subtekst.
d.link(gebruiker, fd, 'https', t.outside, route='v')
d.link(pipeline, app, 'deploy', t.outside, dashed=True, route='v')
d.link(fd, app, 'origin', t.primary, route='vh')
d.link(app, db, 'private endpoint', t.accent, route='h')
d.link(beheer, kv, 'schrijft secrets', t.outside, dashed=True, route='v')

# ----------------------------------------------------------- legenda
d.group('Legenda', 40, 878, 1480, 76, t.border, t.paper)
lx = 86
for lbl, col in [('Vast in elke omgeving', t.primary),
                 ('Per omgeving anders', t.accent),
                 ('Buiten de subscription', t.outside)]:
    d.text(lbl, lx, 910, 240, col, 9, True, swatch=col)
    lx += 300
d.text('Doorlopende lijn = verplichte runtime-weg.\nStreepjes = deploy of rechten.',
       990, 904, 300, t.ink2, 9, lh=12)

d.write(sys.argv[1] if len(sys.argv) > 1 else 'webapp')
