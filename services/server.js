const express = require("express");
const path = require("path");
const fs = require("fs");
const config = require("./config");

const db = require(path.join(__dirname, "..", "src", "db"));

const app = express();
app.disable("x-powered-by");

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// Static
app.use(express.static(config.PUBLIC_DIR));

app.get("/", (req, res) => {
  const index = path.join(config.PUBLIC_DIR, "index.html");
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(404).send("index.html not found");
});

// Health
app.get("/health", async (_, res) => {
  try {
    db.get("SELECT 1", () => {
      res.json({ ok: true });
    });
  } catch {
    res.json({ ok: false });
  }
});

// Routes
try {
  const routes = require("../src/routes/routes");
  app.use("/api", routes);
} catch (_) {
  console.warn("Routes not mounted");
}

// Start
const port = config.PORT || 3000;
app.listen(port, () => {
  console.log("SERVER OK ON", port);
});

module.exports = app;
