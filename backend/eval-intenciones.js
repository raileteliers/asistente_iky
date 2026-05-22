// Suite de evaluación para POST /interpretar.
//
// Uso:
//   1) Asegúrate de que el backend esté corriendo: npm start
//   2) En otra terminal: npm run eval
//
// El script lee eval-intenciones.json, dispara cada caso contra el backend
// y valida tipo, consulta, mensaje (longitud, HTML y frases prematuras).
// Imprime PASS/FAIL por caso, un resumen final y sale con exit code 1 si
// hubo fallos.
//
// No usa Jest/Vitest. Solo Node >= 18 (fetch nativo).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { contieneAccionPrematura } from "./safety-rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, "eval-intenciones.json");

const TIPOS_PERMITIDOS = new Set([
  "RESALTAR_BARRA",
  "GUIAR_BUSQUEDA",
  "EXPLICAR_RESULTADOS",
  "ABRIR_PRIMER_RESULTADO_SOLICITADO",
  "DESCONOCIDO",
]);

// FRASES_ACCION_PREMATURA y contieneAccionPrematura se importan de
// ./safety-rules.js — la misma fuente que usa el backend, así el eval
// nunca da un falso verde por listas divergentes.

function contieneHtmlPeligroso(s) {
  return /<\s*\/?\s*(script|style|iframe|object|embed|link|meta)\b/i.test(s);
}

function contieneAnguloBracket(s) {
  return /[<>]/.test(s);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function colorize(s, code) {
  if (!process.stdout.isTTY) return s;
  return `\x1b[${code}m${s}\x1b[0m`;
}
const green = (s) => colorize(s, 32);
const red = (s) => colorize(s, 31);
const yellow = (s) => colorize(s, 33);
const dim = (s) => colorize(s, 2);

function validarCaso(caso, resp) {
  const errores = [];

  if (!resp || typeof resp !== "object") {
    errores.push("respuesta no es un objeto JSON");
    return errores;
  }

  // 1. tipo dentro del enum cerrado (siempre).
  if (!TIPOS_PERMITIDOS.has(resp.tipo)) {
    errores.push(`tipo "${resp.tipo}" fuera del enum permitido`);
  }

  // 2. tipo esperado (si el caso lo declara).
  if (caso.tipoEsperado && resp.tipo !== caso.tipoEsperado) {
    errores.push(
      `tipo esperado "${caso.tipoEsperado}", recibido "${resp.tipo}"`
    );
  }

  // 3. consulta cuando el tipo es GUIAR_BUSQUEDA.
  if (resp.tipo === "GUIAR_BUSQUEDA") {
    if (typeof resp.consulta !== "string" || !resp.consulta.trim()) {
      errores.push("GUIAR_BUSQUEDA sin 'consulta' válida");
    } else if (resp.consulta.length > 200) {
      errores.push(`consulta supera 200 chars (${resp.consulta.length})`);
    }
  } else if (resp.consulta !== null) {
    // server.js ya nulifica consulta fuera de GUIAR_BUSQUEDA — si llega algo,
    // es un bug del backend.
    errores.push(
      `consulta debería ser null cuando tipo=${resp.tipo}, llegó: ${JSON.stringify(
        resp.consulta
      )}`
    );
  }

  // Validación específica si el caso pide consulta.
  if (caso.requiereConsulta) {
    if (typeof resp.consulta !== "string" || !resp.consulta.trim()) {
      errores.push("caso requiere consulta no vacía pero llegó vacía/null");
    }
  }

  // consultaIncluye: substring que la consulta DEBE contener (case-insensitive).
  if (caso.consultaIncluye) {
    const consulta = (resp.consulta || "").toLowerCase();
    const needle = String(caso.consultaIncluye).toLowerCase();
    if (!consulta.includes(needle)) {
      errores.push(
        `consulta debe contener "${caso.consultaIncluye}", recibido: ${JSON.stringify(
          resp.consulta
        )}`
      );
    }
  }

  // consultaNoIncluye: lista de substrings que la consulta NO debe contener
  // (case-insensitive). Sirve para vetar frases tipo "usar ChatGPT".
  if (Array.isArray(caso.consultaNoIncluye) && caso.consultaNoIncluye.length) {
    const consulta = (resp.consulta || "").toLowerCase();
    for (const veto of caso.consultaNoIncluye) {
      const v = String(veto).toLowerCase();
      if (consulta.includes(v)) {
        errores.push(
          `consulta no debe contener "${veto}", recibido: ${JSON.stringify(
            resp.consulta
          )}`
        );
      }
    }
  }

  // 4. mensaje string no vacío.
  if (typeof resp.mensaje !== "string" || !resp.mensaje.trim()) {
    errores.push("mensaje vacío o no es string");
  } else {
    // 5. mensaje <= 220 chars.
    if (resp.mensaje.length > 220) {
      errores.push(`mensaje supera 220 chars (${resp.mensaje.length})`);
    }
    // 6. sin HTML ni < / >.
    if (contieneAnguloBracket(resp.mensaje)) {
      errores.push("mensaje contiene '<' o '>'");
    }
    if (contieneHtmlPeligroso(resp.mensaje)) {
      errores.push("mensaje contiene etiquetas HTML peligrosas");
    }
    // 7. sin frases de acción prematura.
    if (contieneAccionPrematura(resp.mensaje)) {
      errores.push("mensaje contiene frase de acción prematura");
    }
  }

  // 8. confianza válida.
  if (
    typeof resp.confianza !== "number" ||
    !Number.isFinite(resp.confianza) ||
    resp.confianza < 0 ||
    resp.confianza > 1
  ) {
    errores.push(`confianza fuera de [0,1]: ${resp.confianza}`);
  }

  return errores;
}

async function llamarBackend(baseUrl, endpoint, body) {
  const url = `${baseUrl.replace(/\/$/, "")}${endpoint}`;
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `No se pudo conectar a ${url}. ¿Está corriendo el backend? (${err.message})`
    );
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

async function main() {
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    console.error(red(`No se pudo leer ${CONFIG_PATH}: ${err.message}`));
    process.exit(1);
  }

  const baseUrl = config.baseUrl || "http://localhost:3000";
  const endpoint = config.endpoint || "/interpretar";
  const delayMs = typeof config.delayMs === "number" ? config.delayMs : 250;
  const contextos = config.contextos || {};
  const casos = Array.isArray(config.casos) ? config.casos : [];

  if (!casos.length) {
    console.error(red("eval-intenciones.json no tiene casos."));
    process.exit(1);
  }

  console.log(dim(`Ejecutando ${casos.length} casos contra ${baseUrl}${endpoint}`));
  console.log("");

  const resultados = [];
  let totales = { pass: 0, fail: 0, error: 0 };
  let porGrupo = {};

  for (let i = 0; i < casos.length; i++) {
    const caso = casos[i];
    const grupo = caso.grupo || "SIN_GRUPO";
    porGrupo[grupo] ||= { pass: 0, fail: 0, error: 0 };

    const contexto =
      caso.contexto ||
      (caso.contextoRef ? contextos[caso.contextoRef] : undefined) ||
      {};

    const etiqueta = `[${grupo}] "${caso.texto}"`;
    let resp;
    try {
      resp = await llamarBackend(baseUrl, endpoint, {
        texto: caso.texto,
        contexto,
      });
    } catch (err) {
      console.log(`${red("ERROR")} ${etiqueta}`);
      console.log(`  ${dim(err.message)}`);
      totales.error++;
      porGrupo[grupo].error++;
      resultados.push({ caso, errores: [err.message], resp: null });
      // Si es error de conexión, abortar — el resto fallará igual.
      if (err.message.startsWith("No se pudo conectar")) {
        console.log(red("\nAbortando: backend no responde."));
        break;
      }
      await sleep(delayMs);
      continue;
    }

    const errores = validarCaso(caso, resp);
    if (errores.length === 0) {
      console.log(`${green("PASS")} ${etiqueta}`);
      totales.pass++;
      porGrupo[grupo].pass++;
    } else {
      console.log(`${red("FAIL")} ${etiqueta}`);
      for (const e of errores) console.log(`  ${red("·")} ${e}`);
      console.log(`  ${dim("respuesta:")} ${dim(JSON.stringify(resp))}`);
      totales.fail++;
      porGrupo[grupo].fail++;
    }
    resultados.push({ caso, errores, resp });

    await sleep(delayMs);
  }

  // Resumen.
  console.log("");
  console.log(dim("─".repeat(60)));
  console.log("Resumen por grupo:");
  for (const [grupo, r] of Object.entries(porGrupo)) {
    const total = r.pass + r.fail + r.error;
    const linea = `  ${grupo.padEnd(36)}  PASS ${r.pass}/${total}` +
      (r.fail ? `  ${red(`FAIL ${r.fail}`)}` : "") +
      (r.error ? `  ${yellow(`ERROR ${r.error}`)}` : "");
    console.log(linea);
  }
  console.log(dim("─".repeat(60)));
  const total = totales.pass + totales.fail + totales.error;
  const linea =
    `TOTAL: ${green(`PASS ${totales.pass}`)}/${total}` +
    (totales.fail ? `  ${red(`FAIL ${totales.fail}`)}` : "") +
    (totales.error ? `  ${yellow(`ERROR ${totales.error}`)}` : "");
  console.log(linea);

  if (totales.fail > 0 || totales.error > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(red("Error inesperado:"), err);
  process.exit(1);
});
