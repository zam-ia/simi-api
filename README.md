# SIMI API

Servicio operativo compartido por SIMI y la web comercial. Mantiene los leads y procesa la cola durable de WhatsApp sin convertir a Meta en una dependencia del checkout.

## Endpoints

- `GET /health`: Supabase, configuración de WhatsApp y antigüedad de la cola.
- `POST /api/leads`: registra solicitudes de demo desde `simi-web`.
- `POST /api/internal/notifications/process`: procesa un lote; requiere `Authorization: Bearer WORKER_TOKEN`.
- `GET /api/internal/notifications/process`: ejecución programada por Vercel; usa `CRON_SECRET`.
- `GET /webhooks/whatsapp`: verificación inicial de Meta.
- `POST /webhooks/whatsapp`: recibe estados `sent`, `delivered`, `read` y `failed`, validando `X-Hub-Signature-256`.

## Flujo de pedidos

1. SIMI crea el pedido y las notificaciones en una única transacción PostgreSQL.
2. `notification_outbox` conserva cada mensaje con una clave de deduplicación.
3. SIMI despierta este servicio después de responder al cliente.
4. El worker reclama trabajos con `FOR UPDATE SKIP LOCKED` mediante la RPC de la migración 020.
5. Meta recibe una plantilla aprobada.
6. El webhook actualiza envío, entrega y lectura.
7. Los errores temporales vuelven a cola con espera progresiva; los definitivos quedan visibles para revisión.

## Plantillas requeridas en Meta

`simi_order_received_v1`, idioma `es`, cuerpo con cinco variables:

```txt
Hola, {{1}}. Recibimos tu pedido {{2}} en {{3}}.
Total: S/ {{4}}
Revisa el estado: {{5}}
```

`simi_new_order_business_v1`, idioma `es`, cuerpo con cinco variables:

```txt
Nuevo pedido {{1}}
Cliente: {{2}}
Total: S/ {{3}}
Modalidad: {{4}}
Revisar: {{5}}
```

## Ejecución

```powershell
npm.cmd run dev
npm.cmd run dev:worker
```

En Vercel, cada pedido activa el endpoint interno y existe una recuperación diaria compatible con el plan Hobby. Para reintentos cada minuto se necesita Vercel Pro, un programador externo o ejecutar `npm run worker` en un servidor persistente.

## Seguridad

- Las claves de Meta y la `service_role` son solo de servidor.
- El webhook rechaza firmas inválidas mediante HMAC-SHA256 y comparación de tiempo constante.
- La cola evita duplicados con `dedupe_key`.
- Los logs no incluyen tokens ni números completos.
- La migración 020 limita los datos operativos por `client_id`.

Usa `.env.example` como base. Las claves reales van en `.env` o en Vercel, nunca en Git.
