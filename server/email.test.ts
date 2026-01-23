import { describe, it, expect } from "vitest";
import nodemailer from "nodemailer";
import { ENV } from "./_core/env";

describe("Email Configuration", () => {
  it("should successfully authenticate with Gmail", async () => {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: ENV.emailUser,
        pass: ENV.emailPass,
      },
    });

    // Verify connection configuration
    await expect(transporter.verify()).resolves.toBe(true);
  }, 30000); // 30 second timeout for network request
});
