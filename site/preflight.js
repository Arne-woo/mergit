/**
 * ¿Puede Mergit pagar en este repositorio?
 *
 * Se corre antes de firmar nada, con la URL de lo que el bounty paga. Contesta
 * con bloqueantes (el pago no va a salir), avisos (va a salir, pero algo no está
 * como debería) y hechos (lo que encontró, para que se pueda comprobar a mano).
 *
 * Todo pasa en el navegador de quien mira, contra la API pública de GitHub y sin
 * token. Es la misma decisión que ya toma /register al comprobar la prueba: si
 * esto corriera en el servidor, las 60 peticiones por hora sin autenticar serían
 * compartidas por todo el mundo y se agotarían en minutos. Aquí cada visitante
 * gasta su propia cuota.
 *
 * El contenido de los archivos se lee de raw.githubusercontent.com, que no cuenta
 * contra esa cuota. Solo el listado del directorio pasa por la API.
 *
 * Lo que NO se puede comprobar desde fuera, y por eso se dice en voz alta en vez
 * de callarlo: si el secreto MERGIT_AGENT_KEY está puesto. Los secretos de un
 * repositorio no son públicos. Sin él el agente verifica y comenta lo que pagaría,
 * pero no firma.
 */

const GH = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

const PERMISOS = [
  ["contents", "read", "to read the repository"],
  ["checks", "read", "to see whether the tests passed"],
  ["statuses", "read", "the other half of the same check"],
  ["pull-requests", "write", "to comment the receipt on the pull request"],
];

/** Saca owner y repo de cualquier URL de GitHub: el repo, un issue, un PR. */
export function repoFromUrl(url) {
  const m = String(url || "").trim()
    .match(/^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, "") };
}

async function ghJson(path) {
  const r = await fetch(GH + path, { headers: { Accept: "application/vnd.github+json" } });
  if (r.status === 404) return null;
  if (r.status === 403) {
    const e = new Error("GitHub rate-limited this browser. Wait a few minutes and try again.");
    e.rateLimited = true;
    throw e;
  }
  if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
  return r.json();
}

async function rawText(url) {
  try {
    const r = await fetch(url);
    return r.ok ? r.text() : null;
  } catch {
    return null;
  }
}

/**
 * Lee el bloque `permissions:` de un workflow sin interpretar YAML entero.
 * No hace falta un analizador: solo importa si una clave aparece con su valor,
 * y un workflow que declara permisos los escribe en líneas sueltas.
 */
function permisosDe(yaml) {
  const bloque = yaml.match(/^permissions:\s*$([\s\S]*?)(?=^\S)/m);
  if (!bloque) {
    // `permissions: read-all` o `write-all` en una línea.
    const unaLinea = yaml.match(/^permissions:\s*(\S+)\s*$/m);
    if (unaLinea) return { modo: unaLinea[1], tiene: () => unaLinea[1] === "write-all" };
    return null;
  }
  const texto = bloque[1];
  return {
    modo: "bloque",
    tiene: (clave, valor) =>
      new RegExp(`^\\s+${clave}:\\s*${valor}\\s*$`, "m").test(texto),
  };
}

const usaMergit = (yaml) => /uses:\s*odiseo159-beep\/mergit@/.test(yaml)
  || /repository:\s*odiseo159-beep\/mergit/.test(yaml);

const versionUsada = (yaml) => {
  const accion = yaml.match(/uses:\s*odiseo159-beep\/mergit@(\S+)/);
  if (accion) return { como: "action", ref: accion[1] };
  if (/repository:\s*odiseo159-beep\/mergit/.test(yaml)) {
    const ref = yaml.match(/repository:\s*odiseo159-beep\/mergit[\s\S]{0,200}?\bref:\s*(\S+)/);
    return { como: "checkout", ref: ref ? ref[1] : null };
  }
  return null;
};

const corre = (yaml, evento) => new RegExp(`^\\s*${evento}:`, "m").test(yaml);

/**
 * @param {string} url  cualquier URL del repositorio, su issue o su pull request
 * @returns {Promise<{ok:boolean, repo:object|null, blockers:string[], warnings:string[], facts:string[], unknowns:string[]}>}
 */
export async function preflight(url) {
  const out = { ok: false, repo: null, blockers: [], warnings: [], facts: [], unknowns: [] };

  const ref = repoFromUrl(url);
  if (!ref) {
    out.blockers.push("That does not look like a GitHub URL. Paste the issue, the pull request or the repository.");
    return out;
  }
  out.repo = ref;
  const slug = `${ref.owner}/${ref.repo}`;

  let repo;
  try {
    repo = await ghJson(`/repos/${slug}`);
  } catch (e) {
    out.unknowns.push(e.message);
    return out;
  }
  if (!repo) {
    out.blockers.push(`${slug} does not exist, or it is private. The agent reads it with a repository token, so a private repository has to be the one running the workflow.`);
    return out;
  }
  if (repo.archived) out.blockers.push(`${slug} is archived. Nothing can be merged into it.`);
  out.facts.push(`${slug} exists, default branch ${repo.default_branch}.`);

  // Los workflows. El listado pasa por la API; el contenido, por raw.
  let lista;
  try {
    lista = await ghJson(`/repos/${slug}/contents/.github/workflows?ref=${encodeURIComponent(repo.default_branch)}`);
  } catch (e) {
    out.unknowns.push(e.message);
    return out;
  }
  if (!Array.isArray(lista) || lista.length === 0) {
    out.blockers.push("No workflows in .github/workflows, so nothing runs the agent and nothing runs the tests. The README has the two files to add.");
    return out;
  }

  const archivos = lista.filter((f) => /\.ya?ml$/i.test(f.name || ""));
  const leidos = await Promise.all(archivos.map(async (f) => ({
    nombre: f.name,
    texto: await rawText(`${RAW}/${slug}/${repo.default_branch}/.github/workflows/${f.name}`),
  })));

  const conMergit = leidos.filter((f) => f.texto && usaMergit(f.texto));
  const conPR = leidos.filter((f) => f.texto && corre(f.texto, "pull_request"));

  if (conMergit.length === 0) {
    out.blockers.push("No workflow runs Mergit. Without it nothing will pay when a pull request is merged.");
  } else {
    const w = conMergit[0];
    out.facts.push(`${w.nombre} runs Mergit.`);

    const v = versionUsada(w.texto);
    if (v?.como === "action" && v.ref) {
      out.facts.push(`It uses the published action, pinned to ${v.ref}.`);
    } else if (v?.como === "checkout") {
      if (!v.ref) {
        out.warnings.push("It checks out the Mergit repository without pinning a ref, so it runs whatever is on the default branch today. A merged pull request that touches the agent becomes the code that holds the signing key. Pin it to a tag.");
      } else {
        out.facts.push(`It checks out Mergit pinned to ${v.ref}.`);
      }
    }

    const p = permisosDe(w.texto);
    if (!p) {
      out.warnings.push(`${w.nombre} declares no permissions block. On a public repository the agent can usually still read the checks; on a private one it will be refused. Declaring them costs nothing.`);
    } else {
      const faltan = PERMISOS.filter(([k, v2]) => !p.tiene(k, v2));
      if (faltan.length) {
        const detalle = faltan.map(([k, v2, por]) => `${k}: ${v2} (${por})`).join(", ");
        if (repo.private) {
          out.blockers.push(`Missing permissions in ${w.nombre}: ${detalle}. On a private repository GitHub answers 403 and the agent refuses to pay without seeing the tests.`);
        } else {
          out.warnings.push(`Missing permissions in ${w.nombre}: ${detalle}. It works today because the repository is public, and breaks the day it is not.`);
        }
      } else {
        out.facts.push("It declares the four permissions the agent needs.");
      }
    }
  }

  if (conPR.length === 0) {
    out.blockers.push("No workflow runs on pull_request, so no pull request will ever have a green check. The agent refuses to pay when it cannot see the tests: the absence of CI is not CI passing.");
  } else {
    out.facts.push(`${conPR.map((f) => f.nombre).join(", ")} runs on pull requests.`);
  }

  // mergit.json es opcional: el registro on-chain y el README del perfil le ganan.
  const cfg = await rawText(`${RAW}/${slug}/${repo.default_branch}/mergit.json`);
  if (cfg) {
    out.facts.push("mergit.json is present, as a fallback for contributors who did not register.");
  } else {
    out.facts.push("No mergit.json, which is fine: contributors get paid through the on-chain registry or a line in their profile README.");
  }

  out.unknowns.push("Whether the MERGIT_AGENT_KEY secret is set. Repository secrets are not public, so nobody outside can check it. Without it the agent still verifies and comments what it would pay, and signs nothing.");

  out.ok = out.blockers.length === 0;
  return out;
}
