"use strict";

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

global.window = global;

require(path.join(repoRoot, "src", "puzzle-rules.js"));
require(path.join(repoRoot, "src", "puzzle-solver.js"));
require(path.join(repoRoot, "src", "puzzle-generator.js"));

const rules = window.ArrowPuzzleRules;
const generator = window.ArrowPuzzleGenerator;

const SHAPES = {
  gem: ["..###..", ".#####.", "#######", "#######", "#######", ".#####.", "..###.."],
  plus: ["..###..", "..###..", "#######", "#######", "#######", "..###..", "..###.."],
  heart: [".##.##.", "#######", "#######", ".#####.", "..###..", "...#..."]
};
const APP_LEVEL_LAYOUTS = [
  {
    name: "gem",
    maskRows: SHAPES.gem
  },
  {
    name: "plus",
    maskRows: SHAPES.plus
  },
  {
    name: "heart",
    maskRows: SHAPES.heart
  },
  {
    name: "square",
    pointColumns: 6,
    pointRows: 6
  }
];

const ALGORITHMS = new Set(["free-placement", "reverse", "flow"]);
const DIFFICULTY_LABELS = new Set(["easy", "normal", "hard"]);
const NUMBER_KEYS = new Set([
  "count",
  "pointColumns",
  "pointRows",
  "minEdges",
  "maxEdges",
  "longLineRatio",
  "longLineQuota",
  "longLineChance",
  "longLineMaxEdges",
  "longLineMaxRatio",
  "straightBias",
  "rayBias",
  "pathAttempts",
  "maxAttempts",
  "solutionCountCap",
  "fullSolveMaxCells",
  "tileSize",
  "tileWidth",
  "tileHeight",
  "tileStitchThreshold",
  "tileStitchAttempts",
  "tileMaxAttempts",
  "tilePathAttempts",
  "tileFillerSearchLimit",
  "tileLongLineSearchLimit",
  "fallbackSearchLimit",
  "tileFallbackSearchLimit",
  "freePlacementBranchLimit",
  "freePlacementCandidateAttempts",
  "freePlacementComponentLimit",
  "freePlacementSearchLimit",
  "freePlacementNodeLimit",
  "repairAttempts",
  "flowMaxAttempts",
  "solverVisitedStateLimit"
]);
const BOOLEAN_KEYS = new Set([
  "json",
  "pretty",
  "solution",
  "debug",
  "app",
  "useTileStitch",
  "fullSolve",
  "debugStitch",
  "logFallbackWarning",
  "debugGeneratedLevel",
  "requireFirstExit",
]);
const KEY_ALIASES = {
  c: "count",
  n: "count",
  s: "seed",
  o: "out",
  j: "json",
  cols: "pointColumns",
  columns: "pointColumns",
  rows: "pointRows",
  size: "size",
  output: "out",
  debugPreview: "debug",
  preview: "debug",
  warn: "logFallbackWarning"
};

function printHelp() {
  console.log(`Usage:
  PowerShell: .\\gen [count] [size] [seed] [options]
  Bash:       ./gen [count] [size] [seed] [options]

Examples:
  PowerShell: .\\gen 1 8x8
  Bash:       ./gen 1 8x8
  .\\gen 5
  .\\gen 10 8x8 --seed stage
  .\\gen --shape gem
  .\\gen --json
  .\\gen 3 --out levels.json
  .\\gen --app
  ./gen --app

Common options:
  --count, -n <n>       Number of levels to generate.
  --size <NxM>          Board size, for example 7x7 or 9x6.
  --cols <n> --rows <n> Board size as separate values.
  --seed, -s <text>     Seed prefix. Multiple levels use prefix-1, prefix-2...
  --shape <name>        gem, plus, or heart.
  --json, -j            Print full level JSON instead of updating src/levels.js.
  --out, -o <file>      Save full level JSON to a file instead of updating src/levels.js.
  --solution            Include solution order in summary output.
  --debug               Save success as an order debug level; failures return the last partial preview.
  --app                 Regenerate the built-in app level set.
  --algorithm <name>    free-placement (default) or reverse.

Advanced generator options can be passed as flags too:
  .\\gen 7x7 --debug
  .\\gen 15x15 --tileSize 6 --tileStitchAttempts 12 --maxEdges 7
  ./gen 15x15 --freePlacementBranchLimit 24 --freePlacementNodeLimit 12000
  .\\gen 8x8 --algorithm reverse`);
}

function toCamelKey(key) {
  const stripped = key.replace(/^-+/, "");
  const aliased = KEY_ALIASES[stripped] || stripped;

  return aliased.replace(/[-_]([a-zA-Z0-9])/g, (_, char) => char.toUpperCase());
}

function parseScalar(value) {
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return value;
}

function readFlagValue(args, index, key, inlineValue) {
  if (inlineValue !== undefined) {
    return { value: inlineValue, nextIndex: index };
  }

  if (BOOLEAN_KEYS.has(key)) {
    return { value: true, nextIndex: index };
  }

  const value = args[index + 1];

  if (value === undefined || value.startsWith("-")) {
    throw new Error(`Missing value for --${key}`);
  }

  return { value, nextIndex: index + 1 };
}

function parseSize(value) {
  const match = String(value).toLowerCase().match(/^(\d+)(?:x(\d+))?$/);

  if (!match) {
    throw new Error(`Invalid size "${value}". Use NxM, for example 7x7.`);
  }

  const columns = Number(match[1]);
  const rows = Number(match[2] || match[1]);

  if (columns < 2 || rows < 2) {
    throw new Error("Size must be at least 2x2.");
  }

  return { pointColumns: columns, pointRows: rows };
}

function applySize(options, value) {
  const size = parseSize(value);
  options.pointColumns = size.pointColumns;
  options.pointRows = size.pointRows;
}

function collectArgs(rawArgs) {
  const options = {
    count: 1,
    seed: "level",
    pointColumns: 7,
    pointRows: 7,
    algorithm: "free-placement",
    pretty: true,
    logFallbackWarning: false
  };
  const explicit = {
    count: false,
    seed: false,
    size: false
  };
  const positionals = [];
  let help = false;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--help" || arg === "-h" || arg === "/?") {
      help = true;
      continue;
    }

    if (arg.startsWith("--no-")) {
      options[toCamelKey(arg.slice(5))] = false;
      continue;
    }

    if (arg.startsWith("--")) {
      const equalIndex = arg.indexOf("=");
      const rawKey = equalIndex >= 0 ? arg.slice(2, equalIndex) : arg.slice(2);
      const key = toCamelKey(rawKey);
      const inlineValue = equalIndex >= 0 ? arg.slice(equalIndex + 1) : undefined;
      const result = readFlagValue(rawArgs, index, key, inlineValue);

      index = result.nextIndex;

      if (key === "size") {
        applySize(options, result.value);
        explicit.size = true;
      } else {
        options[key] = NUMBER_KEYS.has(key) ? Number(result.value) : parseScalar(result.value);

        if (key === "count" || key === "seed") {
          explicit[key] = true;
        } else if (key === "pointColumns" || key === "pointRows") {
          explicit.size = true;
        }
      }

      continue;
    }

    if (arg.startsWith("-") && arg.length > 1) {
      const key = toCamelKey(arg.slice(1));
      const result = readFlagValue(rawArgs, index, key);

      index = result.nextIndex;
      options[key] = NUMBER_KEYS.has(key) ? Number(result.value) : parseScalar(result.value);

      if (key === "count" || key === "seed") {
        explicit[key] = true;
      }
      continue;
    }

    positionals.push(arg);
  }

  return { help, options, positionals, explicit };
}

function applyPositionals(options, positionals, explicit = {}) {
  let countSet = Boolean(explicit.count);
  let sizeSet = Boolean(explicit.size);
  let seedSet = Boolean(explicit.seed);

  for (const value of positionals) {
    const lower = value.toLowerCase();

    if (DIFFICULTY_LABELS.has(lower)) {
      throw new Error("Difficulty is classified after generation. Omit easy/normal/hard here and filter generated output by difficulty.");
    }

    if (/^\d+x\d+$/i.test(value)) {
      applySize(options, value);
      sizeSet = true;
      continue;
    }

    if (/^\d+$/.test(value)) {
      if (!countSet) {
        options.count = Number(value);
        countSet = true;
      } else if (!sizeSet) {
        applySize(options, value);
        sizeSet = true;
      } else {
        throw new Error(`Unexpected positional value "${value}"`);
      }
      continue;
    }

    if (!seedSet) {
      options.seed = value;
      seedSet = true;
      continue;
    }

    throw new Error(`Unexpected positional value "${value}"`);
  }
}

function validateOptions(options) {
  if (!Number.isSafeInteger(options.count) || options.count < 1) {
    throw new Error("Count must be a positive integer.");
  }

  if (!ALGORITHMS.has(options.algorithm)) {
    throw new Error("Algorithm must be free-placement or reverse.");
  }

  if (!Number.isSafeInteger(options.pointColumns) || !Number.isSafeInteger(options.pointRows)) {
    throw new Error("Board size must use integer columns and rows.");
  }
}

function applyShape(options) {
  if (!options.shape) {
    return;
  }

  const shapeName = String(options.shape).toLowerCase();
  const rows = SHAPES[shapeName];

  if (!rows) {
    throw new Error(`Unknown shape "${options.shape}". Use gem, plus, or heart.`);
  }

  const shape = rules.buildMaskFromRows(rows);
  options.mask = shape.mask;
  options.pointColumns = shape.pointColumns;
  options.pointRows = shape.pointRows;
}

function buildGeneratorOptions(options, index) {
  const ignoredKeys = new Set(["count", "json", "pretty", "out", "solution", "shape", "debug", "app"]);
  const generatorOptions = {};

  for (const [key, value] of Object.entries(options)) {
    if (!ignoredKeys.has(key) && value !== undefined) {
      generatorOptions[key] = value;
    }
  }

  generatorOptions.id = index;
  generatorOptions.seed = options.count === 1 ? options.seed : `${options.seed}-${index}`;

  if (options.debug) {
    generatorOptions.captureFailurePreview = true;
    generatorOptions.returnFailurePreview = true;
    generatorOptions.debugGeneratedLevel = true;
  }

  return generatorOptions;
}

function jsonReplacer(_key, value) {
  if (value instanceof Set) {
    return [...value].sort();
  }

  return value;
}

function summarize(level, index, options) {
  const stats = level.stats || {};
  const parts = [
    `${index}.`,
    level.seed,
    `difficulty=${level.difficulty || stats.classifiedDifficulty || "?"}`,
    `${level.pointColumns}x${level.pointRows}`,
    `arrows=${level.arrows.length}`,
    `initial=${stats.initialMoves ?? "?"}`,
    `depth=${stats.dependencyDepth ?? "?"}`,
    `score=${stats.difficultyScore ?? "?"}`,
    `mode=${stats.generationMode || "?"}`
  ];

  if (level.debugPreview) {
    parts.push("debugPreview=true");
  }

  const lines = [parts.join(" ")];

  if (options.solution) {
    lines.push(`   solution=${level.solutionOrder.join(",")}`);
  }

  return lines.join("\n");
}

function writeJson(target, payload, pretty) {
  const json = JSON.stringify(payload, jsonReplacer, pretty ? 2 : 0);

  if (target) {
    fs.writeFileSync(path.resolve(process.cwd(), target), `${json}\n`);
    return;
  }

  console.log(json);
}

function toLevelStoreSource(levels) {
  const json = JSON.stringify(levels, jsonReplacer, 2)
    .split("\n")
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join("\n");

  return `(function () {
  "use strict";

  window.ARROW_PUZZLE_LEVELS = ${json};
}());
`;
}

function writeLevelStore(target, levels) {
  const outputPath = path.resolve(process.cwd(), target || path.join("src", "levels.js"));
  fs.writeFileSync(outputPath, toLevelStoreSource(levels));
  return outputPath;
}

function buildAppLevelOptions(layout, index, options) {
  const levelOptions = {
    id: index,
    seed: layout.seed || `level-${index}`,
    color: "#111a4f",
    maxAttempts: options.maxAttempts || 120,
    logFallbackWarning: false
  };

  if (layout.maskRows) {
    const shape = rules.buildMaskFromRows(layout.maskRows);
    levelOptions.mask = shape.mask;
    levelOptions.pointColumns = shape.pointColumns;
    levelOptions.pointRows = shape.pointRows;
  } else {
    levelOptions.pointColumns = layout.pointColumns;
    levelOptions.pointRows = layout.pointRows;
  }

  return levelOptions;
}

function generateAppLevels(options) {
  return APP_LEVEL_LAYOUTS.map((layout, index) => {
    const level = generator.generateLevel(buildAppLevelOptions(layout, index + 1, options));
    level.name = layout.name;
    return level;
  });
}

function main() {
  const parsed = collectArgs(process.argv.slice(2));

  if (parsed.help) {
    printHelp();
    return;
  }

  applyPositionals(parsed.options, parsed.positionals, parsed.explicit);
  applyShape(parsed.options);
  validateOptions(parsed.options);

  if (parsed.options.app) {
    const levels = generateAppLevels(parsed.options);

    if (parsed.options.json) {
      writeJson(parsed.options.out, levels, parsed.options.pretty);
    } else {
      const outputPath = writeLevelStore(parsed.options.out, levels);
      console.log(`Saved ${levels.length} app levels to ${outputPath}`);
    }

    console.log(levels.map((level, index) => summarize(level, index + 1, parsed.options)).join("\n"));
    return;
  }

  const levels = [];

  for (let index = 1; index <= parsed.options.count; index += 1) {
    const generatorOptions = buildGeneratorOptions(parsed.options, index);
    const level = generator.generateLevel(generatorOptions);

    levels.push(level);
  }

  const payload = levels.length === 1 ? levels[0] : levels;

  if (parsed.options.json || parsed.options.out) {
    writeJson(parsed.options.out, payload, parsed.options.pretty);
  } else {
    const outputPath = writeLevelStore(null, levels);
    console.log(`Saved ${levels.length} level${levels.length === 1 ? "" : "s"} to ${outputPath}`);
  }

  if (!parsed.options.json || parsed.options.out) {
    console.log(levels.map((level, index) => summarize(level, index + 1, parsed.options)).join("\n"));

    if (parsed.options.out) {
      console.log(`Saved JSON to ${path.resolve(process.cwd(), parsed.options.out)}`);
    }
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
