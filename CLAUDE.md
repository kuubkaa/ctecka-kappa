# CLAUDE.md

Živý dokument. Průběžně aktualizuj, udržuj krátký a přehledný.

## Projekt
- Název: Čtečka Kappa — inventura zboží
- Firma: <!-- TODO: název firmy + web + stručný popis činnosti -->
- Popis: Mobilní webová aplikace (PWA) pro inventuru skladu. Uživatel skenuje čárové kódy fotoaparátem telefonu, aplikace počítá kusy a na konci vygeneruje předávací protokol v PDF.
- Cíl / Vize: Nahradit ruční sčítání na papír. Musí fungovat ve skladu bez signálu a bez školení.
- Cílová skupina: Interní, jednotky uživatelů. Skladníci, ne technici.
- Brand tón: Přátelský, věcný, žádný žargon. Chybové hlášky říkají, co má uživatel udělat.
- Jazyky UI: Pouze čeština.

## Uživatel
- Skill level: začátečník
  → Neptej se na technické detaily. Rozhoduj sám, vysvětluj jednoduše.
  → Rozhodnutí s dopadem na provoz (hosting, náklady, workflow) ale probírej.

## Stack
- Framework: Vite 8 + React 19 + TypeScript 6 (statická SPA, žádný server)
- UI: Tailwind CSS v4, vlastní komponenty (`src/components/ui.tsx`), font Roboto
- Databáze: IndexedDB v zařízení (Dexie 4). **Žádná synchronizace** — přenos dat mezi zařízeními jde přes zálohu (JSON).
- Auth: **žádná**
- Skenování: `barcode-detector` (ponyfill nad zxing-wasm)
- PDF: jsPDF 4 + jspdf-autotable 5 + vestavěný ořezaný Roboto
- PWA: vite-plugin-pwa (offline, instalace na plochu)
- Hosting: GitHub Pages — https://kuubkaa.github.io/ctecka-kappa/ (repo `kuubkaa/ctecka-kappa`, veřejný)

## Pravidla

### Prostředí
- NIKDY needituj .env — používej pouze .env.local
- Komunikace v chatu: česky
- Kód (proměnné, komentáře, commity): anglicky
- **Docker se v tomhle projektu nepoužívá.** Je to statická appka bez serveru a bez databáze; Docker by byl jen vrstva navíc. Spouštěj přímo:
  - Dev server: `npm run dev`
  - Build: `npm run build` (spustí i typecheck)
  - Testy: `npm run test:e2e`
  - Nasazení: `npm run deploy` — **testy nespouští, pusť je předtím sám**
- **Fotoaparát vyžaduje HTTPS.** Na `localhost` funguje, přes IP adresu v telefonu ne. Testování na reálném telefonu = nasadit (`npm run deploy`) a otevřít živou adresu.
- **Appka běží v podsložce `/ctecka-kappa/`** (`BASE` ve `vite.config.ts`). Platí i pro dev a testy schválně — cesty k fontům a wasm jsou na base citlivé a jinak by se rozbily až v produkci. Při změně adresy uprav `BASE` i `baseURL` v `playwright.config.ts`.
- **CI zatím neběží.** `.github/workflows/deploy.yml` existuje, ale není nahraný — token nemá scope `workflow`. Zapnutí: `gh auth refresh -s workflow`, pak commitnout `.github/` a v Settings → Pages přepnout zdroj na GitHub Actions.

### Git a commity
- Zatím není git repozitář. Až vznikne: pracuj na dev branch, nikdy nepushuj přímo na main.
- Před každým commitem a pushem se zeptej uživatele na potvrzení
- Commit zprávy: anglicky, stručné, popisné (např. `feat: add torch toggle`)

### Knihovny a verze
- Vždy používej nejnovější stabilní verze. Před instalací ověř na internetu (npm, docs).
- Nepoužívej deprecated balíčky. Konkrétně: **pdf-lib je mrtvý** (poslední vydání 2021) a jeho subsetter fontů umí zatuhnout bez chyby — proto jsPDF. **html5-qrcode je opuštěný** (2023) — proto barcode-detector.

### Testy
- E2E: Playwright, konfigurace `playwright.config.ts`, testy v `e2e/`
- **Testy běží proti produkčnímu buildu**, ne dev serveru — wasm, líně načítaný PDF chunk a service worker existují až po buildu.
- **Skenování se testuje přes falešnou kameru.** `e2e/y4m.ts` vygeneruje video s reálným EAN-13, Chromium ho podstrčí jako kameru. Testuje tak celou cestu: kamera → wasm dekódování → započítání → zpětná vazba.
  - Nutné `channel: 'chromium'` — výchozí headless build Playwrightu (`chromium-headless-shell`) **nemá média vůbec** a `getUserMedia` v něm hlásí „Not supported".
  - Cesta k .y4m musí být dekódovaná (`fileURLToPath`, ne `.pathname`) — repo je ve složce s diakritikou a Chromium při chybějícím souboru tiše nezaregistruje žádnou kameru, místo aby ohlásil chybu.
- Po napsání nové funkce vždy spusť: `npm run test:e2e`
- Před commitem ověř, že testy procházejí

### Mazací akce
- Všechny mazací akce musí mít potvrzovací dialog (`ConfirmDialog`)

### Bezpečnost
- Data jsou nešifrovaná v telefonu. Kdo má odemčený telefon, má i inventuru.
- Po přihlášení data leží i u Dexie Cloud. `dexie-cloud.key` = klíč ke správě databáze, **je v .gitignore a repozitář je veřejný** — nikdy ho necommituj.
- URL databáze tajná není (stejně je v klientovi) a přístup chrání přihlášení + whitelist adres.
- Pokud najdeš riziko, zapiš do `security_warnings.md` v rootu

### Grafika a UI
- Brand: <!-- TODO: doplnit firemní barvy a font, až budou známé -->
  - Zatím: slate paleta Tailwindu, primární `#0f172a`, akcent `#38bdf8`, font Roboto
  - Styl: mobile-first, velká tlačítka (ovládání palcem, klidně v rukavici), zaoblené rohy

### Vyhledávání
- Pokud si nejsi jistý verzí, best practice nebo syntaxí, vyhledej na internetu. Nespoléhej na zastaralé znalosti.

## Struktura projektu
```
/
├── assets/fonts-src/         # Zdrojové Roboto TTF (vstup pro subsetting)
├── e2e/                      # Playwright testy
│   ├── ean13.ts              # Generátor čárových kódů pro test skeneru
│   └── harness.html          # Testovací stránka, přibalí se jen při E2E=1
├── public/fonts/             # Ořezaný Roboto pro PDF (generovaný, commitnutý)
├── scripts/
│   ├── subset-font.mjs       # Ořez fontu + generuje src/lib/charset.json
│   └── make-icons.mjs        # SVG → PNG ikony pro instalaci na plochu
└── src/
    ├── db.ts                 # Dexie schéma + všechny operace nad daty
    ├── components/           # Scanner (kamera) + ui.tsx (tlačítka, dialogy)
    ├── lib/
    │   ├── scanner.ts        # Kamera, torch, wasm dekodér
    │   ├── pdf.ts            # Předávací protokol
    │   └── charset.json      # Generovaný — needituj ručně
    └── screens/              # HomeScreen, SessionScreen, SettingsScreen
```

## Omezení agenta
- Role neexistují — aplikace je jednouživatelská. Na role se neptej.

## Nuance projektu
- **Aplikace se nesynchronizuje. Data na jiné zařízení přenáší jen záloha (JSON).** Rozhodnuto po ověření, že by data ležela na Azure **eastus (USA)** — a na protokolu jsou jména lidí. Připomínka zálohy (`BackupReminder`) je náhrada za sync, ne doplněk.
- **Připomínka smí otravovat jen když je co ztratit** (`needsBackup()` = něco přibylo od poslední zálohy) a **nikdy přes kameru ani přes jiný dialog**. Chycené testem: dialog přes hledáček člověku na štaflích je horší než žádná připomínka. Po odložení 6 h ticho — připomínku, se kterou uživatel bojuje, uživatel porazí.
- **Dexie Cloud je vyházený**, ale co jsem zjistil, ať se to nemusí objevovat znovu:
  - Přihlášení **maže lokální data** zapsaná před ním (naměřeno: ~2 s po přihlášení 0 inventur). Řádky odhlášeného patří `unauthorized`; přihlášením se změní totožnost a server je nezná. **Mazání není součástí přihlašovacího syncu** — `syncState.phase` je `in-sync`, když data ještě jsou, takže „počkej a zkontroluj" prokazatelně nefunguje. Směr: po přihlášení odsouzené řádky sám smazat a naimportovat zálohu jako přihlášený (musí přežít pád stránky).
  - Nevyřešeno, jestli to dělá addon, nebo testovací postroj (překonfigurovával `db.cloud` po otevření). Skutečná přihlašovací cesta nešla otestovat — OTP i demo grant čekají na interakci.
  - **Ptej se serveru, nehádej:** `GET {dbUrl}/auth-providers` → `{"providers":[],"otpEnabled":true}`. Nasadil jsem tlačítko „Přihlásit Googlem" na základě domněnky; uživateli vyhodilo `OAuth provider 'google' not configured`.
  - `nameSuffix: false` je povinné, jinak addon přejmenuje lokální DB a uvězní data.
  - Účet `jakubmilotinsky@gmail.com` je na DB `zuszhwp9s.dexie.cloud` nastavený na `prod` (nevyprší).
- **Počty NIKDY neupravuj stylem „přečti a zapiš".** Používej `add(delta)` z Dexie (`recordScan`, `nameAndCount`, `addWithoutBarcode`, `bumpQty`). Serializuje se jako pokyn `{"@@propmod":{"add":1}}`, ne jako hotová hodnota, a server ho vyhodnotí proti aktuálnímu stavu. Bez toho: telefon offline napočítá 50, PC zároveň nastaví 3 → výsledek 50 nebo 3, nikdy 53. Tiše a na podepisovaném protokolu.
  - `setQty` je schválně absolutní — uživatel říká „na regálu jich je 48", to musí přebít starší počet.
  - ⚠️ **Testy tohle neověří** (ověřeno mutací: read-modify-write je nechá zelené). Na jednom zařízení transakce rozdíl schová. Skutečné ověření přijde až se synchronizací.
- **Zboží bez čárového kódu** (vážené, rozbalené, vlastní výroba) má syntetický interní kód s prefixem `bez-kodu:`. Všechno je klíčované na `code`, takže prázdný být nemůže — ale **nikdy ho nezobrazuj**. Vymyšlené ID na podepisovaném protokolu vypadá jako skutečný čárový kód a pošle člověka hledat ho do regálu. Používej `isNoBarcode()` / `Line.noBarcode`.
- Volné zboží se slučuje **podle názvu** (bez ohledu na velikost písmen a mezery), ne podle kódu — dva řádky „Jablka" na jednom protokolu jsou vada.
- **jsPDF tiše maže text.** Když font nemá nějaký znak, jsPDF buď znak zahodí, nebo **uřízne celý zbytek řetězce** — bez chyby. Naměřeno: `"Müsli tyčinka ořechová"` → `"M"`. Proto font pokrývá Latin-1 + Latin Extended-A a `renderable()` v `pdf.ts` propouští jen znaky z `charset.json`. Nikdy nevolej `doc.text()` s nefiltrovaným uživatelským vstupem.
- **Bold font je povinný.** autoTable sází hlavičky tučně; bez registrovaného bold řezu jsPDF potichu spadne zpět na Helveticu a rozsype diakritiku jen v hlavičce.
- **Skenování běží přes ponyfill na obou platformách**, i na Androidu, kde nativní API existuje. iOS BarcodeDetector nikdy nefungoval, Android vyžaduje Google Play Services. Jeden engine = jedno chování.
- **iOS neuchová povolení k fotoaparátu** mezi studenými starty PWA — Apple to ví a neopravuje. `getUserMedia` proto vždy volej přímo z gesta uživatele, jinak dostaneš místo 10minutového okna jednominutové.
- **Zvuk se musí „nastartovat" z gesta.** iOS spouští každý AudioContext uspaný a probudit ho smí jen dotek uživatele. Proto `primeAudio()` visí na tlačítku Skenovat; kdyby se AudioContext vytvářel až ve skenovací smyčce, pípání by na iPhonu tiše chybělo.
- **iOS umí zčernat náhled kamery** po přepnutí z pozadí, přičemž stream se tváří jako živý. Řeší se znovupřipojením `srcObject` (viz `Scanner.tsx`).
- `.wasm` dekodér a jeho JS obal jsou svázané verzí — nikdy nekopíruj wasm do `public/`, musí projít Vite `?url` importem.

## Rozhodnutí
- **PWA místo nativní Android aplikace** — uživatel chce Android i iOS, appka nepotřebuje nic, co web neumí, a nasazení změny je otázka minut místo instalace do telefonu.
- **Data jen v telefonu, žádný server** — ve skladu není signál, víc lidí najednou nepočítá, a server by znamenal přihlašování a provozní náklady bez užitku.
- **Katalog se buduje ručně za běhu** — uživatel nemá seznam EAN → název. Neznámý kód vyvolá dotaz na název a ten se zapamatuje napříč inventurami.
- **Bez ESLintu** — typecheck v buildu zatím stačí. typescript-eslint navíc neumí TS 7, proto je TypeScript zamčený na 6.0.3.

## Údržba tohoto souboru
- Aktualizuj po každé strukturální změně, novém pravidlu nebo rozhodnutí
- Maximální stručnost — detaily patří do kódu nebo docs/, ne sem
- Smaž zastaralé info, nepřidávej duplicity
