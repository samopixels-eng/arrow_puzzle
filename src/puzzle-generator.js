(function () {
  "use strict";

  const rules = window.ArrowPuzzleRules;
  const solver = window.ArrowPuzzleSolver;
  const DEFAULT_COLOR = "#111a4f";
  const DEFAULT_TILE_SIZE = 8;
  const MIN_TILE_SIZE = 2;
  const ALGORITHMS = new Set(["free-placement", "reverse", "flow"]);
  let lastDebugPreviewLevel = null;

  if (!rules || !solver) {
    throw new Error("ArrowPuzzleRules and ArrowPuzzleSolver must load before puzzle-generator.js");
  }

  // longLineRatio: a "long" arrow spans at least this fraction of the larger
  //   board dimension (≈10%), so long lines scale with map size.
  // longLineChance: probability a given placement attempt aims for a long spine.
  // longLineMaxEdges: upper bound on a spine length (also capped by free space).
  // straightBias: chance a spine keeps its current direction (straighter lines).
  // rayBias: chance a short filler routes onto a placed arrow's exit ray
  //   (creates interlocking by blocking that arrow at the start).
  const GENERATION_CONFIG = {
    minEdges: 1,
    maxEdges: 6,
    pathAttempts: 130,
    solutionCountCap: 600,
    longLineRatio: 0.1,
    longLineQuota: 0.18,
    longLineChance: 0.32,
    longLineMaxEdges: 12,
    longLineMaxRatio: 0.38,
    straightBias: 0.82,
    rayBias: 0.7,
    fillerSearchLimit: 340,
    longLineSearchLimit: 2400
  };

  const DIFFICULTY_RULES = {
    easy: {
      initialMoves: [4, Infinity],
      dependencyRatio: [0, 0.44],
      averageBranching: [3, Infinity]
    },
    normal: {
      initialMoves: [2, 4],
      dependencyRatio: [0.35, 0.69],
      averageBranching: [1.7, 4.5]
    },
    hard: {
      initialMoves: [1, 2],
      dependencyRatio: [0.62, Infinity],
      averageBranching: [0, 2.8]
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

  function buildWeightedComponents(level, freeKeys) {
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

    return weighted;
  }

  function pickWeighted(weighted, random) {
    return weighted[Math.floor(random() * weighted.length)];
  }

  function scoreNeighbor(level, neighbor, current, previous, rayInfo, options) {
    let score = rules.getPointNeighbors(level, neighbor).length * 0.2;

    if (previous && options.straightBias) {
      const currentDx = Math.sign(current[0] - previous[0]);
      const currentDy = Math.sign(current[1] - previous[1]);
      const nextDx = Math.sign(neighbor[0] - current[0]);
      const nextDy = Math.sign(neighbor[1] - current[1]);

      if (currentDx === nextDx && currentDy === nextDy) {
        score += options.straightBias * 10;
      }
    }

    if (rayInfo && rayInfo.keys.has(pointKey(neighbor))) {
      score += (options.rayBias || 0) * 10;
      score += rayInfo.byKey.get(pointKey(neighbor)).length * 2;
    }

    return score;
  }

  function orderCandidateNeighbors(level, neighbors, current, previous, rayInfo, options, random) {
    return shuffle(neighbors, random)
      .map((neighbor) => ({
        point: neighbor,
        score: scoreNeighbor(level, neighbor, current, previous, rayInfo, options)
      }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.point);
  }

  function growPath(level, component, targetEdges, freeKeys, random, rayInfo, options = {}) {
    const componentKeys = new Set(component.map(pointKey));
    const starts = shuffle(component, random);
    const requireTargetLength = options.requireTargetLength !== false;
    let remainingSearch = options.searchLimit || 300;
    let best = null;

    function rememberBest(path) {
      if (path.length >= 2 && (!best || path.length > best.length)) {
        best = path.map(clonePoint);
      }
    }

    function search(path, used) {
      remainingSearch -= 1;

      if (remainingSearch <= 0) {
        rememberBest(path);
        return false;
      }

      if (path.length - 1 >= targetEdges) {
        best = path.map(clonePoint);
        return true;
      }

      const current = path[path.length - 1];
      const previous = path.length >= 2 ? path[path.length - 2] : null;
      const neighbors = orderCandidateNeighbors(
        level,
        rules.getPointNeighbors(level, current).filter((neighbor) => {
          const key = pointKey(neighbor);
          return freeKeys.has(key) && componentKeys.has(key) && !used.has(key);
        }),
        current,
        previous,
        rayInfo,
        options,
        random
      );

      if (neighbors.length === 0) {
        rememberBest(path);
        return false;
      }

      for (const next of neighbors) {
        const key = pointKey(next);
        path.push(clonePoint(next));
        used.add(key);

        if (search(path, used)) {
          return true;
        }

        used.delete(key);
        path.pop();
      }

      rememberBest(path);
      return false;
    }

    for (const start of starts) {
      const path = [clonePoint(start)];
      const used = new Set([pointKey(start)]);

      if (search(path, used)) {
        return best;
      }

      if (remainingSearch <= 0) {
        break;
      }
    }

    if (!requireTargetLength && best && best.length >= 2) {
      return best;
    }

    return best && best.length - 1 >= targetEdges ? best : null;
  }

  function preferExitOrientations(level, orientations, id, color, preferredExitDirections) {
    const outer = orientations.filter((path) => rules.isOuterExit(level, { id, color, path }));

    if (!preferredExitDirections || preferredExitDirections.length === 0) {
      return outer;
    }

    const preferred = outer.filter((path) => {
      const direction = rules.getHeadDirection(path);
      return direction && preferredExitDirections.includes(direction.name);
    });

    return preferred.length > 0 ? preferred : outer;
  }

  function buildArrowCandidate(level, placedArrows, rawPoints, freeAfter, id, config, random) {
    const forward = simplifyGridPath(rawPoints);
    const backward = simplifyGridPath([...rawPoints].reverse());
    let orientations = shuffle([forward, backward], random);

    if (freeAfter.size === 0 && config.requireOuterFirst !== false) {
      orientations = preferExitOrientations(level, orientations, id, config.color, config.preferredExitDirections);
    }

    for (const path of orientations) {
      const arrow = { id, color: config.color, path };
      // Candidate paths are built only from free points, so they are disjoint
      // from already-placed arrows by construction. Validating the single new
      // arrow (self-overlap, bounds, head direction) is therefore equivalent to
      // validating the whole board but O(arrow) instead of O(board). The full
      // cross-arrow geometry check still runs once in buildReverseCandidate.
      const geometry = rules.validateGeometry({
        pointColumns: level.pointColumns,
        pointRows: level.pointRows,
        mask: level.mask,
        arrows: [arrow]
      });

      if (!geometry.valid) {
        continue;
      }

      const isSelfRemovable = rules.isArrowRemovable(level, [arrow], arrow);
      const isInsertionRemovable = config.requireInsertionRemovable === false ||
        rules.isArrowRemovable(level, placedArrows.concat(arrow), arrow);

      if (isSelfRemovable && isInsertionRemovable) {
        return arrow;
      }
    }

    return null;
  }

  function pathSignature(path) {
    return path.map(pointKey).join(";");
  }

  function getArrowPointKeys(arrow) {
    return [...rules.expandPath(arrow.path).points];
  }

  function getNextArrowIndex(arrows) {
    let maxIndex = 0;

    for (const arrow of arrows) {
      const match = String(arrow.id).match(/^a(\d+)$/);

      if (match) {
        maxIndex = Math.max(maxIndex, Number(match[1]));
      }
    }

    return maxIndex + 1;
  }

  function buildOwnerMaps(arrows) {
    const points = new Map();
    const edges = new Map();

    for (const arrow of arrows) {
      const occupied = rules.expandPath(arrow.path);

      for (const key of occupied.points) {
        points.set(key, arrow.id);
      }

      for (const key of occupied.edges) {
        edges.set(key, arrow.id);
      }
    }

    return { points, edges };
  }

  function buildFreeArrowCandidate(level, rawPoints, id, config, random) {
    const forward = simplifyGridPath(rawPoints);
    const backward = simplifyGridPath([...rawPoints].reverse());
    const orientations = shuffle([forward, backward], random);

    for (const path of orientations) {
      const arrow = { id, color: config.color, path };
      const geometry = rules.validateGeometry({
        pointColumns: level.pointColumns,
        pointRows: level.pointRows,
        mask: level.mask,
        arrows: [arrow]
      });

      if (!geometry.valid) {
        continue;
      }

      if (rules.isArrowRemovable(level, [arrow], arrow)) {
        return arrow;
      }
    }

    return null;
  }

  function collectFreePlacementCandidates(level, freeKeys, random, config, id) {
    const components = rules
      .getComponentsFromKeys(level, freeKeys)
      .filter((component) => component.length >= 2)
      .sort((a, b) => a.length - b.length);
    const candidates = [];
    const seen = new Set();
    const componentLimit = Math.min(config.freePlacementComponentLimit, components.length);
    const longLineMinEdges = getLongLineMinEdges(level, config);

    function considerRawPoints(rawPoints, component, extraScore = 0) {
      if (!rawPoints || rawPoints.length < 2) {
        return false;
      }

      const usedKeys = new Set(rawPoints.map(pointKey));

      if (usedKeys.size !== rawPoints.length) {
        return false;
      }

      const freeAfter = removeUsedPoints(freeKeys, rawPoints);

      if (!isRemainderPossible(level, freeAfter)) {
        return false;
      }

      const arrow = buildFreeArrowCandidate(level, rawPoints, id, config, random);

      if (!arrow) {
        return false;
      }

      const signature = pathSignature(arrow.path);

      if (seen.has(signature)) {
        return false;
      }

      seen.add(signature);

      const metrics = rules.buildPathMetrics(arrow.path);
      const remainderComponents = freeAfter.size === 0
        ? []
        : rules.getComponentsFromKeys(level, freeAfter);
      const smallestRemainder = remainderComponents.length === 0
        ? 0
        : Math.min(...remainderComponents.map((entry) => entry.length));
      const completedSmallComponent = rawPoints.length === component.length && component.length <= config.maxEdges + 1;
      const isLong = metrics.length >= longLineMinEdges;

      candidates.push({
        arrow,
        freeAfter,
        score:
          extraScore +
          metrics.length * 1.7 +
          (isLong ? 8 : 0) +
          (completedSmallComponent ? 18 : 0) +
          smallestRemainder * 0.35 -
          remainderComponents.length * 0.75 +
          getTurnCount(arrow.path) * 0.6
      });

      return true;
    }

    for (let componentIndex = 0; componentIndex < componentLimit; componentIndex += 1) {
      const component = components[componentIndex];
      const maxEdges = Math.min(
        component.length - 1,
        Math.max(config.maxEdges, Math.min(config.longLineMaxEdges || config.maxEdges, longLineMinEdges + 1))
      );
      const minEdges = Math.min(config.minEdges, maxEdges);

      if (component.length <= config.maxEdges + 1) {
        const rawPoints = growPath(level, component, component.length - 1, freeKeys, random, null, {
          straightBias: config.straightBias,
          searchLimit: config.freePlacementSearchLimit,
          requireTargetLength: true
        });
        considerRawPoints(rawPoints, component, 12);
      }

      for (let attempt = 0; attempt < config.freePlacementCandidateAttempts; attempt += 1) {
        const wantLong = component.length - 1 >= longLineMinEdges && random() < config.longLineChance;
        const targetMax = wantLong
          ? Math.min(maxEdges, Math.max(longLineMinEdges, config.maxEdges))
          : Math.min(maxEdges, config.maxEdges);
        const targetMin = wantLong ? Math.min(longLineMinEdges, targetMax) : minEdges;
        const targetEdges = randomInt(random, targetMin, targetMax);
        const rawPoints = growPath(level, component, targetEdges, freeKeys, random, null, {
          straightBias: config.straightBias,
          searchLimit: wantLong ? config.longLineSearchLimit : config.freePlacementSearchLimit,
          requireTargetLength: true
        });

        considerRawPoints(rawPoints, component);
      }

      for (const point of shuffle(component, random)) {
        const neighbor = shuffle(rules.getPointNeighbors(level, point), random)
          .find((entry) => freeKeys.has(pointKey(entry)));

        if (neighbor) {
          considerRawPoints([point, neighbor], component, -4);
        }

        if (candidates.length >= config.freePlacementBranchLimit * 2) {
          break;
        }
      }
    }

    return candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, config.freePlacementBranchLimit);
  }

  function fillFreePlacement(level, initialArrows, initialFreeKeys, random, config) {
    const failed = new Set();
    const startIndex = getNextArrowIndex(initialArrows);
    let visitedStates = 0;
    let lastFailure = {
      reason: "free-placement-not-started",
      arrows: initialArrows,
      freeKeys: initialFreeKeys
    };

    function freeStateKey(freeKeys) {
      return [...freeKeys].sort().join("|");
    }

    function search(arrows, freeKeys) {
      visitedStates += 1;

      if (visitedStates > config.freePlacementNodeLimit) {
        lastFailure = {
          reason: "free-placement-node-limit",
          arrows,
          freeKeys,
          details: { visitedStates }
        };
        return null;
      }

      if (freeKeys.size === 0) {
        return arrows;
      }

      if (!isRemainderPossible(level, freeKeys)) {
        lastFailure = {
          reason: "free-placement-singleton",
          arrows,
          freeKeys
        };
        return null;
      }

      const key = freeStateKey(freeKeys);

      if (failed.has(key)) {
        return null;
      }

      const id = `a${startIndex + arrows.length - initialArrows.length}`;
      const candidates = collectFreePlacementCandidates(level, freeKeys, random, config, id);

      if (candidates.length === 0) {
        lastFailure = {
          reason: "free-placement-candidate-missing",
          arrows,
          freeKeys
        };
        failed.add(key);
        return null;
      }

      for (const candidate of candidates) {
        const result = search(arrows.concat(candidate.arrow), candidate.freeAfter);

        if (result) {
          return result;
        }
      }

      failed.add(key);
      return null;
    }

    const arrows = search(initialArrows.map(rules.cloneArrow), new Set(initialFreeKeys));

    return {
      arrows,
      visitedStates,
      failure: lastFailure
    };
  }

  function replaceArrowAt(arrows, index, replacement) {
    return arrows.map((arrow, arrowIndex) => (
      arrowIndex === index ? replacement : rules.cloneArrow(arrow)
    ));
  }

  function tryOrientExistingOuterExit(level, random) {
    const arrowIndexes = shuffle(level.arrows.map((_arrow, index) => index), random);

    for (const index of arrowIndexes) {
      const arrow = level.arrows[index];
      const paths = shuffle([
        arrow.path.map(clonePoint),
        [...arrow.path].reverse().map(clonePoint)
      ], random);

      for (const path of paths) {
        const replacement = { ...arrow, path };

        if (!rules.isOuterExit(level, replacement)) {
          continue;
        }

        const arrows = replaceArrowAt(level.arrows, index, replacement);
        const geometry = rules.validateGeometry({ ...level, arrows }, {
          requireFullPointCover: true
        });

        if (!geometry.valid) {
          continue;
        }

        if (rules.isArrowRemovable(level, arrows, replacement)) {
          return {
            arrows,
            repair: {
              type: "orient-existing-outer-exit",
              arrowId: replacement.id
            }
          };
        }
      }
    }

    return null;
  }

  function getBoundaryExitPairs(level) {
    const pairs = [];

    for (const key of rules.getAllPointKeys(level)) {
      const point = rules.parsePointKey(key);
      const options = [
        { edge: point[0] === 0, inward: [point[0] + 1, point[1]] },
        { edge: point[0] === level.pointColumns - 1, inward: [point[0] - 1, point[1]] },
        { edge: point[1] === 0, inward: [point[0], point[1] + 1] },
        { edge: point[1] === level.pointRows - 1, inward: [point[0], point[1] - 1] }
      ];

      for (const option of options) {
        if (option.edge && rules.isActivePoint(level, option.inward)) {
          pairs.push({
            boundary: point,
            inward: option.inward
          });
        }
      }
    }

    return pairs;
  }

  function tryForceBoundaryExit(level, random, config) {
    const pairs = shuffle(getBoundaryExitPairs(level), random).slice(0, config.repairAttempts);
    const ownerMaps = buildOwnerMaps(level.arrows);

    for (const pair of pairs) {
      const boundaryKey = pointKey(pair.boundary);
      const inwardKey = pointKey(pair.inward);
      const edge = rules.edgeKey(pair.boundary, pair.inward);
      const removeIds = new Set([
        ownerMaps.points.get(boundaryKey),
        ownerMaps.points.get(inwardKey),
        ownerMaps.edges.get(edge)
      ].filter(Boolean));

      if (removeIds.size === 0) {
        continue;
      }

      const removed = level.arrows.filter((arrow) => removeIds.has(arrow.id));
      const kept = level.arrows.filter((arrow) => !removeIds.has(arrow.id)).map(rules.cloneArrow);
      const exitArrow = {
        id: `a${getNextArrowIndex(level.arrows)}`,
        color: config.color,
        path: [clonePoint(pair.inward), clonePoint(pair.boundary)]
      };
      const exitGeometry = rules.validateGeometry({
        pointColumns: level.pointColumns,
        pointRows: level.pointRows,
        mask: level.mask,
        arrows: [exitArrow]
      });

      if (!exitGeometry.valid || !rules.isOuterExit(level, exitArrow)) {
        continue;
      }

      const reserved = new Set(getArrowPointKeys(exitArrow));
      const freeKeys = new Set();

      for (const arrow of removed) {
        for (const key of getArrowPointKeys(arrow)) {
          if (!reserved.has(key)) {
            freeKeys.add(key);
          }
        }
      }

      if (!isRemainderPossible(level, freeKeys)) {
        continue;
      }

      const baseArrows = kept.concat(exitArrow);
      const fill = fillFreePlacement(level, baseArrows, freeKeys, random, config);

      if (!fill.arrows) {
        continue;
      }

      const repaired = {
        ...level,
        arrows: fill.arrows
      };
      const geometry = rules.validateGeometry(repaired, {
        requireFullPointCover: true
      });

      if (!geometry.valid) {
        continue;
      }

      const move = repaired.arrows.find((arrow) => arrow.id === exitArrow.id);

      if (move && rules.isArrowRemovable(repaired, repaired.arrows, move)) {
        return {
          arrows: repaired.arrows,
          repair: {
            type: "force-boundary-exit-redraw",
            arrowId: exitArrow.id,
            removed: [...removeIds],
            redrawnPoints: freeKeys.size,
            fillVisitedStates: fill.visitedStates
          }
        };
      }
    }

    return null;
  }

  function ensureInitialEscape(level, random, config) {
    const initialMoves = rules.getRemovableArrows(level, level.arrows);

    if (initialMoves.length > 0) {
      return {
        level,
        repair: null
      };
    }

    const oriented = tryOrientExistingOuterExit(level, random);

    if (oriented) {
      return {
        level: {
          ...level,
          arrows: oriented.arrows
        },
        repair: oriented.repair
      };
    }

    const forced = tryForceBoundaryExit(level, random, config);

    if (forced) {
      return {
        level: {
          ...level,
          arrows: forced.arrows
        },
        repair: forced.repair
      };
    }

    return null;
  }

  function attachDebugPreview(level, config, attemptIndex, reason, details = {}) {
    if (!config.debugGeneratedLevel) {
      return level;
    }

    return {
      ...level,
      debugPreview: true,
      debug: {
        preview: true,
        reason,
        details,
        attemptIndex,
        tile: null,
        freeKeys: [],
        placedArrowCount: level.arrows.length
      }
    };
  }

  function verifyFreePlacementLevel(level, config) {
    const geometry = rules.validateGeometry(level, {
      requireFullPointCover: true
    });

    if (!geometry.valid) {
      return {
        valid: false,
        reason: "free-final-geometry",
        details: {
          errors: geometry.errors ? geometry.errors.slice(0, 5) : []
        }
      };
    }

    const solved = solver.solveLevel(level, {
      requireFullPointCover: true,
      requireFirstExit: Boolean(config.requireFirstExit),
      solutionCountCap: 1,
      maxVisitedStates: config.solverVisitedStateLimit
    });

    if (!solved.solvable || solved.oneSolution.length !== level.arrows.length) {
      return {
        valid: false,
        reason: "free-solver",
        details: {
          visitedStates: solved.visitedStates,
          initialMoves: solved.initialMoves,
          capped: solved.solutionCountCapped
        }
      };
    }

    const solvedLevel = {
      ...level,
      solutionOrder: solved.oneSolution
    };
    const stats = solver.analyzeLevel(solvedLevel, {
      solutionOrder: solved.oneSolution
    });

    return {
      valid: true,
      level: solvedLevel,
      stats: {
        ...stats,
        solutionCount: solved.solutionCount,
        solutionCountCapped: solved.solutionCountCapped,
        visitedStates: solved.visitedStates,
        averageBranching: solved.averageBranching,
        maxBranching: solved.maxBranching
      }
    };
  }

  function buildFreePlacementCandidate(config, attemptIndex) {
    const random = createRandom(`${config.seed}:free:${attemptIndex}`);
    const levelShell = {
      pointColumns: config.pointColumns,
      pointRows: config.pointRows,
      mask: config.mask,
      arrows: []
    };
    const freeKeys = new Set(rules.getAllPointKeys(levelShell));
    const fill = fillFreePlacement(levelShell, [], freeKeys, random, config);

    if (!fill.arrows) {
      captureDebugPreview(config, {
        reason: fill.failure.reason,
        arrows: fill.failure.arrows || [],
        freeKeys: fill.failure.freeKeys || freeKeys,
        attemptIndex,
        details: fill.failure.details || {
          visitedStates: fill.visitedStates
        },
        mode: "debug-free-placement"
      });
      return null;
    }

    const level = {
      id: config.id,
      seed: `${config.seed}:free:${attemptIndex}`,
      pointColumns: config.pointColumns,
      pointRows: config.pointRows,
      mask: config.mask,
      arrows: fill.arrows.map(rules.cloneArrow),
      generated: true,
      requireFullPointCover: true,
      generationStats: {
        mode: "free-placement",
        fillVisitedStates: fill.visitedStates,
        repair: null
      }
    };
    const escaped = ensureInitialEscape(level, random, config);

    if (!escaped) {
      captureDebugPreview(config, {
        reason: "free-start-exit-repair-failed",
        arrows: level.arrows,
        freeKeys: [],
        attemptIndex,
        details: {
          initialMoves: 0
        },
        mode: "debug-free-placement"
      });
      return null;
    }

    const repairedLevel = {
      ...escaped.level,
      generationStats: {
        ...level.generationStats,
        repair: escaped.repair
      }
    };
    const verified = verifyFreePlacementLevel(repairedLevel, config);

    if (!verified.valid) {
      captureDebugPreview(config, {
        reason: verified.reason,
        arrows: repairedLevel.arrows,
        freeKeys: [],
        attemptIndex,
        details: verified.details,
        mode: "debug-free-placement"
      });
      return null;
    }

    const score = scoreLevel(verified.level, verified.stats, config);
    const levelWithStats = attachStats(verified.level, verified.stats, score);

    return attachDebugPreview(
      levelWithStats,
      config,
      attemptIndex,
      "verified-free-placement",
      {
        solverVisitedStates: verified.stats.visitedStates,
        initialMoves: verified.stats.initialMoves,
        repair: escaped.repair
      }
    );
  }

  function scoreRayIntersections(arrow, rayInfo) {
    if (!rayInfo || rayInfo.keys.size === 0) {
      return {
        crossings: 0,
        uniqueArrowHits: 0,
        score: 0
      };
    }

    const occupied = rules.expandPath(arrow.path);
    const hitArrowIds = new Set();
    let crossings = 0;
    let distanceWeight = 0;

    for (const key of occupied.points) {
      const hits = rayInfo.byKey.get(key);

      if (!hits) {
        continue;
      }

      crossings += hits.length;

      for (const hit of hits) {
        hitArrowIds.add(hit.arrowId);
        distanceWeight += 1 / Math.max(1, hit.distance);
      }
    }

    const length = rules.buildPathMetrics(arrow.path).length;

    return {
      crossings,
      uniqueArrowHits: hitArrowIds.size,
      score: crossings * Math.max(1, length * 0.45) + hitArrowIds.size * 8 + distanceWeight * 3
    };
  }

  function scoreInsertion(level, placedArrows, arrow, removableBeforeList, rayInfo) {
    const removableBefore = removableBeforeList.length;
    const withArrow = placedArrows.concat(arrow);
    // Adding an arrow can only block existing arrows, never unblock them, so the
    // set still removable afterwards is a subset of those removable before. We
    // only need to re-test that subset instead of every placed arrow.
    const existingRemovableAfter = removableBeforeList
      .filter((placedArrow) => rules.isArrowRemovable(level, withArrow, placedArrow))
      .length;
    const blockedGain = removableBefore - existingRemovableAfter;
    const metrics = rules.buildPathMetrics(arrow.path);
    const rayScore = scoreRayIntersections(arrow, rayInfo);

    return (
      blockedGain * 22 +
      rayScore.score -
      existingRemovableAfter * 3 +
      getTurnCount(arrow.path) * 2 +
      metrics.length * 0.35
    );
  }

  function collectExitRayInfo(level, removableList, freeKeys) {
    const keys = new Set();
    const byKey = new Map();
    const maxDistance = Math.max(level.pointColumns, level.pointRows);

    for (const arrow of removableList) {
      const direction = rules.getHeadDirection(arrow.path);

      if (!direction) {
        continue;
      }

      const head = arrow.path[arrow.path.length - 1];

      for (let distance = 1; distance <= maxDistance; distance += 1) {
        const next = [head[0] + direction.dx * distance, head[1] + direction.dy * distance];

        if (!rules.isInBounds(level, next)) {
          break;
        }

        const key = pointKey(next);

        if (freeKeys.has(key)) {
          keys.add(key);
          if (!byKey.has(key)) {
            byKey.set(key, []);
          }
          byKey.get(key).push({
            arrowId: arrow.id,
            distance
          });
        }
      }
    }

    return { keys, byKey };
  }

  function getLongLineMinEdges(level, config) {
    return Math.max(3, Math.ceil(Math.max(level.pointColumns, level.pointRows) * config.longLineRatio));
  }

  function getLongLineMaxEdges(level, component, config) {
    const boardCap = Math.ceil(Math.max(level.pointColumns, level.pointRows) * (config.longLineMaxRatio || 0.3));
    return Math.min(Math.max(config.longLineMaxEdges, boardCap), component.length - 1);
  }

  function estimateTargetLongLineCount(activePointCount, config, longLineMinEdges) {
    const estimatedArrowCount = Math.max(1, Math.ceil(activePointCount / Math.max(2, config.maxEdges + 1)));
    const quotaTarget = Math.ceil(estimatedArrowCount * (config.longLineQuota || 0));
    const coverageTarget = Math.ceil((activePointCount * (config.longLineQuota || 0)) / Math.max(2, longLineMinEdges + 1));
    return Math.max(1, Math.min(quotaTarget || 1, coverageTarget || 1));
  }

  function hasLongComponent(level, freeKeys, longLineMinEdges) {
    return rules
      .getComponentsFromKeys(level, freeKeys)
      .some((component) => component.length - 1 >= longLineMinEdges);
  }

  function findCandidatePath(level, freeKeys, placedArrows, random, config, placementState = {}) {
    const id = `a${placedArrows.length + 1}`;
    // removableBefore is identical for every candidate in this call (placedArrows
    // is fixed), so compute it once instead of inside scoreInsertion per attempt.
    const removableBeforeList = rules.getRemovableArrows(level, placedArrows);
    // Free cells lying on a currently-removable arrow's exit ray: routing a new
    // body through them blocks that arrow at the start, creating interlocking.
    const rayInfo = collectExitRayInfo(level, removableBeforeList, freeKeys);
    const longLineMinEdges = placementState.longLineMinEdges || getLongLineMinEdges(level, config);
    // Free-space components are fixed for this call, so enumerate them once
    // instead of recomputing inside every attempt.
    const weighted = buildWeightedComponents(level, freeKeys);

    if (!weighted) {
      return null;
    }

    const usableWeighted = placementState.forceLong
      ? weighted.filter((component) => component.length - 1 >= longLineMinEdges)
      : weighted;

    if (usableWeighted.length === 0) {
      return null;
    }

    let best = null;

    function considerRawPoints(rawPoints, extraScore = 0) {
      if (!rawPoints || rawPoints.length < 2) {
        return false;
      }

      const usedKeys = new Set(rawPoints.map(pointKey));

      if (usedKeys.size !== rawPoints.length) {
        return false;
      }

      const freeAfter = removeUsedPoints(freeKeys, rawPoints);

      if (!isRemainderPossible(level, freeAfter)) {
        return false;
      }

      const arrow = buildArrowCandidate(level, placedArrows, rawPoints, freeAfter, id, config, random);

      if (!arrow) {
        return false;
      }

      const metrics = rules.buildPathMetrics(arrow.path);
      const isLong = metrics.length >= longLineMinEdges;

      if (placementState.forceLong && !isLong) {
        return false;
      }

      const score =
        scoreInsertion(level, placedArrows, arrow, removableBeforeList, rayInfo) +
        (isLong ? 18 + metrics.length * 0.6 : 0) +
        (placementState.forceLong ? 20 : 0) +
        extraScore;
      const candidate = {
        arrow,
        freeAfter,
        score,
        isLong
      };

      if (!best || candidate.score > best.score) {
        best = candidate;
      }

      return true;
    }

    for (let attempt = 0; attempt < config.pathAttempts; attempt += 1) {
      const component = pickWeighted(usableWeighted, random);
      const wantLong = placementState.forceLong ||
        (random() < config.longLineChance && component.length - 1 >= longLineMinEdges);
      const maxEdges = wantLong
        ? getLongLineMaxEdges(level, component, config)
        : Math.min(config.maxEdges, component.length - 1);
      const minEdges = Math.min(config.minEdges, maxEdges);
      let targetEdges = randomInt(random, minEdges, maxEdges);

      if (wantLong) {
        targetEdges = randomInt(random, Math.min(longLineMinEdges, maxEdges), maxEdges);
      } else if (component.length <= config.maxEdges + 1 && random() < 0.55) {
        targetEdges = component.length - 1;
      }

      const growOptions = wantLong
        ? {
          straightBias: config.straightBias,
          rayBias: config.rayBias * 0.35,
          searchLimit: config.longLineSearchLimit,
          requireTargetLength: true
        }
        : {
          rayBias: config.rayBias,
          searchLimit: config.fillerSearchLimit,
          requireTargetLength: true
        };
      const rawPoints = growPath(level, component, targetEdges, freeKeys, random, rayInfo, growOptions);

      if (!rawPoints || rawPoints.length < 2) {
        continue;
      }

      considerRawPoints(rawPoints);
    }

    if (!best) {
      const fallbackComponents = rules
        .getComponentsFromKeys(level, freeKeys)
        .filter((component) => component.length >= 2)
        .sort((a, b) => a.length - b.length);

      for (const component of fallbackComponents) {
        const maxFallbackEdges = Math.min(
          component.length - 1,
          Math.max(config.maxEdges, longLineMinEdges),
          config.longLineMaxEdges || config.maxEdges
        );

        for (let targetEdges = maxFallbackEdges; targetEdges >= 1; targetEdges -= 1) {
          const rawPoints = growPath(level, component, targetEdges, freeKeys, random, rayInfo, {
            rayBias: config.rayBias,
            straightBias: config.straightBias * 0.35,
            searchLimit: config.fallbackSearchLimit,
            requireTargetLength: true
          });

          if (considerRawPoints(rawPoints, -6)) {
            break;
          }
        }

        if (best) {
          break;
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
      mask: config.mask,
      arrows: []
    };
    let freeKeys = new Set(rules.getAllPointKeys(levelShell));
    const activePointCount = freeKeys.size;
    const longLineMinEdges = getLongLineMinEdges(levelShell, config);
    const targetLongLines = estimateTargetLongLineCount(activePointCount, config, longLineMinEdges);
    let longLineCount = 0;
    const arrows = [];
    const maxArrows = freeKeys.size;

    while (freeKeys.size > 0) {
      if (arrows.length >= maxArrows) {
        captureDebugPreview(config, {
          reason: "single-arrow-limit",
          arrows,
          freeKeys,
          attemptIndex,
          details: {
            remaining: freeKeys.size
          },
          mode: "debug-single"
        });
        return null;
      }

      const forceLong = longLineCount < targetLongLines && hasLongComponent(levelShell, freeKeys, longLineMinEdges);
      let candidate = findCandidatePath(levelShell, freeKeys, arrows, random, config, {
        forceLong,
        longLineMinEdges
      });

      if (!candidate && forceLong) {
        candidate = findCandidatePath(levelShell, freeKeys, arrows, random, config, {
          forceLong: false,
          longLineMinEdges
        });
      }

      if (!candidate) {
        captureDebugPreview(config, {
          reason: "single-candidate-missing",
          arrows,
          freeKeys,
          attemptIndex,
          details: {
            remaining: freeKeys.size,
            longLineCount,
            targetLongLines,
            longLineMinEdges
          },
          mode: "debug-single"
        });
        return null;
      }

      arrows.push(candidate.arrow);
      if (candidate.isLong) {
        longLineCount += 1;
      }
      freeKeys = candidate.freeAfter;
      levelShell.arrows = arrows;
    }

    const solutionOrder = arrows.map((arrow) => arrow.id).reverse();
    const first = arrows.find((arrow) => arrow.id === solutionOrder[0]);

    if (!first || !rules.isOuterExit(levelShell, first)) {
      captureDebugPreview(config, {
        reason: "single-first-not-outer-exit",
        arrows,
        freeKeys,
        attemptIndex,
        details: {
          firstId: solutionOrder[0] || null
        },
        mode: "debug-single"
      });
      return null;
    }

    const level = {
      id: config.id,
      seed: `${seed}:${attemptIndex}`,
      pointColumns: config.pointColumns,
      pointRows: config.pointRows,
      mask: config.mask,
      arrows: arrows.map(rules.cloneArrow),
      solutionOrder,
      generated: true,
      requireFullPointCover: true,
      generationStats: {
        longLineCount,
        targetLongLines,
        longLineMinEdges,
        mode: "single"
      }
    };
    const geometry = rules.validateGeometry(level, {
      requireFullPointCover: true,
      solutionOrder,
      requireFirstExit: true
    });

    if (!geometry.valid) {
      captureDebugPreview(config, {
        reason: "single-geometry",
        arrows,
        freeKeys: [],
        attemptIndex,
        details: {
          errors: geometry.errors ? geometry.errors.slice(0, 5) : []
        },
        mode: "debug-single"
      });
      return null;
    }

    const known = rules.validateKnownSolution(level, solutionOrder);

    if (!known.valid) {
      captureDebugPreview(config, {
        reason: "single-known-solution",
        arrows,
        freeKeys: [],
        attemptIndex,
        details: {
          known
        },
        mode: "debug-single"
      });
      return null;
    }

    return level;
  }

  function buildRanges(total, preferredSize) {
    const ranges = [];
    const count = Math.max(1, Math.ceil(total / preferredSize));
    const baseSize = Math.max(MIN_TILE_SIZE, Math.floor(total / count));
    let remainder = total - baseSize * count;
    let start = 0;

    for (let index = 0; index < count; index += 1) {
      const size = baseSize + (remainder > 0 ? 1 : 0);
      const end = index === count - 1 ? total : start + size;
      ranges.push({
        start,
        end,
        size: end - start
      });
      start = end;
      remainder -= 1;
    }

    return ranges.filter((range) => range.size >= MIN_TILE_SIZE);
  }

  function extractTileMask(mask, xRange, yRange) {
    if (!mask) {
      return undefined;
    }

    const tileMask = new Set();

    for (const key of mask) {
      const point = rules.parsePointKey(key);

      if (
        point[0] >= xRange.start &&
        point[0] < xRange.end &&
        point[1] >= yRange.start &&
        point[1] < yRange.end
      ) {
        tileMask.add(rules.pointKey(point[0] - xRange.start, point[1] - yRange.start));
      }
    }

    return tileMask;
  }

  function getPreferredExitDirections(config, xRange, yRange) {
    const directions = [];

    if (xRange.start === 0) {
      directions.push("left");
    }

    if (xRange.end === config.pointColumns) {
      directions.push("right");
    }

    if (yRange.start === 0) {
      directions.push("up");
    }

    if (yRange.end === config.pointRows) {
      directions.push("down");
    }

    if (directions.length > 0) {
      return directions;
    }

    const centerX = (xRange.start + xRange.end - 1) / 2;
    const centerY = (yRange.start + yRange.end - 1) / 2;
    const distances = [
      { name: "left", value: centerX },
      { name: "right", value: config.pointColumns - 1 - centerX },
      { name: "up", value: centerY },
      { name: "down", value: config.pointRows - 1 - centerY }
    ].sort((a, b) => a.value - b.value);

    return [distances[0].name];
  }

  function shiftTileArrow(arrow, tileIndex, xRange, yRange) {
    return {
      ...arrow,
      id: `t${tileIndex}_${arrow.id}`,
      path: arrow.path.map((point) => [point[0] + xRange.start, point[1] + yRange.start])
    };
  }

  function buildGlobalSolutionOrder(level) {
    let remaining = level.arrows.map(rules.cloneArrow);
    const order = [];
    const branching = [];

    while (remaining.length > 0) {
      const moves = rules.getRemovableArrows(level, remaining);

      if (moves.length === 0) {
        return {
          valid: false,
          order,
          remaining: remaining.map((arrow) => arrow.id),
          branching
        };
      }

      moves.sort((a, b) => {
        const outerDelta = Number(rules.isOuterExit(level, b)) - Number(rules.isOuterExit(level, a));
        return outerDelta || a.id.localeCompare(b.id);
      });

      branching.push(moves.length);

      const moveIds = new Set(moves.map((arrow) => arrow.id));
      for (const move of moves) {
        order.push(move.id);
      }
      remaining = remaining.filter((arrow) => !moveIds.has(arrow.id));
    }

    return {
      valid: true,
      order,
      remaining: [],
      branching
    };
  }

  function buildTileConfig(config, xRange, yRange, tileIndex, attemptIndex) {
    const mask = extractTileMask(config.mask, xRange, yRange);

    if (mask && mask.size === 0) {
      return null;
    }

    return {
      ...config,
      id: `${config.id}-tile-${tileIndex}`,
      seed: `${config.seed}:tile:${tileIndex}:${attemptIndex}`,
      pointColumns: xRange.size,
      pointRows: yRange.size,
      mask,
      maxAttempts: config.tileMaxAttempts,
      pathAttempts: Math.min(config.pathAttempts, config.tilePathAttempts),
      fillerSearchLimit: Math.min(config.fillerSearchLimit, config.tileFillerSearchLimit),
      longLineSearchLimit: Math.min(config.longLineSearchLimit, config.tileLongLineSearchLimit),
      fullSolve: false,
      useTileStitch: false,
      preferredExitDirections: getPreferredExitDirections(config, xRange, yRange),
      logFallbackWarning: false
    };
  }

  function buildTileDefinitions(config) {
    const xRanges = buildRanges(config.pointColumns, config.tileWidth);
    const yRanges = buildRanges(config.pointRows, config.tileHeight);
    const tiles = [];
    let index = 0;

    for (const yRange of yRanges) {
      for (const xRange of xRanges) {
        const edgeDistance = Math.min(
          xRange.start,
          config.pointColumns - xRange.end,
          yRange.start,
          config.pointRows - yRange.end
        );
        tiles.push({
          index,
          xRange,
          yRange,
          edgeDistance
        });
        index += 1;
      }
    }

    return tiles.sort((a, b) => b.edgeDistance - a.edgeDistance || a.index - b.index);
  }

  function getTileActiveKeys(config, tile) {
    const keys = [];

    for (let y = tile.yRange.start; y < tile.yRange.end; y += 1) {
      for (let x = tile.xRange.start; x < tile.xRange.end; x += 1) {
        const point = [x, y];

        if (rules.isActivePoint(config, point)) {
          keys.push(rules.pointKey(x, y));
        }
      }
    }

    return keys;
  }

  function buildGlobalTileConfig(config, tile, requireOuterFirst, attemptIndex) {
    return {
      ...config,
      pathAttempts: Math.min(config.pathAttempts, config.tilePathAttempts),
      fillerSearchLimit: Math.min(config.fillerSearchLimit, config.tileFillerSearchLimit),
      longLineSearchLimit: Math.min(config.longLineSearchLimit, config.tileLongLineSearchLimit),
      fallbackSearchLimit: Math.min(config.fallbackSearchLimit, config.tileFallbackSearchLimit),
      preferredExitDirections: getPreferredExitDirections(config, tile.xRange, tile.yRange),
      requireOuterFirst: false,
      requireInsertionRemovable: true,
      debugTile: {
        index: tile.index,
        x: tile.xRange.start,
        y: tile.yRange.start,
        width: tile.xRange.size,
        height: tile.yRange.size,
        edgeDistance: tile.edgeDistance
      },
      debugAttemptIndex: attemptIndex
    };
  }

  function rejectStitchedCandidate(config, reason, details = {}) {
    if (config.debugStitch) {
      console.warn("Stitched candidate rejected", {
        reason,
        ...details
      });
    }

    return null;
  }

  function summarizeInitialMoves(level) {
    const moves = rules.getRemovableArrows(level, level.arrows).map((arrow) => arrow.id);

    return {
      count: moves.length,
      ids: moves
    };
  }

  function captureDebugPreview(config, snapshot) {
    if (!config.captureFailurePreview && !config.returnFailurePreview) {
      return null;
    }

    const arrows = snapshot.arrows.map(rules.cloneArrow);
    const debugLevel = {
      id: config.id,
      seed: `${config.seed}:debug:${snapshot.attemptIndex || 0}`,
      pointColumns: config.pointColumns,
      pointRows: config.pointRows,
      mask: config.mask,
      arrows,
      generated: true,
      requireFullPointCover: false,
      debugPreview: true,
      debug: {
        preview: true,
        reason: snapshot.reason,
        details: snapshot.details || {},
        attemptIndex: snapshot.attemptIndex || 0,
        tile: snapshot.tile || null,
        freeKeys: snapshot.freeKeys ? [...snapshot.freeKeys] : [],
        placedArrowCount: arrows.length
      }
    };
    const initialMoves = summarizeInitialMoves(debugLevel);

    debugLevel.stats = {
      initialMoves: initialMoves.count,
      initialMoveIds: initialMoves.ids,
      averageBranching: 0,
      knownAverageBranching: 0,
      maxBranching: initialMoves.count,
      dependencyDepth: 0,
      solutionCount: null,
      solutionCountCapped: false,
      visitedStates: 0,
      generationMode: snapshot.mode || "debug-stitch",
      failureReason: snapshot.reason,
      placedArrows: arrows.length,
      uncoveredPoints: debugLevel.debug.freeKeys.length,
      tileCount: 0,
      difficultyScore: 0
    };

    lastDebugPreviewLevel = debugLevel;
    return debugLevel;
  }

  function buildTileIntoGlobal(levelShell, freeKeys, arrows, random, config) {
    const activePointCount = freeKeys.size;
    const longLineMinEdges = getLongLineMinEdges(levelShell, config);
    const targetLongLines = estimateTargetLongLineCount(activePointCount, config, longLineMinEdges);
    const maxArrows = freeKeys.size;
    const startArrowCount = arrows.length;
    let longLineCount = 0;

    while (freeKeys.size > 0) {
      if (arrows.length - startArrowCount >= maxArrows) {
        captureDebugPreview(config, {
          reason: "tile-arrow-limit",
          arrows,
          freeKeys,
          tile: config.debugTile,
          attemptIndex: config.debugAttemptIndex,
          details: {
            remaining: freeKeys.size
          }
        });
        return rejectStitchedCandidate(config, "tile-arrow-limit", {
          remaining: freeKeys.size
        });
      }

      const forceLong = longLineCount < targetLongLines && hasLongComponent(levelShell, freeKeys, longLineMinEdges);
      let candidate = findCandidatePath(levelShell, freeKeys, arrows, random, config, {
        forceLong,
        longLineMinEdges
      });

      if (!candidate && forceLong) {
        candidate = findCandidatePath(levelShell, freeKeys, arrows, random, config, {
          forceLong: false,
          longLineMinEdges
        });
      }

      if (!candidate) {
        captureDebugPreview(config, {
          reason: "tile-candidate-missing",
          arrows,
          freeKeys,
          tile: config.debugTile,
          attemptIndex: config.debugAttemptIndex,
          details: {
            remaining: freeKeys.size,
            requireOuterFirst: config.requireOuterFirst
          }
        });
        return rejectStitchedCandidate(config, "tile-candidate-missing", {
          remaining: freeKeys.size,
          requireOuterFirst: config.requireOuterFirst
        });
      }

      arrows.push(candidate.arrow);
      if (candidate.isLong) {
        longLineCount += 1;
      }
      freeKeys = candidate.freeAfter;
      levelShell.arrows = arrows;
    }

    return {
      longLineCount,
      targetLongLines,
      longLineMinEdges
    };
  }

  function buildStitchedCandidate(config, attemptIndex) {
    const tiles = buildTileDefinitions(config);
    const random = createRandom(`${config.seed}:stitched:${attemptIndex}`);
    const levelShell = {
      pointColumns: config.pointColumns,
      pointRows: config.pointRows,
      mask: config.mask,
      arrows: []
    };
    const arrows = [];
    const tileSummaries = [];
    let totalLongLineCount = 0;
    let totalTargetLongLines = 0;
    let longLineMinEdges = 0;

    for (let tileOrderIndex = 0; tileOrderIndex < tiles.length; tileOrderIndex += 1) {
      const tile = tiles[tileOrderIndex];
      const freeKeys = new Set(getTileActiveKeys(config, tile));

      if (freeKeys.size === 0) {
        continue;
      }

      const requireOuterFirst = tile.edgeDistance === 0 || tileOrderIndex === tiles.length - 1;
      const tileConfig = buildGlobalTileConfig(config, tile, requireOuterFirst, attemptIndex);
      const beforeCount = arrows.length;
      const tileStats = buildTileIntoGlobal(levelShell, freeKeys, arrows, random, tileConfig);

      if (!tileStats) {
        return rejectStitchedCandidate(config, "tile-build-failed", {
          tile: tile.index,
          order: tileOrderIndex
        });
      }

      totalLongLineCount += tileStats.longLineCount;
      totalTargetLongLines += tileStats.targetLongLines;
      longLineMinEdges = Math.max(longLineMinEdges, tileStats.longLineMinEdges);
      tileSummaries.push({
        index: tile.index,
        order: tileOrderIndex,
        x: tile.xRange.start,
        y: tile.yRange.start,
        width: tile.xRange.size,
        height: tile.yRange.size,
        arrows: arrows.length - beforeCount,
        longLineCount: tileStats.longLineCount
      });
    }

    const constructedOrder = arrows.map((arrow) => arrow.id).reverse();
    const level = {
      id: config.id,
      seed: `${config.seed}:stitched:${attemptIndex}`,
      pointColumns: config.pointColumns,
      pointRows: config.pointRows,
      mask: config.mask,
      arrows,
      solutionOrder: constructedOrder,
      generated: true,
      requireFullPointCover: true
    };
    const geometry = rules.validateGeometry(level, {
      requireFullPointCover: true
    });

    if (!geometry.valid) {
      captureDebugPreview(config, {
        reason: "geometry",
        arrows,
        freeKeys: [],
        attemptIndex,
        details: {
          errors: geometry.errors.slice(0, 5)
        }
      });
      return rejectStitchedCandidate(config, "geometry", {
        errors: geometry.errors.slice(0, 5)
      });
    }

    const schedule = buildGlobalSolutionOrder(level);

    if (!schedule.valid) {
      captureDebugPreview(config, {
        reason: "scheduler-deadlock",
        arrows,
        freeKeys: [],
        attemptIndex,
        details: {
          remaining: schedule.remaining.slice(0, 8)
        }
      });
      return rejectStitchedCandidate(config, "scheduler-deadlock", {
        remaining: schedule.remaining.slice(0, 8)
      });
    }

    const longLineCount = tileSummaries.reduce((sum, tile) => sum + tile.longLineCount, 0);
    const targetLongLines = Math.max(1, Math.ceil(tileSummaries.length * (config.longLineQuota || 0)));
    const stitched = {
      ...level,
      solutionOrder: schedule.order,
      generationStats: {
        mode: "stitched",
        longLineCount: totalLongLineCount,
        targetLongLines: totalTargetLongLines,
        longLineMinEdges,
        tileCount: tileSummaries.length,
        tileWidth: config.tileWidth,
        tileHeight: config.tileHeight,
        tiles: tileSummaries,
        constructedOrder,
        schedulerBranching: schedule.branching
      }
    };
    const finalGeometry = rules.validateGeometry(stitched, {
      requireFullPointCover: true,
      solutionOrder: stitched.solutionOrder,
      requireFirstExit: true
    });
    const known = rules.validateKnownSolution(stitched, stitched.solutionOrder);

    if (!finalGeometry.valid || !known.valid) {
      captureDebugPreview(config, {
        reason: "final-validation",
        arrows,
        freeKeys: [],
        attemptIndex,
        details: {
          geometry: finalGeometry.errors ? finalGeometry.errors.slice(0, 5) : [],
          known
        }
      });
      return rejectStitchedCandidate(config, "final-validation", {
        geometry: finalGeometry.errors ? finalGeometry.errors.slice(0, 5) : [],
        known
      });
    }

    return stitched;
  }

  function scoreLevel(level, stats, config) {
    const blockedAtStartCount = level.arrows.length - stats.initialMoves;
    const turnCountScore = level.arrows.reduce((sum, arrow) => sum + getTurnCount(arrow.path), 0);
    const visualCongestionScore = level.arrows.length / 2;
    const generationStats = level.generationStats || {};
    const longLineCount = generationStats.longLineCount || 0;
    const targetLongLines = generationStats.targetLongLines || 0;
    const longLineScore = targetLongLines > 0
      ? Math.min(longLineCount, targetLongLines) * 4 - Math.max(0, targetLongLines - longLineCount) * 6
      : 0;
    const cappedPenalty = stats.solutionCountCapped ? 8 : 0;

    return (
      stats.dependencyDepth * 3 -
      stats.initialMoves * 2 -
      stats.knownAverageBranching +
      blockedAtStartCount +
      turnCountScore +
      visualCongestionScore +
      longLineScore -
      cappedPenalty
    );
  }

  function isInRange(value, range) {
    return value >= range[0] && value <= range[1];
  }

  function getDifficultyMetrics(level, stats) {
    return {
      initialMoves: stats.initialMoves,
      dependencyRatio: level.arrows.length === 0 ? 0 : stats.dependencyDepth / level.arrows.length,
      averageBranching: stats.knownAverageBranching || stats.averageBranching || 0
    };
  }

  function classifyDifficulty(level, stats) {
    const metrics = getDifficultyMetrics(level, stats);

    for (const name of ["hard", "normal", "easy"]) {
      const ruleset = DIFFICULTY_RULES[name];

      if (
        isInRange(metrics.initialMoves, ruleset.initialMoves) &&
        isInRange(metrics.dependencyRatio, ruleset.dependencyRatio) &&
        isInRange(metrics.averageBranching, ruleset.averageBranching)
      ) {
        return {
          name,
          metrics
        };
      }
    }

    const fallbackName = metrics.dependencyRatio >= 0.6 || metrics.initialMoves <= 2
      ? "hard"
      : metrics.initialMoves >= 5 || metrics.averageBranching >= 4
        ? "easy"
        : "normal";

    return {
      name: fallbackName,
      metrics
    };
  }

  function isVerified(stats) {
    return Boolean(stats.knownSolutionValid && stats.solvable);
  }

  function toMaskSet(mask) {
    if (!mask) {
      return undefined;
    }

    if (mask instanceof Set) {
      return mask;
    }

    return new Set(
      mask.map((item) => (Array.isArray(item) ? rules.pointKey(item[0], item[1]) : item))
    );
  }

  function maskBounds(maskSet) {
    let columns = 0;
    let rows = 0;

    for (const key of maskSet) {
      const parts = key.split(",");
      columns = Math.max(columns, Number(parts[0]) + 1);
      rows = Math.max(rows, Number(parts[1]) + 1);
    }

    return { columns, rows };
  }

  function normalizeConfig(options) {
    const mask = toMaskSet(options.mask);
    const algorithm = options.algorithm || "free-placement";
    // A mask can imply the board size when columns/rows are not given explicitly.
    const bounds = mask ? maskBounds(mask) : { columns: 0, rows: 0 };

    if (!ALGORITHMS.has(algorithm)) {
      throw new Error("Generator algorithm must be free-placement, reverse, or flow");
    }

    return {
      ...GENERATION_CONFIG,
      ...options,
      id: options.id || 1,
      seed: options.seed || "level-1",
      color: options.color || DEFAULT_COLOR,
      mask,
      pointColumns: options.pointColumns || bounds.columns || 7,
      pointRows: options.pointRows || bounds.rows || 7,
      maxAttempts: options.maxAttempts || 250,
      fullSolveMaxCells: options.fullSolveMaxCells || 200,
      fullSolve: options.fullSolve,
      useTileStitch: options.useTileStitch,
      tileWidth: options.tileWidth || options.tileSize || DEFAULT_TILE_SIZE,
      tileHeight: options.tileHeight || options.tileSize || DEFAULT_TILE_SIZE,
      tileStitchThreshold: options.tileStitchThreshold || 200,
      tileStitchAttempts: options.tileStitchAttempts || 8,
      tileMaxAttempts: options.tileMaxAttempts || 28,
      tilePathAttempts: options.tilePathAttempts || 60,
      tileFillerSearchLimit: options.tileFillerSearchLimit || 140,
      tileLongLineSearchLimit: options.tileLongLineSearchLimit || 700,
      fallbackSearchLimit: options.fallbackSearchLimit || 1200,
      tileFallbackSearchLimit: options.tileFallbackSearchLimit || 500,
      algorithm,
      freePlacementBranchLimit: options.freePlacementBranchLimit || 18,
      freePlacementCandidateAttempts: options.freePlacementCandidateAttempts || 8,
      freePlacementComponentLimit: options.freePlacementComponentLimit || 5,
      freePlacementSearchLimit: options.freePlacementSearchLimit || 260,
      freePlacementNodeLimit: options.freePlacementNodeLimit || 6500,
      repairAttempts: options.repairAttempts || 90,
      flowMaxAttempts: options.flowMaxAttempts || 80,
      // flow shape variety: low straight-bias makes bodies wind; high long-chance
      // and point range make long snakes; turnBias prefers changing direction so
      // arrows bend 2+ times and fold into U-turns.
      flowStraightBias: options.flowStraightBias != null ? options.flowStraightBias : 0.32,
      flowTurnBias: options.flowTurnBias != null ? options.flowTurnBias : 0.7,
      // How often body growth hugs the carved frontier (low-degree). Higher keeps
      // coverage tidy (fewer holes); lower makes shapes more random. Balanced so
      // shapes vary without leaving too many empty cells.
      flowTidyBias: options.flowTidyBias != null ? options.flowTidyBias : 0.5,
      // Chance to pick a spatially RANDOM head instead of a far-weighted one, so
      // carving scatters across the board and neighbours don't tile the same shape.
      flowSpread: options.flowSpread != null ? options.flowSpread : 0.35,
      flowLongChance: options.flowLongChance != null ? options.flowLongChance : 0.8,
      flowMinPoints: options.flowMinPoints || 5,
      flowMaxPoints: options.flowMaxPoints || 22,
      flowShortPoints: options.flowShortPoints || 3,
      flowFarWeightExp: options.flowFarWeightExp != null ? options.flowFarWeightExp : 1,
      flowDirBalance: options.flowDirBalance != null ? options.flowDirBalance : 1.5,
      solverVisitedStateLimit: options.solverVisitedStateLimit || 80000,
      requireFirstExit: options.requireFirstExit === true,
      debugGeneratedLevel: Boolean(options.debugGeneratedLevel),
      captureFailurePreview: Boolean(options.captureFailurePreview || options.returnFailurePreview),
      returnFailurePreview: Boolean(options.returnFailurePreview),
      debugStitch: Boolean(options.debugStitch),
      logFallbackWarning: options.logFallbackWarning !== false
    };
  }

  function attachStats(level, stats, score) {
    const generationStats = level.generationStats || {};
    const difficulty = classifyDifficulty(level, stats);

    return {
      ...level,
      difficulty: difficulty.name,
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
        generationMode: generationStats.mode || "single",
        longLineCount: generationStats.longLineCount || 0,
        targetLongLines: generationStats.targetLongLines || 0,
        longLineMinEdges: generationStats.longLineMinEdges || 0,
        tileCount: generationStats.tileCount || 0,
        classifiedDifficulty: difficulty.name,
        difficultyMetrics: {
          initialMoves: difficulty.metrics.initialMoves,
          dependencyRatio: Number(difficulty.metrics.dependencyRatio.toFixed(3)),
          averageBranching: Number(difficulty.metrics.averageBranching.toFixed(3))
        },
        difficultyScore: Number(score.toFixed(3))
      }
    };
  }

  function shouldFullSolve(config) {
    if (typeof config.fullSolve === "boolean") {
      return config.fullSolve;
    }

    return config.pointColumns * config.pointRows <= config.fullSolveMaxCells;
  }

  function finalizeStats(level, config) {
    if (!shouldFullSolve(config)) {
      return level;
    }

    const full = solver.solveLevel(level, {
      solutionOrder: level.solutionOrder,
      requireFullPointCover: true,
      requireFirstExit: Boolean(config.requireFirstExit),
      solutionCountCap: config.solutionCountCap
    });
    const mergedStats = {
      ...level.stats,
      solutionCount: full.solutionCount,
      solutionCountCapped: full.solutionCountCapped,
      visitedStates: full.visitedStates,
      averageBranching: Number(full.averageBranching.toFixed(3)),
      maxBranching: full.maxBranching
    };
    const difficulty = classifyDifficulty(level, {
      ...mergedStats,
      knownAverageBranching: mergedStats.knownAverageBranching,
      dependencyDepth: mergedStats.dependencyDepth
    });

    return {
      ...level,
      difficulty: difficulty.name,
      stats: {
        ...mergedStats,
        classifiedDifficulty: difficulty.name,
        difficultyMetrics: {
          initialMoves: difficulty.metrics.initialMoves,
          dependencyRatio: Number(difficulty.metrics.dependencyRatio.toFixed(3)),
          averageBranching: Number(difficulty.metrics.averageBranching.toFixed(3))
        }
      }
    };
  }

  function generateSinglePassLevel(config) {
    let best = null;
    let matched = null;
    lastDebugPreviewLevel = null;

    for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
      const candidate = buildReverseCandidate(config.seed, config, attempt);

      if (!candidate) {
        continue;
      }

      const stats = solver.analyzeLevel(candidate, {
        solutionOrder: candidate.solutionOrder
      });

      if (!stats.solvable || !stats.knownSolutionValid) {
        continue;
      }

      const score = scoreLevel(candidate, stats, config);
      const level = attachStats(candidate, stats, score);

      if (!best || level.stats.difficultyScore > best.stats.difficultyScore) {
        best = level;
      }

      if (isVerified(stats)) {
        matched = level;
        break;
      }
    }

    const chosen = matched || best;

    if (!chosen) {
      if (config.returnFailurePreview && lastDebugPreviewLevel) {
        return lastDebugPreviewLevel;
      }

      throw new Error(`Unable to generate a solvable level for seed ${config.seed}`);
    }

    return finalizeStats(chosen, config);
  }

  function generateFreePlacementLevel(config) {
    let best = null;
    let matched = null;
    lastDebugPreviewLevel = null;

    for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
      const candidate = buildFreePlacementCandidate(config, attempt);

      if (!candidate) {
        continue;
      }

      if (!best || candidate.stats.difficultyScore > best.stats.difficultyScore) {
        best = candidate;
      }

      if (isVerified({
        ...candidate.stats,
        solvable: true,
        knownSolutionValid: true
      })) {
        matched = candidate;
        break;
      }
    }

    const chosen = matched || best;

    if (!chosen) {
      if (config.returnFailurePreview && lastDebugPreviewLevel) {
        return lastDebugPreviewLevel;
      }

      throw new Error(`Unable to generate a free-placement solvable level for seed ${config.seed}`);
    }

    return finalizeStats(chosen, config);
  }

  function shouldUseTileStitch(config) {
    return config.algorithm === "reverse" && config.useTileStitch === true;
  }

  function generateStitchedLevel(config) {
    let best = null;
    let matched = null;
    lastDebugPreviewLevel = null;

    for (let attempt = 0; attempt < config.tileStitchAttempts; attempt += 1) {
      const candidate = buildStitchedCandidate(config, attempt);

      if (!candidate) {
        continue;
      }

      const stats = solver.analyzeLevel(candidate, {
        solutionOrder: candidate.solutionOrder
      });

      if (!stats.solvable || !stats.knownSolutionValid) {
        continue;
      }

      const score = scoreLevel(candidate, stats, config);
      const level = attachStats(candidate, stats, score);

      if (!best || level.stats.difficultyScore > best.stats.difficultyScore) {
        best = level;
      }

      if (isVerified(stats)) {
        matched = level;
        break;
      }
    }

    const chosen = matched || best;

    if (!chosen) {
      if (config.returnFailurePreview && lastDebugPreviewLevel) {
        return lastDebugPreviewLevel;
      }

      throw new Error(`Unable to stitch a solvable level for seed ${config.seed}`);
    }

    return finalizeStats(chosen, config);
  }

  // ===========================================================================
  // flow algorithm: reverse-design "carving".
  //
  // This game is fundamentally a 4-DIRECTION puzzle, and difficulty comes from
  // arrows that must cross FAR across the board to exit. Two shortcuts are
  // therefore FORBIDDEN and must never be reintroduced:
  //   - a single global gradient (collapses every arrow to 2 directions), and
  //   - quadrant / sector drainage (every arrow exits the NEAREST edge, so no
  //     long crossings and no real difficulty).
  //
  // Instead we build the board by simulating the solve backwards. Arrows are
  // carved in removal order O1, O2, ...: a new arrow Ok is accepted only if its
  // head ray reaches the boundary through cells that are already carved out (or
  // straight off the edge) — i.e. Ok can leave once O1..O(k-1) are gone. Every
  // arrow is given a valid exit at carve time, so the finished board's "blocks"
  // graph is acyclic BY CONSTRUCTION (no search, no cycle to repair), while
  // arrow direction and length stay completely free. The first arrows carved
  // exit near the edge (nothing is cleared yet); later arrows cross the growing
  // empty space and can span the whole board — that is where the hard, long
  // dependency chains come from.
  //
  // Key fact that keeps it cheap: a head has a clear ray exactly when it is the
  // extreme remaining cell along that ray (rightmost-in-row → clear right,
  // topmost-in-column → clear up, …). So candidate heads come straight from the
  // per-row / per-column sets of still-uncarved cells.
  // ===========================================================================

  function buildCarveCover(level, random, config) {
    const remaining = new Set(rules.getAllPointKeys(level));
    const rowXs = new Map();
    const colYs = new Map();
    const directions = Object.values(rules.DIRECTIONS);

    for (const key of remaining) {
      const point = rules.parsePointKey(key);

      if (!rowXs.has(point[1])) {
        rowXs.set(point[1], new Set());
      }

      if (!colYs.has(point[0])) {
        colYs.set(point[0], new Set());
      }

      rowXs.get(point[1]).add(point[0]);
      colYs.get(point[0]).add(point[1]);
    }

    function isRemaining(point) {
      return remaining.has(pointKey(point));
    }

    function removeCell(point) {
      remaining.delete(pointKey(point));
      rowXs.get(point[1]).delete(point[0]);
      colYs.get(point[0]).delete(point[1]);
    }

    function remainingDegree(point) {
      let count = 0;

      for (const direction of directions) {
        if (isRemaining([point[0] + direction.dx, point[1] + direction.dy])) {
          count += 1;
        }
      }

      return count;
    }

    // Heads with a clear ray = the extreme remaining cell of each row/column.
    // We also require the cell behind the head to be remaining so the arrow has
    // a body whose last step points that way.
    // `score` is the head's distance to the edge it exits toward = how far the
    // arrow crosses through already-carved space. A high score means the arrow
    // threads past many earlier-carved cells, so it depends on those arrows
    // (it is NOT an initial move) and its exit is long — that is the difficulty.
    function collectHeadCandidates() {
      const candidates = [];
      const D = rules.DIRECTIONS;
      const maxX = level.pointColumns - 1;
      const maxY = level.pointRows - 1;

      function consider(head, direction, score) {
        const pen = [head[0] - direction.dx, head[1] - direction.dy];

        if (isRemaining(pen)) {
          candidates.push({ head, direction, score });
        }
      }

      for (const [y, xs] of rowXs) {
        if (xs.size === 0) {
          continue;
        }

        let rowMin = Infinity;
        let rowMax = -Infinity;

        for (const x of xs) {
          if (x < rowMin) { rowMin = x; }
          if (x > rowMax) { rowMax = x; }
        }

        consider([rowMax, y], D.right, maxX - rowMax);
        consider([rowMin, y], D.left, rowMin);
      }

      for (const [x, ys] of colYs) {
        if (ys.size === 0) {
          continue;
        }

        let colMin = Infinity;
        let colMax = -Infinity;

        for (const y of ys) {
          if (y < colMin) { colMin = y; }
          if (y > colMax) { colMax = y; }
        }

        consider([x, colMax], D.down, maxY - colMax);
        consider([x, colMin], D.up, colMin);
      }

      return candidates;
    }

    // Mostly long bodies (so arrows are long snakes) with an occasional short one
    // for variety. These are point counts, not spans — a winding body packs many
    // points into a small area.
    function chooseTargetPoints() {
      if (random() < config.flowLongChance) {
        return randomInt(random, config.flowMinPoints, config.flowMaxPoints);
      }

      return randomInt(random, 2, config.flowShortPoints);
    }

    function pickLowDegree(options) {
      let bestDegree = Infinity;
      const ties = [];

      for (const option of options) {
        const optionDegree = remainingDegree(option.point);

        if (optionDegree < bestDegree) {
          bestDegree = optionDegree;
          ties.length = 0;
          ties.push(option);
        } else if (optionDegree === bestDegree) {
          ties.push(option);
        }
      }

      return ties[Math.floor(random() * ties.length)];
    }

    // Grow the body backwards from the head. The head's facing is fixed (clear
    // ray); the body extends through remaining cells in any direction, so arrows
    // stay 4-directional. The head is always the extreme cell, so the body can
    // never wander onto the head's own ray (no self-block). The walk PREFERS to
    // turn (flowTurnBias), which produces winding, multi-turn and U-turn shapes
    // instead of straight lines.
    function growArrow(head, direction) {
      const pen = [head[0] - direction.dx, head[1] - direction.dy];
      const path = [clonePoint(pen), clonePoint(head)];
      const inPath = new Set([pointKey(head), pointKey(pen)]);
      const target = chooseTargetPoints();
      let tail = pen;

      while (path.length < target) {
        const previous = path[1];
        const lineDx = Math.sign(tail[0] - previous[0]);
        const lineDy = Math.sign(tail[1] - previous[1]);
        const options = directions
          .map((d) => ({ point: [tail[0] + d.dx, tail[1] + d.dy] }))
          .filter((o) => isRemaining(o.point) && !inPath.has(pointKey(o.point)));

        if (options.length === 0) {
          break;
        }

        const straight = options.find(
          (o) => Math.sign(o.point[0] - tail[0]) === lineDx && Math.sign(o.point[1] - tail[1]) === lineDy
        );
        const turns = options.filter((o) => o !== straight);
        let chosen;

        // Turn choice is mostly RANDOM (not always toward the carved frontier),
        // so adjacent arrows don't tile into the same repeated shape. low-degree
        // is used only occasionally, to limit stranded cells.
        if (turns.length > 0 && random() < config.flowTurnBias) {
          chosen = random() < config.flowTidyBias
            ? pickLowDegree(turns)
            : turns[Math.floor(random() * turns.length)];
        } else if (straight && random() < config.flowStraightBias) {
          chosen = straight;
        } else {
          chosen = random() < config.flowTidyBias
            ? pickLowDegree(options)
            : options[Math.floor(random() * options.length)];
        }

        path.unshift(clonePoint(chosen.point));
        inPath.add(pointKey(chosen.point));
        tail = chosen.point;
      }

      return path;
    }

    const arrows = [];
    const uncovered = [];
    const endpointTail = new Map();
    // Recent head-direction usage, decayed each carve, to spread directions and
    // stop long runs of identically-facing arrows.
    const dirRecent = { up: 0, down: 0, left: 0, right: 0 };

    function carve(path) {
      const simplified = simplifyGridPath(path);
      const arrow = { id: `a${arrows.length + 1}`, color: config.color, path: simplified };

      for (const point of path) {
        removeCell(point);
      }

      arrows.push(arrow);
      endpointTail.set(pointKey(simplified[0]), arrows.length - 1);
      return arrow;
    }

    // A stranded cell (no remaining neighbour) is absorbed as the new tail of an
    // adjacent already-carved arrow. The cell was never on any carved arrow's
    // ray (or that arrow would have been rejected), so this adds no blocking
    // edge and the donor arrow's head/ray is untouched — acyclicity is kept.
    function mergeSingleton(point) {
      for (const direction of shuffle(directions, random)) {
        const neighbor = [point[0] + direction.dx, point[1] + direction.dy];
        const index = endpointTail.get(pointKey(neighbor));

        if (index === undefined) {
          continue;
        }

        const arrow = arrows[index];
        arrow.path = simplifyGridPath([clonePoint(point), ...arrow.path]);
        endpointTail.delete(pointKey(neighbor));
        endpointTail.set(pointKey(point), index);
        removeCell(point);
        return true;
      }

      return false;
    }

    while (remaining.size > 0) {
      const candidates = collectHeadCandidates();

      if (candidates.length === 0) {
        // Only isolated leftovers remain (no two are adjacent). Absorb what we
        // can into a neighbouring arrow's tail; leave the rest uncovered — full
        // coverage is not required, so a few empty cells are acceptable.
        for (const key of [...remaining]) {
          if (!mergeSingleton(rules.parsePointKey(key))) {
            uncovered.push(key);
            removeCell(rules.parsePointKey(key));
          }
        }

        continue;
      }

      // Weight each candidate by far-crossing distance (difficulty) AND by how
      // little its direction has been used recently (variety), so heads don't
      // cluster into long same-facing runs.
      let totalWeight = 0;

      for (const candidate of candidates) {
        const far = Math.pow(candidate.score + 1, config.flowFarWeightExp);
        const balance = 1 / (1 + config.flowDirBalance * dirRecent[candidate.direction.name]);
        candidate.weight = far * balance;
        totalWeight += candidate.weight;
      }

      let choice;

      if (random() < config.flowSpread) {
        // Spatially scattered pick: carve all over the board, not region by
        // region, so adjacent arrows form in different contexts and don't tile.
        choice = candidates[Math.floor(random() * candidates.length)];
      } else {
        let pick = random() * totalWeight;
        choice = candidates[candidates.length - 1];

        for (const candidate of candidates) {
          pick -= candidate.weight;

          if (pick <= 0) {
            choice = candidate;
            break;
          }
        }
      }

      for (const name of Object.keys(dirRecent)) {
        dirRecent[name] *= 0.6;
      }
      dirRecent[choice.direction.name] += 1;

      carve(growArrow(choice.head, choice.direction));
    }

    return { arrows, uncovered };
  }

  // Cast an arrow's head ray to the bounding box and collect every other arrow
  // sitting on it. Unlike removability (which only needs the nearest blocker),
  // the dependency graph needs all blockers, since the ray clears only once they
  // are all gone.
  function collectFlowBlockers(level, ownerMaps, arrow) {
    const direction = rules.getHeadDirection(arrow.path);
    const blockers = new Set();

    if (!direction) {
      return { blockers, selfBlock: true };
    }

    const head = arrow.path[arrow.path.length - 1];
    const maxDistance = Math.max(level.pointColumns, level.pointRows) + 3;
    let previous = head;
    let selfBlock = false;

    for (let distance = 1; distance <= maxDistance; distance += 1) {
      const next = [head[0] + direction.dx * distance, head[1] + direction.dy * distance];
      const edgeOwner = ownerMaps.edges.get(rules.edgeKey(previous, next));

      if (edgeOwner !== undefined) {
        if (edgeOwner === arrow.id) {
          selfBlock = true;
        } else {
          blockers.add(edgeOwner);
        }
      }

      if (rules.isInBounds(level, next)) {
        const pointOwner = ownerMaps.points.get(rules.pointKey(next[0], next[1]));

        if (pointOwner !== undefined) {
          if (pointOwner === arrow.id) {
            selfBlock = true;
          } else {
            blockers.add(pointOwner);
          }
        }
      }

      previous = next;

      if (!rules.isInBounds(level, next)) {
        break;
      }
    }

    return { blockers, selfBlock };
  }

  function buildFlowGraph(level, arrows) {
    const ownerMaps = buildOwnerMaps(arrows);
    const blockersById = new Map();
    let anySelfBlock = false;

    for (const arrow of arrows) {
      const result = collectFlowBlockers(level, ownerMaps, arrow);
      blockersById.set(arrow.id, result.blockers);

      if (result.selfBlock) {
        anySelfBlock = true;
      }
    }

    return { blockersById, anySelfBlock };
  }

  // Branching/dependency stats computed directly from the blocking DAG. Because
  // an arrow is removable exactly when its in-degree reaches zero, simulating
  // the removal order over the DAG reproduces analyzeLevel's metrics in O(V+E)
  // instead of the solver's O(N^2 * boardDim) replay.
  function computeFlowStats(arrows, blockersById, order) {
    const indegree = new Map();
    const dependents = new Map();

    for (const arrow of arrows) {
      dependents.set(arrow.id, []);
    }

    for (const arrow of arrows) {
      const blockers = blockersById.get(arrow.id);
      indegree.set(arrow.id, blockers.size);

      for (const blocker of blockers) {
        dependents.get(blocker).push(arrow.id);
      }
    }

    const initialMoveIds = arrows
      .filter((arrow) => indegree.get(arrow.id) === 0)
      .map((arrow) => arrow.id);
    const branching = [];
    let currentRemovable = initialMoveIds.length;

    for (const id of order) {
      branching.push(currentRemovable);
      currentRemovable -= 1;

      for (const dependent of dependents.get(id)) {
        const next = indegree.get(dependent) - 1;
        indegree.set(dependent, next);

        if (next === 0) {
          currentRemovable += 1;
        }
      }
    }

    const averageBranching = branching.length > 0
      ? branching.reduce((sum, value) => sum + value, 0) / branching.length
      : 0;
    const maxBranching = branching.length > 0 ? Math.max(...branching) : 0;

    return {
      solvable: true,
      knownSolutionValid: true,
      initialMoves: initialMoveIds.length,
      initialMoveIds,
      averageBranching,
      knownAverageBranching: averageBranching,
      maxBranching,
      knownMaxBranching: maxBranching,
      knownBranching: branching,
      dependencyDepth: branching.filter((count) => count <= 2).length,
      solutionCount: null,
      solutionCountCapped: false,
      visitedStates: 0,
      analysisMode: "flow"
    };
  }

  function buildFlowCandidate(config, attemptIndex) {
    const random = createRandom(`${config.seed}:flow:${attemptIndex}`);
    const levelShell = {
      pointColumns: config.pointColumns,
      pointRows: config.pointRows,
      mask: config.mask,
      arrows: []
    };
    const cover = buildCarveCover(levelShell, random, config);

    if (!cover || cover.arrows.length === 0) {
      captureDebugPreview(config, {
        reason: "flow-carve-empty",
        arrows: [],
        freeKeys: [],
        attemptIndex,
        mode: "debug-flow"
      });
      return null;
    }

    const arrows = cover.arrows.map((arrow) => ({
      id: arrow.id,
      color: arrow.color || config.color,
      path: arrow.path.map(clonePoint)
    }));
    // Carve order is removal order O1..On by construction.
    const solutionOrder = arrows.map((arrow) => arrow.id);
    const level = {
      id: config.id,
      seed: `${config.seed}:flow:${attemptIndex}`,
      pointColumns: config.pointColumns,
      pointRows: config.pointRows,
      mask: config.mask,
      arrows,
      solutionOrder,
      generated: true,
      // Full coverage is not required: the carver leaves a few un-carvable cells
      // empty rather than failing. Solvability comes from the carve order.
      requireFullPointCover: false,
      generationStats: {
        mode: "flow",
        attempt: attemptIndex,
        arrowCount: arrows.length,
        uncoveredCells: cover.uncovered.length
      }
    };
    const geometry = rules.validateGeometry(level, {
      requireFullPointCover: false
    });

    if (!geometry.valid) {
      captureDebugPreview(config, {
        reason: "flow-geometry",
        arrows,
        freeKeys: [],
        attemptIndex,
        details: {
          errors: geometry.errors ? geometry.errors.slice(0, 5) : []
        },
        mode: "debug-flow"
      });
      return null;
    }

    // The carve order is solvable by construction; this is a correctness backstop
    // (RULES rule 4: surface a real failure rather than hide it) and never trips.
    const known = rules.validateKnownSolution(level, solutionOrder);

    if (!known.valid) {
      captureDebugPreview(config, {
        reason: "flow-known-solution",
        arrows,
        freeKeys: [],
        attemptIndex,
        details: {
          known
        },
        mode: "debug-flow"
      });
      return null;
    }

    const graph = buildFlowGraph(level, arrows);
    const stats = computeFlowStats(arrows, graph.blockersById, solutionOrder);
    const score = scoreLevel(level, stats, config);
    return attachStats(level, stats, score);
  }

  function generateFlowLevel(config) {
    lastDebugPreviewLevel = null;

    for (let attempt = 0; attempt < config.flowMaxAttempts; attempt += 1) {
      const candidate = buildFlowCandidate(config, attempt);

      if (candidate) {
        return candidate;
      }
    }

    if (config.returnFailurePreview && lastDebugPreviewLevel) {
      return lastDebugPreviewLevel;
    }

    throw new Error(`Unable to generate a flow level for seed ${config.seed}`);
  }

  /*
   * Node generation usage:
   *
   *   .\gen
   *   .\gen 5 hard 8x8 --seed stage
   *   .\gen --shape gem --json
   *   .\gen --help
   *
   * By default, `gen` writes generated levels to src/levels.js for index.html.
   * Use --json or --out to emit standalone JSON instead.
   *
   * Human-facing params:
   *   - cols / rows: map size. Passed as pointColumns / pointRows.
   *   - count: how many levels to generate. Not a generator option; the Node
   *     command loops generateLevel() count times.
   *   - difficulty is classified after solver analysis; it does not tune
   *     placement and is not a generation input.
   *   - minEdges / maxEdges: minimum and maximum arrow length in edges.
   *   - longLineRatio: long arrow minimum length as a map-size ratio.
   *   - longLineQuota: target share of long arrows.
   *   - seed: deterministic seed prefix.
   *   - algorithm: default "free-placement". Use "reverse" for the old
   *     reverse-insertion generator.
   *   - tileSize / tileWidth / tileHeight: old reverse stitch tile size.
   *   - useTileStitch: only applies with --algorithm reverse.
   *   - fullSolve: force or skip expensive solution counting.
   *
   * Debug preview params:
   *   Use generateDebugPreviewLevel({...same params...}) to return a verified
   *   level with placement-order controls. If generation fails, it returns the
   *   last failed partial level instead.
   */
  function generateLevel(options = {}) {
    const config = normalizeConfig(options);

    if (config.algorithm === "flow") {
      return generateFlowLevel(config);
    }

    if (shouldUseTileStitch(config)) {
      return generateStitchedLevel(config);
    }

    if (config.algorithm === "reverse") {
      return generateSinglePassLevel(config);
    }

    return generateFreePlacementLevel(config);
  }

  function generateDebugPreviewLevel(options = {}) {
    return generateLevel({
      ...options,
      debugGeneratedLevel: true,
      captureFailurePreview: true,
      returnFailurePreview: true
    });
  }

  function getLastDebugPreviewLevel() {
    return lastDebugPreviewLevel ? rules.cloneLevel(lastDebugPreviewLevel) : null;
  }

  window.ArrowPuzzleGenerator = {
    generateLevel,
    generateDebugPreviewLevel,
    getLastDebugPreviewLevel,
    createRandom,
    GENERATION_CONFIG,
    DIFFICULTY_RULES
  };
}());
