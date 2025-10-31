require("dotenv").config();
const cors = require("cors");

const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");
const http = require("http");
const fetch = require("node-fetch"); // npm install node-fetch@2

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

app.use(cors()); // allow all origins

const BINANCE_BASE = "wss://stream.binance.com:9443";
const BINANCE_HTTP = "https://api.binance.com";

const PORT = process.env.PORT || 4000;

// ===== HTTP FETCH PROXY =====
app.use("/api", async (req, res) => {
  try {
    const targetUrl = BINANCE_HTTP + req.originalUrl; // e.g. /api/v3/ticker/price
    console.log(`Proxying REST -> ${targetUrl}`);

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Parse JSON safely
    const data = await response.json();

    res.status(response.status).json(data); // send as JSON
  } catch (err) {
    console.error("Error proxying request:", err);
    res.status(500).json({ error: "Proxy Error", details: err.message });
  }
});

// Handle WebSocket upgrades
server.on("upgrade", (req, socket, head) => {
  const url = req.url; // e.g. /stream?streams=btcusdt@trade or /ws/!ticker@arr

  if (url.startsWith("/stream") || url.startsWith("/ws")) {
    wss.handleUpgrade(req, socket, head, (clientSocket) => {
      wss.emit("connection", clientSocket, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on("connection", (clientSocket, req) => {
  const targetUrl = BINANCE_BASE + req.url; // just prepend base URL
  console.log(`Proxying WS -> ${targetUrl}`);

  const binanceSocket = new WebSocket(targetUrl);

  // Forward Binance messages to client
  binanceSocket.on("message", (msg) => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      // Ensure message is sent as UTF-8 text, not Buffer
      const text = Buffer.isBuffer(msg) ? msg.toString("utf8") : msg;
      clientSocket.send(text);
    }
  });

  // Forward client messages to Binance (rarely needed)
  clientSocket.on("message", (msg) => {
    if (binanceSocket.readyState === WebSocket.OPEN) {
      binanceSocket.send(msg);
    }
  });

  // Handle close events both ways
  const closeBoth = () => {
    if (clientSocket.readyState === WebSocket.OPEN) clientSocket.close();
    if (binanceSocket.readyState === WebSocket.OPEN) binanceSocket.close();
  };

  clientSocket.on("close", closeBoth);
  binanceSocket.on("close", closeBoth);
  binanceSocket.on("error", closeBoth);
  clientSocket.on("error", closeBoth);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`WebSocket proxy running on port ${PORT}`);
});
