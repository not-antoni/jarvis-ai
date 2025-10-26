// Runs Lavalink (Java) and the Discord bot side by side
const { spawn, execSync } = require("child_process");
const https = require("https");
const fs = require("fs");
const path = require("path");

const LAVALINK_VERSION = process.env.LAVALINK_VERSION || "4.1.1";
const LAVALINK_JAR_PATH = path.join(__dirname, "Lavalink.jar");
const LAVALINK_DOWNLOAD_URL = `https://github.com/lavalink-devs/Lavalink/releases/download/${LAVALINK_VERSION}/Lavalink.jar`;

const JAVA_RUNTIME_DIR = path.join(__dirname, ".java-runtime");
const JAVA_BINARY_PATH = path.join(JAVA_RUNTIME_DIR, "bin", "java");
const TEMURIN_VERSION = process.env.JRE_VERSION || "17.0.12_7";
const TEMURIN_DOWNLOAD_URL =
    process.env.JRE_DOWNLOAD_URL ||
    `https://github.com/adoptium/temurin17-binaries/releases/download/jre-17.${TEMURIN_VERSION.replace(
        "_",
        "+"
    )}/OpenJDK17U-jre_x64_linux_hotspot_17.${TEMURIN_VERSION}.tar.gz`;

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

function findJavaBinary() {
    try {
        execSync("java -version", { stdio: "ignore" });
        return "java";
    } catch {
        if (fs.existsSync(JAVA_BINARY_PATH)) {
            return JAVA_BINARY_PATH;
        }
    }
    return null;
}

async function extractTarGz(archivePath, destination) {
    await new Promise((resolve, reject) => {
        const tar = spawn("tar", ["-xzf", archivePath, "-C", destination]);
        tar.on("exit", (code) => {
            if (code === 0) resolve();
            else reject(new Error(`tar exited with code ${code}`));
        });
        tar.on("error", reject);
    });
}

function findJavaInDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const candidate = findJavaInDir(entryPath);
            if (candidate) return candidate;
        } else if (
            entry.isFile() &&
            entry.name === "java" &&
            entryPath.includes(`${path.sep}bin${path.sep}java`)
        ) {
            return entryPath;
        }
    }
    return null;
}

async function ensureJavaRuntime() {
    const existingBinary = findJavaBinary();
    if (existingBinary) {
        return existingBinary;
    }

    if (!fs.existsSync(JAVA_RUNTIME_DIR)) {
        fs.mkdirSync(JAVA_RUNTIME_DIR, { recursive: true });
    }

    const archivePath = path.join(JAVA_RUNTIME_DIR, "temurin.tar.gz");
    console.log(`Java runtime not found. Downloading Temurin from ${TEMURIN_DOWNLOAD_URL}...`);
    await downloadFile(TEMURIN_DOWNLOAD_URL, archivePath);

    console.log("Extracting Java runtime...");
    const extractTarget = path.join(JAVA_RUNTIME_DIR, "dist");
    if (!fs.existsSync(extractTarget)) {
        fs.mkdirSync(extractTarget);
    }
    await extractTarGz(archivePath, extractTarget);
    fs.unlinkSync(archivePath);

    const javaBinary = findJavaInDir(extractTarget);
    if (!javaBinary) {
        throw new Error("Failed to locate java binary after extraction.");
    }

    fs.chmodSync(javaBinary, 0o755);
    fs.mkdirSync(path.dirname(JAVA_BINARY_PATH), { recursive: true });

    if (!fs.existsSync(JAVA_BINARY_PATH)) {
        fs.symlinkSync(javaBinary, JAVA_BINARY_PATH);
    }

    console.log(`Java runtime ready at ${JAVA_BINARY_PATH}`);
    return JAVA_BINARY_PATH;
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
    const useExternal = String(process.env.LAVALINK_USE_EXTERNAL).toLowerCase() === "true";
    let lavalinkProcess = null;
    let resolvedPort = String(process.env.LAVALINK_PORT || "2333");
    process.env.LAVALINK_PORT = resolvedPort;

    if (!useExternal) {
        const lavalinkHost = "127.0.0.1";
        process.env.LAVALINK_HOST = lavalinkHost;

        let javaCommand;
        try {
            javaCommand = await ensureJavaRuntime();
            await ensureLavalinkJar();
        } catch (error) {
            console.error("Unable to prepare Lavalink runtime:", error);
            process.exit(1);
        }

        console.log(`Launching embedded Lavalink on ${lavalinkHost}:${resolvedPort}`);
        lavalinkProcess = spawn(javaCommand, ["-jar", LAVALINK_JAR_PATH], {
            stdio: "inherit"
        });

        lavalinkProcess.on("close", (code) =>
            console.log(`Lavalink exited with code ${code}`)
        );

        lavalinkProcess.on("error", (error) =>
            console.error("Failed to start Lavalink process:", error)
        );
    } else {
        const lavalinkHost = normalizeHost(process.env.LAVALINK_HOST);
        process.env.LAVALINK_HOST = lavalinkHost;
        console.log(`Using external Lavalink at ${lavalinkHost}:${resolvedPort}`);
    }

    const bot = spawn("node", ["index.js"], {
        stdio: "inherit"
    });

    bot.on("close", (code) =>
        console.log(`Bot exited with code ${code}`)
    );

    process.on("SIGINT", () => {
        if (lavalinkProcess) {
            lavalinkProcess.kill("SIGINT");
        }
        bot.kill("SIGINT");
        process.exit();
    });
}

main().catch((error) => {
    console.error("Failed to launch services:", error);
    process.exit(1);
});
