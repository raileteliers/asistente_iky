// HITO V1 — verificación de detectarMicroIntencionRepetir
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
const repetirSrc = entre(
  CONTENT,
  "function detectarMicroIntencionRepetir(textoNorm) {",
  "async function manejarRepetirOSimplificar() {"
);

const normalizar = new Function(`${normalizarSrc}; return normalizar;`)();
const detectarMicroIntencionRepetir = new Function(`${normalizarSrc}\n${repetirSrc}; return detectarMicroIntencionRepetir;`)();

console.log("\n--- Frases soportadas (con tilde, input real del usuario) ---");
const soportadas = [
  ["no entendí",          "no entendi"],
  ["no entendi",          "no entendi"],
  ["explícame de nuevo",  "explicame de nuevo"],
  ["explicame de nuevo",  "explicame de nuevo"],
  ["explicame denuevo",   "explicame denuevo"],
  ["repítelo",            "repitelo"],
  ["repitelo",            "repitelo"],
  ["más simple",          "mas simple"],
  ["mas simple",          "mas simple"],
  ["otra vez",            "otra vez"],
];
for (const [input, norm] of soportadas) {
  ok(detectarMicroIntencionRepetir(normalizar(input)), `"${input}" detecta repetir`);
  ok(normalizar(input) === norm, `normalizar("${input}") === "${norm}"`);
}

console.log("\n--- Variantes en contexto (frase más larga) ---");
ok(detectarMicroIntencionRepetir(normalizar("Iky, no entendí bien")), "frase más larga con 'no entendí'");
ok(detectarMicroIntencionRepetir(normalizar("por favor explicame de nuevo")), "'explicame de nuevo' en contexto");
ok(detectarMicroIntencionRepetir(normalizar("hazlo mas simple por favor")), "'mas simple' en contexto");

console.log("\n--- Frases irrelevantes (no deben detectar) ---");
const irrelevantes = [
  "hola",
  "busca recetas",
  "qué es esto",
  "abrir el menú",
  "volver",
];
for (const input of irrelevantes) {
  ok(!detectarMicroIntencionRepetir(normalizar(input)), `"${input}" no detecta repetir`);
}

console.log("\n--- Casos borde ---");
ok(!detectarMicroIntencionRepetir(""), "string vacío → false");
ok(!detectarMicroIntencionRepetir(normalizar("  ")), "solo espacios → false");

console.log(`\n${fallos === 0 ? "✓ Todos los tests pasaron" : `✗ ${fallos} test(s) fallaron`}\n`);
if (fallos > 0) process.exit(1);
