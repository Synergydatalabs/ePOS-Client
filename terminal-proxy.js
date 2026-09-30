#!/usr/bin/env node
// ============================================
// Terminal Proxy Bridge
// Runs locally on the POS machine to bridge
// HTTPS browser pages to HTTP terminals on LAN.
//
// Usage: node terminal-proxy.js
// Default port: 9999
//
// The browser (on HTTPS) calls http://localhost:9999
// which forwards to the terminal on the local network.
// Browsers allow HTTP to localhost from HTTPS pages.
// ============================================

const http = require("http");

const PROXY_PORT = parseInt(process.env.TERMINAL_PROXY_PORT || "9999", 10);

// CORS headers to allow any HTTPS origin
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { ...corsHeaders, "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function forwardToTerminal(terminalUrl, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(terminalUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || 8080,
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: timeoutMs,
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Terminal timeout"));
    });

    req.on("error", (err) => {
      reject(err);
    });

    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Health check
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    sendJson(res, 200, {
      status: "running",
      service: "terminal-proxy",
      version: "1.0.0",
      port: PROXY_PORT,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // POST /proxy — forward request to terminal
  if (req.method === "POST" && req.url === "/proxy") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { terminalIp, terminalPort, payload, timeout } = JSON.parse(body);

        if (!terminalIp) {
          sendJson(res, 400, { error: "terminalIp required" });
          return;
        }

        const port = terminalPort || 8080;
        const timeoutMs = timeout || 30000;
        const terminalUrl = `http://${terminalIp}:${port}/`;

        console.log(`[Proxy] → ${terminalIp}:${port} | ${payload?.data?.command || "unknown"}`);

        const result = await forwardToTerminal(
          terminalUrl,
          JSON.stringify(payload),
          timeoutMs
        );

        console.log(`[Proxy] ← ${result.status} | ${result.body?.data?.cmdResult?.result || "?"}`);
        sendJson(res, 200, { success: true, ...result });
      } catch (err) {
        console.error(`[Proxy] Error:`, err.message);
        sendJson(res, 502, {
          success: false,
          error: err.message,
          type: err.message.includes("timeout")
            ? "TIMEOUT"
            : err.message.includes("ECONNREFUSED")
              ? "UNREACHABLE"
              : "ERROR",
        });
      }
    });
    return;
  }

  // POST /ping — quick connectivity check
  if (req.method === "POST" && req.url === "/ping") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { terminalIp, terminalPort } = JSON.parse(body);
        const port = terminalPort || 8080;

        const pingPayload = JSON.stringify({
          message: "MSG",
          data: { command: "Ping", EcrId: "13", requestId: `proxy-ping-${Date.now()}` },
        });

        const result = await forwardToTerminal(
          `http://${terminalIp}:${port}/`,
          pingPayload,
          3000
        );

        const online = result.body?.data?.cmdResult?.result === "Success";
        console.log(`[Proxy] Ping ${terminalIp}:${port} → ${online ? "ONLINE" : "OFFLINE"}`);
        sendJson(res, 200, { online, ...result });
      } catch (err) {
        console.log(`[Proxy] Ping failed: ${err.message}`);
        sendJson(res, 200, { online: false, error: err.message });
      }
    });
    return;
  }

  // POST /info — get terminal device info
  if (req.method === "POST" && req.url === "/info") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        const { terminalIp, terminalPort } = JSON.parse(body);
        const port = terminalPort || 8080;

        const infoPayload = JSON.stringify({
          message: "MSG",
          data: { command: "GetAppInfo", EcrId: "13", requestId: `proxy-info-${Date.now()}` },
        });

        const result = await forwardToTerminal(
          `http://${terminalIp}:${port}/`,
          infoPayload,
          5000
        );

        const info = result.body?.data?.data || result.body?.data?.response || {};
        sendJson(res, 200, {
          success: result.body?.data?.cmdResult?.result === "Success",
          info: {
            serialNumber: info.serialNumber || info.SerialNumber || "",
            model: info.appName || info.AppName || info.model || "Terminal",
            appVersion: info.appVersion || info.AppVersion || "",
            osVersion: info.osVersion || info.OsVersion || "",
            macAddress: info.macAddress || info.MacAddress || "",
          },
          raw: result,
        });
      } catch (err) {
        sendJson(res, 200, { success: false, error: err.message });
      }
    });
    return;
  }

  sendJson(res, 404, { error: "Not found. Use POST /proxy, /ping, or /info" });
});

server.listen(PROXY_PORT, "127.0.0.1", () => {
  console.log("");
  console.log("  ╔══════════════════════════════════════════╗");
  console.log("  ║       Terminal Proxy Bridge v1.0         ║");
  console.log(`  ║       http://localhost:${PROXY_PORT}              ║`);
  console.log("  ╠══════════════════════════════════════════╣");
  console.log("  ║  Ready to bridge browser → terminal     ║");
  console.log("  ║  HTTPS pages can now reach terminals     ║");
  console.log("  ╚══════════════════════════════════════════╝");
  console.log("");
});
