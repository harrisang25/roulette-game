(() => {
  "use strict";

  // ---- Rules ---------------------------------------------------------------
  // European single-zero wheel order, clockwise.
  const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const START_BALANCE = 1000;
  const STORAGE_KEY = "roulette.balance";

  const colorOf = (n) => (n === 0 ? "green" : RED.has(n) ? "red" : "black");

  // Each bet: which numbers win, and the payout ratio (x:1).
  const BETS = {};
  for (let n = 0; n <= 36; n++) BETS["n" + n] = { label: String(n), wins: (x) => x === n, pays: 35 };
  [1, 2, 3].forEach((d) => {
    BETS["dozen" + d] = { label: ["1st 12", "2nd 12", "3rd 12"][d - 1], pays: 2,
      wins: (x) => x >= (d - 1) * 12 + 1 && x <= d * 12 };
    BETS["col" + d] = { label: "2 to 1", pays: 2, wins: (x) => x !== 0 && x % 3 === d % 3 };
  });
  Object.assign(BETS, {
    low: { label: "1–18", pays: 1, wins: (x) => x >= 1 && x <= 18 },
    high: { label: "19–36", pays: 1, wins: (x) => x >= 19 },
    even: { label: "Even", pays: 1, wins: (x) => x !== 0 && x % 2 === 0 },
    odd: { label: "Odd", pays: 1, wins: (x) => x % 2 === 1 },
    red: { label: "Red", pays: 1, wins: (x) => RED.has(x) },
    black: { label: "Black", pays: 1, wins: (x) => x !== 0 && !RED.has(x) },
  });

  // ---- State ---------------------------------------------------------------
  let balance = loadBalance();
  let chip = 5;
  let bets = {};          // id -> amount
  let placements = [];    // stack of {id, amount} for undo
  let lastBets = null;    // bets from the previous spin, for Rebet
  let spinning = false;
  const history = [];

  function loadBalance() {
    try {
      const v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
      return Number.isFinite(v) && v >= 0 ? v : START_BALANCE;
    } catch { return START_BALANCE; }
  }
  function saveBalance() {
    try { localStorage.setItem(STORAGE_KEY, String(balance)); } catch { /* ignore */ }
  }

  // ---- DOM -----------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const tableEl = $("table");
  const els = {
    balance: $("balance"), totalBet: $("totalBet"), lastWin: $("lastWin"),
    result: $("result"), history: $("history"),
    spin: $("spin"), undo: $("undo"), clear: $("clear"), rebet: $("rebet"), reset: $("reset"),
  };
  const cells = {};

  function addCell(id, col, row, colSpan = 1, rowSpan = 1, cls = "") {
    const b = document.createElement("button");
    b.className = "cell " + cls;
    b.dataset.bet = id;
    b.style.gridColumn = `${col} / span ${colSpan}`;
    b.style.gridRow = `${row} / span ${rowSpan}`;
    const bet = BETS[id];
    if (id.startsWith("n")) {
      b.innerHTML = `<span class="n">${bet.label}</span>`;
    } else if (id === "red" || id === "black") {
      b.innerHTML = `<span class="diamond" style="background:var(--${id})"></span>`;
    } else {
      b.textContent = bet.label;
    }
    b.setAttribute("aria-label", `${id.startsWith("n") ? "Number " : ""}${bet.label === "2 to 1" ? "Column " + id.slice(3) : bet.label}, pays ${bet.pays} to 1`);
    tableEl.appendChild(b);
    cells[id] = b;
  }

  function buildTable() {
    addCell("n0", 1, 1, 1, 3, "num zero");
    for (let n = 1; n <= 36; n++) {
      const col = 2 + Math.floor((n - 1) / 3);
      const row = 3 - ((n - 1) % 3);
      addCell("n" + n, col, row, 1, 1, "num " + colorOf(n));
    }
    addCell("col3", 14, 1, 1, 1, "outside");
    addCell("col2", 14, 2, 1, 1, "outside");
    addCell("col1", 14, 3, 1, 1, "outside");
    addCell("dozen1", 2, 4, 4, 1, "outside");
    addCell("dozen2", 6, 4, 4, 1, "outside");
    addCell("dozen3", 10, 4, 4, 1, "outside");
    ["low", "even", "red", "black", "odd", "high"].forEach((id, i) => addCell(id, 2 + i * 2, 5, 2, 1, "outside"));
  }

  // ---- Betting -------------------------------------------------------------
  const totalBet = () => Object.values(bets).reduce((a, b) => a + b, 0);

  function place(id, amount) {
    if (spinning || amount <= 0) return false;
    if (amount > balance) { flash(`Not enough balance for a ${amount} chip`); return false; }
    balance -= amount;
    bets[id] = (bets[id] || 0) + amount;
    placements.push({ id, amount });
    return true;
  }

  function removeOne(id) {
    if (spinning || !bets[id]) return;
    // Remove the most recent chip placed on this spot.
    for (let i = placements.length - 1; i >= 0; i--) {
      if (placements[i].id === id) {
        const { amount } = placements.splice(i, 1)[0];
        refund(id, amount);
        break;
      }
    }
    render();
  }

  function refund(id, amount) {
    balance += amount;
    bets[id] -= amount;
    if (bets[id] <= 0) delete bets[id];
  }

  function undo() {
    if (spinning) return;
    const p = placements.pop();
    if (p) refund(p.id, p.amount);
    render();
  }

  function clearBets() {
    if (spinning) return;
    while (placements.length) { const p = placements.pop(); refund(p.id, p.amount); }
    render();
  }

  function rebet() {
    if (spinning || !lastBets) return;
    clearBets();
    const need = Object.values(lastBets).reduce((a, b) => a + b, 0);
    if (need > balance) { flash("Not enough balance to repeat the last bet"); return; }
    for (const [id, amt] of Object.entries(lastBets)) place(id, amt);
    render();
  }

  let flashTimer;
  function flash(msg) {
    els.result.textContent = msg;
    els.result.classList.remove("win");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { if (!spinning) els.result.textContent = "Place your bets"; }, 2200);
  }

  // ---- Rendering -----------------------------------------------------------
  function render() {
    els.balance.textContent = balance.toLocaleString();
    els.totalBet.textContent = totalBet().toLocaleString();
    for (const [id, cell] of Object.entries(cells)) {
      let tag = cell.querySelector(".placed");
      if (bets[id]) {
        if (!tag) { tag = document.createElement("span"); tag.className = "placed"; cell.appendChild(tag); }
        tag.textContent = compact(bets[id]);
      } else if (tag) tag.remove();
    }
    const hasBets = totalBet() > 0;
    els.spin.disabled = spinning || !hasBets;
    els.undo.disabled = spinning || !placements.length;
    els.clear.disabled = spinning || !hasBets;
    els.rebet.disabled = spinning || !lastBets;
    document.body.classList.toggle("spinning", spinning);
  }

  const compact = (n) => (n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));

  function renderHistory() {
    els.history.innerHTML = "";
    history.slice(0, 14).forEach((n) => {
      const li = document.createElement("li");
      li.textContent = n;
      li.style.background = `var(--${colorOf(n)})`;
      els.history.appendChild(li);
    });
  }

  // ---- Wheel ---------------------------------------------------------------
  const canvas = $("wheel");
  const ctx = canvas.getContext("2d");
  const SIZE = 440, C = SIZE / 2;
  const SEG = (Math.PI * 2) / WHEEL.length;
  const R = { rim: 214, track: 192, pocketOut: 172, pocketIn: 122, numText: 158, ballRest: 133, cone: 112 };

  const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  canvas.width = SIZE * dpr; canvas.height = SIZE * dpr;
  ctx.scale(dpr, dpr);

  let wheelAngle = 0;               // clockwise from top, radians
  let ballAngle = 0;                // absolute
  let ballRadius = R.ballRest;
  let ballOffset = 0;               // ball's angle relative to the wheel when resting
  let ballVisible = false;
  let anim = null;                  // active spin animation
  let lastFrame = performance.now();

  // Angle measured clockwise from 12 o'clock → canvas coordinates.
  const pt = (a, r) => [C + r * Math.sin(a), C - r * Math.cos(a)];
  const arcA = (a) => a - Math.PI / 2;

  function drawWheel() {
    ctx.clearRect(0, 0, SIZE, SIZE);

    // Wooden rim & ball track
    let g = ctx.createRadialGradient(C, C, R.track, C, C, R.rim);
    g.addColorStop(0, "#5a3416"); g.addColorStop(1, "#2b1708");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(C, C, R.rim, 0, Math.PI * 2); ctx.fill();
    g = ctx.createRadialGradient(C, C, R.pocketOut, C, C, R.track + 4);
    g.addColorStop(0, "#2a2a2a"); g.addColorStop(1, "#6b6b6b");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(C, C, R.track + 4, 0, Math.PI * 2); ctx.fill();

    // Pockets
    for (let i = 0; i < WHEEL.length; i++) {
      const n = WHEEL[i];
      const mid = wheelAngle + i * SEG;
      const a0 = arcA(mid - SEG / 2), a1 = arcA(mid + SEG / 2);
      ctx.beginPath();
      ctx.arc(C, C, R.pocketOut, a0, a1);
      ctx.arc(C, C, R.pocketIn, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = n === 0 ? "#138a4a" : RED.has(n) ? "#b8202c" : "#17181a";
      ctx.fill();
      ctx.strokeStyle = "#d4b25a"; ctx.lineWidth = 1.2; ctx.stroke();

      const [x, y] = pt(mid, R.numText);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(mid);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 13px system-ui, sans-serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(n), 0, 0);
      ctx.restore();
    }

    // Inner cone
    g = ctx.createRadialGradient(C - 20, C - 20, 10, C, C, R.cone);
    g.addColorStop(0, "#8a5a2b"); g.addColorStop(1, "#3d230d");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(C, C, R.cone, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#d4b25a"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(C, C, R.pocketIn, 0, Math.PI * 2); ctx.stroke();

    // Turret spokes
    ctx.strokeStyle = "#e6c46a"; ctx.lineWidth = 6; ctx.lineCap = "round";
    for (let k = 0; k < 4; k++) {
      const a = wheelAngle + k * Math.PI / 2;
      const [x1, y1] = pt(a, 18), [x2, y2] = pt(a, 70);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
    g = ctx.createRadialGradient(C - 6, C - 6, 2, C, C, 24);
    g.addColorStop(0, "#fff3c4"); g.addColorStop(1, "#b38b2e");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(C, C, 22, 0, Math.PI * 2); ctx.fill();

    // Ball
    if (ballVisible) {
      const [bx, by] = pt(ballAngle, ballRadius);
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath(); ctx.arc(bx + 2, by + 2, 7, 0, Math.PI * 2); ctx.fill();
      g = ctx.createRadialGradient(bx - 2, by - 2, 1, bx, by, 7);
      g.addColorStop(0, "#fff"); g.addColorStop(1, "#bdbdbd");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(bx, by, 7, 0, Math.PI * 2); ctx.fill();
    }

    // Pointer marker at the top
    ctx.fillStyle = "#e6c46a";
    ctx.beginPath();
    ctx.moveTo(C - 9, C - R.rim + 1); ctx.lineTo(C + 9, C - R.rim + 1); ctx.lineTo(C, C - R.track + 2);
    ctx.closePath(); ctx.fill();
  }

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

  function frame(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;

    if (anim) {
      const p = Math.min(1, (now - anim.start) / anim.duration);
      wheelAngle = anim.w0 + anim.wDelta * easeOutCubic(p);
      ballAngle = anim.b0 + anim.bDelta * easeOutQuint(p);
      // Ball rides the outer track, then drops into the pockets with a small bounce.
      if (p < 0.55) ballRadius = R.track - 6;
      else if (p < 0.8) {
        const q = (p - 0.55) / 0.25;
        ballRadius = (R.track - 6) - ((R.track - 6) - R.ballRest) * q * q + Math.sin(q * Math.PI * 3) * 6 * (1 - q);
      } else ballRadius = R.ballRest;
      if (p >= 1) { const done = anim.onDone; anim = null; done(); }
    } else {
      wheelAngle += dt * 0.25; // gentle idle rotation
      ballAngle = wheelAngle + ballOffset;
    }
    drawWheel();
    requestAnimationFrame(frame);
  }

  function secureRandomInt(max) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / max) * max;
    do crypto.getRandomValues(buf); while (buf[0] >= limit);
    return buf[0] % max;
  }

  const norm = (a) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

  function spin() {
    if (spinning || totalBet() === 0) return;
    spinning = true;
    clearTimeout(flashTimer);
    els.result.classList.remove("win");
    els.result.textContent = "No more bets…";
    Object.values(cells).forEach((c) => c.classList.remove("hit"));
    render();

    const index = secureRandomInt(WHEEL.length);
    const number = WHEEL[index];
    const duration = 6500;
    const w0 = wheelAngle;
    const wDelta = Math.PI * 2 * 2.5 + Math.random() * Math.PI;
    const wFinal = w0 + wDelta;
    const b0 = ballVisible ? ballAngle : norm(-wheelAngle);
    const target = wFinal + index * SEG;
    // Ball travels counter-clockwise: several full laps plus the remaining distance.
    const bDelta = -(norm(b0 - target) + Math.PI * 2 * 6);
    ballVisible = true;

    anim = {
      start: performance.now(), duration, w0, wDelta, b0, bDelta,
      onDone: () => { ballOffset = index * SEG; settle(number); },
    };
  }

  function settle(number) {
    let won = 0;
    for (const [id, amt] of Object.entries(bets)) {
      if (BETS[id].wins(number)) won += amt * (BETS[id].pays + 1);
    }
    balance += won;
    saveBalance();

    for (const id of Object.keys(BETS)) if (BETS[id].wins(number)) cells[id].classList.add("hit");

    history.unshift(number);
    renderHistory();

    const colorName = number === 0 ? "green" : colorOf(number);
    if (won > 0) {
      els.result.textContent = `${number} ${colorName} — you win ${won.toLocaleString()}!`;
      els.result.classList.add("win");
    } else {
      els.result.textContent = `${number} ${colorName} — no win this time`;
    }
    els.lastWin.textContent = won.toLocaleString();

    lastBets = { ...bets };
    bets = {}; placements = [];
    spinning = false;
    render();

    if (balance === 0) {
      els.result.textContent += " · Out of chips — use “Reset balance” to play again";
    }
  }

  // ---- Events --------------------------------------------------------------
  tableEl.addEventListener("click", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    if (place(cell.dataset.bet, chip)) render();
  });
  tableEl.addEventListener("contextmenu", (e) => {
    const cell = e.target.closest(".cell");
    if (!cell) return;
    e.preventDefault();
    removeOne(cell.dataset.bet);
  });

  const chipButtons = document.querySelectorAll(".chip");
  function selectChip(v) {
    chip = v;
    chipButtons.forEach((b) => b.setAttribute("aria-checked", String(Number(b.dataset.value) === v)));
  }
  chipButtons.forEach((b) => b.addEventListener("click", () => selectChip(Number(b.dataset.value))));

  els.spin.addEventListener("click", spin);
  els.undo.addEventListener("click", undo);
  els.clear.addEventListener("click", clearBets);
  els.rebet.addEventListener("click", rebet);
  els.reset.addEventListener("click", () => {
    if (spinning) return;
    clearBets();
    balance = START_BALANCE;
    saveBalance();
    lastBets = null;
    flash("Balance reset to " + START_BALANCE);
    render();
  });
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.target.closest("button")) { e.preventDefault(); spin(); }
  });

  // ---- Init ----------------------------------------------------------------
  buildTable();
  selectChip(chip);
  render();
  requestAnimationFrame(frame);

  // Exposed for automated checks; not used by the game.
  window.__roulette = { WHEEL, BETS, get balance() { return balance; } };
})();
