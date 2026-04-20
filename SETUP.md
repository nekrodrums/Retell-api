# Setup: VoIP.MS → Twilio SIP Domain → Retell AI

## Arquitectura final

```
VoIP.MS IVR (dígitos 3, 7, 8, 9)
    │
    │  SIP URI (sin límite de 2 canales)
    ▼
Twilio SIP Domain  ←── IP ACL: 208.100.60.0/24 (todos los servidores VoIP.MS)
    │
    │  POST webhook
    ▼
Este servidor (src/index.js)
    │
    │  POST /v2/register-phone-call
    ▼
Retell API → devuelve call_id
    │
    │  TwiML: <Dial><Sip>sip:{call_id}@sip.retellai.com</Sip></Dial>
    ▼
Twilio → sip:{call_id}@sip.retellai.com
    │
    ▼
Anna (agente Retell)
```

**No necesitas comprar ningún número de Twilio.**
**No necesitas mantener el número 5877428743 de Retell.**

---

## PASO 1 — Completar el .env

Abre `.env` y completa:
- `RETELL_API_KEY` → Retell dashboard → Settings → API Key
- `RETELL_AGENT_ID` → Retell dashboard → click en el agente ERA AI → copiar el ID (empieza con `agent_`)

---

## PASO 2 — Instalar dependencias y probar local

```bash
npm install
npm run dev
```

Para probar: `curl http://localhost:3000/health` → debe devolver `{"status":"ok"}`

---

## PASO 3 — Deployar en Railway (gratis)

1. Ir a https://railway.app → Login con GitHub
2. "New Project" → "Deploy from GitHub repo" → seleccionar `Retell-api`
3. Railway detecta Node.js automáticamente
4. En Railway → Variables → agregar:
   - `RETELL_API_KEY` = tu clave
   - `RETELL_AGENT_ID` = tu agent ID
5. Railway da una URL pública tipo: `https://retell-api-production.up.railway.app`
6. Anotar esa URL → la usas en el Paso 4

---

## PASO 4 — Twilio: crear IP Access Control List

1. Twilio Console → Voice → Manage → **IP access control lists**
2. Click "+" → Nombre: `voipms-acl`
3. Agregar IP: `208.100.60.0/24` (rango completo de servidores VoIP.MS)
4. Guardar

---

## PASO 5 — Twilio: crear SIP Domain

1. Twilio Console → Voice → Manage → **SIP domains**
2. Click "+" → completar:
   - **Friendly Name**: `Anna Retell`
   - **SIP URI**: `anna` (queda como `anna.sip.twilio.com`)
   - **Voice Configuration**:
     - Request URL: `https://[tu-url-railway]/incoming-call`
     - HTTP Method: `POST`
   - **SIP Registration**: desactivado (no necesita registro)
   - **IP Access Control Lists**: seleccionar `voipms-acl`
3. Guardar → anotar el SIP URI completo: `sip:anna@anna.sip.twilio.com`

> ⚠️ Si el nombre `anna` ya existe, usar `era-ai` o `futed-ai` → el URI quedaría `sip:x@era-ai.sip.twilio.com`

---

## PASO 6 — VoIP.MS: cambiar dígitos 3, 7, 8, 9

En el IVR "Ben 2025 new", para cada uno de los dígitos 3, 7, 8, 9:

1. Cambiar **Destination** de `Call Forwarding` → `SIP URI`
2. En **Option** escribir: `anna@anna.sip.twilio.com`
   (sin el `sip:` al principio, VoIP.MS lo agrega solo)
3. Click **Save IVR**

---

## PASO 7 — Probar

Llamar al número principal → presionar 3 → Anna debe responder.

Si hay problemas → revisar logs en Railway → el servidor loggea cada llamada entrante.

---

## PASO 8 — Eliminar número Retell (ahorra $2 CAD/mes)

Una vez confirmado que todo funciona:
1. Retell dashboard → Phone Numbers → `+1(587)742-8743`
2. Eliminar número → ya no se necesita

---

## Notas importantes

- **Concurrencia**: Twilio SIP Domain soporta 1000+ llamadas simultáneas. VoIP.MS via SIP URI no tiene el límite de 2 canales del Call Forwarding.
- **VoIP.MS IPs**: Todos los servidores VoIP.MS están en el rango `208.100.60.0/24`. El ACL cubre todos.
- **Retell call_id**: Caduca en 5 minutos si no se conecta. El servidor lo registra justo antes de que Twilio dial, así que no hay problema.
- **Twilio trial**: El trial de Twilio funciona para recibir SIP inbound y hacer webhooks. No hay restricción de números verificados porque no estamos haciendo llamadas salientes a números externos.
