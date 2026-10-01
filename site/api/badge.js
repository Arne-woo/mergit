// Badge para el README de un desarrollador: /badge/<login>.svg
//
// Lee la cadena y nada más. **No llama a GitHub**: las funciones de Vercel salen
// por IPs compartidas y el límite sin autenticar (60/hora) se agota enseguida,
// con lo que el badge quedaría roto para todos. La comprobación de la prueba
// vive en /p/<login>, que corre en el navegador de quien mira.
//
// Cuenta con las mismas reglas que /p: no suma lo que una wallet se pagó a sí
// misma, deja fuera los bounties 1 y 2 de la v1 (pruebas de julio), y si no se
// pudo leer quién financió un pago, ese financiador no cuenta. El número se
// queda corto antes que inflarse.
//
// Muestra bounties y financiadores, nunca ETH: en testnet el ETH sale de un
// faucet y ordenar por eso sería ordenar por quién usó más el faucet.

const EXPLORER = "https://sepolia-explorer.giwa.io";
const REGISTRY = "0x79d44543d20c7c6653f6626687d67d2cd7f2af9c";
const ESCROWS = [
  { v: "v1", address: "0xffcf206ce1474263aaa3336fb9c8bc3d632e5879", from: 3 },
  { v: "v2", address: "0x48d506080abdbed11f1acbe40f799301d9612ad5", from: 1 },
];

const LOGIN_OK = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

async function logsOf(address) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(`${EXPLORER}/api/v2/addresses/${address}/logs`, { signal: ctl.signal });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    return (data.items || []).filter((it) => it.decoded).map((it) => {
      const p = Object.fromEntries(it.decoded.parameters.map((x) => [x.name, x.value]));
      return { kind: it.decoded.method_call.split("(")[0], block: Number(it.block_number), ...p };
    });
  } finally {
    clearTimeout(t);
  }
}

/** Qué wallet tiene registrado ese login ahora mismo. */
async function walletFor(login) {
  const want = login.toLowerCase();
  const events = await logsOf(REGISTRY);
  let claimed = null;
  let releasedAt = -1;
  for (const e of events) {
    if (e.kind === "Claimed" && String(e.login || "").toLowerCase() === want) {
      if (!claimed || e.block >= claimed.block) claimed = e;
    }
  }
  if (!claimed) return null;
  // un login liberado después de registrarse deja de estar tomado
  for (const e of events) {
    if (e.kind === "Released" && e.loginHash === claimed.loginHash && e.block > releasedAt) releasedAt = e.block;
  }
  if (releasedAt > claimed.block) return null;
  return String(claimed.wallet || "").toLowerCase();
}

/** Pagos que le hizo otro, y cuántos financiadores distintos fueron. */
async function recordOf(wallet) {
  let bounties = 0;
  const funders = new Set();
  for (const { address, from } of ESCROWS) {
    let events;
    try {
      events = await logsOf(address);
    } catch {
      continue; // un escrow que no responde no puede inventar un pago
    }
    const posted = new Map();
    for (const e of events) {
      if (e.kind === "BountyPosted") posted.set(String(e.bountyId), String(e.funder || "").toLowerCase());
    }
    for (const e of events) {
      if (e.kind !== "BountySettled") continue;
      if (String(e.developer || "").toLowerCase() !== wallet) continue;
      if (Number(e.bountyId) < from) continue;
      const funder = posted.get(String(e.bountyId)) || "";
      if (funder === wallet) continue;     // se lo pagó a sí mismo
      bounties++;
      if (funder) funders.add(funder);     // un financiador ilegible no cuenta
    }
  }
  return { bounties, funders: funders.size };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function svg(right, tone) {
  const LEFT = "mergit";
  const w = (t) => Math.round(t.length * 6.3) + 20;
  const lw = w(LEFT), rw = w(right), total = lw + rw;
  const fill = tone === "on" ? "#ff2d2d" : "#55555d";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="mergit: ${esc(right)}">
  <title>mergit: ${esc(right)}</title>
  <rect width="${lw}" height="20" fill="#0a0a0b"/>
  <rect x="${lw}" width="${rw}" height="20" fill="${fill}"/>
  <g font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" fill="#fff">
    <text x="${lw / 2}" y="14" text-anchor="middle" fill="#ededf0">${LEFT}</text>
    <text x="${lw + rw / 2}" y="14" text-anchor="middle">${esc(right)}</text>
  </g>
</svg>`;
}

module.exports = async (req, res) => {
  // Pase lo que pase se devuelve un SVG válido con 200. Una imagen rota en el
  // README de alguien es peor que no tener badge.
  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const file = String((req.query && req.query.file) || "");
  const login = file.replace(/\.svg$/i, "");

  if (!LOGIN_OK.test(login)) return res.status(200).send(svg("unknown login", "off"));

  try {
    const wallet = await walletFor(login);
    if (!wallet) return res.status(200).send(svg("not registered", "off"));

    const { bounties, funders } = await recordOf(wallet);
    if (!bounties) return res.status(200).send(svg("registered", "on"));

    const b = bounties === 1 ? "1 bounty" : `${bounties} bounties`;
    return res.status(200).send(svg(`${b} · ${plural(funders, "funder")}`, "on"));
  } catch {
    return res.status(200).send(svg("chain unreachable", "off"));
  }
};
