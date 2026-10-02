// Paso 2: GitHub nos devuelve un código, lo cambiamos por un token, publicamos
// el gist y tiramos el token.
//
// El token se usa una vez, dentro de esta petición, y no se guarda en ningún
// lado ni vuelve al navegador. No hay base de datos, no hay sesión, no hay nada
// que robarle a este servidor mañana.
//
// El login sale de GitHub, nunca del formulario: si la persona escribió otro,
// manda el que GitHub dice que es.

const COOKIE = "mg_oauth";
const WALLET_OK = /^0x[0-9a-fA-F]{40}$/;

const back = (res, frag) => {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/api/github; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
  res.setHeader("Cache-Control", "no-store");
  return res.redirect(302, "/register#" + frag);
};
const fail = (res, msg) => back(res, "err=" + encodeURIComponent(msg));

function cookieOf(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return "";
}

async function gh(path, token, init = {}) {
  const r = await fetch("https://api.github.com" + path, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "mergit",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  return r.json();
}

module.exports = async (req, res) => {
  const q = req.query || {};

  if (q.error) {
    return fail(res, q.error === "access_denied"
      ? "You did not give permission, so nothing was published. You can still publish the proof yourself."
      : String(q.error_description || q.error));
  }

  const [state, wallet] = String(cookieOf(req, COOKIE) || "").split(".");
  if (!state || !q.state || state !== String(q.state)) {
    return fail(res, "That sign-in did not come from this page. Start again.");
  }
  if (!WALLET_OK.test(wallet || "")) {
    return fail(res, "The wallet was lost along the way. Connect it and try again.");
  }
  if (!q.code) return fail(res, "GitHub did not return a code.");

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "mergit" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code: q.code,
      }),
    });
    const tok = await tokenRes.json();
    const token = tok && tok.access_token;
    if (!token) return fail(res, "GitHub refused the exchange. Try again.");

    const me = await gh("/user", token);
    const login = String(me.login || "");
    if (!login) return fail(res, "GitHub did not say who you are.");

    // Exactamente la misma línea que pide el camino manual. Si esta cadena
    // cambia aquí y no en la página, la comprobación falla y nadie se registra.
    const line = `Mergit: my GitHub account ${login} is registered to ${wallet} on GIWA Chain.`;

    const gist = await gh("/gists", token, {
      method: "POST",
      body: JSON.stringify({
        description: "Mergit proof",
        public: true,
        files: { "mergit.md": { content: line + "\n" } },
      }),
    });

    const url = String(gist.html_url || "");
    // El gist tiene que llevar el login en la URL: la comprobación del navegador
    // lo exige, y así la persona ve de quién es sin tener que confiar en nadie.
    if (!/^https:\/\/gist\.github\.com\/[^/]+\/[0-9a-f]+/i.test(url)) {
      return fail(res, "The gist was created but its address was not what we expected. Publish the proof yourself.");
    }

    // Vuelve en el fragmento: no viaja en logs de servidor ni en la cabecera
    // Referer hacia terceros.
    return back(res, `login=${encodeURIComponent(login)}&gist=${encodeURIComponent(url)}`);
  } catch (e) {
    return fail(res, `Could not publish the proof: ${e.message}`);
  }
};
