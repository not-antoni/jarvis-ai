// Runs Lavalink (Java) and your Node bot side by side
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const https = require("https");

const LAVALINK_VERSION = process.env.LAVALINK_VERSION || "4.1.1";
const LAVALINK_JAR_PATH = path.join(__dirname, "Lavalink.jar");
const LAVALINK_DOWNLOAD_URL = `https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar`;

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createWriteStream(destination);
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          fileStream.close();
          fs.unlink(destination, () => {
            reject(new Error(`Failed to download ${url}. Status code: ${response.statusCode}`));
          });
          return;
        }

        response.pipe(fileStream);
        fileStream.on("finish", () => fileStream.close(resolve));
      })
      .on("error", (error) => {
        fileStream.close();
        fs.unlink(destination, () => reject(error));
      });
  });
}

async function ensureLavalinkJar() {
  if (fs.existsSync(LAVALINK_JAR_PATH)) {
    return;
  }

  console.log(`Downloading Lavalink ${LAVALINK_VERSION}...`);
  await downloadFile(LAVALINK_DOWNLOAD_URL, LAVALINK_JAR_PATH);
  console.log("Lavalink download complete.");
}

const normalizeHost = (raw) => {
  if (!raw) {
    return "127.0.0.1";
  }

  const lower = raw.toLowerCase();
  if (["localhost", "127.0.0.1", "::1"].includes(lower)) {
    return raw;
  }

  const isIp = /^[\d.:]+$/.test(raw);
  if (isIp || raw.includes(".")) {
    return raw;
  }

  const suffix = (process.env.LAVALINK_HOST_SUFFIX || ".onrender.com").trim();
  if (!suffix.length) {
    return raw;
  }

  return raw.endsWith(suffix) ? raw : `${raw}${suffix}`;
};

async function main() {
  try {
    await ensureLavalinkJar();
  } catch (error) {
    console.error("Unable to prepare Lavalink jar:", error);
    process.exit(1);
  }

  const lavalinkHost = normalizeHost(process.env.LAVALINK_HOST);
  process.env.LAVALINK_HOST = lavalinkHost;
  process.env.LAVALINK_PORT = process.env.LAVALINK_PORT || "2333";

  const isLocalLavalinkHost = ["127.0.0.1", "localhost", "::1"].includes(
    lavalinkHost.trim().toLowerCase()
  );

  let lavalink = null;

  // ---- Start Lavalink ----
  if (isLocalLavalinkHost) {
    lavalink = spawn("java", ["-jar", LAVALINK_JAR_PATH], {
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
}

main().catch((error) => {
  console.error("Failed to launch services:", error);
  process.exit(1);
});
