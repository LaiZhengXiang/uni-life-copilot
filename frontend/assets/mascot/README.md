# Mascot pictures (optional, kept on this computer only)

Put pictures of your own mascot here to use them instead of the drawn Ollie cat.
They are **not uploaded to GitHub** (see `.gitignore`), so only your computer shows them.

The app reads `mascot.json`, which lists these groups of pictures:

| Group | When it shows |
|---|---|
| `main` | The normal pose. Also the logo and Ollie's chat picture |
| `idle` | Every 6 to 14 seconds, one random idle picture shows for 3 seconds, then back to `main` |
| `pressed` | While you press and hold the mascot (it squishes), and a moment after you let go |
| `answer` | While Ollie waits for the AI and while it answers you |

Only `main` (or `idle`) is required; without `main`, the first idle picture is the main pose. Without `mascot.json` the drawn cat is used.

## Making the pictures

Put your line drawings (black outline on white) in sub-folders named after the groups,
for example `mascot/main/`, `mascot/idle/`, `mascot/pressed/`, `mascot/answer/` in the project folder. Then run:

```bash
python tools/remove_bg.py --batch mascot frontend/assets/mascot
```

It cuts out the white background of every picture, saves `idle-1.png`, `pressed-1.png` ...
here, and writes `mascot.json`. It needs Pillow (`pip install pillow`).
