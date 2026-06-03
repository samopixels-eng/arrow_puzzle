(function () {
  "use strict";

  const DIRECTIONS = {
    up: { name: "up", dx: 0, dy: -1 },
    right: { name: "right", dx: 1, dy: 0 },
    down: { name: "down", dx: 0, dy: 1 },
    left: { name: "left", dx: -1, dy: 0 }
  };

  function clonePoint(point) {
    return [point[0], point[1]];
  }

  function cloneArrow(arrow) {
    return {
      ...arrow,
      path: arrow.path.map(clonePoint)
    };
  }

  function cloneLevel(level) {
    return {
      ...level,
      arrows: level.arrows.map(cloneArrow),
      solutionOrder: level.solutionOrder ? [...level.solutionOrder] : undefined,
      stats: level.stats ? { ...level.stats } : undefined
    };
  }

  function pointKey(x, y) {
    return `${x},${y}`;
  }

  function parsePointKey(key) {
    const parts = key.split(",").map(Number);
    return [parts[0], parts[1]];
  }

  function edgeKey(a, b) {
    const first = pointKey(a[0], a[1]);
    const second = pointKey(b[0], b[1]);
    return first < second ? `${first}|${second}` : `${second}|${first}`;
  }

  function isInBounds(level, point) {
    return (
      point[0] >= 0 &&
      point[1] >= 0 &&
      point[0] < level.pointColumns &&
      point[1] < level.pointRows
    );
  }

  function buildPathMetrics(path) {
    const segments = [];
    let length = 0;

    for (let index = 0; index < path.length - 1; index += 1) {
      const start = path[index];
      const end = path[index + 1];
      const segmentLength = Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]);

      segments.push({
        start,
        end,
        from: length,
        to: length + segmentLength,
        length: segmentLength
      });
      length += segmentLength;
    }

    return { segments, length };
  }

  function getHeadDirection(path) {
    if (!Array.isArray(path) || path.length < 2) {
      return null;
    }

    const end = path[path.length - 1];
    const beforeEnd = path[path.length - 2];
    const dx = Math.sign(end[0] - beforeEnd[0]);
    const dy = Math.sign(end[1] - beforeEnd[1]);

    if (dx > 0 && dy === 0) {
      return DIRECTIONS.right;
    }

    if (dx < 0 && dy === 0) {
      return DIRECTIONS.left;
    }

    if (dy > 0 && dx === 0) {
      return DIRECTIONS.down;
    }

    if (dy < 0 && dx === 0) {
      return DIRECTIONS.up;
    }

    return null;
  }

  function addCount(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
  }

  function expandPath(path) {
    const points = new Set();
    const edges = new Set();
    const pointVisitCounts = new Map();
    const edgeVisitCounts = new Map();
    const orderedPoints = [];
    const invalidSegments = [];

    if (!Array.isArray(path) || path.length === 0) {
      return {
        points,
        edges,
        pointVisitCounts,
        edgeVisitCounts,
        orderedPoints,
        invalidSegments: ["path is empty"]
      };
    }

    let x = path[0][0];
    let y = path[0][1];
    orderedPoints.push([x, y]);
    points.add(pointKey(x, y));
    addCount(pointVisitCounts, pointKey(x, y));

    for (let index = 0; index < path.length - 1; index += 1) {
      const start = path[index];
      const end = path[index + 1];
      const dx = Math.sign(end[0] - start[0]);
      const dy = Math.sign(end[1] - start[1]);
      const steps = Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]);

      if (steps === 0 || (dx !== 0 && dy !== 0)) {
        invalidSegments.push(`invalid segment ${index}`);
        continue;
      }

      x = start[0];
      y = start[1];

      for (let step = 0; step < steps; step += 1) {
        const next = [x + dx, y + dy];
        const key = edgeKey([x, y], next);
        edges.add(key);
        addCount(edgeVisitCounts, key);
        x = next[0];
        y = next[1];
        orderedPoints.push([x, y]);
        points.add(pointKey(x, y));
        addCount(pointVisitCounts, pointKey(x, y));
      }
    }

    return {
      points,
      edges,
      pointVisitCounts,
      edgeVisitCounts,
      orderedPoints,
      invalidSegments
    };
  }

  function getArrowOccupancyMap(arrows, ignoreId) {
    const points = new Map();
    const edges = new Map();

    for (const arrow of arrows) {
      if (arrow.id === ignoreId) {
        continue;
      }

      const occupied = expandPath(arrow.path);

      for (const point of occupied.points) {
        points.set(point, arrow.id);
      }

      for (const edge of occupied.edges) {
        edges.set(edge, arrow.id);
      }
    }

    return { points, edges };
  }

  function getHeadExitBlock(level, arrows, arrow) {
    const occupied = getArrowOccupancyMap(arrows, arrow.id);
    const direction = getHeadDirection(arrow.path);

    if (!direction) {
      return {
        arrowId: arrow.id,
        blockedBy: null,
        type: "invalid-direction",
        key: arrow.id,
        distance: 0
      };
    }

    const head = arrow.path[arrow.path.length - 1];
    const maxDistance = Math.max(level.pointColumns, level.pointRows) + 3;
    let previous = [...head];

    for (let distance = 1; distance <= maxDistance; distance += 1) {
      const next = [
        head[0] + direction.dx * distance,
        head[1] + direction.dy * distance
      ];
      const edge = edgeKey(previous, next);
      const point = pointKey(next[0], next[1]);

      if (occupied.edges.has(edge)) {
        return {
          arrowId: arrow.id,
          blockedBy: occupied.edges.get(edge),
          type: "edge",
          key: edge,
          distance: Math.max(0, distance - 1)
        };
      }

      if (isInBounds(level, next) && occupied.points.has(point)) {
        return {
          arrowId: arrow.id,
          blockedBy: occupied.points.get(point),
          type: "point",
          key: point,
          distance: Math.max(0, distance - 0.001)
        };
      }

      previous = next;

      if (!isInBounds(level, next)) {
        break;
      }
    }

    return null;
  }

  function isArrowRemovable(level, arrows, arrow) {
    return getHeadExitBlock(level, arrows, arrow) === null;
  }

  function getRemovableArrows(level, arrows) {
    return arrows.filter((arrow) => isArrowRemovable(level, arrows, arrow));
  }

  function getAllPointKeys(level) {
    const keys = [];

    for (let y = 0; y < level.pointRows; y += 1) {
      for (let x = 0; x < level.pointColumns; x += 1) {
        keys.push(pointKey(x, y));
      }
    }

    return keys;
  }

  function getPointNeighbors(level, point) {
    const neighbors = [];

    for (const direction of Object.values(DIRECTIONS)) {
      const next = [point[0] + direction.dx, point[1] + direction.dy];

      if (isInBounds(level, next)) {
        neighbors.push(next);
      }
    }

    return neighbors;
  }

  function getComponentsFromKeys(level, keys) {
    const remaining = new Set(keys);
    const components = [];

    while (remaining.size > 0) {
      const startKey = remaining.values().next().value;
      const stack = [parsePointKey(startKey)];
      const component = [];
      remaining.delete(startKey);

      while (stack.length > 0) {
        const point = stack.pop();
        component.push(point);

        for (const neighbor of getPointNeighbors(level, point)) {
          const neighborKey = pointKey(neighbor[0], neighbor[1]);

          if (remaining.has(neighborKey)) {
            remaining.delete(neighborKey);
            stack.push(neighbor);
          }
        }
      }

      components.push(component);
    }

    return components;
  }

  function isOuterExit(level, arrow) {
    const direction = getHeadDirection(arrow.path);

    if (!direction) {
      return false;
    }

    const head = arrow.path[arrow.path.length - 1];

    return (
      (head[0] === 0 && direction.dx < 0) ||
      (head[0] === level.pointColumns - 1 && direction.dx > 0) ||
      (head[1] === 0 && direction.dy < 0) ||
      (head[1] === level.pointRows - 1 && direction.dy > 0)
    );
  }

  function validateGeometry(level, options = {}) {
    const errors = [];
    const pointOwners = new Map();
    const edgeOwners = new Map();
    const ids = new Set();

    if (!level || !Number.isInteger(level.pointColumns) || !Number.isInteger(level.pointRows)) {
      errors.push("level dimensions must be integers");
      return { valid: false, errors };
    }

    if (level.pointColumns < 2 || level.pointRows < 2) {
      errors.push("level dimensions must be at least 2x2");
    }

    if (!Array.isArray(level.arrows)) {
      errors.push("level.arrows must be an array");
      return { valid: false, errors };
    }

    for (const arrow of level.arrows) {
      if (!arrow.id) {
        errors.push("arrow id is required");
        continue;
      }

      if (ids.has(arrow.id)) {
        errors.push(`duplicate arrow id ${arrow.id}`);
      }
      ids.add(arrow.id);

      if (!Array.isArray(arrow.path) || arrow.path.length < 2) {
        errors.push(`arrow ${arrow.id} must connect at least two points`);
        continue;
      }

      const metrics = buildPathMetrics(arrow.path);

      if (metrics.length < 1) {
        errors.push(`arrow ${arrow.id} is shorter than one edge`);
      }

      const direction = getHeadDirection(arrow.path);

      if (!direction) {
        errors.push(`arrow ${arrow.id} has invalid head direction`);
      }

      const occupied = expandPath(arrow.path);

      for (const invalidSegment of occupied.invalidSegments) {
        errors.push(`arrow ${arrow.id} ${invalidSegment}`);
      }

      for (const point of occupied.orderedPoints) {
        if (!isInBounds(level, point)) {
          errors.push(`arrow ${arrow.id} point ${pointKey(point[0], point[1])} is out of bounds`);
        }
      }

      for (const [point, count] of occupied.pointVisitCounts) {
        if (count > 1) {
          errors.push(`arrow ${arrow.id} revisits point ${point}`);
        }
      }

      for (const [edge, count] of occupied.edgeVisitCounts) {
        if (count > 1) {
          errors.push(`arrow ${arrow.id} revisits edge ${edge}`);
        }
      }

      for (const point of occupied.points) {
        if (pointOwners.has(point)) {
          errors.push(`point overlap ${pointOwners.get(point)} ${arrow.id} at ${point}`);
        } else {
          pointOwners.set(point, arrow.id);
        }
      }

      for (const edge of occupied.edges) {
        if (edgeOwners.has(edge)) {
          errors.push(`edge overlap ${edgeOwners.get(edge)} ${arrow.id} at ${edge}`);
        } else {
          edgeOwners.set(edge, arrow.id);
        }
      }
    }

    if (options.requireFullPointCover) {
      for (const key of getAllPointKeys(level)) {
        if (!pointOwners.has(key)) {
          errors.push(`empty point ${key}`);
        }
      }
    }

    if (options.requireFirstExit && options.solutionOrder && options.solutionOrder.length > 0) {
      const first = level.arrows.find((arrow) => arrow.id === options.solutionOrder[0]);

      if (!first) {
        errors.push(`first solution arrow ${options.solutionOrder[0]} not found`);
      } else if (!isOuterExit(level, first)) {
        errors.push(`first solution arrow ${first.id} must point out from the outer edge`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  function validateKnownSolution(level, solutionOrder) {
    if (!Array.isArray(solutionOrder) || solutionOrder.length === 0) {
      return {
        valid: false,
        failedAt: 0,
        reason: "solutionOrder is empty"
      };
    }

    let remaining = level.arrows.map(cloneArrow);

    for (let index = 0; index < solutionOrder.length; index += 1) {
      const id = solutionOrder[index];
      const arrow = remaining.find((candidate) => candidate.id === id);

      if (!arrow) {
        return {
          valid: false,
          failedAt: index,
          arrowId: id,
          reason: "arrow is missing from remaining state"
        };
      }

      if (!isArrowRemovable(level, remaining, arrow)) {
        return {
          valid: false,
          failedAt: index,
          arrowId: id,
          reason: "arrow is blocked"
        };
      }

      remaining = remaining.filter((candidate) => candidate.id !== id);
    }

    if (remaining.length > 0) {
      return {
        valid: false,
        failedAt: solutionOrder.length,
        reason: "solutionOrder does not remove every arrow",
        remaining: remaining.map((arrow) => arrow.id)
      };
    }

    return {
      valid: true,
      failedAt: null,
      reason: null
    };
  }

  window.ArrowPuzzleRules = {
    DIRECTIONS,
    cloneArrow,
    cloneLevel,
    pointKey,
    parsePointKey,
    edgeKey,
    isInBounds,
    buildPathMetrics,
    getHeadDirection,
    expandPath,
    getArrowOccupancyMap,
    getHeadExitBlock,
    isArrowRemovable,
    getRemovableArrows,
    getAllPointKeys,
    getPointNeighbors,
    getComponentsFromKeys,
    isOuterExit,
    validateGeometry,
    validateKnownSolution
  };
}());
