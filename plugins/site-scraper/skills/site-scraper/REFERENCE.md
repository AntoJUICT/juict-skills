# Site Scraper — Commando-recepten

Beproefde `firecrawl interact` commando's (CLI v1.14.8). De scrape-ID wordt automatisch onthouden na `firecrawl scrape`, dus `--scrape-id` is meestal niet nodig.

## 1. Inlogpagina scrapen (met profiel)

```bash
firecrawl scrape "https://example.com/" --profile <naam>
```

Read-only reconnect zonder het profiel te wijzigen: voeg `--no-save-changes` toe.

## 2. Inloggen

Veilige variant: geef de gebruiker de **Interactive Live View** URL (verschijnt in de output van elke `interact`-call) zodat hij zelf inlogt.

Geautomatiseerd (credentials passeren de cloud):

```bash
# eerst eventueel de juiste login-optie kiezen
firecrawl interact --prompt "Click the 'Use email and password' option"
# daarna invullen en versturen
firecrawl interact --prompt "Fill in the email field with 'X' and the password field with 'Y', then click the login button" --timeout 90
```

Controleer waar je belandt:

```bash
firecrawl interact --node -c "await page.url()"
firecrawl interact --node -c "await page.title()"
```

## 3. Framework + scripts + interne links

```bash
firecrawl interact --node -c "JSON.stringify(await page.evaluate(() => ({ scripts: Array.from(document.querySelectorAll('script[src]')).map(s=>s.src), ngVersion: (document.querySelector('[ng-version]')||{getAttribute:()=>null}).getAttribute('ng-version'), hasReactRoot: !!document.querySelector('#root,[data-reactroot]'), hasVue: !!document.querySelector('[data-v-app]'), generator: (document.querySelector('meta[name=generator]')||{}).content||null, links: [...new Set(Array.from(document.querySelectorAll('a[href]')).map(a=>a.getAttribute('href')).filter(h=>h&&h.startsWith('/')))] })), null, 2)" --timeout 60
```

## 4. Sitemap — route-tabel uit de JS-bundles trekken (kerntruc)

Doorzoek alle eigen-origin scripts op `path:"..."` route-definities. Werkt voor Vue-router / vergelijkbare SPA's. De router-chunk heeft soms een misleidende naam.

```bash
firecrawl interact --node -c "JSON.stringify(await page.evaluate(async () => { const srcs = Array.from(document.querySelectorAll('script[src]')).map(s=>s.src).filter(u=>u.includes(location.hostname)); const out={}; for (const u of srcs){ try{ const t=await (await fetch(u)).text(); const p=[...t.matchAll(/path\s*:\s*[\x22']([^\x22']+)[\x22']/g)].map(m=>m[1]); if(p.length) out[u.split('/').pop()]=[...new Set(p)]; }catch(e){} } return out; }))" --timeout 120
```

Alternatieve patronen om op te proberen als `path:` niets geeft: `route(`, `component:`, of `RouterLink`/`<a href>` na navigatie. Bij een server-rendered site (geen SPA) gebruik je in plaats hiervan `firecrawl map`.

## 5. API-endpoints onderscheppen

Belangrijk: `domcontentloaded` + vaste wachttijd, NIET `networkidle` (websockets blokkeren dat).

```bash
firecrawl interact --node -c "JSON.stringify(await (async () => { const calls=new Set(); const handler=req=>{ const t=req.resourceType(); if(t==='xhr'||t==='fetch'){ try{ const u=new URL(req.url()); calls.add(u.origin+u.pathname); }catch(e){} } }; page.on('request', handler); for(const r of ['/people','/calendar','/settings']){ try{ await page.goto(location.origin+r,{waitUntil:'domcontentloaded',timeout:15000}); await page.waitForTimeout(3500);}catch(e){} } page.off('request', handler); return { count: calls.size, calls: [...calls].sort() }; })())" --timeout 90
```

Pas de routelijst aan op de doelsite (gebruik de routes uit stap 4). Houd het aantal routes per call beperkt om de timeout (max 300s) te vermijden, of draai in de achtergrond.

Wil je ook methode + querystring of response-status: log `req.method()` en hang een `page.on('response')`-listener op met `res.status()`.

## 6. Sessie sluiten

```bash
firecrawl interact stop
```

## Sandbox-notities

- `-c` verwacht een expressie. Geen top-level `return`; wikkel in `page.evaluate(() => (...))` of een IIFE die een waarde teruggeeft.
- Taalflags: `--node` (default, Playwright), `--python`, `--bash`. Er is GEEN `--language`.
- `page` is een Playwright Page-object dat tussen calls in dezelfde sessie blijft bestaan.
- Output naar bestand kan met `-o <pad>`; JSON met `--json`.
