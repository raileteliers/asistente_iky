// HITO V3 — "otra opción / otro resultado" + re-explicar/localizar con Groq.
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

// ---- Bloques reales de producción ----
const normalizarSrc = entre(CONTENT, "function normalizar(texto) {", "function limpiarEspacios(texto) {");
const detectorSrc = entre(CONTENT, "function detectarMicroIntencionOtraOpcion(textoNorm) {", "async function manejarOtraOpcion(texto) {");
const manejarOtraSrc = entre(CONTENT, "async function manejarOtraOpcion(texto) {", "function marcarSiguienteResultadoGoogle() {");
const marcarSrc = entre(CONTENT, "function marcarSiguienteResultadoGoogle() {", "function tieneContenidoExtraEnCorreccion(textoNorm) {");
const contenidoExtraSrc = entre(CONTENT, "function tieneContenidoExtraEnCorreccion(textoNorm) {", "async function localizarSeccionConGroq(texto) {");
const colectorSrc = entre(CONTENT, "function recolectarResultadosGoogle() {", "function encontrarPrimerResultadoConEnlace() {");
const repetirSrc = entre(CONTENT, "async function manejarRepetirOSimplificar() {", "function detectarMicroIntencionQueHago(textoNorm) {");

const normalizar = new Function(`${normalizarSrc}; return normalizar;`)();
const detectarMicroIntencionOtraOpcion = new Function(`${detectorSrc}; return detectarMicroIntencionOtraOpcion;`)();
const tieneContenidoExtraEnCorreccion = new Function(`${contenidoExtraSrc}; return tieneContenidoExtraEnCorreccion;`)();

// ============================================================
// [1] detectarMicroIntencionOtraOpcion — frases soportadas
// ============================================================
console.log("\n[1] detectarMicroIntencionOtraOpcion — debe detectar (con/sin tilde)");
const soportadas = [
  "otro", "muéstrame otro", "muestrame otro", "otro resultado",
  "quiero elegir otro resultado", "otra opción", "otra opcion",
  "el siguiente", "siguiente",
  "no es ese", "no es esa", "no era ese", "ese no", "esa no", "no, ese no",
  "más abajo", "mas abajo", "más arriba", "mas arriba",
];
for (const f of soportadas) ok(detectarMicroIntencionOtraOpcion(normalizar(f)), `"${f}" -> detecta`);

console.log("\n[2] No matchea cancelaciones ni otros hitos");
const negativas = [
  "no", "no gracias", "cancela", "cancelar", "mejor no",   // cancelación → debe seguir cancelando
  "otra vez", "no entendí", "repítelo", "más simple",       // V1
  "que sigue", "qué hago ahora", "cuál miro",               // V2
  "nosotros", "hola", "busca recetas", "abrir el menú", "",  // irrelevantes
];
for (const f of negativas) ok(!detectarMicroIntencionOtraOpcion(normalizar(f)), `"${f}" -> NO detecta`);

// ============================================================
// [3] tieneContenidoExtraEnCorreccion — corrección pura vs mixta
// ============================================================
console.log("\n[3] tieneContenidoExtraEnCorreccion");
for (const f of ["no es ese", "otro", "el siguiente", "ese no", "más abajo", "otra opcion"]) {
  ok(!tieneContenidoExtraEnCorreccion(normalizar(f)), `"${f}" -> sin contenido extra`);
}
for (const f of ["no es ese, el de devoluciones", "otro, el botón de ayuda", "muéstrame el de contacto"]) {
  ok(tieneContenidoExtraEnCorreccion(normalizar(f)), `"${f}" -> tiene contenido extra`);
}

// ============================================================
// [4] recolectarResultadosGoogle / encontrarResultadoGooglePorIndice
// ============================================================
console.log("\n[4] recolectar resultados Google (N-ésimo + dedup por contenedor)");
{
  const esVisible = (el) => !!(el && el._vis);
  function link(href, container, opts = {}) {
    const h3 = { _vis: opts.h3vis !== false };
    return {
      _href: href, href,
      _h3: opts.noH3 ? null : h3,
      _container: container,
      _vis: opts.vis !== false,
      querySelector(sel) { return sel === "h3" ? this._h3 : null; },
      getAttribute(a) { return a === "href" ? this._href : null; },
      closest(sel) { return sel === ".g" ? this._container : null; },
      parentElement: container,
    };
  }
  const cA = { id: "A" }, cB = { id: "B" }, cC = { id: "C" };
  const links = [
    link("https://uno.cl/x", cA),
    link("https://dos.cl/y", cB),
    link("https://uno.cl/x-sitelink", cA),   // mismo contenedor → deduplicado
    link("javascript:void(0)", cC),          // descartado (javascript:)
    link("https://tres.cl/z", cC, { vis: false }), // descartado (no visible)
  ];
  const scope = { querySelectorAll: (s) => (s === "a" ? links : []) };
  const document = { querySelector: (s) => (s === "#rso" ? scope : null) };

  const colector = new Function("document", "esVisible",
    `${colectorSrc}; return { recolectarResultadosGoogle, encontrarResultadoGooglePorIndice };`
  )(document, esVisible);

  const todos = colector.recolectarResultadosGoogle();
  eq(todos.length, 2, "deduplica sitelink y descarta javascript:/oculto -> 2 resultados");
  eq(todos[0].contenedor.id, "A", "primer resultado = contenedor A");
  eq(todos[1].contenedor.id, "B", "segundo resultado = contenedor B");
  eq(colector.encontrarResultadoGooglePorIndice(0).contenedor.id, "A", "índice 0 -> A");
  eq(colector.encontrarResultadoGooglePorIndice(1).contenedor.id, "B", "índice 1 -> B");
  eq(colector.encontrarResultadoGooglePorIndice(2), null, "índice 2 -> null (no hay más)");
}

// ============================================================
// [5] marcarSiguienteResultadoGoogle — avanza, re-apunta abrir, sin backend
// ============================================================
console.log("\n[5] marcarSiguienteResultadoGoogle");
function makeMarcar(resultados, startIdx) {
  const calls = { mensajes: [], resaltados: [], acciones: [] };
  const api = new Function(
    "encontrarResultadoGooglePorIndice", "agregarMensaje", "resaltar", "mostrarAccionAbrirPrimerResultado",
    `let indiceResultadoGoogleMarcado = ${startIdx};\n${marcarSrc}\n` +
    "return { marcar: marcarSiguienteResultadoGoogle, idx: () => indiceResultadoGoogleMarcado };"
  )(
    (i) => resultados[i] || null,
    (m) => calls.mensajes.push(m),
    (c) => calls.resaltados.push(c),
    (r) => calls.acciones.push(r),
  );
  return { api, calls };
}
{
  const r0 = { contenedor: "c0", url: "u0" }, r1 = { contenedor: "c1", url: "u1" };
  // cold "otro" (índice -1) marca el PRIMERO
  const cold = makeMarcar([r0, r1], -1);
  eq(cold.api.marcar(), true, "cold -> consume (true)");
  eq(cold.api.idx(), 0, "cold avanza a índice 0 (primer resultado)");
  eq(cold.calls.acciones[0], r0, "re-apunta acción de abrir al nuevo resultado (r0)");
  eq(cold.calls.mensajes[0], "Le marqué otro resultado.", "mensaje de marcado");
  // tras explicar (índice 0) -> marca el SEGUNDO
  const next = makeMarcar([r0, r1], 0);
  next.api.marcar();
  eq(next.api.idx(), 1, "avanza a índice 1 (segundo resultado)");
  eq(next.calls.acciones[0], r1, "re-apunta abrir a r1");
  // sin más resultados
  const fin = makeMarcar([r0, r1], 1);
  eq(fin.api.marcar(), true, "agotado -> consume igual (true)");
  eq(fin.api.idx(), 1, "no avanza el índice cuando no hay más");
  eq(fin.calls.mensajes[0], "No veo otro resultado claro.", "mensaje de agotado");
  eq(fin.calls.acciones.length, 0, "agotado no re-apunta ninguna acción de abrir");
}

// ============================================================
// [6] manejarOtraOpcion — ruteo (Google vs externa, sin/ con candidatos)
// ============================================================
function makeManejarOtra(deps) {
  const log = { marcar: 0, correccion: [], localizar: 0 };
  const api = new Function(
    "esPaginaExterna", "estaEnPaginaResultados", "marcarSiguienteResultadoGoogle",
    "_resetGuiaSiCambioUrl", "_guiaCandidatos", "normalizar",
    "tieneContenidoExtraEnCorreccion", "localizarSeccionConGroq",
    "manejarCorreccionGuia", "esCorreccionGuia",
    `${manejarOtraSrc}\n return manejarOtraOpcion;`
  )(
    () => deps.externa,
    () => deps.resultados,
    () => { log.marcar++; return true; },
    () => {},
    deps.candidatos || [],
    normalizar,
    tieneContenidoExtraEnCorreccion,
    async () => { log.localizar++; return true; },
    async (dir) => { log.correccion.push(dir); },
    (norm) => (/no es ese|ese no|\botro\b/.test(norm) ? "siguiente" : null),
  );
  return { api, log };
}

// ============================================================
// [7] manejarRepetirOSimplificar (V1) — re-explica la opción marcada vía Groq
// ============================================================
function makeRepetir(deps) {
  const log = { consultar: [], responder: [], explicarRes: 0, mensajes: [] };
  const api = new Function(
    "esPaginaExterna", "_resetGuiaSiCambioUrl", "_guiaCandidatos", "_guiaPos",
    "obtenerResumenCacheadoOFresco", "actualizarModoSensible", "consultarExplicarPagina",
    "responderPreguntaSobrePagina", "estaEnPaginaResultados", "ejecutarIntencion", "agregarMensaje",
    `${repetirSrc}\n return manejarRepetirOSimplificar;`
  )(
    () => deps.externa,
    () => {},
    deps.candidatos || [],
    deps.pos != null ? deps.pos : -1,
    () => ({ elementos: deps.elementos || [] }),
    () => ({ esSensible: !!deps.sensible }),
    async (texto, opts) => { log.consultar.push({ texto, opts }); },
    async (texto) => { log.responder.push(texto); },
    () => deps.resultados,
    (intencion) => { log.explicarRes++; },
    (m) => log.mensajes.push(m),
  );
  return { api, log };
}

(async () => {
  console.log("\n[6] manejarOtraOpcion — ruteo");
  // Google home (no resultados) -> no consume
  let m = makeManejarOtra({ externa: false, resultados: false });
  ok((await m.api("otro")) === false, "Google home -> false (no consume)");

  // Google resultados -> marca
  m = makeManejarOtra({ externa: false, resultados: true });
  eq(await m.api("otro"), true, "Google resultados -> true");
  eq(m.log.marcar, 1, "Google resultados llama a marcarSiguienteResultadoGoogle");

  // Externa sin guía activa -> no consume
  m = makeManejarOtra({ externa: true, candidatos: [] });
  ok((await m.api("otro")) === false, "Externa sin candidatos -> false (no consume)");

  // Externa con candidatos, corrección pura -> delega en manejarCorreccionGuia
  m = makeManejarOtra({ externa: true, candidatos: [{ idx: 0 }, { idx: 1 }] });
  eq(await m.api("no es ese"), true, "Externa + corrección pura -> true");
  eq(m.log.correccion, ["siguiente"], "delega en manejarCorreccionGuia('siguiente')");
  eq(m.log.localizar, 0, "no llama a Groq en corrección pura");

  // Externa con candidatos + contenido extra -> localiza con Groq
  m = makeManejarOtra({ externa: true, candidatos: [{ idx: 0 }, { idx: 1 }] });
  eq(await m.api("no es ese, el de devoluciones"), true, "Externa + contenido extra -> true");
  eq(m.log.localizar, 1, "caso mixto llama a localizarSeccionConGroq");
  eq(m.log.correccion.length, 0, "caso mixto NO cicla a ciegas");

  // ----- [7] manejarRepetirOSimplificar — re-explica la opción marcada vía Groq -----
  console.log("\n[7] manejarRepetirOSimplificar — re-explicar opción marcada");
  // Externa con opción marcada -> consultarExplicarPagina enfocada, sin mover resaltado
  let r = makeRepetir({ externa: true, candidatos: [{ idx: 0 }], pos: 0, elementos: [{ texto: "Devoluciones" }] });
  await r.api();
  eq(r.log.consultar.length, 1, "re-explica vía consultarExplicarPagina");
  ok(r.log.consultar[0].texto.includes("Devoluciones"), "la pregunta a Groq menciona la etiqueta marcada");
  eq(r.log.consultar[0].opts.permitirResaltar, false, "no mueve el resaltado (permitirResaltar:false)");
  ok(!r.log.consultar[0].opts.seguridad, "no sensible -> sin flag de seguridad");

  // Externa sensible -> pasa el flag de seguridad
  r = makeRepetir({ externa: true, sensible: true, candidatos: [{ idx: 0 }], pos: 0, elementos: [{ texto: "Ayuda" }] });
  await r.api();
  ok(r.log.consultar[0].opts.seguridad && r.log.consultar[0].opts.seguridad.esSensible, "sensible -> pasa seguridad");

  // Externa SIN opción marcada -> fallback general
  r = makeRepetir({ externa: true, candidatos: [], pos: -1 });
  await r.api();
  eq(r.log.consultar.length, 0, "sin opción marcada no usa la vía enfocada");
  eq(r.log.responder, ["Explíquelo de nuevo de forma más simple."], "cae al re-explicar general");

  // Google resultados -> EXPLICAR_RESULTADOS local
  r = makeRepetir({ externa: false, resultados: true });
  await r.api();
  eq(r.log.explicarRes, 1, "Google resultados -> ejecutarIntencion(EXPLICAR_RESULTADOS)");

  console.log("\n" + (fallos === 0 ? "TODAS LAS ASERCIONES PASARON ✓" : (fallos + " ASERCION(ES) FALLARON ✗")));
  process.exit(fallos === 0 ? 0 : 1);
})();
