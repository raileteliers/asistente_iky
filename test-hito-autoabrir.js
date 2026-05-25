// Verificación read-only de la bandera de auto-apertura (Ítem 3):
//   autoAbrirEsFresca(ts, ahora) — decide si la marca guardada en
//   chrome.storage.local es lo bastante reciente para abrir Iky solo en la
//   página de destino. Solo se testea la parte pura; marcar/consumir dependen
//   de chrome.storage y van por QA manual.
//
// Cero dependencias: extrae el bloque EXACTO de content.js por anclas de texto.
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

// Bloque real: const AUTO_ABRIR_VENTANA_MS + function autoAbrirEsFresca.
const src = entre(CONTENT, "const AUTO_ABRIR_VENTANA_MS", "function marcarAutoAbrirIky");
const F = new Function(src + "\nreturn { autoAbrirEsFresca };")();

// La ventana real declarada en producción (para no hardcodear el número aquí).
const VENTANA = (() => {
  const m = src.match(/const AUTO_ABRIR_VENTANA_MS\s*=\s*(\d+)/);
  return m ? Number(m[1]) : NaN;
})();

console.log("[1] autoAbrirEsFresca — frescura de la marca");
ok(F.autoAbrirEsFresca(1000, 1000), "ahora === ts (recién marcada) -> fresca");
ok(F.autoAbrirEsFresca(1000, 1000 + VENTANA - 1), "justo dentro de la ventana -> fresca");
ok(!F.autoAbrirEsFresca(1000, 1000 + VENTANA), "en el borde de la ventana -> NO fresca");
ok(!F.autoAbrirEsFresca(1000, 1000 + VENTANA + 5000), "vencida (mucho después) -> NO fresca");
ok(!F.autoAbrirEsFresca(2000, 1000), "marca futura (ts > ahora) -> NO fresca");
ok(!F.autoAbrirEsFresca(undefined, 1000), "sin marca (undefined) -> NO fresca");
ok(!F.autoAbrirEsFresca("1000", 1000), "marca no-número -> NO fresca");

console.log("\n" + (fallos === 0 ? "TODAS LAS ASERCIONES PASARON ✓" : (fallos + " ASERCION(ES) FALLARON ✗")));
process.exit(fallos === 0 ? 0 : 1);
