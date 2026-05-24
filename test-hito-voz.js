// Verificación read-only del fix de flujo de voz (Google):
//   Fix 1 — "quiero usar/abrir X" ejecuta directo (riesgo BAJO), no MEDIO.
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
const verbosSrc = entre(CONTENT, "const VERBOS_BUSQUEDA_DIRECTA = [", "// ---- Branding");
const palabrasSrc = entre(CONTENT, "const AG_PALABRAS_CLAVE_ESCUCHA = [", "const AG_SALUDO_VISIBLE");
const normalizarSrc = entre(CONTENT, "function normalizar(texto) {", "function limpiarEspacios(texto) {");
const busquedaSrc = entre(CONTENT, "function esBusquedaDirecta(texto) {", "// Devuelve \"BAJO\"");
const conversacionalSrc = entre(
  CONTENT,
  "function clasificarRespuestaConversacional(texto) {",
  "function cancelarAccionPendiente(accion) {"
);

const F = new Function(
  palabrasSrc + "\n" + verbosSrc + "\n" + normalizarSrc + "\n" +
  busquedaSrc + "\n" + conversacionalSrc + "\n" +
  "return { esBusquedaDirecta, clasificarRespuestaConversacional };"
)();

// ============================================================
// [1] Fix 1 — "quiero usar/abrir X" es búsqueda directa (=> BAJO)
// ============================================================
console.log("[1] esBusquedaDirecta — uso/acceso directo");
ok(F.esBusquedaDirecta("quiero usar chatgpt"), "'quiero usar X' -> directo (BAJO)");
ok(F.esBusquedaDirecta("quiero usar chat juguete"), "transcripción real del log -> directo");
ok(F.esBusquedaDirecta("quiero abrir youtube"), "'quiero abrir X' -> directo");
ok(F.esBusquedaDirecta("quiero ir a youtube"), "'quiero ir a X' -> directo");
ok(F.esBusquedaDirecta("quiero entrar a gmail"), "'quiero entrar a X' -> directo");
ok(F.esBusquedaDirecta("necesito usar maps"), "'necesito usar X' -> directo");
ok(F.esBusquedaDirecta("abre youtube"), "'abre X' -> directo");
ok(F.esBusquedaDirecta("Iky, quiero usar chatgpt"), "prefijo wake-word se limpia -> directo");
// No deben ejecutarse directo (siguen MEDIO/según intent)
ok(!F.esBusquedaDirecta("ahora qué hago"), "frase neutra sin verbo -> NO directo");
ok(!F.esBusquedaDirecta("dónde escribo"), "pregunta de ubicación -> NO directo");
// Las de búsqueda explícita siguen funcionando
ok(F.esBusquedaDirecta("busca chatgpt"), "'busca X' sigue siendo directo");
ok(F.esBusquedaDirecta("quiero buscar receta de cazuela"), "'quiero buscar X' sigue directo");

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
