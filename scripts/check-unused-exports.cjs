/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   check-unused-exports.cjs                           :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/05/18 21:19:17 by dlesieur          #+#    #+#             */
/*   Updated: 2026/05/18 21:19:17 by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

const { execFileSync } = require("node:child_process");

// Public entry points. Every export here is a re-export for CONSUMERS, so
// ts-prune correctly sees no in-repo use — that is the point of a facade.
// Keep in sync with the "exports" map in package.json.
const allowedPublicFacadeFiles = new Set([
  "index.ts",
  "blocks.ts",
  "inline.ts",
  "dom.ts",
  "react.tsx",
  "terminal.ts",
  "shortcuts.ts",
  "markdown.ts",
  "markdown/index.ts",
  "markdown/parserBlockHelpers.ts",
  "markdown/parserBlockNested.ts",
  "markdown/renderers/terminalHelpers.ts",
  "vite.config.ts",
]);

const output = execFileSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["ts-prune", "-p", "tsconfig.prune.json"],
  { encoding: "utf8" },
)
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((line) => !line.includes("(used in module)"))
  .filter((line) => {
    const [file] = line.split(":", 1);
    return !allowedPublicFacadeFiles.has(file);
  });

if (output.length > 0) {
  console.error(output.join("\n"));
  process.exit(1);
}

console.log("ts-prune: zero unused internal exports");