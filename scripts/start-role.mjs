import { spawn } from "node:child_process";

const role = (process.env.APP_ROLE || "web").toLowerCase();
const port = process.env.PORT || "3000";
const runMigrations = process.env.RUN_MIGRATIONS === "true";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: process.env,
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });

    child.on("error", reject);
  });
}

async function main() {
  if (runMigrations) {
    await run("npx", ["prisma", "migrate", "deploy"]);
  }

  if (role === "worker") {
    await run("npx", ["tsx", "src/workers/email-worker.ts"]);
    return;
  }

  await run("npx", ["next", "start", "-H", "0.0.0.0", "-p", port]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
