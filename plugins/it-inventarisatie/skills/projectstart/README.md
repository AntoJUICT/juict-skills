# Projectstart: wat het is en wat het oplevert

## Wat is het

Een skill voor Claude Code die de start van een project na akkoord op de offerte klaarzet. Je geeft één
Autotask-projectnummer. De skill leest alles wat op dat project staat (offerte, mails, gespreksverslagen, notities) en
maakt daaruit in één keer de stukken voor de kick-off. Alle stukken komen uit hetzelfde dossier, dus ze spreken
elkaar niet tegen.

De kick-off is de eerste meeting met de klant na akkoord en meteen ook de technische kick-off: er is er maar één.
De presentatie sluit in stijl en route aan op de verkooppresentatie, zodat de klant hetzelfde verhaal herkent.

## Wanneer gebruik je het

1. De offerte is getekend.
2. De projectleider maakt het project aan in Autotask vanuit het sjabloon en zet de projectmanagement-,
   administratie- en salestaken klaar. De technische taken laat hij leeg: die maakt de skill.
3. Alle communicatie met de klant tot nu toe staat als bijlage of notitie op dat project (offerte, mails,
   verslagen van gesprekken).
4. Je start Claude Code en typt `/projectstart` met het projectnummer.

## Wat je na elke kick-off-voorbereiding hebt

Alles staat op het Autotask-project, zichtbaar voor het interne projectteam.

| Wat | Vorm | Voor wie | Waarvoor |
|---|---|---|---|
| Kick-off-presentatie | Link naar een webpagina (Claude) | Klant | De kick-off zelf: doel, scope, fases, team, besluiten, wat de klant aanlevert, afspraken over overleg en support. Maximaal 10 slides, hoofdlijnen, geen bedragen. |
| IT-inventarisatierapport | Link naar de online versie, plus een Word-bestand en een PDF (de PDF gaat met de opvolgmail mee) | Klant, na de kick-off | Wat we zagen, wat we adviseren, stappenplan, uren, open vragen en een bijlage om aan te kruisen. Een levend document: het groeit mee met de antwoorden van de klant. |
| Mini PVA | Word-bestand, met versienummer | Intern | Het plan van aanpak in de stijl en volgorde van de kick-off: planning, besluiten, team, afspraken, financiële afspraken met bron, open punten en goedkeuring. |
| Technische taken | Taken in Autotask, in de fases van het project | Engineers en planner | Per stap uit de offerte en de mails een taak, met de uren uit de offerte en de bron in de omschrijving. Jij voegt de projectmanagement-, administratie- en salestaken zelf toe; de planner wijst de taken toe via het planbord. Een taak die er al staat, wordt nooit overschreven. |
| Interne briefing | Notitie op het project | Projectteam en techniek | Afspraken, technische vragen, externe partijen en de links naar presentatie en rapport. |
| Opvolgmail na de kick-off | Concept in Outlook met het rapport als PDF-bijlage (zonder Outlook: tekst in de chat) | Klant | Kort bedankje, het verzoek het rapport zorgvuldig door te nemen en de belangrijkste punten kort genoemd. Geen link naar het rapport. De skill verstuurt nooit zelf. |
| Dossier | `projectstart-dossier-v<N>.json` als bijlage | De skill zelf | De stand van alle feiten. Hiermee vult een volgende run aan zonder iets dubbel te doen. |

## Aanvullen tijdens het project

Komt er nieuwe informatie (een antwoord van de klant, een afspraak, een verslag), zet die dan als notitie of bijlage
op het project en draai `/projectstart` opnieuw met hetzelfde nummer. Dat kan iedere engineer.

- Alleen de nieuwe bronnen worden gelezen.
- Rapport en Mini PVA krijgen een nieuwe versie als er inhoudelijk iets veranderd is.
- De presentatie wordt nooit opnieuw gemaakt; die past de projectleider met de hand aan.
- Staat er niets nieuws op het project, dan verandert er niets.

## Waar je op kunt rekenen

- Niets verzonnen: wat niet in de bronnen staat, blijft zichtbaar open ("nog te bepalen").
- Geen bedragen in stukken voor de klant; wel in het Mini PVA en de briefing.
- Geen wachtwoorden of andere geheimen in de stukken. Inloggegevens komen uit Key Vault en worden nergens opgeslagen.
- Elke schrijfactie naar Autotask zie je eerst als voorvertoning en gebeurt pas na jouw akkoord.
- Er gaat niets naar de klant zonder jou: geen mail, geen wijziging in de omgeving van de klant.

## Wat je zelf nog doet

- Presentatie en online rapport delen met de JUICT-organisatie (Share, met bewerkrechten). De skill kan dat niet.
- De opvolgmail controleren en versturen.
- Open punten tijdens de kick-off invullen en daarna als notitie op het project zetten.

Technische werking en commando's: [SKILL.md](SKILL.md) en [REFERENCE.md](REFERENCE.md).
