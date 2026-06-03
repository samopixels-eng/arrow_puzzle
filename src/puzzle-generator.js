(function () {
  "use strict";

  const rules = window.ArrowPuzzleRules;
  const solver = window.ArrowPuzzleSolver;
  const DEFAULT_COLOR = "#111a4f";

  if (!rules || !solver) {
    throw new Error("ArrowPuzzleRules and ArrowPuzzleSolver must load before puzzle-generator.js");
  }

  const DIFFICULTY_CONFIGS = {
    easy: {
      minEdges: 1,
      maxEdges: 2,
      targetInitialMoves: [3, 5],
      targetDependencyRatio: 0.3,
      pathAttempts: 90,
      solutionCountCap: 600
    },
    normal: {
      minEdges: 1,
      maxEdges: 4,
      targetInitialMoves: [2, 4],
      targetDependencyRatio: 0.5,
      pathAttempts: 120,
      solutionCountCap: 600
    },
    hard: {
      minEdges: 2,
      maxEdges: 5,
      targetInitialMoves: [1, 2],
      targetDependencyRatio: 0.7,
      pathAttempts: 160,
      solutionCountCap: 600
    }
  };

  function hashSeed(seed) {
    let hash = 2166136261;
    const text = String(seed);

    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
  }

  function createRandom(seed) {
    let state = hashSeed(seed) || 1;

    return function random() {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randomInt(random, min, max) {
    return Math.floor(random() * (max - min + 1)) + min;
  }

  function shuffle(items, random) {
    const shuffled = [...items];

    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      const item = shuffled[index];
      shuffled[index] = shuffled[swapIndex];
      shuffled[swapIndex] = item;
    }

    return shuffled;
  }

  function pointKey(point) {
    return rules.pointKey(point[0], point[1]);
  }

  function clonePoint(point) {
    return [point[0], point[1]];
  }

  function pointsEqual(a, b) {
    return a[0] === b[0] && a[1] === b[1];
  }

  function removeUsedPoints(freeKeys, points) {
    const next = new Set(freeKeys);

    for (const point of points) {
      next.delete(pointKey(point));
    }

    return next;
  }

  function getTurnCount(path) {
    let turns = 0;

    for (let index = 1; index < path.length - 1; index += 1) {
      const previous = path[index - 1];
      const current = path[index];
      const next = path[index + 1];
      const dx1 = Math.sign(current[0] - previous[0]);
      const dy1 = Math.sign(current[1] - previous[1]);
      const dx2 = Math.sign(next[0] - current[0]);
      const dy2 = Math.sign(next[1] - current[1]);

      if (dx1 !== dx2 || dy1 !== dy2) {
        turns += 1;
      }
    }

    return turns;
  }

  function simplifyGridPath(points) {
    if (points.length <= 2) {
      return points.map(clonePoint);
    }

    const simplified = [clonePoint(points[0])];

    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = simplified[simplified.length - 1];
      const current = points[index];
      const next = points[index + 1];
      const sameX = previous[0] === current[0] && current[0] === next[0];
      const sameY = previous[1] === current[1] && current[1] === next[1];

      if (!sameX && !sameY) {
        simplified.push(clonePoint(current));
      }
    }

    simplified.push(clonePoint(points[points.length - 1]));
    return simplified;
  }

  function isRemainderPossible(level, freeKeys) {
    if (freeKeys.size === 0) {
      return true;
    }

    const components = rules.getComponentsFromKeys(level, freeKeys);
    return components.every((component) => component.length !== 1);
  }

  function chooseComponent(level, freeKeys, random) {
    const components = rules
      .getComponentsFromKeys(level, freeKeys)
      .filter((component) => component.length >= 2);

    if (components.length === 0) {
      return null;
    }

    const weighted = [];

    for (const component of components) {
      const weight = Math.max(1, Math.ceil(component.length / 3));

      for (let index = 0; index < weight; index += 1) {
        weighted.push(component);
      }
    }

    return weighted[Math.floor(random() * weighted.length)];
  }

  function growPath(level, component, targetEdges, freeKeys, random) {
    const componentKeys = new Set(component.map(pointKey));
    const starts = shuffle(component, random);

    for (const start of starts) {
      const path = [clonePoint(start)];
      const used = new Set([pointKey(start)]);

      while (path.length - 1 < targetEdges) {
        const current = path[path.length - 1];
        const neighbors = shuffle(rules.getPointNeighbors(level, current), random)
          .filter((neighbor) => {
            const key = pointKey(neighbor);
            return freeKeys.has(key) && componentKeys.has(key) && !used.has(key);
          });

        if (neighbors.length === 0) {
          break;
        }

        const next = neighbors[0];
        path.push(clonePoint(next));
        used.add(pointKey(next));
      }

      if (path.length >= 2) {
        return path;
      }
    }

    return null;
  }

  function buildArrowCandidate(level, placedArrows, rawPoints, freeAfter, id, color, random) {
    const forward = simplifyGridPath(rawPoints);
    const backward = simplifyGridPath([...rawPoints].reverse());
    let orientations = shuffle([forward, backward], random);

    if (freeAfter.size === 0) {
      orientations = orientations.filter((path) => {
        const arrow = { id, color, path };
        return rules.isOuterExit(level, arrow);
      });
    }

    for (const path of orientations) {
      const arrow = { id, color, path };
      const geometry = rules.validateGeometry({
        pointColumns: level.pointColumns,
        pointRows: level.pointRows,
        arrows: placedArrows.concat(arrow)
      });

      if (!geometry.valid) {
        continue;
      }

      if (rules.isArrowRemovable(level, placedArrows.concat(arrow), arrow)) {
        return arrow;
      }
    }

    return null;
  }

  function scoreInsertion(level, placedArrows, arrow) {
    const removableBefore = rules.getRemovableArrows(level, placedArrows).length;
    const withArrow = placedArrows.concat(arrow);
    const existingRemovableAfter = placedArrows
      .filter((placedArrow) => rules.isArrowRemovable(level, withArrow, placedArrow))
      .length;
    const blockedGain = removableBefore - existingRemovableAfter;
    const metrics = rules.buildPathMetrics(arrow.path);

    return (
      blockedGain * 20 -
      existingRemovableAfter * 3 +
      getTurnCount(arrow.path) * 2 +
      metrics.length * 0.25
    );
  }

  function findCandidatePath(level, freeKeys, placedArrows, random, config) {
    const id = `a${placedArrows.length + 1}`;
    let best = null;

    for (let attempt = 0; attempt < config.pathAttempts; attempt += 1) {
      const component = chooseComponent(level, freeKeys, random);

      if (!component) {
        return null;
      }

      const maxEdges = Math.min(config.maxEdges, component.length - 1);
      const minEdges = Math.min(config.minEdges, maxEdges);
      let targetEdges = randomInt(random, minEdges, maxEdges);

      if (component.length <= config.maxEdges + 1 && random() < 0.55) {
        targetEdges = component.length - 1;
      }

      const rawPoints = growPath(level, component, targetEdges, freeKeys, random);

      if (!rawPoints || rawPoints.length < 2) {
        continue;
      }

      const usedKeys = new Set(rawPoints.map(pointKey));

      if (usedKeys.size !== rawPoints.length) {
        continue;
      }

      const freeAfter = removeUsedPoints(freeKeys, rawPoints);

      if (!isRemainderPossible(level, freeAfter)) {
        continue;
      }

      const arrow = buildArrowCandidate(level, placedArrows, rawPoints, freeAfter, id, config.color, random);

      if (arrow) {
        const score = scoreInsertion(level, placedArrows, arrow);
        const candidate = {
          arrow,
          freeAfter,
          score
        };

        if (!best || candidate.score > best.score) {
          best = candidate;
        }
      }
    }

    return best;
  }

  function buildReverseCandidate(seed, config, attemptIndex) {
    const random = createRandom(`${seed}:${attemptIndex}`);
    const levelShell = {
      pointColumns: config.pointColumns,
      pointRows: config.pointRows,
      arrows: []
    };
    let freeKeys = new Set(rules.getAllPointKeys(levelShell));
    const arrows = [];
    const maxArrows = config.pointColumns * config.pointRows;

    while (freeKeys.size > 0) {
      if (arrows.length >= maxArrows) {
        return null;
      }

      const candidate = findCandidatePath(levelShell, freeKeys, arrows, random, config);

      if (!candidate) {
        return null;
      }

      arrows.push(candidate.arrow);
      freeKeys = candidate.freeAfter;
      levelShell.arrows = arrows;
    }

    const solutionOrder = arrows.map((arrow) => arrow.id).reverse();
    const first = arrows.find((arrow) => arrow.id === solutionOrder[0]);

    if (!first || !rules.isOuterExit(levelShell, first)) {
      return null;
    }

    const level = {
      id: config.id,
      seed: `${seed}:${attemptIndex}`,
      pointColumns: config.pointColumns,
      pointRows: config.pointRows,
      arrows: arrows.map(rules.cloneArrow),
      solutionOrder,
      generated: true,
      requireFullPointCover: true
    };
    const geometry = rules.validateGeometry(level, {
      requireFullPointCover: true,
      solutionOrder,
      requireFirstExit: true
    });

    if (!geometry.valid) {
      return null;
    }

    const known = rules.validateKnownSolution(level, solutionOrder);

    if (!known.valid) {
      return null;
    }

    return level;
  }

  function scoreLevel(level, stats, config) {
    const blockedAtStartCount = level.arrows.length - stats.initialMoves;
    const turnCountScore = level.arrows.reduce((sum, arrow) => sum + getTurnCount(arrow.path), 0);
    const visualCongestionScore = level.arrows.length / 2;
    const targetInitialMin = config.targetInitialMoves[0];
    const targetInitialMax = config.targetInitialMoves[1];
    const initialPenalty =
      stats.initialMoves < targetInitialMin
        ? (targetInitialMin - stats.initialMoves) * 8
        : Math.max(0, stats.initialMoves - targetInitialMax) * 8;
    const cappedPenalty = stats.solutionCountCapped ? 8 : 0;

    return (
      stats.dependencyDepth * 3 -
      stats.initialMoves * 2 -
      stats.knownAverageBranching +
      blockedAtStartCount +
      turnCountScore +
      visualCongestionScore -
      initialPenalty -
      cappedPenalty
    );
  }

  function matchesTargets(level, stats, config) {
    const minDependencyDepth = Math.floor(level.arrows.length * config.targetDependencyRatio);

    return (
      stats.initialMoves >= config.targetInitialMoves[0] &&
      stats.initialMoves <= config.targetInitialMoves[1] &&
      stats.dependencyDepth >= minDependencyDepth &&
      stats.knownSolutionValid &&
      stats.solvable
    );
  }

  function normalizeConfig(options) {
    const difficulty = options.difficulty || "normal";
    const difficultyConfig = DIFFICULTY_CONFIGS[difficulty] || DIFFICULTY_CONFIGS.normal;

    return {
      ...difficultyConfig,
      ...options,
      id: options.id || 1,
      seed: options.seed || "level-1",
      color: options.color || DEFAULT_COLOR,
      pointColumns: options.pointColumns || 7,
      pointRows: options.pointRows || 7,
      maxAttempts: options.maxAttempts || 250,
      logFallbackWarning: options.logFallbackWarning !== false,
      difficulty
    };
  }

  function attachStats(level, stats, score) {
    return {
      ...level,
      stats: {
        initialMoves: stats.initialMoves,
        initialMoveIds: [...stats.initialMoveIds],
        averageBranching: Number(stats.averageBranching.toFixed(3)),
        knownAverageBranching: Number(stats.knownAverageBranching.toFixed(3)),
        maxBranching: stats.maxBranching,
        dependencyDepth: stats.dependencyDepth,
        solutionCount: stats.solutionCount,
        solutionCountCapped: stats.solutionCountCapped,
        visitedStates: stats.visitedStates,
        difficultyScore: Number(score.toFixed(3))
      }
    };
  }

  function generateLevel(options = {}) {
    const config = normalizeConfig(options);
    let best = null;

    for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
      const candidate = buildReverseCandidate(config.seed, config, attempt);

      if (!candidate) {
        continue;
      }

      const stats = solver.solveLevel(candidate, {
        solutionOrder: candidate.solutionOrder,
        requireFullPointCover: true,
        requireFirstExit: true,
        solutionCountCap: config.solutionCountCap
      });

      if (!stats.solvable || !stats.knownSolutionValid) {
        continue;
      }

      const score = scoreLevel(candidate, stats, config);
      const level = attachStats(candidate, stats, score);

      if (!best || level.stats.difficultyScore > best.stats.difficultyScore) {
        best = level;
      }

      if (matchesTargets(candidate, stats, config)) {
        return level;
      }
    }

    if (best) {
      if (config.logFallbackWarning) {
        console.warn("Generated level did not hit every target; using best candidate", best.stats);
      }

      return best;
    }

    throw new Error(`Unable to generate a solvable level for seed ${config.seed}`);
  }

  window.ArrowPuzzleGenerator = {
    generateLevel,
    createRandom,
    DIFFICULTY_CONFIGS
  };
}());
