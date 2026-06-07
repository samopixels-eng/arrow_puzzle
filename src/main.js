(function () {
  "use strict";

  const puzzleRules = window.ArrowPuzzleRules;
  const appConfig = window.ARROW_PUZZLE_CONFIG || {};

  if (!puzzleRules) {
    throw new Error("Puzzle rules must load before main.js");
  }

  if (!Array.isArray(window.ARROW_PUZZLE_LEVELS)) {
    throw new Error("Saved levels must be defined in src/levels.js as window.ARROW_PUZZLE_LEVELS.");
  }

  const storedLevels = window.ARROW_PUZZLE_LEVELS;

  const NAVY = "#111a4f";
  const DANGER = "#ff385c";
  const DEBUG_FILL = "rgba(255, 56, 92, 0.08)";
  const DEBUG_STROKE = "rgba(255, 56, 92, 0.45)";
  const DEBUG_POINT = "#ff385c";
  const DEBUG_LABEL_FILL = "#ffffff";
  const DEBUG_LABEL_STROKE = "#111827";
  const EXIT_DURATION_MS = 960;
  const BLOCKED_TRAVEL_MS = 240;
  const BLOCKED_RETURN_MS = 300;
  const JITTER_DURATION_MS = 200;
  const JITTER_CYCLES = 6;
  const SHAKE_DISTANCE = 0.09;
  const MIN_TOUCH_RADIUS = 50;
  const TOUCH_RADIUS_MULTIPLIER = 2.75;
  const ZERO_JITTER = { x: 0, y: 0 };

  function normalizeStoredLevel(level, index) {
    return {
      ...level,
      id: level.id || index + 1,
      mask: level.mask ? new Set(level.mask) : undefined,
      arrows: level.arrows.map((arrow) => ({
        ...arrow,
        color: arrow.color || NAVY,
        path: arrow.path.map((point) => [...point])
      })),
      solutionOrder: level.solutionOrder ? [...level.solutionOrder] : undefined,
      stats: level.stats ? { ...level.stats } : undefined
    };
  }

  const LEVELS = storedLevels.map(normalizeStoredLevel);
  const MAX_LEVELS = LEVELS.length;

  function hasLevelIndex(levelIndex) {
    return Number.isSafeInteger(levelIndex) && levelIndex >= 0 && levelIndex < MAX_LEVELS;
  }

  function getLevel(levelIndex) {
    if (!hasLevelIndex(levelIndex)) {
      return null;
    }

    return LEVELS[levelIndex];
  }

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const levelLabel = document.querySelector(".level-label");
  const remainingLabel = document.getElementById("remaining-label");
  const restartButton = document.getElementById("restart-button");
  const clearPanel = document.getElementById("clear-panel");
  const clearPanelTitle = clearPanel.querySelector("p");
  const clearActionButton = document.getElementById("clear-restart");

  const state = {
    levelIndex: 0,
    level: null,
    arrows: [],
    view: null,
    moving: null,
    complete: false,
    debugOrderLimit: null
  };

  let devStageInput = null;
  let devStageStatus = null;
  let debugOrderPanel = null;
  let debugOrderRange = null;
  let debugOrderStatus = null;

  function cloneLevel(level) {
    return puzzleRules.cloneLevel(level);
  }

  function loadLevel(levelIndex) {
    const sourceLevel = getLevel(levelIndex);

    if (!sourceLevel) {
      return false;
    }

    const level = cloneLevel(sourceLevel);
    state.levelIndex = levelIndex;
    state.level = level;
    state.arrows = level.arrows.map((arrow) => ({
      ...arrow,
      metrics: puzzleRules.buildPathMetrics(arrow.path)
    }));
    state.moving = null;
    state.complete = false;
    state.debugOrderLimit = level.debugPreview ? Math.min(1, level.arrows.length) : null;
    clearPanel.hidden = true;
    clearPanelTitle.textContent = "LEVEL CLEAR";
    clearActionButton.disabled = false;
    clearActionButton.textContent = "Next Level";
    updateLevelLabel();
    updateRemainingLabel();
    syncDevStagePicker();
    syncDebugOrderPanel();
    calculateView();
    validateLevelGeometry();
    render();
    return true;
  }

  function resetLevel() {
    return loadLevel(state.levelIndex);
  }

  function loadNextLevel() {
    if (isLastLevel()) {
      return false;
    }

    return loadLevel(state.levelIndex + 1);
  }

  function loadLevelNumber(levelNumber) {
    if (!Number.isSafeInteger(levelNumber) || levelNumber < 1 || levelNumber > MAX_LEVELS) {
      return false;
    }

    return loadLevel(levelNumber - 1);
  }

  function isLastLevel() {
    return state.levelIndex >= MAX_LEVELS - 1;
  }

  function updateLevelLabel() {
    const levelNumber = state.levelIndex + 1;
    const label = state.level.debugPreview ? `Debug ${levelNumber}` : `Level ${levelNumber}`;
    levelLabel.textContent = label;
    canvas.setAttribute("aria-label", `${label} puzzle`);
  }

  function getPointAtDistance(route, distance) {
    const clamped = Math.max(0, Math.min(distance, route.length));

    for (const segment of route.segments) {
      if (clamped <= segment.to || segment === route.segments[route.segments.length - 1]) {
        const segmentT = segment.length === 0 ? 0 : (clamped - segment.from) / segment.length;

        return {
          x: segment.start[0] + (segment.end[0] - segment.start[0]) * segmentT,
          y: segment.start[1] + (segment.end[1] - segment.start[1]) * segmentT
        };
      }
    }

    const last = route.segments[route.segments.length - 1].end;
    return { x: last[0], y: last[1] };
  }

  function buildExitRoute(arrow) {
    const direction = puzzleRules.getHeadDirection(arrow.path);
    const extendedPath = arrow.path.map((point) => [...point]);
    const head = extendedPath[extendedPath.length - 1];
    const exitDistance = Math.max(state.level.pointColumns, state.level.pointRows) + 3;

    extendedPath.push([
      head[0] + direction.dx * exitDistance,
      head[1] + direction.dy * exitDistance
    ]);

    return puzzleRules.buildPathMetrics(extendedPath);
  }

  function getVisibleMovingPath(move, timestamp) {
    const elapsed = timestamp - move.startedAt;
    const t = Math.min(1, elapsed / move.duration);
    const eased = 1 - Math.pow(1 - t, 3);
    const headDistance = move.bodyLength + move.exitDistance * eased;
    const tailDistance = headDistance - move.bodyLength;
    const points = sampleRouteRange(move.route, tailDistance, headDistance);

    return {
      done: t >= 1,
      color: move.arrow.color,
      jitter: ZERO_JITTER,
      points
    };
  }

  function sampleRouteRange(route, startDistance, endDistance) {
    const step = 0.08;
    const points = [getPointAtDistance(route, startDistance)];

    for (let distance = Math.ceil(startDistance / step) * step; distance < endDistance; distance += step) {
      if (distance > startDistance) {
        points.push(getPointAtDistance(route, distance));
      }
    }

    points.push(getPointAtDistance(route, endDistance));
    return simplifyCollinear(points);
  }

  function simplifyCollinear(points) {
    if (points.length <= 2) {
      return points;
    }

    const simplified = [points[0]];

    for (let index = 1; index < points.length - 1; index += 1) {
      const previous = simplified[simplified.length - 1];
      const current = points[index];
      const next = points[index + 1];
      const sameX = Math.abs(previous.x - current.x) < 0.001 && Math.abs(current.x - next.x) < 0.001;
      const sameY = Math.abs(previous.y - current.y) < 0.001 && Math.abs(current.y - next.y) < 0.001;

      if (!sameX && !sameY) {
        simplified.push(current);
      }
    }

    simplified.push(points[points.length - 1]);
    return simplified;
  }

  function validateLevelGeometry() {
    const geometry = puzzleRules.validateGeometry(state.level, {
      requireFullPointCover: Boolean(state.level.requireFullPointCover),
      solutionOrder: state.level.solutionOrder,
      requireFirstExit: Boolean(state.level.solutionOrder)
    });

    if (!geometry.valid) {
      console.warn("Level geometry validation failed", geometry.errors);
    }

    if (state.level.solutionOrder) {
      const knownSolution = puzzleRules.validateKnownSolution(state.level, state.level.solutionOrder);

      if (!knownSolution.valid) {
        console.warn("Level solution validation failed", knownSolution);
      }
    }
  }

  function calculateView() {
    const container = canvas.parentElement;
    const available = Math.max(280, Math.floor((container && container.clientWidth) || 420));
    const baseSize = Math.min(420, available);
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

    // Point spacing is fixed to what a 10-wide board uses at the base width, so
    // density never changes. Larger boards grow the canvas (and the board-stage
    // scrolls) instead of cramming points closer together.
    const REFERENCE_COLUMNS = 10;
    const paddingRatio = 0.13;
    const padding = baseSize * paddingRatio;
    const step = (baseSize - padding * 2) / (REFERENCE_COLUMNS - 1);

    const width = padding * 2 + step * (state.level.pointColumns - 1);
    const height = padding * 2 + step * (state.level.pointRows - 1);

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    state.view = {
      width,
      height,
      boardX: padding,
      boardY: padding,
      step,
      lineWidth: Math.max(6, step * 0.11),
      headLength: Math.max(16, step * 0.42),
      headWidth: Math.max(18, step * 0.48)
    };
  }

  function render(timestamp) {
    if (!state.level || !state.view) {
      return;
    }

    const now = timestamp || performance.now();
    ctx.clearRect(0, 0, state.view.width, state.view.height);
    drawBoardBase();
    drawGridPoints();
    drawDebugOverlay();
    drawArrows(now);

    if (state.moving) {
      requestAnimationFrame(render);
    }
  }

  function drawBoardBase() {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, state.view.width, state.view.height);
    ctx.restore();
  }

  // Draw a dot at every active lattice point so the figure (and its holes) is
  // visible. Uses the mask-aware point list, so masked levels show their shape.
  function drawGridPoints() {
    const radius = Math.max(2, state.view.step * 0.07);

    ctx.save();
    ctx.fillStyle = "rgba(17, 26, 79, 0.16)";

    for (const key of puzzleRules.getAllPointKeys(state.level)) {
      const point = puzzleRules.parsePointKey(key);
      const screenPoint = gridPointToScreen(point);

      ctx.beginPath();
      ctx.arc(screenPoint.x, screenPoint.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawDebugOverlay() {
    if (!state.level.debugPreview || !state.level.debug) {
      return;
    }

    drawDebugTile(state.level.debug.tile);
    drawDebugFreePoints(state.level.debug.freeKeys || []);
  }

  function drawDebugTile(tile) {
    if (!tile) {
      return;
    }

    const left = state.view.boardX + (tile.x - 0.45) * state.view.step;
    const top = state.view.boardY + (tile.y - 0.45) * state.view.step;
    const width = Math.max(state.view.step, (tile.width - 1 + 0.9) * state.view.step);
    const height = Math.max(state.view.step, (tile.height - 1 + 0.9) * state.view.step);

    ctx.save();
    ctx.fillStyle = DEBUG_FILL;
    ctx.strokeStyle = DEBUG_STROKE;
    ctx.lineWidth = Math.max(2, state.view.step * 0.04);
    ctx.fillRect(left, top, width, height);
    ctx.strokeRect(left, top, width, height);
    ctx.restore();
  }

  function drawDebugFreePoints(freeKeys) {
    if (freeKeys.length === 0) {
      return;
    }

    const radius = Math.max(4, state.view.step * 0.13);

    ctx.save();
    ctx.fillStyle = DEBUG_POINT;

    for (const key of freeKeys) {
      const point = puzzleRules.parsePointKey(key);
      const screenPoint = gridPointToScreen(point);

      ctx.beginPath();
      ctx.arc(screenPoint.x, screenPoint.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawArrows(timestamp) {
    const movingId = state.moving ? state.moving.id : null;
    const visibleArrows = getDebugVisibleArrows();

    for (const arrow of visibleArrows) {
      if (arrow.id !== movingId) {
        drawArrowPath(arrow.path, arrow.color);
      }
    }

    if (state.moving) {
      const movingPath = getMovingPathState(state.moving, timestamp);
      drawArrowPath(movingPath.points, movingPath.color, true, movingPath.jitter);

      if (movingPath.done) {
        finishMoving();
      }
    }

    drawDebugOrderLabels(visibleArrows);
  }

  function getDebugVisibleArrows() {
    if (!state.level.debugPreview || state.debugOrderLimit === null) {
      return state.arrows;
    }

    return state.arrows.slice(0, state.debugOrderLimit);
  }

  function getMovingPathState(move, timestamp) {
    if (move.mode === "blocked") {
      return getBlockedMovingPath(move, timestamp);
    }

    return getVisibleMovingPath(move, timestamp);
  }

  function getVisiblePathAtOffset(route, bodyLength, offset) {
    return sampleRouteRange(route, offset, bodyLength + offset);
  }

  function toScreenPoint(point) {
    return {
      x: state.view.boardX + point.x * state.view.step,
      y: state.view.boardY + point.y * state.view.step
    };
  }

  function gridPointToScreen(point) {
    return toScreenPoint({ x: point[0], y: point[1] });
  }

  function drawArrowPath(path, color, isMoving, jitter = ZERO_JITTER) {
    const points = path.map((point) => {
      const screenPoint = Array.isArray(point) ? gridPointToScreen(point) : toScreenPoint(point);
      return applyJitter(screenPoint, jitter);
    });

    if (points.length < 2) {
      return;
    }

    const shaftPoints = getShaftPoints(points);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = state.view.lineWidth * (isMoving ? 1.05 : 1);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    ctx.beginPath();
    ctx.moveTo(shaftPoints[0].x, shaftPoints[0].y);

    for (let index = 1; index < shaftPoints.length; index += 1) {
      ctx.lineTo(shaftPoints[index].x, shaftPoints[index].y);
    }

    ctx.stroke();
    drawArrowHead(points, color);
    ctx.restore();
  }

  function applyJitter(point, jitter) {
    return {
      x: point.x + jitter.x * state.view.step,
      y: point.y + jitter.y * state.view.step
    };
  }

  function getPolylineLength(points) {
    let length = 0;

    for (let index = 0; index < points.length - 1; index += 1) {
      length += Math.hypot(points[index + 1].x - points[index].x, points[index + 1].y - points[index].y);
    }

    return length;
  }

  function getShaftPoints(points) {
    const totalLength = getPolylineLength(points);
    const trimDistance = Math.min(state.view.headLength * 0.78, Math.max(0, totalLength - 1));

    return trimPolylineEnd(points, trimDistance);
  }

  function trimPolylineEnd(points, trimDistance) {
    if (trimDistance <= 0) {
      return points;
    }

    let remaining = trimDistance;

    for (let index = points.length - 1; index > 0; index -= 1) {
      const end = points[index];
      const start = points[index - 1];
      const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);

      if (segmentLength > remaining) {
        const t = (segmentLength - remaining) / segmentLength;
        const trimmedEnd = {
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t
        };

        return points.slice(0, index).concat(trimmedEnd);
      }

      remaining -= segmentLength;
    }

    return [points[0], points[0]];
  }

  function drawArrowHead(points, color) {
    const end = points[points.length - 1];
    const beforeEnd = points[points.length - 2];
    const dx = end.x - beforeEnd.x;
    const dy = end.y - beforeEnd.y;
    const angle = Math.atan2(dy, dx);
    const length = state.view.headLength;
    const width = state.view.headWidth;

    ctx.save();
    ctx.translate(end.x, end.y);
    ctx.rotate(angle);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-length, -width * 0.5);
    ctx.lineTo(-length, width * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawDebugOrderLabels(arrows) {
    if (!state.level.debugPreview) {
      return;
    }

    for (const arrow of arrows) {
      const order = state.level.arrows.findIndex((candidate) => candidate.id === arrow.id) + 1;

      if (order > 0) {
        drawDebugOrderLabel(arrow, order);
      }
    }
  }

  function drawDebugOrderLabel(arrow, order) {
    const head = gridPointToScreen(arrow.path[arrow.path.length - 1]);
    const radius = Math.max(9, state.view.step * 0.18);
    const text = String(order);

    ctx.save();
    ctx.fillStyle = DEBUG_LABEL_STROKE;
    ctx.beginPath();
    ctx.arc(head.x, head.y, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = DEBUG_LABEL_FILL;
    ctx.font = `800 ${Math.max(10, radius * 0.95)}px Inter, ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, head.x, head.y + 0.5);
    ctx.restore();
  }

  function handlePointerDown(event) {
    if (state.moving || state.complete) {
      return;
    }

    const arrow = arrowFromPointer(event);
    if (arrow) {
      startMovingArrow(arrow);
    }
  }

  function arrowFromPointer(event) {
    const rect = canvas.getBoundingClientRect();
    const pointer = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    let closest = null;
    let closestDistance = Infinity;

    for (let index = state.arrows.length - 1; index >= 0; index -= 1) {
      const arrow = state.arrows[index];
      const distance = distanceToPath(pointer, arrow.path);

      if (distance < closestDistance) {
        closest = arrow;
        closestDistance = distance;
      }
    }

    return closestDistance <= getTouchRadius() ? closest : null;
  }

  function getTouchRadius() {
    return Math.max(MIN_TOUCH_RADIUS, state.view.lineWidth * TOUCH_RADIUS_MULTIPLIER);
  }

  function distanceToPath(pointer, path) {
    let shortest = Infinity;

    for (let index = 0; index < path.length - 1; index += 1) {
      const a = gridPointToScreen(path[index]);
      const b = gridPointToScreen(path[index + 1]);
      shortest = Math.min(shortest, distanceToSegment(pointer, a, b));
    }

    return shortest;
  }

  function distanceToSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      return Math.hypot(point.x - a.x, point.y - a.y);
    }

    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    const projection = {
      x: a.x + t * dx,
      y: a.y + t * dy
    };

    return Math.hypot(point.x - projection.x, point.y - projection.y);
  }

  function startMovingArrow(arrow) {
    const block = puzzleRules.getHeadExitBlock(state.level, state.arrows, arrow);

    if (block) {
      startBlockedArrow(arrow, block);
      return;
    }

    const route = buildExitRoute(arrow);
    state.moving = {
      mode: "exit",
      id: arrow.id,
      arrow,
      route,
      bodyLength: arrow.metrics.length,
      exitDistance: route.length - arrow.metrics.length,
      duration: EXIT_DURATION_MS,
      startedAt: performance.now()
    };

    render();
  }

  function startBlockedArrow(arrow, block) {
    const route = buildBlockedRoute(arrow, block.distance);
    state.moving = {
      mode: "blocked",
      id: arrow.id,
      arrow,
      block,
      route,
      bodyLength: arrow.metrics.length,
      travelDistance: block.distance,
      travelDuration: BLOCKED_TRAVEL_MS,
      returnDuration: BLOCKED_RETURN_MS,
      startedAt: performance.now()
    };

    console.warn("Arrow head blocked", block);
    window.setTimeout(triggerBlockedHaptic, BLOCKED_TRAVEL_MS);
    render();
  }

  function buildBlockedRoute(arrow, distance) {
    const direction = puzzleRules.getHeadDirection(arrow.path);
    const extendedPath = arrow.path.map((point) => [...point]);
    const head = extendedPath[extendedPath.length - 1];

    extendedPath.push([
      head[0] + direction.dx * distance,
      head[1] + direction.dy * distance
    ]);

    return puzzleRules.buildPathMetrics(extendedPath);
  }

  function getBlockedMovingPath(move, timestamp) {
    const elapsed = timestamp - move.startedAt;
    const travelEnd = move.travelDuration;
    const totalDuration = travelEnd + move.returnDuration;
    let offset = 0;
    let jitter = ZERO_JITTER;
    let color = move.arrow.color;

    if (elapsed <= travelEnd) {
      const t = Math.min(1, elapsed / move.travelDuration);
      offset = move.travelDistance * (1 - Math.pow(1 - t, 3));
    } else {
      const t = Math.min(1, (elapsed - travelEnd) / move.returnDuration);
      const jitterT = Math.min(1, (elapsed - travelEnd) / JITTER_DURATION_MS);
      offset = move.travelDistance * Math.pow(1 - t, 3);
      jitter = getBlockedJitter(move.arrow, jitterT);
      color = DANGER;
    }

    return {
      done: elapsed >= totalDuration,
      color,
      jitter,
      points: getVisiblePathAtOffset(move.route, move.bodyLength, Math.max(0, offset))
    };
  }

  function getBlockedJitter(arrow, t) {
    if (t >= 1) {
      return ZERO_JITTER;
    }

    const direction = puzzleRules.getHeadDirection(arrow.path);
    const perpendicular = {
      x: -direction.dy,
      y: direction.dx
    };
    const phase = Math.sin(t * Math.PI * JITTER_CYCLES * 2);
    const amplitude = SHAKE_DISTANCE * (1 - t);

    return {
      x: perpendicular.x * phase * amplitude,
      y: perpendicular.y * phase * amplitude
    };
  }

  function triggerBlockedHaptic() {
    const mobileLike = navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;

    if (!mobileLike) {
      console.info("Blocked haptic skipped", { reason: "non-mobile pointer context" });
      return;
    }

    if (!navigator.vibrate) {
      console.info("Blocked haptic unavailable", { reason: "navigator.vibrate is not present" });
      return;
    }

    const accepted = navigator.vibrate([12, 24, 12]);
    console.info("Blocked haptic requested", { accepted });
  }

  function finishMoving() {
    if (state.moving.mode === "blocked") {
      state.moving = null;
      render();
      return;
    }

    finishMovingArrow();
  }

  function finishMovingArrow() {
    const movingId = state.moving.id;
    state.arrows = state.arrows.filter((arrow) => arrow.id !== movingId);
    state.moving = null;
    updateRemainingLabel();

    if (state.arrows.length === 0) {
      state.complete = true;
      clearPanel.hidden = false;
      updateClearPanel();
    }

    render();
  }

  function updateClearPanel() {
    if (isLastLevel()) {
      clearPanelTitle.textContent = "ALL CLEAR";
      clearActionButton.textContent = "Complete";
      clearActionButton.disabled = true;
      return;
    }

    clearPanelTitle.textContent = "LEVEL CLEAR";
    clearActionButton.textContent = "Next Level";
    clearActionButton.disabled = false;
  }

  function updateRemainingLabel() {
    if (state.level.debugPreview && state.level.debug) {
      const openCount = state.level.debug.freeKeys ? state.level.debug.freeKeys.length : 0;
      const visibleCount = state.debugOrderLimit || state.arrows.length;
      remainingLabel.textContent = `Debug: ${visibleCount}/${state.arrows.length} placed / ${openCount} open`;
      return;
    }

    const count = state.arrows.length;
    remainingLabel.textContent = count === 1 ? "1 left" : `${count} left`;
  }

  function handleResize() {
    if (!state.level) {
      return;
    }

    calculateView();
    render();
  }

  function setupDevStagePicker() {
    if (!appConfig.devMode) {
      return;
    }

    const panel = document.createElement("aside");
    panel.className = "dev-stage-picker";
    panel.setAttribute("aria-label", "Development stage picker");
    panel.innerHTML = [
      '<div class="dev-stage-title">DEV</div>',
      '<label class="dev-stage-field">',
      '<span>Stage</span>',
      `<input id="dev-stage-input" type="number" min="1" max="${MAX_LEVELS}" step="1" inputmode="numeric" aria-label="Stage number">`,
      '</label>',
      '<div class="dev-stage-actions">',
      '<button type="button" data-dev-stage-step="-1" aria-label="Previous stage">-</button>',
      '<button type="button" data-dev-stage-play aria-label="Load stage">Go</button>',
      '<button type="button" data-dev-stage-step="1" aria-label="Next stage">+</button>',
      '</div>',
      '<p class="dev-stage-status" aria-live="polite"></p>'
    ].join("");

    document.body.appendChild(panel);

    devStageInput = panel.querySelector("#dev-stage-input");
    devStageStatus = panel.querySelector(".dev-stage-status");

    const playStage = (levelNumber) => {
      try {
        if (loadLevelNumber(levelNumber)) {
          return;
        }

        devStageStatus.textContent = `Enter 1-${MAX_LEVELS}`;
        devStageInput.focus();
      } catch (error) {
        console.error("Dev stage load failed", { levelNumber, error });
        devStageStatus.textContent = "Level load failed";
      }
    };

    const playSelectedStage = () => {
      const levelNumber = Math.floor(Number(devStageInput.value));
      playStage(levelNumber);
    };

    panel.querySelector("[data-dev-stage-play]").addEventListener("click", playSelectedStage);
    devStageInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        playSelectedStage();
      }
    });

    for (const button of panel.querySelectorAll("[data-dev-stage-step]")) {
      button.addEventListener("click", () => {
        const delta = Number(button.dataset.devStageStep);
        const current = Math.max(1, Math.floor(Number(devStageInput.value)) || state.levelIndex + 1);
        playStage(Math.max(1, Math.min(MAX_LEVELS, current + delta)));
      });
    }

    syncDevStagePicker();
  }

  function setupDebugOrderPanel() {
    debugOrderPanel = document.createElement("aside");
    debugOrderPanel.className = "debug-order-panel";
    debugOrderPanel.setAttribute("aria-label", "Debug placement order");
    debugOrderPanel.hidden = true;
    debugOrderPanel.innerHTML = [
      '<div class="debug-order-title">ORDER</div>',
      '<input id="debug-order-range" type="range" min="1" max="1" value="1" step="1" aria-label="Visible placed arrows">',
      '<div class="debug-order-actions">',
      '<button type="button" data-debug-order-step="-1" aria-label="Previous placement">-</button>',
      '<button type="button" data-debug-order-all aria-label="Show all placements">All</button>',
      '<button type="button" data-debug-order-step="1" aria-label="Next placement">+</button>',
      '</div>',
      '<p class="debug-order-status" aria-live="polite"></p>'
    ].join("");

    document.body.appendChild(debugOrderPanel);

    debugOrderRange = debugOrderPanel.querySelector("#debug-order-range");
    debugOrderStatus = debugOrderPanel.querySelector(".debug-order-status");

    debugOrderRange.addEventListener("input", () => {
      setDebugOrderLimit(Number(debugOrderRange.value));
    });

    debugOrderPanel.querySelector("[data-debug-order-all]").addEventListener("click", () => {
      setDebugOrderLimit(state.arrows.length);
    });

    for (const button of debugOrderPanel.querySelectorAll("[data-debug-order-step]")) {
      button.addEventListener("click", () => {
        setDebugOrderLimit((state.debugOrderLimit || 1) + Number(button.dataset.debugOrderStep));
      });
    }
  }

  function setDebugOrderLimit(limit) {
    if (!state.level || !state.level.debugPreview) {
      return;
    }

    state.debugOrderLimit = Math.max(1, Math.min(state.arrows.length, Math.floor(limit) || 1));
    syncDebugOrderPanel();
    updateRemainingLabel();
    render();
  }

  function syncDebugOrderPanel() {
    if (!debugOrderPanel || !debugOrderRange || !debugOrderStatus) {
      return;
    }

    const enabled = Boolean(state.level && state.level.debugPreview);
    debugOrderPanel.hidden = !enabled;

    if (!enabled) {
      return;
    }

    const limit = state.debugOrderLimit || state.arrows.length;
    debugOrderRange.max = String(Math.max(1, state.arrows.length));
    debugOrderRange.value = String(limit);
    debugOrderStatus.textContent = `${limit}/${state.arrows.length}`;

    debugOrderPanel.querySelector('[data-debug-order-step="-1"]').disabled = limit <= 1;
    debugOrderPanel.querySelector('[data-debug-order-step="1"]').disabled = limit >= state.arrows.length;
  }

  function syncDevStagePicker() {
    if (!devStageInput || !devStageStatus) {
      return;
    }

    const levelNumber = state.levelIndex + 1;
    devStageInput.value = String(levelNumber);
    devStageStatus.textContent = `Loaded ${levelNumber}/${MAX_LEVELS}`;

    const panel = devStageInput.closest(".dev-stage-picker");
    panel.querySelector('[data-dev-stage-step="-1"]').disabled = levelNumber <= 1;
    panel.querySelector('[data-dev-stage-step="1"]').disabled = levelNumber >= MAX_LEVELS;
  }

  canvas.addEventListener("pointerdown", handlePointerDown);
  restartButton.addEventListener("click", resetLevel);
  clearActionButton.addEventListener("click", loadNextLevel);
  window.addEventListener("resize", handleResize);

  setupDebugOrderPanel();
  setupDevStagePicker();
  if (!resetLevel()) {
    throw new Error("No saved levels found. Run the generator to create src/levels.js.");
  }

  window.arrowPuzzle = {
    reset: resetLevel,
    nextLevel: loadNextLevel,
    loadLevel: loadLevelNumber,
    solveLevel: window.ArrowPuzzleSolver.solveLevel,
    getState() {
      return {
        levelId: state.level.id,
        levelNumber: state.levelIndex + 1,
        totalLevels: MAX_LEVELS,
        isLastLevel: isLastLevel(),
        savedLevelCount: LEVELS.length,
        seed: state.level.seed,
        remaining: state.arrows.length,
        complete: state.complete,
        moving: state.moving ? state.moving.id : null,
        debug: state.level.debug ? { ...state.level.debug } : null,
        solutionOrder: state.level.solutionOrder ? [...state.level.solutionOrder] : null,
        stats: state.level.stats ? { ...state.level.stats } : null,
        arrows: state.arrows.map((arrow) => ({
          id: arrow.id,
          path: arrow.path.map((point) => [...point])
        }))
      };
    }
  };
}());
