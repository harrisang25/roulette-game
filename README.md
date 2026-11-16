# Roulette

A European (single-zero) roulette game that runs entirely in the browser. No installation, no build step, no dependencies: plain HTML, CSS and JavaScript.

**Play it live:** https://harrisang25.github.io/roulette-game/

**Play money only.** You start with 1,000 chips; your balance is kept in your browser's local storage.

## How to play

1. Pick a chip value (1, 5, 25, 100 or 500).
2. Click spaces on the table to place chips. Right-click (or long-press on a phone) a space to remove a chip.
3. Press **Spin** (or the space bar). The wheel and ball spin, the winning number is highlighted, and winnings are paid out.
4. Use **Undo**, **Clear** and **Rebet** to manage bets. **Reset balance** puts you back at 1,000.

### Bets and payouts

| Bet | Covers | Pays |
| --- | --- | --- |
| Straight | A single number (0–36) | 35:1 |
| Dozen | 1–12, 13–24 or 25–36 | 2:1 |
| Column ("2 to 1") | One of the three table rows | 2:1 |
| Red / Black | 18 numbers | 1:1 |
| Odd / Even | 18 numbers | 1:1 |
| 1–18 / 19–36 | 18 numbers | 1:1 |

Zero loses all outside bets. Results use `crypto.getRandomValues`, so every pocket is equally likely (1 in 37).

## Run it locally

Clone the repository and open `index.html` in any modern browser:

```bash
git clone https://github.com/harrisang25/roulette-game.git
cd roulette-game
open index.html        # macOS; on Windows use `start index.html`, on Linux `xdg-open index.html`
```

Or serve the folder with any static file server, for example:

```bash
python3 -m http.server 8000
```

then visit <http://localhost:8000>.

## Project structure

```
index.html   Page markup
style.css    Layout and styling
script.js    Game logic, wheel rendering and animation
```

## Deployment

The site is static, so it is hosted on GitHub Pages straight from the `main` branch (root folder).
