// Paso 1 de la comodidad: mandar a la persona a GitHub para que nos deje
// publicar su prueba.
//
// OAuth aquí no es la fuente de verdad de nada. Lo único que hace es escribir
// un gist público, que es exactamente lo que alguien haría a mano. El registro
// en la cadena sigue viendo un login y una URL pública, y la comprobación la
// hace el navegador de quien mire, contra GitHub, sin pasar por nosotros.
//
// El camino manual sigue existiendo y sigue siendo el predeterminado.

const crypto = require("crypto");

const WALLET_OK = /^0x[0-9a-fA-F]{40}$/;
const COOKIE = "mg_oauth";

module.exports = (req, res) => {
  const clientId = process.env.GITHUB_CLIENT_ID || "";

  // La página pregunta antes de pintar el botón: si esto no está configurado,
  // el botón no aparece y nadie se topa con un flujo a medias.
  if (req.query && req.query.probe) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ configured: Boolean(clientId && process.env.GITHUB_CLIENT_SECRET) });
  }

  if (!clientId || !process.env.GITHUB_CLIENT_SECRET) {
    return res.redirect(302, "/register#err=" + encodeURIComponent("GitHub sign-in is not configured on this deployment."));
  }

  const wallet = String((req.query && req.query.wallet) || "");
  if (!WALLET_OK.test(wallet)) {
    return res.redirect(302, "/register#err=" + encodeURIComponent("Connect your wallet before signing in with GitHub."));
  }

  // El estado vive en una cookie HttpOnly junto con la wallet. Así un enlace
  // fabricado por otro no puede hacer que escribas SU dirección en TU gist:
  // la dirección que se publica sale de la cookie, nunca de la URL de vuelta.
  const state = crypto.randomBytes(16).toString("hex");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0];

  res.setHeader("Set-Cookie",
    `${COOKIE}=${state}.${wallet.toLowerCase()}; Path=/api/github; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  res.setHeader("Cache-Control", "no-store");

  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "gist");
  url.searchParams.set("state", state);
  url.searchParams.set("allow_signup", "false");
  url.searchParams.set("redirect_uri", `${proto}://${host}/api/github/callback`);

  return res.redirect(302, url.toString());
};
