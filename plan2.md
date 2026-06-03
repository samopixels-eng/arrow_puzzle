# 풀이 가능한 맵 제네레이터 계획

## 목표

- 현재 `path` 기반 화살표 규칙을 유지하면서 자동으로 풀이 가능한 맵을 만든다.
- 시작 맵에는 빈 점이 없고, 모든 화살표는 최소 2개 이상의 점을 잇는다.
- 역설계로 확정 풀이 순서를 먼저 만들고, 이후 꼬기 단계에서도 풀이가 사라지지 않게 검증한다.
- 난이도는 무작위 복잡도가 아니라 `해결 순서 의존성`, `초기 선택지 수`, `해금 단계`, `시각적 혼잡도`로 조절한다.

## 핵심 판단

현재 규칙은 단조 감소 퍼즐이다. 화살표를 제거하면 장애물이 줄어들 뿐 새 장애물이 생기지 않는다. 따라서 한 번 제거 가능한 화살표를 제거하는 행동은 이후 상태를 더 어렵게 만들지 않는다.

그래서 이 퍼즐의 어려움은 "잘못 누르면 막히는 전략성"보다 "지금 빠질 수 있는 화살표를 찾는 관찰 난이도"에서 나온다. 생성기는 아래 두 가지를 보장해야 한다.

1. 최소 하나의 확정 풀이 순서가 있다.
2. 시작 상태와 중간 상태에서 너무 많은 화살표가 동시에 빠지지 않도록 의존성을 만든다.

## 용어와 데이터 모델

- `point`: 가상점 좌표. 예: `[x, y]`
- `edge`: 인접한 두 점을 잇는 1칸 선분.
- `arrow.path`: 꼬리부터 머리까지 이어지는 직교 폴리라인. 마지막 점이 머리다.
- `headDirection`: 마지막 선분의 방향. 화살표가 보드 밖으로 나가는 방향이다.
- `occupancy`: 화살표가 차지하는 점과 edge 집합.
- `removable`: 머리에서 `headDirection`으로 보드 밖까지 나가는 레이가 다른 화살표의 점이나 edge와 충돌하지 않는 상태.
- `solutionOrder`: 생성기가 보관하는 의도 풀이 순서. 예: `["a1", "b3", "c2"]`

## 그라운드 룰 보완

1. 맵은 `pointColumns x pointRows` 가상점 그리드로 정의한다.
2. 시작 맵의 모든 점은 정확히 하나의 화살표가 점유한다.
3. 화살표는 최소 2개 점을 연결해야 한다. `path.length < 2` 또는 총 길이 1 미만은 금지한다.
4. 화살표는 수평/수직 선분만 가진다. 대각선은 금지한다.
5. 서로 다른 화살표는 점과 edge를 공유하지 않는다.
6. 한 화살표 안에서도 같은 점이나 edge를 재방문하지 않는다.
7. 첫 풀이 화살표는 머리가 최외곽 점 위에 있고, 머리 방향이 보드 밖을 향해야 한다.
8. 맵 생성 중 남은 빈 점 컴포넌트가 1개짜리 고립점이 되면 즉시 롤백한다.
9. 남은 빈 점 컴포넌트가 2개 이상이어도, 그 안에서 최소 길이 화살표를 만들 수 없는 구조면 롤백한다.
10. 생성 완료 후에는 solver로 실제 풀이 가능 여부를 다시 검증한다.

## 생성 전략

### 1. 역순 삽입으로 풀이 보장

정방향 풀이가 `A1 -> A2 -> A3 -> ... -> AN`이라면 생성은 반대로 한다.

1. 빈 보드에서 시작한다.
2. `AN`을 먼저 배치한다.
3. 다음으로 `A(N-1)`을 배치한다.
4. 마지막에 `A1`을 배치한다.

`Ai`를 배치할 때 현재 보드에는 정방향 풀이에서 `Ai` 이후에 남아 있을 화살표들만 존재한다. 이 상태에서 `Ai`의 탈출 레이가 비어 있으면, 실제 플레이에서 `A1 ... A(i-1)`이 제거된 뒤 `Ai`는 반드시 빠질 수 있다.

즉, 삽입 조건은 다음 하나다.

```text
insert Ai only if Ai is removable against the current partial board
```

이 조건을 지키면 이후에 더 앞순서 화살표를 추가해서 `Ai`를 시작 상태에서 막아도 괜찮다. 그 앞순서 화살표들은 `Ai` 차례 전에 제거되기 때문이다.

### 2. 점 채우기

초기 맵에 빈 점이 없어야 하므로 생성기는 점을 덮는 `path cover`를 만든다.

작업 순서:

1. 모든 점을 `freePoints`로 시작한다.
2. 배치할 화살표 길이와 회전 수를 난이도 파라미터로 뽑는다.
3. `freePoints` 안에서 자기 자신과 겹치지 않는 직교 경로를 만든다.
4. 경로를 임시 점유한다.
5. 남은 free 컴포넌트를 검사한다.
6. 고립점이나 불가능 컴포넌트가 있으면 롤백하고 다른 경로를 시도한다.

권장 파라미터:

- 쉬움: 길이 1-2 edge, 회전 0-1회, 초기 removable 3-5개.
- 보통: 길이 2-4 edge, 회전 0-2회, 초기 removable 2-3개.
- 어려움: 길이 3-6 edge, 회전 1-3회, 초기 removable 1-2개.

### 3. 꼬기 방식

꼬기는 이미 만들어진 풀이를 깨뜨릴 수 있으므로 무조건 트랜잭션으로 처리한다.

```text
clone board
apply twist
validate geometry
validate known solutionOrder
run solver
score difficulty
accept if score improves
rollback otherwise
```

풀이를 보존하기 쉬운 꼬기 규칙:

- 뒤 순서 화살표 `B`의 탈출 레이에 앞 순서 화살표 `A`를 놓는다.
- 그러면 시작 상태에서 `B`는 막히지만, `A`가 먼저 제거된 뒤에는 `B`가 열린다.
- 단, `A` 자신은 자기 차례에 빠질 수 있어야 한다.

피해야 할 꼬기:

- 뒤 순서 화살표가 앞 순서 화살표의 탈출 레이를 막는 변경.
- 첫 풀이 화살표의 머리를 외곽 밖 방향이 아니게 만드는 변경.
- 빈 점을 만들거나 고립점 1개를 남기는 변경.
- solver 없이 회전, 길이 변경, path 재배치를 확정하는 변경.

## Solver 설계

생성기의 최종 안전장치는 solver다.

입력:

- `pointColumns`
- `pointRows`
- `arrows`

출력:

- `solvable`
- `oneSolution`
- `knownSolutionValid`
- `initialMoves`
- `maxBranching`
- `averageBranching`
- `solutionCountCapped`
- `dependencyDepth`

기본 알고리즘:

```text
solve(remainingArrows):
  if remainingArrows is empty:
    return success

  moves = all removable arrows
  if moves is empty:
    return fail

  for move in moves:
    solve(remainingArrows - move)
```

상태 캐시는 남은 화살표 id 목록을 정렬한 문자열로 둔다. 현재 규칙에서는 제거만 일어나므로 같은 남은 집합은 같은 상태로 볼 수 있다.

성능 보호:

- 풀이 개수는 `solutionCountCap`까지만 센다. 예: 1000개.
- 깊이 제한은 화살표 개수와 같게 둔다.
- 난이도 평가용 solver와 최종 검증용 solver를 분리한다.

## 난이도 점수

난이도는 아래 항목을 합산한다.

```text
difficulty =
  dependencyDepth * 3
  - initialMoves * 2
  - averageBranching
  + blockedAtStartCount
  + turnCountScore
  + visualCongestionScore
```

권장 reject 조건:

- `solvable === false`
- `knownSolutionValid === false`
- `initialMoves === 0`
- `initialMoves > targetMaxInitialMoves`
- `averageBranching > targetMaxAverageBranching`
- `dependencyDepth < targetMinDependencyDepth`
- `solutionCountCapped`이 너무 크고 쉬운 맵으로 판정되는 경우
- 1칸짜리 화살표 또는 빈 점이 있는 경우

난이도별 목표:

| 난이도 | 초기 가능 화살표 | 평균 선택지 | 의존성 깊이 | 회전 수 |
| --- | ---: | ---: | ---: | ---: |
| 쉬움 | 3-5 | 3-5 | 화살표 수의 30% 이상 | 낮음 |
| 보통 | 2-3 | 2-4 | 화살표 수의 50% 이상 | 중간 |
| 어려움 | 1-2 | 1-3 | 화살표 수의 70% 이상 | 높음 |

## 구현 계획

### Phase 1. 규칙 함수 분리

`src/main.js` 안의 순수 규칙 함수를 generator와 공유할 수 있게 분리한다.

- `pointKey`
- `edgeKey`
- `expandPath`
- `buildPathMetrics`
- `getHeadDirection`
- `getHeadExitBlock`
- `isArrowRemovable`
- `validateNoOverlaps`
- `validateGeometry`

렌더링, 입력, 애니메이션은 계속 `main.js`에 둔다. 생성기와 solver는 DOM이나 canvas를 몰라야 한다.

### Phase 2. Solver 추가

새 파일 후보:

- `src/puzzle-rules.js`
- `src/puzzle-solver.js`

검증 항목:

- 모든 path가 유효한지
- 모든 점이 정확히 1번 점유되는지
- edge/point overlap이 없는지
- 첫 화살표 조건을 만족하는지
- 저장된 `solutionOrder`가 실제로 유효한지
- solver가 최소 1개 풀이를 찾는지

### Phase 3. Generator 추가

새 파일 후보:

- `src/puzzle-generator.js`

API 초안:

```js
generateLevel({
  seed,
  pointColumns,
  pointRows,
  difficulty,
  arrowCountRange,
  maxAttempts,
  targetInitialMoves,
  targetDependencyDepth
})
```

반환 데이터:

```js
{
  id,
  seed,
  pointColumns,
  pointRows,
  arrows,
  solutionOrder,
  stats: {
    initialMoves,
    averageBranching,
    dependencyDepth,
    difficultyScore
  }
}
```

### Phase 4. 생성 맵 적용

처음에는 런타임 자동 생성보다 개발용 고정 생성이 안전하다.

1. 브라우저 콘솔이나 임시 버튼에서 `generateLevel(seed)`를 실행한다.
2. 결과를 `LEVELS`에 복사한다.
3. 의도 풀이와 solver 결과를 콘솔에 출력한다.
4. 충분히 안정화되면 게임 시작 시 난이도/시드 기반 자동 생성으로 바꾼다.

## 테스트 계획

- `node --check src/main.js`
- 생성기 파일 추가 후 해당 파일도 `node --check` 실행.
- 같은 seed가 항상 같은 맵을 만드는지 확인.
- 100개 seed를 돌려 `solvable === true` 비율을 기록.
- 어려움 파라미터에서 `initialMoves`가 목표 범위에 들어오는지 확인.
- 모든 생성 맵에서 빈 점, 고립점, 점/edge overlap이 없는지 확인.
- 저장된 `solutionOrder`대로 실제 게임에서 클리어되는지 확인.

## 미해결 결정 사항

- "빈 점 없음"을 전체 사각 그리드의 모든 점으로 볼지, 사용자가 정의한 프레임 내부 점으로 볼지 확정해야 한다.
- 외곽 점에 있는 첫 화살표가 반드시 즉시 보드 밖을 향해야 하는지, 외곽에 인접하기만 하면 되는지 확정해야 한다.
- 현재 구현에는 벽이 없으므로 generator 1차 범위에서도 벽은 제외한다. 벽을 추가하면 단조성이 깨질 수 있어 solver와 난이도 기준을 다시 잡아야 한다.
