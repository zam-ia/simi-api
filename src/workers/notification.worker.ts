import "dotenv/config";
import { processOutboxBatch } from "../services/outbox.service.js";

let stopping = false;

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function run() {
  console.log(JSON.stringify({ level: "info", event: "whatsapp.worker_started" }));

  while (!stopping) {
    try {
      const result = await processOutboxBatch(50);
      await delay(result.claimed > 0 ? 500 : 3000);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "whatsapp.worker_loop_failed", message: error instanceof Error ? error.message : "Error desconocido" }));
      await delay(5000);
    }
  }

  console.log(JSON.stringify({ level: "info", event: "whatsapp.worker_stopped" }));
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

void run();
