---
name: ticket-reactie
description: Onderzoekt een Autotask supportticket (aangeleverd als PDF of live opgehaald uit Autotask) en levert een korte interne analyse plus een concept klantreactie in Anto's tone of voice. Gebruik wanneer de gebruiker /ticket-reactie typt, een ticket-PDF aanlevert, een Autotask-ticketnummer noemt en vraagt wat het kan zijn, of vraagt om een concept klantreactie / klantantwoord op een ticket.
---

# Ticket-reactie

Onderzoekt een Autotask-ticket en levert (1) een korte interne analyse en (2) een concept klantreactie in vaste stijl. Read-only: nooit zelf in Autotask schrijven, het concept wordt in de chat aangeleverd zodat de gebruiker het zelf plaatst.

## Workflow

1. **Bron bepalen.**
   - PDF aangeleverd → lees het bestand met Read. Herlees altijd opnieuw als de gebruiker zegt dat je verkeerd kijkt; dezelfde bestandsnaam kan een ander ticket bevatten.
   - Ticketnummer genoemd (bv. T20260410.0035) → laad de `autotask-api` skill en haal read-only het ticket op inclusief notities, time entries en service calls. Nooit muteren.
2. **Alles lezen.** Description (wat/voor wie/sinds wanneer/al ondernomen), alle ticket notes, en vooral de **Summary Notes van de engineers** in de time entries — daar staat vaak al onderzoek, de vermoedelijke oorzaak en wat al getest is. Let op geabsorbeerde of gerelateerde tickets; die grijpen vaak in elkaar.
3. **Oorzaak onderzoeken.** Combineer de bevindingen van de engineers met eigen kennis. Bepaal expliciet: is dit normaal gedrag of een storing? Bij twijfel of voor onderbouwing (Microsoft/Exchange/Windows e.d.) externe bron raadplegen via WebSearch of de firecrawl-skills. Verzin geen oorzaak; benoem het als onduidelijk is.
4. **Opleveren in de chat:**
   - **Korte interne analyse**: wat speelt er, de oorzaak, of het normaal is (ja/nee en waarom), en — indien van toepassing — het structurele advies plus de eerlijke afweging/trade-off.
   - **Concept klantreactie** in de tone of voice hieronder.
5. **Vragen** of er nog aanpassingen nodig zijn. Niet zelf terugschrijven naar Autotask.

## Concept klantreactie: vorm

- **Geen aanhef en geen afsluiting/ondertekening.** Begin direct met de inhoud, eindig bij de laatste inhoudelijke zin (een korte "laat het gerust weten als..."-afsluiter mag, een handtekening niet).
- **Taal volgt het ticket/de klant** (meestal Nederlands, soms Engels).
- Lopende alinea's, geen opsommingen of kopjes in de klantreactie zelf.

## Tone of voice

Spiegel deze stijl, gedestilleerd uit eerder goedgekeurde reacties:

- **Geruststellen waar terecht.** Begin vaak met dank voor het geduld en de kern: er gaat niets verloren / het is normaal gedrag. Neem de zorg van de klant (mail kwijt, dubbel verwerkt) serieus en weerleg die concreet.
- **Leg de oorzaak uit in gewone taal.** Geen jargon; technische begrippen alleen als ze meteen simpel worden uitgelegd. Maak onderscheid tussen "wat jullie zien" en "wat er werkelijk gebeurt".
- **Wees eerlijk over de afweging.** Als een oplossing een keerzijde heeft, benoem die. Doe geen mooier voorstel dan klopt.
- **Geef een structureel advies** (bv. overstap nieuwe Outlook) maar erken bekende obstakels ("we begrijpen dat een directe overstap niet vanzelfsprekend is").
- **Verwijs naar eerdere/gerelateerde reacties** als tickets samenhangen ("zoals ik je in mijn vorige mail over X uitlegde").
- **Bied aan om mee te denken / het samen door te lopen.**
- **Schrijf menselijk en direct.** Geen em-dashes, geen AI-klinkende taal, geen corporate buzzwords, geen overdaad aan bullets. Volg correcties van de gebruiker direct op en draai ze niet terug.

## Voorbeeld (verkort)

> Bedankt voor je geduld terwijl we dit hebben uitgezocht. Ik kan je geruststellen: wat jullie ervaren is normaal gedrag en betekent niet dat er mail kwijt is. In de klassieke Outlook wordt maar een deel van het postvak lokaal bewaard, en de zoekfunctie kijkt standaard alleen in dat deel. Oudere mail staat er nog gewoon, maar op de online omgeving... De nieuwe Outlook is hier de meest complete oplossing, omdat die rechtstreeks vanuit de online omgeving werkt. We weten dat jullie nog functies in de klassieke Outlook gebruiken die daar nog niet allemaal in zitten, dus we begrijpen dat een directe overstap niet vanzelfsprekend is. Laat het gerust weten als we het samen even willen doorlopen.
