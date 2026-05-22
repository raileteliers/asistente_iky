// Reglas de seguridad compartidas entre el backend (server.js) y la suite
// de evaluación (eval-intenciones.js). Tener una sola fuente evita falsos
// verdes: si el eval y el backend usaran listas divergentes, el eval podría
// pasar mientras el backend filtra distinto.
//
// ESM puro, sin dependencias ni build tools (backend usa "type": "module").

// Frases que el modelo NO debe usar porque sugieren que ya ejecutó o
// ejecutará una acción sin confirmación. La extensión siempre exige
// confirmación del usuario, así que estos mensajes lo engañarían aunque la
// intención clasificada sea correcta. Si aparecen, se descarta solo el
// mensaje IA (no el tipo) y se usa un fallback hardcoded.
export const FRASES_ACCION_PREMATURA = [
  "voy a abrir",
  "voy a buscar",
  "voy a hacer clic",
  "voy a escribir",
  "ya abri",
  "ya busque",
  "ya hice clic",
  "hice clic",
  "entre a",
  "seleccione",
  "abri el",
  "busque ",
];

// Normaliza para el filtro: minúsculas y sin tildes/diacríticos, de modo que
// "Voy a abrir" y "voy a abrir" colapsen al mismo texto comparable.
export function normalizarParaFiltro(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// True si el mensaje contiene alguna frase de acción prematura.
export function contieneAccionPrematura(mensaje) {
  const norm = normalizarParaFiltro(mensaje);
  return FRASES_ACCION_PREMATURA.some((f) => norm.includes(f));
}

// --- Solicitudes fuera del alcance del MVP ---
//
// El asistente solo ayuda a buscar información general en Google. NO guía
// pagos, banca, credenciales ni instalación de software/extensiones. Estas
// solicitudes se fuerzan a DESCONOCIDO de forma determinística, sin depender
// del modelo. El filtro es conservador: cubre riesgos reales de alcance sin
// bloquear búsquedas informativas ni "usar/abrir/entrar a" servicios web.

// Frases de varias palabras: se buscan como substring sobre el texto
// normalizado (minúsculas, sin tildes).
const FRASES_FUERA_DE_ALCANCE = [
  "pago de cuenta",
  "cuenta bancaria",
  "instala una extension",
  "instalar una extension",
  "instala extension",
  "instalar extension",
  "instalar programa",
  "instala programa",
];

// Palabras sueltas: se buscan con límite de palabra para no gatillar con
// substrings inocentes (ej. "apagar" no debe activar "paga"; "página"
// normalizada a "pagina" no debe activar "paga").
const PALABRAS_FUERA_DE_ALCANCE = [
  "paga",
  "pagar",
  "transferir",
  "transferencia",
  "banco",
  "contrasena",
  "clave",
  "password",
];

// True si el texto del usuario pide algo fuera del alcance del MVP (pagos,
// banca, credenciales, instalación de software/extensiones).
export function esSolicitudFueraDeAlcance(texto) {
  const norm = normalizarParaFiltro(texto);
  for (const frase of FRASES_FUERA_DE_ALCANCE) {
    if (norm.includes(frase)) return true;
  }
  for (const palabra of PALABRAS_FUERA_DE_ALCANCE) {
    if (new RegExp(`\\b${palabra}\\b`).test(norm)) return true;
  }
  return false;
}
