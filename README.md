# Raycast Artifact Repository Utility

Raycast extension per lavorare con registry privati, con supporto multi-provider.

## Workflow

- **Manage Providers**: aggiungi uno o piu provider (Private Harbor, Docker Hub Beta).
- **Search Images**: cerca su tutti i provider per default; puoi filtrare per provider dal dropdown.
- **Search Projects**: flusso per provider o aggregato, con view members dove disponibile.
- **Favorite Projects**: accesso rapido ai preferiti.

## Note funzionali

- Se nessun provider e configurato, i comandi mostrano onboarding rapido (⌘N).
- In Search Images, la severita non mostra check verde quando lo scan non e ancora stato eseguito.
- Azioni disponibili su immagini: copy, open artifact/project, trigger scan, delete tag/artifact.
- Docker Hub e in beta (alcuni endpoint come scan/delete possono non essere disponibili via API).
