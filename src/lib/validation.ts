import { z } from "zod";
// Use Zod's interpreted validators under the browser's strict script policy.
z.config({ jitless: true });
