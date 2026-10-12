# Klokkelogg

En liten lokal webapp for å følge presisjonen til mekaniske klokker. Flask serverer siden og et lite JSON-API; alle data lagres i `watches.db` med SQLite.

## Kom i gang

Krever Python 3.9 eller nyere.

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Åpne deretter http://127.0.0.1:5000 i nettleseren. Databasen opprettes automatisk første gang appen starter. Stopp serveren med Ctrl+C.

## Slik brukes den

1. Legg til en klokke og velg den i listen.
2. Still klokka etter en pålitelig tidskilde, og start en måleserie. Serien får automatisk datointervallet sitt som navn i grensesnittet.
3. Når du sjekker igjen, skriv inn avviket fra referansetiden i sekunder. Minus betyr at klokka går sakte; pluss betyr at den går fort.

Appen beregner endringen i avvik mellom målingene som sekunder per dag. Det er en enkel måling: resultatet påvirkes av hvor nøyaktig referansetiden og avlesningen er.

Appen er ment for lokal bruk. Flask sin innebygde utviklingsserver er ikke satt opp for å eksponere appen på internett.
