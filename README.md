# Private Repository Utility

Raycast extension per cercare immagini/artifacts su registry privati, partendo da Harbor.

## Setup iniziale

1. Apri il comando **Search Images** in Raycast.
2. Configura le preferenze:
   - Provider: `Harbor`
   - Harbor Base URL: `https://registry.invisiblefarm.it`
   - Harbor Username
   - Harbor Password / Token
   - Default Project (opzionale)

## Funzionalità MVP

- Ricerca immagini per testo.
- Visualizzazione repository:tag, data push, dimensione.
- Sommario vulnerabilità (se presente in `scan_overview`).
- Architettura provider-based, pronta per futuri provider oltre Harbor.
