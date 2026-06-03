# 제너레이터 수정 계획 (plan3)

## 0. 진단 요약 (근거)

Node에서 `puzzle-rules.js` → `puzzle-solver.js` → `puzzle-generator.js`를 로드해 7×7로 실측한 결과:

| 항목 | 측정값 |
| --- | --- |
| 레벨당 생성 시간 | 22~27초 (7×7) |
| easy 생성 성공률 | 1/6 (5건 throw, 83% 실패) |
| normal 풀이 가능 | 6/6, 단 타깃 달성 3/6 (나머지 fallback) |
| hard | fallback (initialMoves=3 > 상한 2) |

원인:

- `maxAttempts=250` × `pathAttempts(90~160)` × 후보마다 전체 `validateGeometry` 재전개 (O(N²)) + 매 시도마다 지수적 `countSolutions` solver.
- 정합성 보장과 난이도 분석이 분리되지 않음. 풀이 존재는 역순삽입으로 구조적으로 보장되는데 비싼 지수 solver를 정합성용으로도 매번 실행.
- easy: full-cover + first-exit + 짧은 화살표 제약 충돌로 생성 실패.
- 단조로움: `growPath`가 백트래킹 없는 greedy라 짧은 화살표만 생성, 인터라킹(서로의 탈출 레이를 막는 구조) 거의 없음. plan2.md 3절 "꼬기" 미구현.

## 핵심 설계 원칙

1. 정합성 ≠ 난이도 분석. 풀이 가능성은 역순삽입 불변식 + 선형(O(N)) known-order replay로만 보장. 지수 `countSolutions`는 난이도 통계 전용으로 격리하고 큰 맵에서는 끈다.
2. 증분(incremental) 점유. 매 후보마다 전체 재전개하지 말고 point/edge 점유 해시를 증분 갱신. 후보 검사는 새 화살표 1개만 본다.
3. 로컬 탐색. 후보 경로 탐색은 free 컴포넌트 내부로 한정. 전역 연산은 화살표당 탈출 레이 캐스트 1회뿐.

## 요구사항 1 — 100×100급 경량화 / 타일 분할

### 1A. 단일 패스 경량화 (모든 크기 공통 기반)

- `countSolutions`를 정합성 경로에서 제거. 최종 검증은 `validateKnownSolution`(선형 replay)이 권위.
- 증분 점유맵 도입: 후보 검사는 점유 해시 대비 1개 화살표만 검증. 전체 `validateGeometry`는 빌드 종료 후 1회로 축소.
- 탈출 레이 캐스트는 점유 해시 조회로 O(레이길이).
- 재시도 대수 축소 + 후보 불변식 만족 시 즉시 채택(early-exit). 난이도 점수는 채택 후 계산.

### 1B. 타일 분할-스티칭 (대형 맵 전용, 임계 크기 초과 시)

- 보드를 `tileW×tileH`(예: 12×12) 격자로 분할, 각 타일 독립 생성(내부 full-cover + 로컬 풀이순서).
- 경계 횡단 문제: 내부 타일 화살표는 보드 밖으로 나가야 해 탈출 레이가 이웃 타일을 가로지름 → 교차 차단으로 전역 데드락 가능.
- 완화: 타일별 주 탈출 방향을 바깥쪽으로 편향(좌측 타일은 좌향 우선 등).
- 전역 선형 스케줄러(권위 검증): 스티칭 후 전역 removable 화살표를 반복 제거. 보드를 비우면 전역 풀이순서 확보, 데드락이면 경계 타일만 재생성.
- 결정론: 타일 시드 = `hash(seed, tileX, tileY)`.

### 1C. 난이도 분석 크기별 분기

- 작은 맵: 기존 `countSolutions`(cap 유지)로 solutionCount/uniqueness까지.
- 큰 맵: 지수 solver 끔. 선형 구조 지표(initialMoves, 의존성 깊이, 인터라킹 수, 길이 분포). 필요시 무작위 greedy 풀이 N회 샘플링으로 평균 분기수 추정.

## 요구사항 2 — 긴 선(맵의 10%+) & 인터라킹

### 2A. 길이 분포 모델

- `[minEdges,maxEdges]` 고정 대신 난이도별 길이 분포 + "긴 선" 쿼터.
- 긴 선 정의: 길이 ≥ `ceil(0.1 × max(cols,rows))` 엣지. 더 긴 척추선은 30~60엣지까지 허용.
- 전체 화살표의 X%(난이도 파라미터)를 긴 선으로 강제.

### 2B. 2단계 배치

1. 척추(spine) 단계: 긴 화살표 먼저 배치. `growPath`를 길이 목표 채울 때까지 백트래킹/제한 DFS로 보강.
2. 필러 단계: 남은 free 점을 짧은 화살표로 덮되 고립점 금지 준수.

### 2C. 의도적 인터라킹 (plan2.md "꼬기"를 구성 단계에 내장)

- 정방향 제거 순서 `A1..AN`, 역순으로 `AN..A1` 배치. `Ai` 배치 시 보드엔 나중 제거되는 `A(i+1)..AN`만 존재.
- `Ai`의 몸통이 이미 놓인 `Aj`(j>i)의 탈출 레이를 가로지르도록 후보 가점 → 시작 상태에서 `Aj` 막힘. `Ai`(먼저 제거)가 빠지면 `Aj` 열림 → 풀이 보존 보장.
- 동시 해결: 인터라킹 생성 + initialMoves 하락 + 의존성 깊이 상승 → matchesTargets 미달 문제 교정.
- `scoreInsertion`의 `blockedGain*20`을 기하 기반(레이 교차 수 × 길이 가중)으로 강화.

## 구현 단계 (Phase)

| Phase | 내용 | 검증 |
| --- | --- | --- |
| P1 | 증분 점유맵 + 정합성/난이도 solver 분리 (1A·1C) | 기존 7×7 풀이가능 동일, 레벨당 시간 대폭 감소 |
| P2 | 2단계 배치 + 길이분포 + 백트래킹 growPath (2A·2B) | 길이 히스토그램, 긴 선 비율 ≥ 목표 |
| P3 | 구성단계 인터라킹 가점 (2C) | initialMoves·의존성 타깃 도달률↑, easy throw율↓ |
| P4 | 타일 분할-스티칭 + 전역 선형 스케줄러 (1B) | 100×100 시간/메모리, 전역 replay 통과율 |
| P5 | easy 제약 재조정 | easy throw율 83% → <5% |

권장 순서: P1 → P3 (속도와 단조로움이 가장 빨리 개선).

## 성능 목표

- 7×7: 25초 → <0.2초
- 100×100(타일): 수 초 이내, 전역 replay 100% 통과
- throw율 <5%, 타깃 도달률 ≥80%

## 리스크 / 미결정

- 타일 스티칭 전역 데드락 빈도 — P4 실측 후 방향정합성 강도/경계 재롤 정책 조정.
- 긴 직선이 많으면 인터라킹 여지 축소(긴 선은 레이도 길어 충돌 잦음) — 길이쿼터·인터라킹 가점 균형 파라미터화.
- 큰 맵 uniqueness 보장 포기(풀이 존재만 보장).

---

## 진행 상황 (2026-06-04)

### 완료: P1 (경량화 + solver 분리)

- `puzzle-solver.js`: `analyzeLevel()` 추가 — 지수 `countSolutions` 없이 선형(known-order replay)으로 풀이가능성·initialMoves·의존성 산출. 매 시도 정합성 게이트를 이걸로 교체.
- 전체 `countSolutions`는 작은 맵(`fullSolveMaxCells`, 기본 200)에서 최종 1회만 실행.
- `puzzle-generator.js`:
  - 후보별 전체 `validateGeometry` → 새 화살표 단일 검증(자유점만 사용 → disjoint 보장). 교차검증은 빌드 종료 후 1회.
  - 자유 컴포넌트(`getComponentsFromKeys`)를 `findCandidatePath` 호출당 1회만 계산(`buildWeightedComponents`/`pickWeighted`).
  - `scoreInsertion`의 removable 재계산을 호출당 1회 + "추가는 차단만 한다" 성질로 검사 대상 축소.

### 완료: P2/P3 (긴 선 + 인터라킹)

- 긴 척추선: `longLineChance`/`longLineMaxEdges`/`longLineRatio`(맵 ~10%+ 길이), `straightBias`로 직선성 유지.
- 인터라킹: `collectExitRayKeys`로 기존 removable 화살표의 탈출 레이 위 자유점 수집, `chooseNextStep`의 `rayBias`로 새 경로를 그쪽으로 유도 → 시작 상태 차단 구조 생성(역순삽입이라 풀이 보존).

### 측정 (7×7, Node 하니스, 수정 전 → 후)

| 지표 | 전 | 후 |
| --- | --- | --- |
| 레벨당 시간 | 22~27s | 2~8s |
| easy throw율 | 83% | 0% |
| normal 타깃 달성 | 3/6 | 4/4 |
| hard initialMoves | 3~5 | ~2.5 (목표 [1,2] 근접) |
| 의존성비 | ~0.5 | 0.63 / 0.76 / 0.90 |
| 최대 선 길이 | 짧고 균일 | 4~7.5 edges |
| 정합성(replay) | — | replayFail=0 (전부 통과) |

### 검증된 트레이드오프 (재시도 시 주의)

- 품질은 **전수 탐색 + 전역 최선 선택**이 핵심 레버. 후보를 일찍 끊으면(early-stop/저 maxAttempts) 품질이 나쁜 비율로 무너짐 — `maxAttempts=40`에서 easy 5/6 throw, hard hit 0/6.
- 속도는 `matchesTargets` 미달 시 전체 `maxAttempts`(250)를 소진하는 fallback 경로가 지배. → initialMoves를 타깃 안으로 더 밀어넣으면 조기 break로 속도도 개선됨(품질·속도 동시 레버).

---

## 향후 작업 (내일 이후)

1. **P4 — 타일 분할-스티칭** (요구사항 1: 100×100). 단일 패스로는 불가, 정공법. 위 1B 설계대로 작은 타일 생성 → 이어붙임 → 전역 선형 재검증 → 경계 타일만 재롤. 절대속도(<0.2s) 목표도 타일 크기로 흡수.
2. **P5 — easy 튜닝**. 현재 throw=0이나 타깃(init [3,5]) 달성률 낮음(init 5.5~7). 짧은 화살표 과다 → 화살표 수↑ → initialMoves↑. maxEdges/길이분포 재조정 또는 타깃 범위 재검토.
3. **P6 — 비사각형 점 마스크** (탈출 의미 **B** 채택, 엔진/제너레이터 완료).
   - 탈출 의미 B: 보드 끝 = 바운딩 박스, 구멍(비활성 셀)은 투명 — 레이가 가로지르며 다른 화살표의 점/엣지에만 막힘. `isInBounds`/`getHeadExitBlock`/`isOuterExit` 불변, 점 멤버십만 마스크로 제한.
   - 구현: `puzzle-rules.js`에 `isActivePoint`, mask-aware `getAllPointKeys`/`getPointNeighbors`, `validateGeometry` 활성점 검사, 헬퍼 `buildMaskFromRows`(ASCII)·`maskFromPoints`. `puzzle-generator.js`는 `normalizeConfig`에서 mask 정규화(Set/배열/키 허용)·크기 자동추론, `buildReverseCandidate`가 mask를 levelShell/level에 전달.
   - 검증: diamond(41)/plus(33)/frame 도넛(20) 마스크 모두 allInMask·fullCover·replay·geometry 통과. 도넛이 통과해 구멍 투과 탈출(의미 B) 확인.
   - 제약(확인됨): 화살표는 ≥2 인접 점 필요 → 고립점·1칸 두께 디테일은 거부. 그림은 활성점이 연결되어 경로로 덮일 수 있는 형태여야 함(`isRemainderPossible`가 싱글톤 거부).
   - **남은 일**: `src/main.js` 렌더링 — 마스크 점만 그리고 구멍은 비우기(시각 영역, 사용자 판단). 엔진은 마스크를 이미 지원하므로 레벨 데이터에 `mask`만 넣으면 됨.
