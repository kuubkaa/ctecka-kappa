# Bezpečnostní poznámky

Seznam známých rizik. Nic z toho není chyba k opravě — jsou to vědomé kompromisy,
které má smysl si připomenout, až se projekt bude měnit.

## Data jsou v telefonu nešifrovaná

Kdo má odemčený telefon, má i inventuru. Žádné heslo, žádné šifrování — appka nemá
přihlašování a data leží v IndexedDB. Přijatelné: jde o počty zboží ve skladu, ne
o osobní údaje. Na protokolu ale **jsou jména lidí** (předal/převzal), takže hotový
PDF protokol si zaslouží stejnou opatrnost jako papír.

## Google tabulka s katalogem je čitelná pro kohokoli s odkazem

Zavedeno funkcí „Zboží z tabulky" (`src/lib/catalog.ts`).

Aby si tabulku mohl stáhnout telefon bez přihlašování, musí být nastavená na
**Kdokoli s odkazem → Čtenář**. Odkaz je sice neuhodnutelný (id tabulky má 44
znaků), ale kdo ho získá — z historie prohlížeče, z chatu, z e-mailu — přečte si
celou tabulku bez ptaní.

**Co z toho plyne:** do téhle tabulky patří jen čárové kódy a názvy zboží. Ne
nákupní ceny, ne marže, ne dodavatelé, ne jména lidí. Když bude potřeba mít v jedné
tabulce i tohle, udělej pro appku **samostatnou tabulku** jen s kódem a názvem.

Přenos je jednosměrný: appka z tabulky jen čte. Z telefonu do Googlu neodejde nic —
žádné inventury, žádná jména z protokolu. To je schválně a je to důvod, proč je
tabulka slučitelná s rozhodnutím nesynchronizovat (viz CLAUDE.md).
