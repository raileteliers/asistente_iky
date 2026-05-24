// Verificación read-only del HITO 2E (memoria + seguimiento en páginas externas).
//
// NO modifica el código de producción: extrae los bloques EXACTOS de content.js
// y backend/server.js (por anclas de texto) y los ejecuta sobre stubs mínimos,
// SIN llamar a Groq. Cubre las tareas verificables por lógica pura:
//   - Memoria por pestaña (cap 10, reset por urlKey, persistencia segura).
//   - historialReciente = últimos 4.
//   - Cache del resumen (no reconstruye si urlKey no cambió / sin forzar).
//   - Detectores: seguimiento, actualizar, sensibles.
//   - Backend: saneo de historial, validación de mensaje (≤400, anti-tags,
//     anti-acción-prematura) y de elementoAResaltar (rango/entero/null).
const fs = require("fs");

const CONTENT = fs.readFileSync("content.js", "utf8");
const SERVER = fs.readFileSync("backend/server.js", "utf8");

// Extrae fuente[desde inicioDe(a) .. inicioDe(b)). Verifica que ambas anclas existan.
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
function eq(a, b, msg) { ok(JSON.stringify(a) === JSON.stringify(b), msg + "  (=> " + JSON.stringify(a) + ")"); }

// ============================================================
// FRONTEND — memoria, cache y detectores (content.js)
// ============================================================

// Bloque de constantes reales (valores que pide la spec).
const constsFront = entre(CONTENT, 'const CHAT_PAGINA_KEY = "AG_CHAT_PAGINA_V1";', "const EXTERNA_MAX_ELEMENTOS = 30;")
  + "const EXTERNA_MAX_ELEMENTOS = 30;";
// Bloque contiguo: chatPagina init + helpers de memoria/cache/detectores.
const memoria = entre(CONTENT, "let chatPagina = obtenerChatPaginaInicial();", "function esCampoSensiblePagina(el) {");

const retFront =
  " return { CHAT_PAGINA_KEY, HISTORIAL_CHAT_MAX, HISTORIAL_BACKEND_MAX," +
  " EXTERNA_MAX_TEXTO, EXTERNA_MAX_ENCABEZADOS, EXTERNA_MAX_ELEMENTOS," +
  " agregarTurnoChat, obtenerHistorialReciente, asegurarHistorialPaginaActual," +
  " obtenerResumenCacheadoOFresco, esPreguntaDeSeguimiento, esComandoActualizar," +
  " esSoloComandoActualizar, _chat: () => chatPagina };";

const fabricaFront = new Function(
  "window", "sessionStorage", "construirResumenPaginaExterna",
  constsFront + "\n" + memoria + "\n" + retFront
);

// Stubs
function nuevaSessionStorage(seed) {
  const store = seed ? { "AG_CHAT_PAGINA_V1": seed } : {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    _raw: () => store["AG_CHAT_PAGINA_V1"],
  };
}
function nuevaWindow(urlKey) {
  const [origin, ...rest] = [urlKey.replace(/(https?:\/\/[^/]+)(.*)/, "$1"), urlKey.replace(/(https?:\/\/[^/]+)(.*)/, "$2")];
  return { location: { origin, pathname: rest.join("") || "/" } };
}
let resumenCalls = 0;
const construirResumenStub = () => { resumenCalls++; return { resumen: "n" + resumenCalls }; };

function instFront(urlKey, seed) {
  resumenCalls = 0;
  return fabricaFront(nuevaWindow(urlKey), nuevaSessionStorage(seed), construirResumenStub);
}

console.log("\n[T1] Memoria por pestaña: cap 10, persistencia segura, cap por mensaje");
{
  const ss = nuevaSessionStorage();
  const M = fabricaFront(nuevaWindow("https://sitio.cl/articulo"), ss, construirResumenStub);
  for (let i = 0; i < 12; i++) M.agregarTurnoChat(i % 2 ? "asistente" : "usuario", "turno " + i);
  eq(M._chat().historial.length, 10, "historial se capa a HISTORIAL_CHAT_MAX (10)");
  eq(M.HISTORIAL_CHAT_MAX, 10, "constante real HISTORIAL_CHAT_MAX = 10");
  const persist = JSON.parse(ss._raw());
  eq(Object.keys(persist).sort(), ["historial", "urlKey"], "sessionStorage SOLO guarda {historial, urlKey}");
  ok(!/textoVisible|elementos|encabezados/.test(ss._raw()), "NO persiste textoVisible/elementos/encabezados (DOM)");
  M.agregarTurnoChat("usuario", "x".repeat(600));
  const ultimo = M._chat().historial[M._chat().historial.length - 1];
  eq(ultimo.texto.length, 400, "cap por mensaje = 400 chars (spec pedía 300: ver reporte)");
}

console.log("\n[T1b] Reset de historial al cambiar urlKey (navegación)");
{
  const M = instFront("https://sitio.cl/a");
  M.agregarTurnoChat("usuario", "hola");
  ok(M._chat().historial.length === 1, "hay 1 turno en /a");
  // Simular navegación a otra ruta
  M._chat().urlKey; // no-op
  // Cambiamos la URL del window stub reusando una nueva instancia que comparte storage no aplica;
  // probamos directamente asegurar con urlKey distinto via objeto window mutado:
}
{
  const ss = nuevaSessionStorage();
  const win = nuevaWindow("https://sitio.cl/a");
  const M = fabricaFront(win, ss, construirResumenStub);
  M.agregarTurnoChat("usuario", "hola en /a");
  win.location.pathname = "/b"; // navegación SPA
  M.asegurarHistorialPaginaActual();
  eq(M._chat().historial, [], "historial se resetea al cambiar pathname");
  eq(M._chat().urlKey, "https://sitio.cl/b", "urlKey se actualiza a la nueva ruta");
}

console.log("\n[T1c] Carga inicial desde sessionStorage (coincide urlKey, filtra turnos inválidos)");
{
  const seed = JSON.stringify({
    urlKey: "https://sitio.cl/a",
    historial: [
      { rol: "usuario", texto: "valido" },
      { rol: "hacker", texto: "rol invalido" },   // se descarta
      { rol: "asistente", texto: 123 },             // texto no-string: se descarta
      { rol: "asistente", texto: "ok" },
    ],
  });
  const M = instFront("https://sitio.cl/a", seed);
  eq(M._chat().historial.map((t) => t.texto), ["valido", "ok"], "carga solo turnos válidos");
}

console.log("\n[T6] historialReciente = últimos 4 (HISTORIAL_BACKEND_MAX)");
{
  const M = instFront("https://sitio.cl/a");
  for (let i = 0; i < 6; i++) M.agregarTurnoChat("usuario", "m" + i);
  eq(M.HISTORIAL_BACKEND_MAX, 4, "constante real HISTORIAL_BACKEND_MAX = 4");
  eq(M.obtenerHistorialReciente().map((t) => t.texto), ["m2", "m3", "m4", "m5"], "devuelve los últimos 4");
}

console.log("\n[T2/F] Cache del resumen: no reconstruye salvo cambio de urlKey o forzar");
{
  const ss = nuevaSessionStorage();
  const win = nuevaWindow("https://sitio.cl/a");
  resumenCalls = 0;
  const M = fabricaFront(win, ss, construirResumenStub);
  M.obtenerResumenCacheadoOFresco(false); // construye (1)
  M.obtenerResumenCacheadoOFresco(false); // cache (sigue 1)
  M.obtenerResumenCacheadoOFresco(false); // cache (sigue 1)
  eq(resumenCalls, 1, "3 preguntas seguidas -> 1 sola construcción del resumen (cache)");
  M.obtenerResumenCacheadoOFresco(true);  // forzar -> reconstruye (2)
  eq(resumenCalls, 2, "forzar (actualiza) reconstruye");
  win.location.pathname = "/b";
  M.obtenerResumenCacheadoOFresco(false); // urlKey cambió -> reconstruye (3)
  eq(resumenCalls, 3, "cambio de urlKey reconstruye");
  eq(M.EXTERNA_MAX_TEXTO, 2000, "límite real textoVisible = 2000");
  eq(M.EXTERNA_MAX_ENCABEZADOS, 10, "límite real encabezados = 10");
  eq(M.EXTERNA_MAX_ELEMENTOS, 30, "límite real elementos = 30");
}

console.log("\n[T3] esPreguntaDeSeguimiento (entrada normalizada, sin tildes)");
{
  const M = instFront("https://sitio.cl/a");
  for (const s of ["y ahora", "ahora que hago", "donde esta eso", "cual boton", "no entendi", "repitelo"]) {
    ok(M.esPreguntaDeSeguimiento(s) === true, "detecta seguimiento: \"" + s + "\"");
  }
  ok(M.esPreguntaDeSeguimiento("explicame los precios") === false, "no marca pregunta normal");
  // GAPS vs spec (no afectan comportamiento: el historial se envía siempre que exista)
  for (const g of ["explicalo de nuevo", "mas simple", "no se"]) {
    ok(M.esPreguntaDeSeguimiento(g) === false, "GAP conocido: NO detecta \"" + g + "\" (solo telemetría)");
  }
}

console.log("\n[T7] Comando actualizar / solo-actualizar");
{
  const M = instFront("https://sitio.cl/a");
  ok(M.esComandoActualizar("actualiza la pagina") === true, "esComandoActualizar(\"actualiza la pagina\")");
  ok(M.esComandoActualizar("relee") === true, "esComandoActualizar(\"relee\")");
  ok(M.esComandoActualizar("vuelve a mirar esto") === true, "detecta dentro de frase");
  ok(M.esComandoActualizar("explicame esto") === false, "no marca pregunta normal");
  ok(M.esSoloComandoActualizar("actualiza la pagina") === true, "esSoloComandoActualizar exacto");
  ok(M.esSoloComandoActualizar("actualiza y dime los precios") === false, "no marca si trae otra pregunta");
}

// ============================================================
// FRONTEND — bloqueo local de sensibles (content.js)
// ============================================================
console.log("\n[T4] contieneTerminosSensibles (bloqueo local antes de IA)");
{
  const terminos = entre(CONTENT, "const TERMINOS_SENSIBLES_PALABRAS = [", "const VERBOS_BUSQUEDA_DIRECTA = [");
  const normalizar = entre(CONTENT, "function normalizar(texto) {", "function limpiarEspacios(texto) {");
  const cts = entre(CONTENT, "function contieneTerminosSensibles(texto) {", "function esSugerenciaVolverAGoogle(texto) {");
  const S = (new Function(terminos + "\n" + normalizar + "\n" + cts +
    "\n return { contieneTerminosSensibles };"))();
  for (const s of ["paga esto", "mi clave es 1234", "transfiere plata", "usa mi tarjeta", "comprar ahora"]) {
    ok(S.contieneTerminosSensibles(s) === true, "BLOQUEA sensible: \"" + s + "\"");
  }
  for (const s of ["explicame esta pagina", "donde esta el boton de inicio", "que dice aqui"]) {
    ok(S.contieneTerminosSensibles(s) === false, "permite pregunta segura: \"" + s + "\"");
  }
}

// ============================================================
// BACKEND — saneo y validación (backend/server.js)
// ============================================================
console.log("\n[T5] Backend: saneo de historial + validación de respuesta");
{
  const { contieneAccionPrematura } = require("./backend/safety-rules.js");
  const prefijo =
    'const EXPLICAR_PAGINA_MAX_RESPUESTA = 400;' +
    'const EXPLICAR_PAGINA_MAX_HISTORIAL = 4;' +
    'const EXPLICAR_PAGINA_MAX_TURNO_HISTORIAL = 400;' +
    'const RESPUESTA_PAGINA_NO_SEGURO = "__NO_SEGURO__";';
  const sanitizarTextoBase = entre(SERVER, "function sanitizarTextoBase(m, maxChars) {", "function sanitizarMensaje(m) {");
  const validacion = entre(SERVER, "function sanearHistorialPagina(historial) {", "async function explicarPaginaHandler(req, res) {");
  const B = (new Function("contieneAccionPrematura",
    prefijo + "\n" + sanitizarTextoBase + "\n" + validacion +
    "\n return { sanearHistorialPagina, validarRespuestaPagina, NO_SEGURO: RESPUESTA_PAGINA_NO_SEGURO };"
  ))(contieneAccionPrematura);

  const pag3 = { elementos: [{}, {}, {}] }; // idx válidos 0..2

  // mensaje
  const r1 = B.validarRespuestaPagina({ mensaje: "a".repeat(600), elementoAResaltar: null }, pag3);
  ok(r1.mensaje.length <= 400 && r1.mensaje.endsWith("..."), "mensaje > 400 se trunca a ≤400 con …");
  const r2 = B.validarRespuestaPagina({ mensaje: "<script>alert(1)</script>", elementoAResaltar: null }, pag3);
  ok(r2.mensaje === B.NO_SEGURO, "mensaje con <script> -> fallback seguro");
  const r3 = B.validarRespuestaPagina({ mensaje: 'hola <img on" onerror=alert(1)>', elementoAResaltar: null }, pag3);
  ok(r3.mensaje === B.NO_SEGURO, "mensaje con handler on*= -> fallback seguro");
  const r4 = B.validarRespuestaPagina({ mensaje: "El precio es < 10 lucas", elementoAResaltar: null }, pag3);
  ok(r4.mensaje === "El precio es 10 lucas", "strip de <,> sin descartar texto inocente");
  const r5 = B.validarRespuestaPagina({ mensaje: "Hice clic en el botón Aceptar por usted", elementoAResaltar: null }, pag3);
  ok(r5.mensaje === B.NO_SEGURO, "mensaje con acción prematura (\"hice clic\") -> fallback");

  // elementoAResaltar
  eq(B.validarRespuestaPagina({ mensaje: "ok", elementoAResaltar: 1 }, pag3).elementoAResaltar, 1, "idx válido (1) se conserva");
  eq(B.validarRespuestaPagina({ mensaje: "ok", elementoAResaltar: 5 }, pag3).elementoAResaltar, null, "idx fuera de rango -> null");
  eq(B.validarRespuestaPagina({ mensaje: "ok", elementoAResaltar: -1 }, pag3).elementoAResaltar, null, "idx negativo -> null");
  eq(B.validarRespuestaPagina({ mensaje: "ok", elementoAResaltar: "2" }, pag3).elementoAResaltar, null, "idx no-entero (string) -> null");
  eq(B.validarRespuestaPagina({ mensaje: "ok", elementoAResaltar: null }, pag3).elementoAResaltar, null, "idx null -> null");
  ok(B.validarRespuestaPagina(null, pag3).mensaje === B.NO_SEGURO, "raw inválido -> fallback seguro");

  // historial
  const h = B.sanearHistorialPagina([
    { rol: "usuario", texto: "  hola   mundo  " },
    { rol: "malo", texto: "x" },              // rol inválido -> fuera
    { rol: "asistente", texto: 99 },           // texto no-string -> fuera
    { rol: "asistente", texto: "respuesta 1" },
    { rol: "usuario", texto: "p2" },
    { rol: "asistente", texto: "r2" },
    { rol: "usuario", texto: "p3" },
  ]);
  ok(h.length <= 4, "historial saneado se capa a ≤4 turnos");
  ok(h.every((t) => t.rol === "usuario" || t.rol === "asistente"), "todos los roles válidos");
  ok(!h.some((t) => typeof t.texto !== "string"), "todos los textos son string");
  eq(B.sanearHistorialPagina("no-array"), [], "input no-array -> []");
}

console.log("\n" + (fallos === 0 ? "TODAS LAS ASERCIONES PASARON ✓" : (fallos + " ASERCIÓN(ES) FALLARON ✗")));
process.exit(fallos === 0 ? 0 : 1);
