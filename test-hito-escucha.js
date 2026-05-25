// Verificación read-only de los timers del modo escucha (Ítem 2):
//   - Ventana conversacional (sin "Iky") = 15s.
//   - Cierre automático del micrófono = 20s desde el último turno.
//   - Ambos timers se reinician en cada turno (re-llamada a activarVentana...).
//
// Cero dependencias: extrae los bloques EXACTOS de content.js por anclas de texto
// y los corre sobre stubs (Date.now / setTimeout / clearTimeout falsos), igual que
// las otras suites. Sin navegador, sin temporizadores reales.
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
const constsSrc = entre(CONTENT, "const VENTANA_CONVERSACION_MS", "// Estado conversacional:");
const funcsSrc = entre(
  CONTENT,
  "function activarVentanaConversacion() {",
  "function manejarResultadoModoEscucha(event) {"
);

// Stubs: reloj y temporizadores controlables, más las dependencias que las
// funciones tocan (actualizarEstadoMic, detenerModoEscucha, modoEscuchaActivado).
const stubs =
  "let now = 1000;" +
  "const Date = { now: () => now };" +
  "const console = { debug: () => {} };" +
  "let timers = []; let _nextId = 1;" +
  "function setTimeout(fn, ms){ const id = _nextId++; timers.push({ id, fn, at: now + ms, ms }); return id; }" +
  "function clearTimeout(id){ timers = timers.filter(t => t.id !== id); }" +
  "let _detenerCount = 0;" +
  "function detenerModoEscucha(){ _detenerCount++; cerrarVentanaConversacion(); }" +
  "function actualizarEstadoMic(){}" +
  "let modoEscuchaActivado = true;" +
  "function reset(){ timers = []; _detenerCount = 0; now = 1000; modoEscuchaActivado = true;" +
  "  conversacionActivaHasta = 0; ventanaConversacionTimer = null; cierreMicTimer = null; }";

const F = new Function(
  stubs + "\n" + constsSrc + "\n" + funcsSrc + "\n" +
  "return {" +
  "  activarVentanaConversacion, conversacionActiva, cerrarVentanaConversacion, reset," +
  "  setNow: (v) => { now = v; }," +
  "  advance: (ms) => { now += ms; }," +
  "  setModo: (v) => { modoEscuchaActivado = v; }," +
  "  fireDue: () => { const due = timers.filter(t => t.at <= now); timers = timers.filter(t => t.at > now); due.forEach(t => t.fn()); }," +
  "  pendingTimers: () => timers.map(t => t.ms)," +
  "  detenerCalls: () => _detenerCount" +
  "};"
)();

// ============================================================
// [1] Ventana = 15s; se programan dos timers (15s + 20s)
// ============================================================
console.log("[1] activarVentanaConversacion — ventana 15s + cierre 20s");
F.reset();
F.activarVentanaConversacion();
ok(F.conversacionActiva(), "tras activar: ventana activa");
eq(F.pendingTimers().slice().sort((a, b) => a - b), [15000, 20000], "dos timers: ventana 15s + cierre 20s");
F.advance(14999);
ok(F.conversacionActiva(), "a los 14999ms: aún activa (sin 'Iky')");
F.advance(1);
ok(!F.conversacionActiva(), "a los 15000ms: ventana cerrada (vuelve a pedir 'Iky')");

// ============================================================
// [2] El micrófono se cierra a los 20s
// ============================================================
console.log("\n[2] cierre de micrófono a los 20s");
F.reset();
F.activarVentanaConversacion();
F.advance(20000);
F.fireDue();
eq(F.detenerCalls(), 1, "a los 20000ms se llama a detenerModoEscucha una vez");
ok(!F.conversacionActiva(), "tras cerrar: ventana inactiva");

// ============================================================
// [3] Cada turno reinicia ambos timers (no se acumulan)
// ============================================================
console.log("\n[3] reinicio en cada turno");
F.reset();
F.activarVentanaConversacion();
F.advance(10000);
F.activarVentanaConversacion(); // nuevo turno antes de expirar
eq(F.pendingTimers().length, 2, "re-activar reinicia: siguen 2 timers (no 4)");
ok(F.conversacionActiva(), "tras re-activar: ventana activa de nuevo");

// ============================================================
// [4] cerrarVentanaConversacion limpia ambos timers
// ============================================================
console.log("\n[4] cerrarVentanaConversacion limpia todo");
F.reset();
F.activarVentanaConversacion();
F.cerrarVentanaConversacion();
eq(F.pendingTimers().length, 0, "cerrar limpia los dos timers");
ok(!F.conversacionActiva(), "cerrar: ventana inactiva");

// ============================================================
// [5] El cierre respeta el guard: si el modo escucha ya está apagado, no cierra
// ============================================================
console.log("\n[5] guard: modo escucha apagado no dispara cierre");
F.reset();
F.setModo(false);
F.activarVentanaConversacion();
F.advance(20000);
F.fireDue();
eq(F.detenerCalls(), 0, "con modo escucha apagado el callback NO cierra el mic");

console.log("\n" + (fallos === 0 ? "TODAS LAS ASERCIONES PASARON ✓" : (fallos + " ASERCION(ES) FALLARON ✗")));
process.exit(fallos === 0 ? 0 : 1);
