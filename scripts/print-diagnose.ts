import { api } from "../convex/_generated/api";
import { workerConnection, connectionMessage } from "./worker-connection";
try {
  const { client, secret, url, worker } = workerConnection();
  console.log(`Node ${process.version}. Checking ${url}`);
  await client.query(api.printing.interrupted, { secret, worker });
  console.log(
    "Connection and worker authentication passed. No jobs claimed or printed.",
  );
} catch (error) {
  console.error(connectionMessage(error, process.env.PRINT_WORKER_SECRET));
  process.exitCode = 1;
}
