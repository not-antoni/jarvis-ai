// Runs Lavalink (Java) and your Node bot side by side
const { spawn } = require("child_process");

const isRenderEnvironment = Boolean(process.env.RENDER_EXTERNAL_URL || process.env.RENDER_SERVICE_NAME);
const lavalinkHost = process.env.LAVALINK_HOST || (isRenderEnvironment ? "jarvis-lavalink" : "127.0.0.1");
process.env.LAVALINK_HOST = lavalinkHost;
process.env.LAVALINK_PORT = process.env.LAVALINK_PORT || process.env.PORT || "2333";
const isLocalLavalinkHost = ["127.0.0.1", "localhost", "::1"].includes(
  lavalinkHost.trim().toLowerCase()
);

let lavalink = null;

// ---- Start Lavalink ----
if (isLocalLavalinkHost) {
  lavalink = spawn("java", ["-jar", "Lavalink.jar"], {
    stdio: "inherit"
  });

  lavalink.on("close", code =>
    console.log(`Lavalink exited with code ${code}`)
  );

  lavalink.on("error", error =>
    console.error("Failed to start Lavalink process:", error)
  );
} else {
  console.log(
    `Skipping embedded Lavalink launch; expecting external node at ${lavalinkHost}:${process.env.LAVALINK_PORT || 2333}`
  );
}

// ---- Start Bot ----
const bot = spawn("node", ["index.js"], {
  stdio: "inherit"
});
bot.on("close", code =>
  console.log(`Bot exited with code ${code}`)
);

// ---- Cleanup ----
process.on("SIGINT", () => {
  if (lavalink) {
    lavalink.kill("SIGINT");
  }
  bot.kill("SIGINT");
  process.exit();
});
