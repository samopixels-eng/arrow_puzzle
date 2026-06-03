(function () {
  "use strict";

  const rules = window.ArrowPuzzleRules;

  if (!rules) {
    throw new Error("ArrowPuzzleRules must load before puzzle-solver.js");
  }

  function stateKey(arrows) {
    return arrows.map((arrow) => arrow.id).sort().join("|");
  }

  function average(values) {
    if (values.length === 0) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function analyzeOrder(level, order) {
    if (!Array.isArray(order) || order.length === 0) {
      return {
        branching: [],
        averageBranching: 0,
        maxBranching: 0,
        dependencyDepth: 0
      };
    }

    let remaining = level.arrows.map(rules.cloneArrow);
    const branching = [];

    for (const id of order) {
      const moves = rules.getRemovableArrows(level, remaining);
      const arrow = remaining.find((candidate) => candidate.id === id);

      branching.push(moves.length);

      if (!arrow || !moves.some((move) => move.id === id)) {
        break;
      }

      remaining = remaining.filter((candidate) => candidate.id !== id);
    }

    return {
      branching,
      averageBranching: average(branching),
      maxBranching: branching.length > 0 ? Math.max(...branching) : 0,
      dependencyDepth: branching.filter((count) => count <= 2).length
    };
  }

  function analyzeLevel(level, options = {}) {
    const knownSolution = options.solutionOrder || level.solutionOrder || null;
    const knownValidation = knownSolution
      ? rules.validateKnownSolution(level, knownSolution)
      : { valid: false, reason: "solutionOrder is missing" };
    const knownAnalysis = analyzeOrder(level, knownSolution);
    const initialMoves = rules.getRemovableArrows(level, level.arrows).map((arrow) => arrow.id);

    return {
      solvable: Boolean(knownValidation.valid),
      oneSolution: knownValidation.valid ? [...knownSolution] : [],
      knownSolutionValid: Boolean(knownValidation.valid),
      knownSolution: knownValidation,
      initialMoves: initialMoves.length,
      initialMoveIds: initialMoves,
      maxBranching: knownAnalysis.maxBranching,
      averageBranching: knownAnalysis.averageBranching,
      knownAverageBranching: knownAnalysis.averageBranching,
      knownMaxBranching: knownAnalysis.maxBranching,
      knownBranching: knownAnalysis.branching,
      solutionCount: null,
      solutionCountCapped: false,
      dependencyDepth: knownAnalysis.dependencyDepth,
      visitedStates: 0,
      analysisMode: "linear"
    };
  }

  function solveLevel(level, options = {}) {
    const solutionCountCap = options.solutionCountCap || 1000;
    const maxVisitedStates = options.maxVisitedStates || 50000;
    const geometry = rules.validateGeometry(level, {
      requireFullPointCover: Boolean(options.requireFullPointCover),
      solutionOrder: options.solutionOrder || level.solutionOrder,
      requireFirstExit: Boolean(options.requireFirstExit)
    });

    if (!geometry.valid) {
      return {
        solvable: false,
        oneSolution: [],
        knownSolutionValid: false,
        knownSolution: null,
        initialMoves: 0,
        maxBranching: 0,
        averageBranching: 0,
        knownAverageBranching: 0,
        solutionCount: 0,
        solutionCountCapped: false,
        dependencyDepth: 0,
        visitedStates: 0,
        geometry
      };
    }

    const arrows = level.arrows.map(rules.cloneArrow);
    const initialMoves = rules.getRemovableArrows(level, arrows).map((arrow) => arrow.id);
    const knownSolution = options.solutionOrder || level.solutionOrder || null;
    const knownValidation = knownSolution
      ? rules.validateKnownSolution(level, knownSolution)
      : { valid: null };
    const knownAnalysis = analyzeOrder(level, knownSolution);
    const memo = new Map();
    const branchCounts = [];
    let visitedStates = 0;
    let capped = false;

    function countSolutions(remaining) {
      if (capped) {
        return { count: 0, oneSuffix: null };
      }

      if (remaining.length === 0) {
        return { count: 1, oneSuffix: [] };
      }

      const key = stateKey(remaining);

      if (memo.has(key)) {
        return memo.get(key);
      }

      visitedStates += 1;

      if (visitedStates > maxVisitedStates) {
        capped = true;
        return { count: 0, oneSuffix: null };
      }

      const moves = rules.getRemovableArrows(level, remaining);
      branchCounts.push(moves.length);

      if (moves.length === 0) {
        const dead = { count: 0, oneSuffix: null };
        memo.set(key, dead);
        return dead;
      }

      let count = 0;
      let oneSuffix = null;

      for (const move of moves) {
        const nextRemaining = remaining.filter((arrow) => arrow.id !== move.id);
        const result = countSolutions(nextRemaining);

        if (!oneSuffix && result.oneSuffix) {
          oneSuffix = [move.id].concat(result.oneSuffix);
        }

        count += result.count;

        if (count >= solutionCountCap) {
          count = solutionCountCap;
          capped = true;
          break;
        }
      }

      const solved = { count, oneSuffix };
      memo.set(key, solved);
      return solved;
    }

    const solved = countSolutions(arrows);
    const oneSolution = solved.oneSuffix || [];
    const fallbackAnalysis = analyzeOrder(level, oneSolution);
    const branchSource = knownValidation.valid ? knownAnalysis : fallbackAnalysis;

    return {
      solvable: solved.count > 0,
      oneSolution,
      knownSolutionValid: Boolean(knownValidation.valid),
      knownSolution: knownValidation,
      initialMoves: initialMoves.length,
      initialMoveIds: initialMoves,
      maxBranching: branchCounts.length > 0 ? Math.max(...branchCounts) : 0,
      averageBranching: average(branchCounts),
      knownAverageBranching: branchSource.averageBranching,
      knownMaxBranching: branchSource.maxBranching,
      knownBranching: branchSource.branching,
      solutionCount: solved.count,
      solutionCountCapped: capped || solved.count >= solutionCountCap,
      dependencyDepth: branchSource.dependencyDepth,
      visitedStates,
      geometry
    };
  }

  window.ArrowPuzzleSolver = {
    solveLevel,
    analyzeLevel,
    analyzeOrder
  };
}());
