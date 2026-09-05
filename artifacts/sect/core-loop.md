# Core loop — Iter 1 hollow

Verbs, in order. Talk is optional colour.

1. **Enter the pocket** (see play path below).
2. **Walk** (`WASD`, Shift to hurry). Rim and houses are solid.
3. **Talk** to the headman (`E`) — he names the jam and the gate-lever. Skip if you already see the silent wheel.
4. **Clear the mill jam** (`E` at the snag in the race). Shoulder the wet timber; throw the lever. No qi.
5. **Succeed** — the wheel turns, the race runs, the hollow has grain again. `Back to the valley` returns to the colony.

## Play path

```bash
npm install   # once
npm run dev   # Vite on 5063
```

Then open:

```
http://localhost:5063/?pocket=hollow
```

From a running colony (dev or `npm run play` on 5062 after `npm run build`):

- Top bar **Hollow**
- Console: `window.aetherhold.enterHollow()`

`V` — inhabit ↔ manager inside the pocket. `Esc` (mouse free) or **Back to the valley** leaves. Colony sim does not step while the pocket is up.

## Controls

| Key | Inhabit | Manager |
|-----|---------|---------|
| WASD | walk (body facing) | walk (into the picture) |
| Shift | hurry | hurry |
| Mouse | look (click to lock) | right-drag orbit |
| Arrows | turn / look | — |
| Q / , | — | orbit |
| Wheel | — | zoom |
| E | talk / clear jam | talk / clear jam |
| V | switch camera | switch camera |
