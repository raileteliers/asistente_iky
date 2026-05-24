// Verificación read-only del HITO 2G (modo sensible reforzado en páginas externas).
//
// Cero dependencias: extrae bloques EXACTOS de content.js / backend/server.js
// por anclas de texto y los corre sobre stubs hechos a mano (sin Groq, sin
// navegador). Cubre:
//   [1] detectarSensibilidadPaginaExterna (señales URL + DOM, sin leer values).
//   [2] esPreguntaGuiaProhibidaSensible.
//   [3] intentPermitidoEnModoSensible (qué intents 2F se deshabilitan).
//   [4] esElementoSeguroEnModoSensible (qué elementos NO se resaltan).
//   [5] Backend sanearSeguridad.
//   [6] Ruteo end-to-end A–E con las funciones reales.
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
// Fábrica frontend: normalizar + términos sensibles + guía 2F + bloque 2G.
// window/document/esVisible/esPaginaSensitivaPorUrl/obtenerUrlKeyActual son
// inyectados (params) para poder variarlos por test.
// ============================================================
const normalizarSrc = entre(CONTENT, "function normalizar(texto) {", "function limpiarEspacios(texto) {");
const terminosSrc = entre(CONTENT, "const TERMINOS_SENSIBLES_PALABRAS = [", "const VERBOS_BUSQUEDA_DIRECTA = [");
const ctsSrc = entre(CONTENT, "function contieneTerminosSensibles(texto) {", "function esSugerenciaVolverAGoogle(texto) {");
const guiaSrc = entre(CONTENT, "const GUIA_INTENT = {", "// ---- Estado de la última guía local");
const dosGsrc = entre(CONTENT, "const AVISO_SENSIBLE =", "// Timeout cliente del chat de página.");

const ret =
  " return { detectarSensibilidadPaginaExterna, esPreguntaGuiaProhibidaSensible," +
  " intentPermitidoEnModoSensible, esElementoSeguroEnModoSensible," +
  " detectarIntentGuiaExterna, rankearElementosParaIntent, contieneTerminosSensibles," +
  " GUIA_INTENT, normalizar };";

const factory = new Function(
  "window", "document", "esVisible", "esPaginaSensitivaPorUrl", "obtenerUrlKeyActual",
  normalizarSrc + "\n" + terminosSrc + "\n" + ctsSrc + "\n" + guiaSrc + "\n" + dosGsrc + "\n" + ret
);

// --- Stubs de DOM ---
function esVisibleStub(el) { return !!el && el.__visible !== false; }
function fakeForm(nCampos, visible) {
  return { __visible: visible !== false, querySelectorAll: () => new Array(nCampos) };
}
function fakeBtn(texto, aria, visible) {
  return {
    __visible: visible !== false,
    textContent: texto || "",
    getAttribute: (n) => (n === "aria-label" ? (aria || null) : null),
  };
}
function fakeIframe(src, title, visible) {
  return { __visible: visible !== false, getAttribute: (n) => (n === "src" ? (src || "") : n === "title" ? (title || "") : null) };
}
// docStub: define qué devuelve cada querySelector(All) por selector.
function makeDoc(opts) {
  opts = opts || {};
  return {
    body: { innerText: opts.bodyText || "" },
    querySelector(sel) {
      if (sel.includes('type="password"')) return opts.password || null;
      if (sel.includes("autocomplete=")) return opts.cc || null;
      return null;
    },
    querySelectorAll(sel) {
      if (sel === "form") return opts.forms || [];
      if (sel === "iframe") return opts.iframes || [];
      if (sel.includes("button")) return opts.buttons || [];
      return [];
    },
  };
}
function makeWin(host, path) {
  return { location: { hostname: host || "ejemplo.cl", pathname: path || "/" } };
}
// Instancia el frontend con stubs concretos.
function inst(opts) {
  opts = opts || {};
  return factory(
    makeWin(opts.host, opts.path),
    makeDoc(opts.doc || {}),
    esVisibleStub,
    opts.esPaginaSensitivaPorUrl || (() => false),
    () => "k"
  );
}

// ============================================================
// [1] detectarSensibilidadPaginaExterna
// ============================================================
console.log("\n[1] detectarSensibilidadPaginaExterna — señales URL + DOM");
{
  // password input visible -> ALTO
  let F = inst({ doc: { password: { __visible: true } } });
  let r = F.detectarSensibilidadPaginaExterna();
  eq(r.nivel, "ALTO", "input password visible -> ALTO");
  ok(r.esSensible && r.razones.includes("input-password-visible"), "razón input-password-visible");

  // password NO visible -> no escala por DOM
  F = inst({ doc: { password: { __visible: false } } });
  eq(F.detectarSensibilidadPaginaExterna().nivel, "BAJO", "password oculto no escala");

  // autocomplete de tarjeta -> ALTO
  F = inst({ doc: { cc: {} } });
  eq(F.detectarSensibilidadPaginaExterna().nivel, "ALTO", "autocomplete cc-/current-password -> ALTO");

  // texto visible con datos de tarjeta -> ALTO
  F = inst({ doc: { bodyText: "Ingrese el número de tarjeta y el CVV" } });
  eq(F.detectarSensibilidadPaginaExterna().nivel, "ALTO", "texto con 'cvv'/'numero de tarjeta' -> ALTO");

  // URL con señal fuerte (banco) -> ALTO
  F = inst({ host: "www.banco-falso.cl" });
  eq(F.detectarSensibilidadPaginaExterna().nivel, "ALTO", "host con 'banco' -> ALTO");

  // URL con señal de login -> MEDIO
  F = inst({ host: "tienda.cl", path: "/login" });
  eq(F.detectarSensibilidadPaginaExterna().nivel, "MEDIO", "path '/login' -> MEDIO");

  // esPaginaSensitivaPorUrl (lista base) -> al menos MEDIO
  F = inst({ esPaginaSensitivaPorUrl: () => true });
  ok(F.detectarSensibilidadPaginaExterna().esSensible, "lista base -> sensible");

  // formulario con >=3 campos + botón acción -> MEDIO
  F = inst({ doc: { forms: [fakeForm(4, true)], buttons: [fakeBtn("Confirmar compra")] } });
  eq(F.detectarSensibilidadPaginaExterna().nivel, "MEDIO", "form 4 campos + 'Confirmar' -> MEDIO");

  // iframe de pago visible -> MEDIO
  F = inst({ doc: { iframes: [fakeIframe("https://webpay.cl/checkout", "")] } });
  eq(F.detectarSensibilidadPaginaExterna().nivel, "MEDIO", "iframe webpay/checkout -> MEDIO");

  // página benigna -> NO sensible
  F = inst({ host: "noticias.cl", path: "/articulo/123", doc: { buttons: [fakeBtn("Leer más")], bodyText: "Hoy llueve en Santiago" } });
  r = F.detectarSensibilidadPaginaExterna();
  ok(!r.esSensible && r.nivel === "BAJO", "página de noticias -> BAJO, no sensible");

  // razones nunca contienen datos del usuario (solo etiquetas con [a-z-])
  F = inst({ doc: { password: { __visible: true }, bodyText: "mi clave secreta es 1234" } });
  ok(F.detectarSensibilidadPaginaExterna().razones.every((x) => /^[a-z-]+$/.test(x)), "razones son etiquetas genéricas (sin datos)");
}

// ============================================================
// [2] esPreguntaGuiaProhibidaSensible
// ============================================================
console.log("\n[2] esPreguntaGuiaProhibidaSensible");
{
  const F = inst();
  const n = F.normalizar;
  const PROH = ["como inicio sesion", "donde inicio de sesion", "como ingreso", "quiero entrar a mi cuenta", "como continuo", "cual es el siguiente", "como confirmo", "donde me registro para crear cuenta"];
  for (const p of PROH) ok(F.esPreguntaGuiaProhibidaSensible(n(p)), 'prohibida: "' + p + '"');
  const OK = ["que dice esta pagina", "que opciones hay", "esto es oficial", "donde esta la ayuda", "como acepto las cookies", "que es esto"];
  for (const p of OK) ok(!F.esPreguntaGuiaProhibidaSensible(n(p)), 'permitida (explicación): "' + p + '"');
}

// ============================================================
// [3] intentPermitidoEnModoSensible
// ============================================================
console.log("\n[3] intentPermitidoEnModoSensible — intents deshabilitados");
{
  const F = inst();
  const G = F.GUIA_INTENT;
  const pagCookies = { elementos: [{ texto: "Aceptar todas las cookies" }] };
  const pagSinCookies = { elementos: [{ texto: "Continuar" }] };

  ok(!F.intentPermitidoEnModoSensible(G.LOGIN, "ALTO", pagSinCookies, ""), "LOGIN bloqueado (ALTO)");
  ok(!F.intentPermitidoEnModoSensible(G.LOGIN, "MEDIO", pagSinCookies, ""), "LOGIN bloqueado (MEDIO)");
  ok(!F.intentPermitidoEnModoSensible(G.CONTINUAR, "MEDIO", pagSinCookies, ""), "CONTINUAR bloqueado");
  ok(F.intentPermitidoEnModoSensible(G.MENU, "ALTO", pagSinCookies, ""), "MENU permitido (ALTO)");
  ok(F.intentPermitidoEnModoSensible(G.CERRAR_POPUP, "ALTO", pagSinCookies, ""), "CERRAR_POPUP permitido (ALTO)");
  ok(!F.intentPermitidoEnModoSensible(G.ACEPTAR_COOKIES, "ALTO", pagCookies, F.normalizar("acepta cookies")), "ACEPTAR_COOKIES bloqueado en ALTO");
  ok(F.intentPermitidoEnModoSensible(G.ACEPTAR_COOKIES, "MEDIO", pagCookies, F.normalizar("acepta cookies")), "ACEPTAR_COOKIES permitido en MEDIO si es banner de cookies");
  ok(!F.intentPermitidoEnModoSensible(G.ACEPTAR_COOKIES, "MEDIO", pagSinCookies, ""), "ACEPTAR_COOKIES bloqueado en MEDIO si NO se ve que es cookies");
}

// ============================================================
// [4] esElementoSeguroEnModoSensible
// ============================================================
console.log("\n[4] esElementoSeguroEnModoSensible — elementos peligrosos");
{
  const F = inst();
  // input nunca
  ok(!F.esElementoSeguroEnModoSensible({ tipo: "input", placeholder: "Usuario" }, "MEDIO"), "input nunca se resalta");
  // acciones peligrosas nunca
  ok(!F.esElementoSeguroEnModoSensible({ tipo: "button", texto: "Iniciar sesión" }, "MEDIO"), "'Iniciar sesión' nunca");
  ok(!F.esElementoSeguroEnModoSensible({ tipo: "button", texto: "Pagar ahora" }, "MEDIO"), "'Pagar' nunca");
  ok(!F.esElementoSeguroEnModoSensible({ tipo: "button", texto: "Continuar" }, "MEDIO"), "'Continuar' nunca");
  // secciones seguras
  ok(F.esElementoSeguroEnModoSensible({ tipo: "link", texto: "Ayuda" }, "ALTO"), "'Ayuda' seguro (ALTO)");
  ok(F.esElementoSeguroEnModoSensible({ tipo: "link", texto: "Contacto" }, "ALTO"), "'Contacto' seguro (ALTO)");
  ok(F.esElementoSeguroEnModoSensible({ tipo: "button", texto: "Cerrar", ariaLabel: "Cerrar" }, "ALTO"), "'Cerrar' seguro (ALTO)");
  // en ALTO, un texto neutro NO listado no es seguro
  ok(!F.esElementoSeguroEnModoSensible({ tipo: "link", texto: "Ver catálogo" }, "ALTO"), "texto neutro no listado -> no seguro en ALTO");
  // en MEDIO, basta con no ser acción peligrosa
  ok(F.esElementoSeguroEnModoSensible({ tipo: "link", texto: "Ver catálogo" }, "MEDIO"), "texto neutro -> seguro en MEDIO");
  ok(F.esElementoSeguroEnModoSensible({ tipo: "button", texto: "Aceptar todas las cookies" }, "MEDIO"), "botón cookies -> seguro en MEDIO");
}

// ============================================================
// [5] Backend: sanearSeguridad
// ============================================================
console.log("\n[5] Backend: sanearSeguridad");
{
  const sanitizarSrc = entre(SERVER, "function sanitizarTextoBase(m, maxChars) {", "function sanitizarMensaje(m) {");
  const segSrc = entre(SERVER, "function sanearSeguridad(seguridad) {", "// Sanea el historial del chat de página.");
  const B = new Function(sanitizarSrc + "\n" + segSrc + "\n return { sanearSeguridad };")();

  eq(B.sanearSeguridad(null), null, "null -> null");
  eq(B.sanearSeguridad({ esSensible: false }), null, "esSensible:false -> null");
  eq(B.sanearSeguridad("x"), null, "no-objeto -> null");
  const r1 = B.sanearSeguridad({ esSensible: true, nivel: "ALTO", razones: ["input-password-visible", "url-banco"] });
  eq(r1.nivel, "ALTO", "nivel ALTO conservado");
  eq(r1.razones, ["input-password-visible", "url-banco"], "razones conservadas");
  eq(B.sanearSeguridad({ esSensible: true, nivel: "RARO" }).nivel, "MEDIO", "nivel inválido -> MEDIO");
  const r2 = B.sanearSeguridad({ esSensible: true, nivel: "MEDIO", razones: ["ok", 123, null, "dos"] });
  eq(r2.razones, ["ok", "dos"], "razones no-string descartadas");
  const muchas = []; for (let i = 0; i < 12; i++) muchas.push("r" + i);
  eq(B.sanearSeguridad({ esSensible: true, nivel: "MEDIO", razones: muchas }).razones.length, 8, "razones cap a 8");
}

// ============================================================
// [6] Ruteo end-to-end A–E (con funciones reales)
// ============================================================
console.log("\n[6] Ruteo end-to-end A–E");
{
  const F = inst();
  const G = F.GUIA_INTENT;
  // Reproduce el árbol de manejarPregunta + responderPreguntaSobrePagina.
  function rutear(texto, modo, pagina) {
    if (F.contieneTerminosSensibles(texto)) return "BLOQUEO_ALTO_UPSTREAM";
    const t = F.normalizar(texto);
    if (modo.esSensible) {
      if (F.esPreguntaGuiaProhibidaSensible(t)) return "RECHAZO_GUIA_SENSIBLE";
      const intent = F.detectarIntentGuiaExterna(t);
      if (intent && !F.intentPermitidoEnModoSensible(intent, modo.nivel, pagina, t)) return "RECHAZO_INTENT:" + intent;
      if (intent) {
        const r = F.rankearElementosParaIntent(intent, pagina.elementos, pagina.viewport)
          .filter((c) => F.esElementoSeguroEnModoSensible(pagina.elementos[c.idx], modo.nivel));
        if (r[0] && r[0].score >= 40) return "GUIA_SEGURA:" + intent + ":idx" + r[0].idx;
      }
      return "EXPLICAR_BACKEND_SENSIBLE(sin resaltar)";
    }
    // No sensible: 2F normal
    const intent = F.detectarIntentGuiaExterna(t);
    if (intent) {
      const r = F.rankearElementosParaIntent(intent, pagina.elementos, pagina.viewport);
      if (r[0] && r[0].score >= 40) return "GUIA_2F:" + intent + ":idx" + r[0].idx;
    }
    return "FALLBACK_IA";
  }

  function el(idx, tipo, texto, rect) { return { idx, tipo, texto, ariaLabel: null, placeholder: null, rect: rect || { x: 100, y: 100, w: 120, h: 40 } }; }
  const VP = { w: 1200, h: 800 };
  const noSensible = { esSensible: false, nivel: "BAJO" };
  const sensibleAlto = { esSensible: true, nivel: "ALTO" };
  const sensibleMedio = { esSensible: true, nivel: "MEDIO" };

  // A) Página NO sensible -> 2F funciona como antes
  const pagA = { viewport: VP, elementos: [el(0, "link", "Iniciar sesión", { x: 1040, y: 20, w: 130, h: 40 })] };
  eq(rutear("dónde está iniciar sesión", noSensible, pagA), "GUIA_2F:LOGIN:idx0", "A) no sensible: 2F guía LOGIN");

  // B) Login (ALTO)
  const pagB = { viewport: VP, elementos: [el(0, "link", "Iniciar sesión"), el(1, "link", "Ayuda", { x: 1100, y: 10, w: 60, h: 30 })] };
  eq(rutear("dónde inicio sesión", sensibleAlto, pagB), "RECHAZO_GUIA_SENSIBLE", "B) ALTO: rechaza guiar login");
  eq(rutear("qué dice esta página", sensibleAlto, pagB), "EXPLICAR_BACKEND_SENSIBLE(sin resaltar)", "B) ALTO: explica general");

  // C) Checkout (ALTO)
  const pagC = { viewport: VP, elementos: [el(0, "link", "Ayuda", { x: 1100, y: 10, w: 60, h: 30 })] };
  eq(rutear("qué botón aprieto para pagar", sensibleAlto, pagC), "BLOQUEO_ALTO_UPSTREAM", "C) 'pagar' -> bloqueo upstream");
  eq(rutear("dónde está ayuda", sensibleAlto, pagC), "EXPLICAR_BACKEND_SENSIBLE(sin resaltar)", "C) 'ayuda' -> explicación (sin resaltar acción)");

  // D) Cookies banner en página sensible MEDIO
  const pagD = { viewport: VP, elementos: [el(0, "button", "Aceptar todas las cookies", { x: 380, y: 640, w: 240, h: 46 })] };
  eq(rutear("acepta cookies", sensibleMedio, pagD), "GUIA_SEGURA:ACEPTAR_COOKIES:idx0", "D) MEDIO + banner cookies -> resalta aceptar");
  // Si el mismo intent llega en ALTO -> bloqueado
  eq(rutear("acepta cookies", sensibleAlto, pagD), "RECHAZO_INTENT:ACEPTAR_COOKIES", "D) ALTO -> ni cookies");

  // E) Privacidad: el payload de seguridad no transporta datos del usuario
  //    (razones genéricas, validado en [1]) y construirResumen no envía
  //    .value ni HTML (validado en test-hito2f [12]).
  ok(true, "E) privacidad: razones genéricas [1] + sin .value/HTML (test-hito2f [12])");
}

console.log("\n" + (fallos === 0 ? "TODAS LAS ASERCIONES PASARON ✓" : (fallos + " ASERCION(ES) FALLARON ✗")));
process.exit(fallos === 0 ? 0 : 1);
