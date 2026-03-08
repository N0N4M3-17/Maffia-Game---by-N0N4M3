# Maffia-Game---by-N0N4M3

Maffia Game ported to hybrid mode (Browser/Phone capacity).

## Run the LAN host

```bash
npm start
```

Server binds to `0.0.0.0:3000` by default and prints LAN URLs in terminal.

## Current implementation status

- GM-hosted LAN lobby in browser.
- Players join with **name only**.
- GM configures role counts.
- GM starts game into **Night 0**.
- Roles are pushed to each player privately in their client on Night 0.
- GM sees all connected players and assigned roles once game starts.

## Current Spec Drafts

- [Spec v1 (Sections 1–2): Phase State Machine + Role Permission Matrix](docs/SPEC_V1.md)
