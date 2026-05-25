// HITO V2 — verificación de detectarMicroIntencionQueHago
//
// Extrae el bloque exacto de producción por anclas de texto y lo corre
// sobre stubs mínimos. Sin Groq, sin navegador, sin dependencias.

const fs = require("fs");
const CONTENT = fs.readFileSync("content.js", "utf8");

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

// Extraer funciones de producción
const normalizarSrc = entre(CONTENT, "function normalizar(texto) {", "function limpiarEspacios(texto) {");
const queHagoSrc = entre(
  CONTENT,
  "function detectarMicroIntencionQueHago(textoNorm) {",
  "async function manejarQueHagoAqui("
);

const normalizar = new Function(`${normalizarSrc}; return normalizar;`)();
const detectarMicroIntencionQueHago = new Function(`${normalizarSrc}\n${queHagoSrc}; return detectarMicroIntencionQueHago;`)();

console.log("\n--- Frases soportadas (con tilde, input real del usuario) ---");
const soportadas = [
  "qué puedo hacer aquí", "que puedo hacer aqui",
  "qué hago aquí",        "que hago aqui",
  "qué hago ahora",       "que hago ahora",
  "qué sigue",            "que sigue",
  "qué miro",             "que miro",
  "cuál miro",            "cual miro",
];
for (const input of soportadas) {
  ok(detectarMicroIntencionQueHago(normalizar(input)), `"${input}" detecta qué-hago`);
}

console.log("\n--- Variantes en contexto (frase más larga / wake-word) ---");
ok(detectarMicroIntencionQueHago(normalizar("Iky, qué puedo hacer aquí")), "wake-word + 'qué puedo hacer aquí'");
ok(detectarMicroIntencionQueHago(normalizar("oye y qué hago ahora")), "'qué hago ahora' en contexto");
ok(detectarMicroIntencionQueHago(normalizar("no sé qué sigue")), "'qué sigue' en contexto");

console.log("\n--- No pisa V1 (repetir/simplificar) ---");
const deV1 = ["no entendí", "explícame de nuevo", "repítelo", "más simple", "otra vez"];
for (const input of deV1) {
  ok(!detectarMicroIntencionQueHago(normalizar(input)), `V1 "${input}" no cae en V2`);
}

console.log("\n--- Frases irrelevantes (no deben detectar) ---");
const irrelevantes = [
  "hola",
  "busca recetas",
  "cerrar sesión",
  "qué es esto",
  "abrir el menú",
  "volver",
];
for (const input of irrelevantes) {
  ok(!detectarMicroIntencionQueHago(normalizar(input)), `"${input}" no detecta qué-hago`);
}

console.log("\n--- Casos borde ---");
ok(!detectarMicroIntencionQueHago(""), "string vacío → false");
ok(!detectarMicroIntencionQueHago(normalizar("  ")), "solo espacios → false");

console.log(`\n${fallos === 0 ? "✓ Todos los tests pasaron" : `✗ ${fallos} test(s) fallaron`}\n`);
if (fallos > 0) process.exit(1);
