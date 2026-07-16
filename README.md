# Čtečka Kappa — inventura zboží

Mobilní aplikace pro inventuru skladu. Naskenuješ čárový kód, appka počítá kusy,
na konci ti vygeneruje předávací protokol v PDF k vytištění a podpisu.

Běží v prohlížeči na Androidu i iPhonu a dá se přidat na plochu jako normální
aplikace. **Data zůstávají v telefonu** — žádný server, žádné přihlašování, funguje
i tam, kde nechytá signál.

## Spuštění na počítači

```bash
npm install
npm run dev
```

Otevře se na `http://localhost:5173`.

## Spuštění v telefonu

Prohlížeč pustí k fotoaparátu **jen přes zabezpečené spojení (https)**. Na počítači
to funguje díky `localhost`, ale otevřít dev server v telefonu přes IP adresu
nestačí — kamera zůstane zamčená.

Pro test na reálném telefonu je potřeba appku nasadit někam s https (statický
hosting zdarma stačí, viz níže).

## Příkazy

| Příkaz | Co dělá |
|---|---|
| `npm run dev` | Vývojový server |
| `npm run build` | Produkční build do `dist/` (spustí i kontrolu typů) |
| `npm run preview` | Naservíruje produkční build lokálně |
| `npm run test:e2e` | Playwright testy proti produkčnímu buildu |
| `npm run font:subset` | Přegeneruje ořezaný font pro PDF + `charset.json` |
| `npm run icons` | Přegeneruje ikony z `public/favicon.svg` |

## Nasazení

Appka běží na **https://kuubkaa.github.io/ctecka-kappa/**

```bash
npm run deploy    # postaví a nahraje na GitHub Pages
```

Build je statický (`dist/`) — žádná databáze, žádný backend, žádné proměnné
prostředí. Šlo by ho hostovat kdekoli; podmínkou je jen https, jinak prohlížeč
nepustí appku k fotoaparátu.

> **Pozor:** `npm run deploy` nasazuje rovnou, bez spuštění testů. Před nasazením
> spusť `npm run test:e2e`.

### Automatické nasazení (zatím nezapnuté)

V `.github/workflows/deploy.yml` čeká workflow, který po každém pushi do `main`
spustí testy a teprve při jejich úspěchu nasadí. Není nahraný, protože přihlašovací
token k GitHubu nemá oprávnění `workflow`. Zapnutí:

```bash
gh auth refresh -s workflow        # potvrdíš v prohlížeči
git add .github && git commit -m "ci: deploy via GitHub Actions" && git push
```

Potom je ještě potřeba v *Settings → Pages* přepnout zdroj z větve `gh-pages`
na *GitHub Actions*.

### Adresa aplikace

Appka běží v podsložce `/ctecka-kappa/`, což je zadrátované v `vite.config.ts`
(`BASE`) — a schválně platí i pro vývoj a testy, aby se cesty k fontům a wasm
dekodéru testovaly přesně tak, jak pojedou v produkci. Při změně adresy (vlastní
doména, jiný název repozitáře) uprav `BASE` a `baseURL` v `playwright.config.ts`.

## Jak to funguje uvnitř

- **Skenování** — `barcode-detector` (zxing-wasm). Používá se na Androidu i iPhonu
  stejně, i když Android má vlastní API: to iOS nikdy nefungovalo a to Androidí
  vyžaduje Google Play Services. Jeden engine = jedno chování. Dekodér (~1 MB wasm)
  se stahuje z vlastní adresy a ukládá pro offline běh.
- **Data** — IndexedDB přes Dexie. Tři tabulky: `products` (naučené kódy → názvy),
  `sessions` (inventury), `items` (napočítané kusy).
- **PDF** — jsPDF + autoTable s vestavěným ořezaným Robotem.

### Dvě věci, které vypadají jako detail, ale nejsou

**Font v PDF nejde vynechat.** Vestavěné fonty jsPDF neumí Unicode: `á é í ó ú ý ž š`
projdou, ale `ě č ř ů ť ď ň` se rozsypou — „Předávací" vyjde jako „PYedávací".
A když font nějaký znak nemá, jsPDF **uřízne zbytek názvu bez varování**
(naměřeno: `"Müsli tyčinka ořechová"` → `"M"`). Proto font pokrývá Latin-1 +
Latin Extended-A a `renderable()` v `src/lib/pdf.ts` propustí jen znaky, které font
umí — zbytek nahradí viditelným `?`. Hlídá to test `e2e/protocol.spec.ts`.

**Kamera na iPhonu je křehká.** iOS si nepamatuje povolení mezi starty aplikace a
umí zčernat náhled, i když se stream tváří jako živý. `src/components/Scanner.tsx`
proto otevírá kameru přímo z uživatelova ťuknutí a po návratu z pozadí náhled
znovu připojuje.
