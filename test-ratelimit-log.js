// Verificación read-only de logRateLimit (backend): que extraiga bien los datos
// del 429 de Groq, soportando las dos formas en que el SDK puede entregar los
// headers (objeto plano con claves en minúscula, o un Headers con .get()).
//
// Cero dependencias: extrae el bloque EXACTO de backend/server.js por anclas y
// lo corre con un console.warn stub para capturar lo que loguearía.
const fs = require("fs");

const SERVER = fs.readFileSync("backend/server.js", "utf8");

function entre(fuente, a, b) {
  const i = fuente.indexOf(a);
  const j = fuente.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error("Ancla no encontrada: " + JSON.stringify(i < 0 ? a : b));
  return fuente.slice(i, j);
}

let fallos = 0;
function ok(cond, msg) {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) fallos++;
}

const src = entre(SERVER, "function logRateLimit(endpoint, err) {", "const TIPOS_PERMITIDOS");

// Corre logRateLimit con un console.warn falso que captura los argumentos.
function capturar(err) {
  let capturado = null;
  const fakeConsole = { warn: (...args) => { capturado = args; } };
  const fn = new Function("console", src + "\nreturn logRateLimit;")(fakeConsole);
  fn("/interpretar", err);
  // logRateLimit llama console.warn("[Iky][429]", endpoint, jsonString)
  return { endpoint: capturado && capturado[1], data: JSON.parse(capturado && capturado[2]) };
}

const headersPlano = {
  "retry-after": "2",
  "x-ratelimit-limit-tokens": "6000",
  "x-ratelimit-remaining-tokens": "0",
  "x-ratelimit-reset-tokens": "1.5s",
};
const mensajeTPM = "Rate limit reached for model llama-3.3-70b-versatile on tokens per minute (TPM): Limit 6000, Used 6000.";

console.log("[1] headers como objeto plano (claves minúscula)");
let r = capturar({ status: 429, headers: headersPlano, error: { message: mensajeTPM } });
ok(r.endpoint === "/interpretar", "loguea el endpoint");
ok(r.data.retryAfter === "2", "retryAfter desde header");
ok(r.data.limitTokens === "6000", "limitTokens desde header");
ok(r.data.remainingTokens === "0", "remainingTokens desde header");
ok(/TPM/.test(r.data.mensaje), "mensaje del proveedor (dice el límite: TPM)");
ok(r.data.limitRequests === null, "campos ausentes quedan null");

console.log("\n[2] headers como Headers con .get()");
const headersGet = { get: (k) => headersPlano[k] || null };
r = capturar({ status: 429, headers: headersGet, error: { message: mensajeTPM } });
ok(r.data.retryAfter === "2", "retryAfter vía .get()");
ok(r.data.limitTokens === "6000", "limitTokens vía .get()");

console.log("\n[3] sin headers: no explota, usa err.message");
r = capturar({ status: 429, message: "boom" });
ok(r.data.retryAfter === null, "sin headers -> retryAfter null");
ok(r.data.mensaje === "boom", "cae a err.message cuando no hay error.message");

console.log("\n" + (fallos === 0 ? "TODAS LAS ASERCIONES PASARON ✓" : (fallos + " ASERCION(ES) FALLARON ✗")));
process.exit(fallos === 0 ? 0 : 1);
