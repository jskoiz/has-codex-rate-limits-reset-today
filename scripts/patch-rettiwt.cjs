const fs = require("node:fs");
const path = require("node:path");

const targets = [
  path.join(__dirname, "..", "node_modules", "rettiwt-api", "dist", "models", "data", "User.js"),
  path.join(__dirname, "..", "node_modules", "rettiwt-api", "src", "models", "data", "User.ts"),
];

const unsafeSnippet = "this.pinnedTweet = user.legacy.pinned_tweet_ids_str[0];";
const safeSnippet =
  "this.pinnedTweet = Array.isArray(user.legacy.pinned_tweet_ids_str) ? user.legacy.pinned_tweet_ids_str[0] : undefined;";

for (const target of targets) {
  if (!fs.existsSync(target)) {
    continue;
  }

  const current = fs.readFileSync(target, "utf8");
  if (current.includes(safeSnippet)) {
    continue;
  }

  if (!current.includes(unsafeSnippet)) {
    throw new Error(`Unable to find Rettiwt patch target in ${target}`);
  }

  fs.writeFileSync(target, current.replace(unsafeSnippet, safeSnippet));
  console.log(`Patched ${path.relative(process.cwd(), target)}`);
}
