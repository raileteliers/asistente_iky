# Asistente para Google

Extensión de Chrome (Manifest V3) + backend local que ayuda a adultos mayores
a usar Google Search en computador de escritorio. Resalta la barra de búsqueda,
guía búsquedas, explica resultados y ofrece acciones simples — siempre con
confirmación del usuario.

## Alcance del MVP

- Solo Google Search en Chrome de escritorio.
- Dominios soportados: `google.com` y `google.cl`.
- La nueva pestaña redirige a `google.cl`.
- **Fuera de alcance:** todo el resto de internet, Gmail, bancos, pagos,
  contraseñas, trámites sensibles, móvil y acciones arbitrarias generadas por IA.

## Estructura

```
asistente-google/
├── manifest.json        Extensión MV3
├── content.js           Lógica de la extensión (DOM, flujo, confirmaciones)
├── style.css            Estilos del panel (prefijo ag-)
├── newtab.html/.js      Nueva pestaña → redirige a google.cl
└── backend/
    ├── server.js              Endpoint POST /interpretar (Groq)
    ├── safety-rules.js        Reglas de seguridad compartidas
    ├── eval-intenciones.js    Suite de evaluación
    ├── eval-intenciones.json  Casos de evaluación
    └── .env.example           Plantilla de configuración
```

## Cargar la extensión desempaquetada en Chrome

1. Abrir `chrome://extensions`.
2. Activar **Modo de desarrollador** (arriba a la derecha).
3. Clic en **Cargar descomprimida** y elegir la carpeta `asistente-google/`.
4. Abrir `google.cl`: aparece el botón flotante **Ayuda**.

## Levantar el backend

```bash
cd backend
cp .env.example .env      # luego editar .env con tu clave real de Groq
npm install
npm start
```

El backend queda escuchando en `http://localhost:3000`. Si está apagado o
falla, la extensión sigue funcionando con su heurística local (fallback).

## Configurar `.env`

Copiar `backend/.env.example` a `backend/.env` y rellenar:

- `GROQ_API_KEY` — tu clave real de Groq (`gsk_...`).
- `GROQ_MODEL` — opcional, por defecto `llama-3.3-70b-versatile`.
- `PORT` — opcional, por defecto `3000`.

`backend/.env` está en `.gitignore` y **nunca** debe commitearse.

## Correr la evaluación

Con el backend corriendo, en otra terminal:

```bash
cd backend
npm run eval
```

Dispara los casos de `eval-intenciones.json` contra `/interpretar` y reporta
PASS/FAIL. Sale con código 1 si hay fallos. Hace llamadas reales a Groq, así
que consume cuota y puede toparse con límites de tasa.

## Reglas de seguridad

- **La IA interpreta y redacta. La extensión decide el flujo. El usuario
  confirma cualquier acción.**
- El asistente primero enseña y resalta; solo ejecuta una acción simple si el
  usuario lo pide, y siempre con confirmación.
- La IA nunca ejecuta acciones, nunca devuelve JavaScript ni HTML, nunca
  controla el navegador.
- No se ponen claves de API dentro de la extensión: viven solo en el backend.
- No se commitea `backend/.env`.
