interface EmailEnv {
  RESEND_API_KEY: string;
}

const MCP_CONFIG_TEMPLATE = (apiKey: string, products: string[]): string => {
  const servers: Record<string, object> = {};
  for (const product of products) {
    servers[product] = {
      command: "npx",
      args: [`@thryx/${product}-mcp-server`],
      env: { THRYX_API_KEY: apiKey },
    };
  }
  return JSON.stringify({ mcpServers: servers }, null, 2);
};

/**
 * Send the API key delivery email via Resend.
 */
export async function sendKeyDeliveryEmail(
  env: EmailEnv,
  email: string,
  apiKey: string,
  products: string[],
): Promise<void> {
  const mcpConfig = MCP_CONFIG_TEMPLATE(apiKey, products);
  const productList = products.map((p) => `- ${p}`).join("\n");

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #1a1a2e;">Your Thryx MCP API Key</h1>
  <p>Thanks for your purchase! Here's your API key and setup instructions.</p>

  <div style="background: #f0f0f5; border-radius: 8px; padding: 16px; margin: 20px 0;">
    <p style="margin: 0 0 4px 0; font-size: 12px; color: #666;">API Key</p>
    <code style="font-size: 16px; color: #1a1a2e; word-break: break-all;">${apiKey}</code>
  </div>

  <h2 style="color: #1a1a2e;">Products</h2>
  <ul>${products.map((p) => `<li><code>@thryx/${p}-mcp-server</code></li>`).join("")}</ul>

  <h2 style="color: #1a1a2e;">Quick Setup</h2>
  <p>Add this to your MCP client config (Claude Code, Cursor, etc.):</p>
  <pre style="background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px;">${escapeHtml(mcpConfig)}</pre>

  <h2 style="color: #1a1a2e;">Install</h2>
  <pre style="background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 8px; font-size: 13px;">${products.map((p) => `npm install -g @thryx/${p}-mcp-server`).join("\n")}</pre>

  <p style="margin-top: 24px;">
    <a href="https://docs.thryx.dev/mcp" style="background: #4f46e5; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">View Documentation</a>
  </p>

  <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;" />
  <p style="font-size: 12px; color: #999;">
    Keep your API key secure. Do not share it publicly or commit it to version control.
    If you need to regenerate your key, contact support@thryx.dev.
  </p>
</div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Thryx <noreply@thryx.dev>",
      to: [email],
      subject: "Your Thryx MCP API Key",
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Resend API error: ${response.status} — ${text}`);
    throw new Error(`Failed to send email: ${response.status}`);
  }
}

/**
 * Send a warning email when payment fails.
 */
export async function sendPaymentFailedEmail(
  env: EmailEnv,
  email: string,
): Promise<void> {
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #dc2626;">Payment Failed</h1>
  <p>We were unable to process your latest payment for your Thryx MCP subscription.</p>
  <p>Please update your payment method within <strong>3 days</strong> to avoid service interruption.</p>
  <p>
    <a href="https://billing.stripe.com/p/login/thryx" style="background: #4f46e5; color: white; padding: 10px 20px; border-radius: 6px; text-decoration: none;">Update Payment Method</a>
  </p>
  <p style="font-size: 12px; color: #999; margin-top: 24px;">If you believe this is an error, contact support@thryx.dev.</p>
</div>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Thryx <noreply@thryx.dev>",
      to: [email],
      subject: "Action Required: Payment Failed — Thryx MCP",
      html,
    }),
  });
}

/**
 * Send cancellation confirmation email.
 */
export async function sendCancellationEmail(
  env: EmailEnv,
  email: string,
): Promise<void> {
  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #1a1a2e;">Subscription Cancelled</h1>
  <p>Your Thryx MCP subscription has been cancelled and your API keys have been deactivated.</p>
  <p>If you'd like to resubscribe, visit <a href="https://thryx.dev/pricing">thryx.dev/pricing</a>.</p>
  <p style="font-size: 12px; color: #999; margin-top: 24px;">Thanks for being a customer. — The Thryx Team</p>
</div>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Thryx <noreply@thryx.dev>",
      to: [email],
      subject: "Subscription Cancelled — Thryx MCP",
      html,
    }),
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
