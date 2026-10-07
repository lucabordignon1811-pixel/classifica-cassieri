# Classifica Operatori Bar – Web

Conversione web del file Excel `Tool_Classifiche_Operatori_Bar_v16` e del modulo VBA v15.

## Cosa contiene

- import diretto di `Cashier Session Reconciliation` (.xls/.xlsx/.xlsm)
- riconoscimento operatore / workstation
- esclusioni WEB, CELL, Carretto configurabili
- conteggio scontrini, venduto, tematici, Combo Doppio e Acque 75cl
- inserimento ore lavorate
- mappa workstation -> Bar Principale / Secondario
- classifica storica con la stessa logica v15
- grafici ATV e Tematici/100 per operatore
- storico iniziale convertito dal file Excel esistente (519 righe)
- configurazione modificabile in `config.json`
- salvataggio locale nel browser + export/import di `storico.json`

## Pubblicazione su GitHub Pages

1. Crea un repository GitHub, ad esempio `classifica-cassieri`.
2. Carica nella root i file di questa cartella.
3. Apri **Settings > Pages**.
4. In **Build and deployment**, scegli **Deploy from a branch**.
5. Seleziona `main` e `/ (root)`, quindi salva.
6. GitHub mostrerà l'indirizzo pubblico della pagina.

## Nota importante sul salvataggio

GitHub Pages è statico: una pagina pubblica non può modificare direttamente `storico.json` nel repository senza autenticazione GitHub.

Questa versione usa quindi `localStorage` per lavorare in modo semplice e sicuro. Il pulsante **Esporta storico.json** consente di scaricare lo storico aggiornato; il file può poi essere caricato nel repository per renderlo la nuova base condivisa.

## Librerie esterne

La pagina usa:

- SheetJS `xlsx` per leggere i file Excel nel browser
- Chart.js per i grafici

Sono caricate via CDN, quindi il PC deve avere accesso a Internet quando apre la pagina.
