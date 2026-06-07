# Arrow Puzzle 아웃게임 이식 작업 계획

## 목표

ColorDots의 아웃게임을 Arrow Puzzle에 붙일 수 있도록, Arrow Puzzle 인게임을 표준 계약에 맞춘다.

## 현재 1차 작업

- `src/arrow-puzzle-level-manager.js` 추가
- `src/screens/arrow-puzzle-screen.js` 추가
- `src/outgame/arrow-puzzle-game-config.js` 추가
- `src/outgame/arrow-puzzle-game-adapter.js` 추가
- `src/main.js`에 outgame mode 콜백 API 추가

## 표준 계약

Arrow Puzzle 인게임은 다음 형태로 아웃게임과 연결된다.

```js
screen.show(level, stageLabel, soundService, adService, coinService, itemService, options)
screen.hide()
callbacks.onClear(stats)
callbacks.onLeave()
```

레벨 진행은 `ArrowPuzzleLevelManager`가 맡는다.

```js
loadLevels()
getCurrentLevel()
getCurrentLevelNumber()
getCurrentStageLabel()
getTotalLevels()
getOpenLevelCount()
getAttemptStageKey()
advanceLevel()
setProgressIndex(index)
onChange(callback)
```

## 다음 작업

1. ColorDots 아웃게임 파일을 Arrow Puzzle로 복사한다.
2. Arrow Puzzle용 앱 진입 파일을 만든다.
3. 기존 자체 UI와 ColorDots 로비/클리어 UI 중복을 제거한다.
4. 브라우저에서 로비 -> 인게임 -> 클리어 -> 다음 레벨 흐름을 검증한다.
5. 아이템, 광고, 구매, 로그인, 클라우드 저장은 그 다음에 연결한다.

## 주의점

- 기존 `src/main.js`에는 사용자 변경이 있으므로 덮어쓰지 않는다.
- 현재 `src/main.js`는 자체 플레이를 유지하면서 outgame mode만 추가했다.
- outgame mode에서는 자체 클리어 패널 대신 `callbacks.onClear(stats)`가 호출된다.
