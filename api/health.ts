import type { VercelRequest, VercelResponse } from "@vercel/node";
import { healthCheck } from "../server/health";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const healthStatus = await healthCheck();
    return res.status(200).json(healthStatus);
  } catch (error) {
    console.error("[Health Check Error]", error);
    return res.status(500).json({ 
      status: "error", 
      message: "Health check failed" 
    });
  }
}
