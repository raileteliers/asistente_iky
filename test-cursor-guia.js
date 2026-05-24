// Prueba aislada del módulo "cursor virtual de guía" + "modo compacto" (HITOs 3 y 4).
//
// NO reimplementa la lógica: extrae el bloque EXACTO de content.js (desde la
// declaración de _cursorGuiaTimer hasta antes de renderMensaje, que abarca el
// cursor y el modo compacto) y lo ejecuta sobre stubs mínimos del DOM con un
// reloj falso determinista.
const fs = require("fs");

// --- Extraer el módulo desde content.js (anclas de texto) ---
const fuente = fs.readFileSync("content.js", "utf8");
const ini = fuente.indexOf("  let _cursorGuiaTimer = null;");
const fin = fuente.indexOf("  function renderMensaje(", ini);
if (ini < 0 || fin < 0 || fin <= ini) {
  throw new Error("No pude delimitar el módulo por anclas de texto.");
}
const slice = fuente.slice(ini, fin);
for (const f of ["mostrarCursorGuiaHaciaElemento", "limpiarGuiasVisuales",
                 "setCompacto", "autoCompactarSiTapa"]) {
  if (!new RegExp("function " + f).test(slice)) {
    throw new Error("La extracción no contiene " + f + ".");
  }
}

// --- Reloj falso determinista para setTimeout/clearTimeout ---
let now = 0;
let timers = [];
let seq = 0;
global.setTimeout = (fn, ms) => {
  const id = { id: ++seq, fn, at: now + (ms || 0) };
  timers.push(id);
  return id;
};
global.clearTimeout = (id) => { timers = timers.filter((t) => t !== id); };
function tick(ms) {
  const hasta = now + ms;
  let guard = 0;
  while (true) {
    const due = timers.filter((t) => t.at <= hasta).sort((a, b) => a.at - b.at);
    if (due.length === 0) break;
    const t = due[0];
    timers = timers.filter((x) => x !== t);
    now = t.at;
    t.fn();
    if (++guard > 1000) throw new Error("loop de timers");
  }
  now = hasta;
}

// --- Stubs de DOM ---
function fakeClassList() {
  const set = new Set();
  return {
    add: (...c) => c.forEach((x) => set.add(x)),
    remove: (...c) => c.forEach((x) => set.delete(x)),
    contains: (c) => set.has(c),
    toggle: (c, on) => { if (on) set.add(c); else set.delete(c); },
    _set: set,
  };
}
function rect(l, t, w, h) {
  return { left: l, top: t, width: w, height: h, right: l + w, bottom: t + h };
}
const cursorGuia = {
  id: "ag-cursor",
  classList: fakeClassList(),
  style: { display: "none", transform: "" },
  offsetWidth: 0,
};
// Panel cuyo rect cambia según esté compacto y/o reubicado a la izquierda.
// Expandido: x[1000,1360] y[200,600]. Compacto (anclado abajo): y[520,600].
const panel = {
  classList: fakeClassList(),
  getBoundingClientRect() {
    const left = this.classList.contains("ag-panel-izquierda") ? 24 : 1000;
    return this.classList.contains("ag-panel-compacto")
      ? rect(left, 520, 360, 80)
      : rect(left, 200, 360, 400);
  },
};
const btnMinimizar = {
  textContent: "Minimizar",
  _attrs: {},
  setAttribute(k, v) { this._attrs[k] = v; },
};
let resaltados = [];
const documentStub = {
  querySelectorAll: (sel) => (sel === ".ag-resaltado" ? resaltados.slice() : []),
};
let reduceMotion = false;
const windowStub = {
  innerWidth: 1280,
  innerHeight: 800,
  matchMedia: (q) => ({ matches: /reduce/.test(q) ? reduceMotion : false }),
};
let sensible = false;
function esPaginaSensitivaPorUrl() { return sensible; }
function esVisible(el) { return !el || el.__visible !== false; }

// --- Cargar el módulo real con esos stubs en alcance ---
const ret = " return { mostrarCursorGuiaHaciaElemento, ocultarCursorGuia," +
  " limpiarGuiasVisuales, prefiereMenosMovimiento, puntoOrigenCursor, setCompacto," +
  " autoCompactarSiTapa, rectsIntersectan," +
  " _estado: () => ({ compactoAuto: _compactoAuto, controlManualTs: _controlManualTs })," +
  " _marcarManual: () => { _controlManualTs = Date.now(); } };";
const fabrica = new Function(
  "cursorGuia", "panel", "btnMinimizar", "document", "window", "esVisible",
  "esPaginaSensitivaPorUrl", slice + "\n" + ret
);
let M;
function nuevaInstancia() {
  M = fabrica(cursorGuia, panel, btnMinimizar, documentStub, windowStub,
              esVisible, esPaginaSensitivaPorUrl);
}

// --- Aserciones / helpers ---
let fallos = 0;
function ok(cond, msg) {
  console.log((cond ? "  ✓ " : "  ✗ ") + msg);
  if (!cond) fallos++;
}
function elementoEn(x, y, w, h) {
  return { getBoundingClientRect: () => rect(x, y, w, h), __visible: true };
}
function reset() {
  timers = []; now = 0;
  cursorGuia.style.display = "none";
  cursorGuia.style.transform = "";
  cursorGuia.classList._set.clear();
  panel.classList._set.clear();
  resaltados = [];
  reduceMotion = false;
  sensible = false;
  windowStub.innerWidth = 1280;
  btnMinimizar.textContent = "Minimizar";
  nuevaInstancia(); // estado interno fresco (_compactoAuto, _controlManualTs, timers)
}

// =====================  CURSOR (HITO 3)  =====================

console.log("\n[A] Externa normal: cursor viaja al elemento y pulsa al llegar");
reset();
const elA = elementoEn(300, 400, 120, 40); // centro (360,420); no toca el panel
M.mostrarCursorGuiaHaciaElemento(elA);
ok(cursorGuia.style.display === "block", "el cursor se muestra (display:block)");
ok(/translate\(1000px, 400px\)/.test(cursorGuia.style.transform),
   "nace desde la zona del panel: " + cursorGuia.style.transform);
tick(420);
ok(/translate\(360px, 420px\)/.test(cursorGuia.style.transform),
   "viaja al CENTRO del elemento (360,420): " + cursorGuia.style.transform);
ok(!cursorGuia.classList.contains("ag-cursor-pulso"), "aún no pulsa (viaje en curso)");
tick(950);
ok(cursorGuia.classList.contains("ag-cursor-pulso"), "pulsa al llegar (animación normal)");

console.log("\n[B] Cambio de objetivo: re-guiar limpia y apunta al nuevo elemento");
const elB = elementoEn(50, 50, 200, 50); // centro (150,75)
M.mostrarCursorGuiaHaciaElemento(elB);
ok(!cursorGuia.classList.contains("ag-cursor-pulso"), "el pulso anterior se limpia al re-guiar");
tick(420);
ok(/translate\(150px, 75px\)/.test(cursorGuia.style.transform),
   "apunta al nuevo elemento (150,75): " + cursorGuia.style.transform);

console.log("\n[C] Ocultar (cerrar panel): cursor desaparece de inmediato");
M.ocultarCursorGuia();
ok(cursorGuia.style.display === "none", "display:none inmediato");
ok(timers.length === 0, "no quedan timers colgados");

console.log("\n[D] limpiarGuiasVisuales: quita resaltado + cursor");
reset();
resaltados = [{ classList: (function () { const c = fakeClassList(); c.add("ag-resaltado"); return c; })() }];
M.mostrarCursorGuiaHaciaElemento(elementoEn(300, 400, 120, 40));
tick(420);
M.limpiarGuiasVisuales();
ok(cursorGuia.style.display === "none", "cursor oculto");
ok(!resaltados[0].classList.contains("ag-resaltado"), "se removió .ag-resaltado");

console.log("\n[E] Reduced motion: salto directo + halo estático (sin pulso)");
reset();
reduceMotion = true;
M.mostrarCursorGuiaHaciaElemento(elementoEn(300, 400, 120, 40));
tick(60);
ok(/translate\(360px, 420px\)/.test(cursorGuia.style.transform), "salto directo al destino");
ok(cursorGuia.classList.contains("ag-cursor-estatico"), "halo ESTÁTICO");
ok(!cursorGuia.classList.contains("ag-cursor-pulso"), "NO usa pulso animado");

console.log("\n[F] Página sensible: halo estático (sin pulso agresivo)");
reset();
sensible = true;
M.mostrarCursorGuiaHaciaElemento(elementoEn(300, 400, 120, 40));
tick(420); tick(950);
ok(cursorGuia.classList.contains("ag-cursor-estatico"), "halo estático en página sensible");
ok(!cursorGuia.classList.contains("ag-cursor-pulso"), "sin pulso agresivo");

// =====================  MODO COMPACTO (HITO 4)  =====================

console.log("\n[H] Auto-compacta cuando el panel EXPANDIDO tapa el objetivo");
reset();
// Elemento sobre el panel expandido (y[250,350]) pero NO sobre el compacto (y[520,600]).
M.mostrarCursorGuiaHaciaElemento(elementoEn(1050, 250, 150, 100));
tick(420);
ok(panel.classList.contains("ag-panel-compacto"), "panel se compacta");
ok(!panel.classList.contains("ag-panel-izquierda"), "no necesita reubicar (compacto ya despeja)");
ok(M._estado().compactoAuto === true, "marcado como compactación automática");
ok(btnMinimizar.textContent === "Expandir", "el botón ahora ofrece Expandir");

console.log("\n[I] NO compacta cuando no hay intersección");
reset();
M.mostrarCursorGuiaHaciaElemento(elementoEn(100, 100, 100, 50)); // lejos del panel
tick(420);
ok(!panel.classList.contains("ag-panel-compacto"), "panel sigue expandido");
ok(M._estado().compactoAuto === false, "no marca auto-compacto");

console.log("\n[J] Respeta control manual reciente (no auto-compacta)");
reset();
M._marcarManual(); // simula que el usuario tocó Minimizar/Expandir recién
M.mostrarCursorGuiaHaciaElemento(elementoEn(1050, 250, 150, 100)); // tapa el panel
tick(420);
ok(!panel.classList.contains("ag-panel-compacto"), "respeta al usuario: no toca el panel");

console.log("\n[K] limpiarGuiasVisuales restaura el panel si fue auto-compactado");
reset();
M.mostrarCursorGuiaHaciaElemento(elementoEn(1050, 250, 150, 100));
tick(420);
ok(panel.classList.contains("ag-panel-compacto"), "precondición: quedó compacto");
M.limpiarGuiasVisuales();
ok(!panel.classList.contains("ag-panel-compacto"), "se restauró a expandido");
ok(M._estado().compactoAuto === false, "estado auto reseteado");

console.log("\n[L] Reubica a la izquierda si compacto AÚN tapa el objetivo");
reset();
// Elemento en la franja inferior-derecha: tapa expandido y compacto-derecha,
// pero no compacto-izquierda (x[24,384]).
M.mostrarCursorGuiaHaciaElemento(elementoEn(1100, 540, 150, 50));
tick(420);
ok(panel.classList.contains("ag-panel-compacto"), "compactó primero");
ok(panel.classList.contains("ag-panel-izquierda"), "reubicó a la izquierda para despejar");

console.log("\n[M] En pantalla angosta NO reubica (panel es full-width)");
reset();
windowStub.innerWidth = 480;
M.mostrarCursorGuiaHaciaElemento(elementoEn(1100, 540, 150, 50));
tick(420);
ok(panel.classList.contains("ag-panel-compacto"), "compacta igual");
ok(!panel.classList.contains("ag-panel-izquierda"), "no reubica en pantalla angosta");

console.log("\n" + (fallos === 0 ? "TODAS LAS ASERCIONES PASARON ✓" : (fallos + " ASERCIÓN(ES) FALLARON ✗")));
process.exit(fallos === 0 ? 0 : 1);
