"use strict";

// Local-only GUI server for the level generator.
// Zero dependencies: uses the Node built-in http module and reuses the
// generation logic exported from generate-levels.js (no duplicated logic).

const http = require("http");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const guiPath = path.join(repoRoot, "generator-gui.html");
const levelStorePath = path.join(repoRoot, "src", "levels.js");

const generatorCli = require(path.join(repoRoot, "scripts", "generate-levels.js"));

const PORT = Number(process.env.GEN_GUI_PORT) || 4178;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, (_key, value) => (value instanceof Set ? [...value].sort() : value));
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function handleGenerate(req, res) {
  readRequestBody(req)
    .then((raw) => {
      const request = raw ? JSON.parse(raw) : {};
      const options = request.options || {};
      const shouldSave = Boolean(request.save);

      const levels = generatorCli.generateFromOptions(options);
      const summaries = levels.map((level, index) => generatorCli.summarize(level, index + 1, {}));

      let savedPath = null;

      if (shouldSave) {
        savedPath = generatorCli.writeLevelStore(levelStorePath, levels);
      }

      sendJson(res, 200, { levels, summaries, savedPath });
    })
    .catch((error) => {
      console.error(`[generate] ${error.message}`);
      sendJson(res, 400, { error: error.message });
    });
}

function serveGui(res) {
  fs.readFile(guiPath, (error, data) => {
    if (error) {
      console.error(`[gui] ${error.message}`);
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(error.message);
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/generate") {
    handleGenerate(req, res);
    return;
  }

  if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
    serveGui(res);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Arrow Puzzle generator GUI: http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});
