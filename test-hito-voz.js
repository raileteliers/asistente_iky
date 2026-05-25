// Verificación read-only del fix de flujo de voz (Google):
//   Fix 1 — toda búsqueda confirma: RESALTAR_CON_CONSULTA es SIEMPRE MEDIO
//           (escribe en la barra y pregunta antes de ejecutar). Antes
//           "busca X"/"quiero usar X" iban directo (BAJO); esBusquedaDirecta
//           ya no decide el flujo.
//   Fix 2 — clasificarRespuestaConversacional tolera afirmación + palabras
//           extra (deja de loopear), pero sigue exigiendo una palabra
//           accionable y mantiene la prioridad del rechazo.
//
// Cero dependencias: extrae bloques EXACTOS de content.js por anclas de texto
// y los corre sobre stubs (sin Groq, sin navegador), igual que las otras suites.
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
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), msg + "  (=> " + JSON.stringify(a) + ")");
}

// --- Bloques reales de producción ---
const normalizarSrc = entre(CONTENT, "function normalizar(texto) {", "function limpiarEspacios(texto) {");
const riesgoSrc = entre(CONTENT, "function clasificarRiesgoAccion(intencion, texto) {", "function esVisible(el) {");
const conversacionalSrc = entre(
  CONTENT,
  "function clasificarRespuestaConversacional(texto) {",
  "function cancelarAccionPendiente(accion) {"
);

const F = new Function(
  normalizarSrc + "\n" +
  // Stub: el bloqueo por términos sensibles (riesgo ALTO) lo cubre test-hito2g.
  "function contieneTerminosSensibles(){ return false; }\n" +
  riesgoSrc + "\n" + conversacionalSrc + "\n" +
  "return { clasificarRiesgoAccion, clasificarRespuestaConversacional };"
)();

// ============================================================
// [1] Fix 1 — toda búsqueda confirma: RESALTAR_CON_CONSULTA => MEDIO
// ============================================================
console.log("[1] clasificarRiesgoAccion — toda búsqueda escribe y confirma (MEDIO)");
const conConsulta = (texto) => F.clasificarRiesgoAccion({ tipo: "RESALTAR_CON_CONSULTA" }, texto);
eq(conConsulta("busca chatgpt"), "MEDIO", "'busca X' ya NO va directo -> MEDIO");
eq(conConsulta("quiero buscar receta de cazuela"), "MEDIO", "'quiero buscar X' -> MEDIO");
eq(conConsulta("quiero usar chatgpt"), "MEDIO", "'quiero usar X' -> MEDIO");
eq(conConsulta("quiero abrir youtube"), "MEDIO", "'quiero abrir X' -> MEDIO");
eq(conConsulta("abre gmail"), "MEDIO", "'abre X' -> MEDIO");
eq(conConsulta("noticias de hoy"), "MEDIO", "frase sin verbo -> MEDIO");
eq(conConsulta("Iky, busca chatgpt"), "MEDIO", "con prefijo wake-word -> MEDIO");
// Otros intents conservan su tier (no se tocan).
eq(F.clasificarRiesgoAccion({ tipo: "RESALTAR_BARRA" }, "donde escribo"), "BAJO", "RESALTAR_BARRA -> BAJO");
eq(F.clasificarRiesgoAccion({ tipo: "EXPLICAR_RESULTADOS" }, "que dice"), "BAJO", "EXPLICAR_RESULTADOS -> BAJO");
eq(F.clasificarRiesgoAccion({ tipo: "ABRIR_PRIMER_RESULTADO" }, "abre el primero"), "MEDIO", "ABRIR_PRIMER_RESULTADO -> MEDIO");

// ============================================================
// [2] Fix 2 — afirmación + palabras extra ya NO loopea
// ============================================================
console.log("\n[2] clasificarRespuestaConversacional — afirmaciones naturales");
eq(F.clasificarRespuestaConversacional("sí escríbelo"), "ACEPTACION", "'sí escríbelo' (antes null/LOOP)");
eq(F.clasificarRespuestaConversacional("sí busca eso"), "ACEPTACION", "'sí busca eso' -> ACEPTACION (acept gana a buscar)");
eq(F.clasificarRespuestaConversacional("ya po"), "ACEPTACION", "'ya po' (po es neutral)");
eq(F.clasificarRespuestaConversacional("claro que sí"), "ACEPTACION", "'claro que sí'");
eq(F.clasificarRespuestaConversacional("sí ábrelo po"), "ACEPTACION", "'sí ábrelo po'");
eq(F.clasificarRespuestaConversacional("ábrelo nomás"), "COMANDO_ABRIR", "'ábrelo nomás' -> COMANDO_ABRIR");
eq(F.clasificarRespuestaConversacional("búscalo ahora pues"), "COMANDO_BUSCAR", "'búscalo ahora pues' -> COMANDO_BUSCAR");

// ============================================================
// [3] Fix 2 — seguridad/precisión se conserva
// ============================================================
console.log("\n[3] precedencia del rechazo y caída a nueva intención");
eq(F.clasificarRespuestaConversacional("no"), "RECHAZO", "'no' -> RECHAZO");
eq(F.clasificarRespuestaConversacional("mejor no"), "RECHAZO", "'mejor no' -> RECHAZO");
eq(F.clasificarRespuestaConversacional("sí pero no"), "RECHAZO", "'sí pero no' -> rechazo gana a aceptación");
// Sin palabra accionable -> null (se trata como nueva intención, como antes)
eq(F.clasificarRespuestaConversacional("quiero usar youtube"), null, "'quiero usar youtube' -> null (nueva intención)");
eq(F.clasificarRespuestaConversacional("escribí chat juguete"), null, "'escribí chat juguete' -> null (nueva intención)");
eq(F.clasificarRespuestaConversacional("por favor gracias"), null, "solo neutrales -> null");
eq(F.clasificarRespuestaConversacional("cómo se usa esto"), null, "pregunta -> null");
// Casos base que ya funcionaban
eq(F.clasificarRespuestaConversacional("sí"), "ACEPTACION", "'sí' -> ACEPTACION");
eq(F.clasificarRespuestaConversacional("buscar ahora"), "COMANDO_BUSCAR", "'buscar ahora' -> COMANDO_BUSCAR");

console.log("\n" + (fallos === 0 ? "TODAS LAS ASERCIONES PASARON ✓" : (fallos + " ASERCION(ES) FALLARON ✗")));
process.exit(fallos === 0 ? 0 : 1);
