// Verificación read-only del HITO 2F (guía visual inteligente en páginas externas).
//
// NO modifica el código de producción: extrae los bloques EXACTOS de content.js
// y backend/server.js (por anclas de texto) y los ejecuta sobre stubs mínimos,
// SIN llamar a Groq. Cubre la lógica determinística:
//   - detectarIntentGuiaExterna: clasificador de intents comunes.
//   - rankearElementosParaIntent / puntuarElementoGuia: scoring + seguridad.
//   - Umbrales de confianza (alta/media/baja) sobre el mejor score.
//   - "no es ese": el ranking devuelve una lista ordenada (segundo candidato).
//   - Backend: sanearCandidatos (idx en rango, cap 5, truncado, score).
const fs = require("fs");

const CONTENT = fs.readFileSync("content.js", "utf8");
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
function eq(a, b, msg) {
  ok(JSON.stringify(a) === JSON.stringify(b), msg + "  (=> " + JSON.stringify(a) + ")");
}

// ============================================================
// FRONTEND — detección de intent + ranking (content.js)
// ============================================================

const normalizarSrc = entre(CONTENT, "function normalizar(texto) {", "function limpiarEspacios(texto) {");
const guiaSrc = entre(CONTENT, "const GUIA_INTENT = {", "// ---- Estado de la última guía local");

const retFront =
  " return { normalizar, detectarIntentGuiaExterna, rankearElementosParaIntent," +
  " puntuarElementoGuia, GUIA_INTENT, UMBRAL_GUIA_ALTA, UMBRAL_GUIA_MEDIA };";

const F = new Function(normalizarSrc + "\n" + guiaSrc + "\n" + retFront)();
const norm = F.normalizar;
const { GUIA_INTENT } = F;

// Helper: construye un elemento del resumen como lo hace construirResumenPaginaExterna.
function el(idx, tipo, texto, opts) {
  opts = opts || {};
  return {
    idx,
    tipo,
    texto: texto || null,
    ariaLabel: opts.ariaLabel || null,
    placeholder: opts.placeholder || null,
    tag: opts.tag || (tipo === "button" ? "BUTTON" : tipo === "link" ? "A" : "DIV"),
    rol: opts.rol || null,
    rect: opts.rect || { x: 100, y: 300, w: 120, h: 40 },
  };
}
const VP = { w: 1200, h: 800 };

// Clasifica la confianza igual que responderPreguntaSobrePagina.
function confianzaDe(score) {
  if (score >= F.UMBRAL_GUIA_ALTA) return "alta";
  if (score >= F.UMBRAL_GUIA_MEDIA) return "media";
  return "baja";
}

console.log("\n[1] detectarIntentGuiaExterna — intents soportados");
const casosIntent = [
  ["donde esta iniciar sesion", "LOGIN"],
  ["como ingreso", "LOGIN"],
  ["quiero acceder a mi cuenta", "LOGIN"],
  ["donde hago sign in", "LOGIN"],
  ["como continuo", "CONTINUAR"],
  ["como sigo desde aca", "CONTINUAR"],
  ["cual es el boton siguiente", "CONTINUAR"],
  ["como acepto", "ACEPTAR_COOKIES"],
  ["aceptar cookies", "ACEPTAR_COOKIES"],
  ["donde doy consentimiento", "ACEPTAR_COOKIES"],
  ["como cierro esta ventana", "CERRAR_POPUP"],
  ["cerrar este aviso", "CERRAR_POPUP"],
  ["donde esta el menu", "MENU"],
  ["donde esta la hamburguesa", "MENU"],
  ["donde busco en la pagina", "BUSCAR_EN_PAGINA"],
  ["donde busco", "BUSCAR_EN_PAGINA"],
  ["donde puedo buscar", "BUSCAR_EN_PAGINA"],
];
for (const [frase, esperado] of casosIntent) {
  eq(F.detectarIntentGuiaExterna(norm(frase)), GUIA_INTENT[esperado], 'intent "' + frase + '" -> ' + esperado);
}

console.log("\n[2] detectarIntentGuiaExterna — null cuando no hay intent claro");
// "donde puedo buscar <sección específica>" -> null: lo resuelve el asistente,
// no se marca el buscador (fix flujo de voz externa).
for (const frase of ["que boton debo apretar", "donde debo apretar", "que dice aqui", "explicame esta pagina", "cerrar sesion", "", "hola", "donde puedo buscar devoluciones", "donde puedo buscar mi pedido"]) {
  eq(F.detectarIntentGuiaExterna(norm(frase)), null, 'sin intent: "' + frase + '"');
}

console.log("\n[3] rankearElementosParaIntent — LOGIN: enlace arriba a la derecha = alta confianza");
{
  const elementos = [
    el(0, "link", "Iniciar sesión", { rect: { x: 1040, y: 20, w: 120, h: 40 } }),
    el(1, "button", "Buscar", { rect: { x: 500, y: 300, w: 80, h: 40 } }),
    el(2, "button", "Pagar ahora", { rect: { x: 600, y: 500, w: 120, h: 40 } }),
  ];
  const r = F.rankearElementosParaIntent(GUIA_INTENT.LOGIN, elementos, VP);
  eq(r[0] && r[0].idx, 0, "mejor candidato es el enlace de login (idx 0)");
  ok(r[0] && r[0].score >= F.UMBRAL_GUIA_ALTA, "score >= 60 (alta)  (=> " + (r[0] && r[0].score) + ")");
  ok(!r.some((c) => c.idx === 2), "el botón 'Pagar' nunca se propone (seguridad)");
  ok(!r.some((c) => c.idx === 1), "'Buscar' no es candidato de login (sin match de texto)");
}

console.log("\n[4] rankearElementosParaIntent — ACEPTAR_COOKIES: frase exacta > keyword");
{
  const elementos = [
    el(0, "button", "Aceptar todas las cookies", { rect: { x: 400, y: 620, w: 220, h: 44 } }),
    el(1, "button", "Aceptar", { rect: { x: 700, y: 620, w: 120, h: 44 } }),
    el(2, "link", "Política de privacidad", { rect: { x: 100, y: 700, w: 160, h: 20 } }),
  ];
  const r = F.rankearElementosParaIntent(GUIA_INTENT.ACEPTAR_COOKIES, elementos, VP);
  eq(r[0] && r[0].idx, 0, "'Aceptar todas las cookies' rankea primero (frase +50)");
  eq(confianzaDe(r[0].score), "alta", "frase exacta abajo -> alta  (=> " + r[0].score + ")");
  // El "Aceptar" simple es segundo candidato (sirve para 'no es ese').
  eq(r[1] && r[1].idx, 1, "segundo candidato es 'Aceptar' (para 'no es ese')");
  eq(confianzaDe(r[1].score), "media", "'Aceptar' simple -> media  (=> " + r[1].score + ")");
}

console.log("\n[5] rankearElementosParaIntent — MENU por aria-label (ícono arriba izquierda)");
{
  const elementos = [
    el(0, "button", null, { ariaLabel: "Menú", rol: "button", rect: { x: 16, y: 24, w: 44, h: 44 } }),
    el(1, "link", "Inicio", { rect: { x: 200, y: 24, w: 80, h: 30 } }),
  ];
  const r = F.rankearElementosParaIntent(GUIA_INTENT.MENU, elementos, VP);
  eq(r[0] && r[0].idx, 0, "el botón con aria-label 'Menú' rankea primero");
  eq(confianzaDe(r[0].score), "media", "menu por aria + posición -> media  (=> " + r[0].score + ")");
}

console.log("\n[6] rankearElementosParaIntent — CONTINUAR");
{
  const elementos = [el(0, "button", "Continuar", { rect: { x: 540, y: 400, w: 140, h: 44 } })];
  const r = F.rankearElementosParaIntent(GUIA_INTENT.CONTINUAR, elementos, VP);
  eq(r[0] && r[0].idx, 0, "'Continuar' es candidato");
  eq(confianzaDe(r[0].score), "media", "'Continuar' (keyword+boton+size) -> media  (=> " + r[0].score + ")");
}

console.log("\n[7] Baja confianza -> sin candidato fuerte (fallback IA)");
{
  // Intent LOGIN pero solo hay un texto que menciona 'entrar' en un 'other' chico.
  const elementos = [el(0, "other", "Entrar al detalle", { tag: "SPAN", rect: { x: 10, y: 500, w: 30, h: 12 } })];
  const r = F.rankearElementosParaIntent(GUIA_INTENT.LOGIN, elementos, VP);
  // keyword 'entrar' (35) sin bonus de tipo/posición/tamaño = 35 < 40.
  ok(r.length === 0 || confianzaDe(r[0].score) === "baja", "mejor score < 40 -> baja  (=> " + (r[0] && r[0].score) + ")");
}

console.log("\n[8] Seguridad: nunca se propone pago/banco aunque matchee el intent");
{
  const elementos = [
    el(0, "button", "Aceptar y pagar", { rect: { x: 400, y: 620, w: 180, h: 44 } }),
    el(1, "button", "Aceptar", { rect: { x: 700, y: 620, w: 120, h: 44 } }),
  ];
  const r = F.rankearElementosParaIntent(GUIA_INTENT.ACEPTAR_COOKIES, elementos, VP);
  ok(!r.some((c) => c.idx === 0), "'Aceptar y pagar' bloqueado por seguridad");
  eq(r[0] && r[0].idx, 1, "queda solo el 'Aceptar' inocente");
}

console.log("\n[9] Ranking ordenado desc + 'razon' presente");
{
  const elementos = [
    el(0, "button", "Aceptar", { rect: { x: 700, y: 620, w: 120, h: 44 } }),
    el(1, "button", "Aceptar todas", { rect: { x: 400, y: 620, w: 180, h: 44 } }),
  ];
  const r = F.rankearElementosParaIntent(GUIA_INTENT.ACEPTAR_COOKIES, elementos, VP);
  ok(r[0].score >= r[1].score, "ordenado por score desc");
  ok(typeof r[0].razon === "string" && r[0].razon.length > 0, "incluye razon breve  (=> \"" + r[0].razon + "\")");
}

console.log("\n[10] Umbrales declarados segun spec");
eq(F.UMBRAL_GUIA_ALTA, 60, "umbral alta = 60");
eq(F.UMBRAL_GUIA_MEDIA, 40, "umbral media = 40");

// ============================================================
// BACKEND — sanearCandidatos (server.js)
// ============================================================

console.log("\n[11] Backend: sanearCandidatos (idx en rango, cap 5, truncado, score)");
{
  const sanitizarSrc = entre(SERVER, "function sanitizarTextoBase(m, maxChars) {", "function sanitizarMensaje(m) {");
  const candSrc = entre(SERVER, "function sanearCandidatos(candidatos, paginaSegura) {", "// Sanea el historial del chat de página.");
  const B = new Function(
    "const EXPLICAR_PAGINA_MAX_CANDIDATOS = 5;\n" + sanitizarSrc + "\n" + candSrc + "\n return { sanearCandidatos };"
  )();

  const pag = { elementos: [{}, {}, {}] }; // length 3 -> idx válido 0..2

  const r1 = B.sanearCandidatos(
    [
      { idx: 0, texto: "Iniciar sesión", razon: "match login", score: 66.7 },
      { idx: 2, texto: "Aceptar", razon: "cookies", score: 55 },
      { idx: 5, texto: "fuera", razon: "x", score: 40 },   // fuera de rango
      { idx: -1, texto: "neg", razon: "x", score: 10 },     // negativo
      { idx: "1", texto: "str", razon: "x", score: 10 },    // no entero
      { idx: 1.5, texto: "float", razon: "x", score: 10 },  // no entero
    ],
    pag
  );
  eq(r1.map((c) => c.idx), [0, 2], "solo conserva idx enteros en rango");
  eq(r1[0].score, 67, "score se redondea (66.7 -> 67)");

  const largo = "a".repeat(200);
  const r2 = B.sanearCandidatos([{ idx: 0, texto: largo, razon: largo, score: 1 }], pag);
  ok(r2[0].texto.length <= 80, "texto se trunca a <=80  (=> " + r2[0].texto.length + ")");
  ok(r2[0].razon.length <= 120, "razon se trunca a <=120  (=> " + r2[0].razon.length + ")");

  const muchos = [];
  for (let i = 0; i < 8; i++) muchos.push({ idx: 0, texto: "x", razon: "y", score: 1 });
  eq(B.sanearCandidatos(muchos, pag).length, 5, "cap a 5 candidatos");

  eq(B.sanearCandidatos("no-array", pag), [], "input no-array -> []");
  eq(B.sanearCandidatos(undefined, pag), [], "undefined -> []");
}

// ============================================================
// INTEGRACIÓN DOM — construirResumenPaginaExterna -> ranking (content.js)
//
// Las secciones [3]-[9] rankean elementos fabricados a mano. Acá probamos
// la GRIETA real: que construirResumenPaginaExterna construya bien esos
// datos (rect/viewport, exclusión de password/invisibles/sin-descriptor)
// y que el ranking, alimentado por esos datos REALES, elija el idx correcto.
// Stubs de DOM hechos a mano (sin jsdom), al estilo de test-cursor-guia.js.
// ============================================================

console.log("\n[12] Integración DOM: construirResumenPaginaExterna -> rankearElementosParaIntent");
{
  const externaConsts = entre(CONTENT, "const EXTERNA_MAX_TEXTO = 2000;", "// Tiempo máximo para que el backend");
  const esVisibleSrc = entre(CONTENT, "function esVisible(el) {", "function puntuar(el) {");
  // Bloque contiguo: esCampoSensiblePagina + identificarTipoElementoPagina +
  // obtenerCamposSegurosPagina + rectDeElemento + construirResumenPaginaExterna.
  const bloqueElementos = entre(CONTENT, "function esCampoSensiblePagina(el) {", "// Resalta visualmente el elemento externo");

  const retDom =
    " return { construirResumenPaginaExterna, rankearElementosParaIntent," +
    " GUIA_INTENT, mapa: () => _elementosResaltablesMap };";

  const D = new Function("window", "document",
    normalizarSrc + "\n" + externaConsts + "\n" + esVisibleSrc + "\n" +
    "const _elementosResaltablesMap = new Map();\n" +
    bloqueElementos + "\n" + guiaSrc + "\n" + retDom
  );

  // --- Stub de elemento DOM (rect en coords del navegador: left/top/width/height) ---
  function fakeEl(o) {
    const attrs = o.attrs || {};
    const rect = o.rect || { left: 0, top: 0, width: 0, height: 0 };
    return {
      tagName: o.tag,
      type: o.type || "",
      autocomplete: o.autocomplete || "",
      disabled: !!o.disabled,
      textContent: o.texto || "",
      __style: { display: o.display || "block", visibility: "visible", opacity: "1" },
      getAttribute(n) { return n in attrs ? attrs[n] : null; },
      getBoundingClientRect() {
        return {
          left: rect.left, top: rect.top, width: rect.width, height: rect.height,
          right: rect.left + rect.width, bottom: rect.top + rect.height,
        };
      },
    };
  }

  // Fixture: "una página cualquiera" no sensible.
  const E1 = fakeEl({ tag: "A", texto: "Iniciar sesión", attrs: { href: "/login" }, rect: { left: 1040, top: 20, width: 130, height: 40 } });
  const E2 = fakeEl({ tag: "BUTTON", texto: "Aceptar todas las cookies", rect: { left: 380, top: 640, width: 240, height: 46 } });
  const E3 = fakeEl({ tag: "BUTTON", texto: "", attrs: { "aria-label": "Menú", role: "button" }, rect: { left: 16, top: 24, width: 44, height: 44 } });
  const E4 = fakeEl({ tag: "BUTTON", texto: "Continuar", rect: { left: 540, top: 420, width: 150, height: 46 } });
  const E5 = fakeEl({ tag: "BUTTON", texto: "Pagar ahora", rect: { left: 540, top: 520, width: 150, height: 46 } });
  const E6 = fakeEl({ tag: "INPUT", type: "password", attrs: { name: "clave", placeholder: "Contraseña" }, rect: { left: 540, top: 300, width: 200, height: 30 } }); // sensible
  const E7 = fakeEl({ tag: "BUTTON", texto: "Oculto", display: "none", rect: { left: 0, top: 0, width: 80, height: 30 } });                                          // invisible
  const E8 = fakeEl({ tag: "DIV", texto: "", rect: { left: 10, top: 700, width: 50, height: 20 } });                                                                  // sin descriptor
  const interactivos = [E1, E2, E3, E4, E5, E6, E7, E8];

  const docStub = {
    title: "Una página cualquiera",
    body: { innerText: "Bienvenido. Inicie sesión o continúe." },
    querySelectorAll(sel) { return /h1|h2|h3/.test(sel) ? [] : interactivos; },
  };
  const winStub = {
    innerWidth: 1200,
    innerHeight: 800,
    location: { origin: "https://ejemplo.cl", pathname: "/" },
    getComputedStyle(el) { return el.__style; },
  };

  const api = D(winStub, docStub);
  const pagina = api.construirResumenPaginaExterna();
  const mapa = api.mapa();

  // 1) Capa de datos
  eq(pagina.viewport, { w: 1200, h: 800 }, "viewport capturado del window");
  eq(pagina.elementos.length, 5, "incluye solo los 5 visibles con descriptor (E1..E5)");
  ok(
    pagina.elementos.every((e) => e.rect && ["x", "y", "w", "h"].every((k) => typeof e.rect[k] === "number")),
    "cada elemento trae rect numérico {x,y,w,h}"
  );
  ok(!pagina.elementos.some((e) => e.tag === "INPUT"), "input password (E6) excluido del resumen");
  ok(!pagina.elementos.some((e) => (e.texto || "") === "Oculto"), "botón oculto display:none (E7) excluido");
  ok(!pagina.elementos.some((e) => e.tag === "DIV"), "div sin descriptor (E8) excluido");
  eq(pagina.elementos.map((e) => e.idx), [0, 1, 2, 3, 4], "idx secuenciales 0..n-1");
  ok(pagina.elementos.every((e) => mapa.get(e.idx)), "mapa idx->elemento poblado para cada idx");

  // 2) Ranking sobre los datos REALES construidos arriba (no a mano)
  function ganador(intent) {
    return api.rankearElementosParaIntent(api.GUIA_INTENT[intent], pagina.elementos, pagina.viewport);
  }
  const rLogin = ganador("LOGIN");
  ok(rLogin[0] && mapa.get(rLogin[0].idx) === E1, "LOGIN -> enlace 'Iniciar sesión' (E1)  (idx " + (rLogin[0] && rLogin[0].idx) + ")");
  ok(rLogin[0] && rLogin[0].score >= 60, "LOGIN alta confianza  (=> " + (rLogin[0] && rLogin[0].score) + ")");

  const rCookies = ganador("ACEPTAR_COOKIES");
  ok(rCookies[0] && mapa.get(rCookies[0].idx) === E2, "ACEPTAR_COOKIES -> 'Aceptar todas las cookies' (E2)");
  ok(!rCookies.some((c) => mapa.get(c.idx) === E5), "'Pagar ahora' (E5) nunca es candidato (seguridad)");

  const rMenu = ganador("MENU");
  ok(rMenu[0] && mapa.get(rMenu[0].idx) === E3, "MENU -> ícono aria 'Menú' (E3)");

  const rCont = ganador("CONTINUAR");
  ok(rCont[0] && mapa.get(rCont[0].idx) === E4, "CONTINUAR -> 'Continuar' (E4)");
}

console.log("\n" + (fallos === 0 ? "TODAS LAS ASERCIONES PASARON ✓" : (fallos + " ASERCION(ES) FALLARON ✗")));
process.exit(fallos === 0 ? 0 : 1);
