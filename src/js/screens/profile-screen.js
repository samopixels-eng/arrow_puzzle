import { SceneRenderer } from '../scene-renderer.js';
import { applyScale }    from '../utils/scaler.js';
import { createScalePopupFrame, openScalePopup, closeScalePopup } from '../utils/popup-manager.js';
import { showToast }     from '../utils/toast.js';

const COUNTRY_CODES = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BG','BH','BI','BJ','BN','BO','BR','BS','BT','BW','BY','BZ',
  'CA','CC','CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CX','CY','CZ',
  'DE','DJ','DK','DM','DO','DZ',
  'EC','EE','EG','ER','ES','ET',
  'FI','FJ','FK','FO','FR',
  'GA','GB','GD','GE','GG','GH','GM','GN','GQ','GR','GT','GU','GW','GY',
  'HK','HN','HR','HT','HU',
  'ID','IE','IL','IM','IN','IQ','IS','IT',
  'JE','JM','JO','JP',
  'KE','KG','KH','KI','KM','KN','KP','KR','KW','KY',
  'LA','LB','LC','LI','LK','LR','LS','LT','LU','LV','LY',
  'MA','MC','MD','ME','MG','MH','MK','ML','MM','MN','MO','MR','MS','MT','MU','MV','MW','MX','MY','MZ',
  'NA','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ',
  'OM',
  'PA','PE','PF','PG','PH','PK','PL','PR','PS','PT','PW','PY',
  'QA',
  'RO','RS','RU','RW',
  'SA','SB','SC','SD','SE','SG','SH','SI','SL','SM','SO','SR','SS','ST','SV','SY','SZ',
  'TC','TD','TG','TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ',
  'UA','UG','US','UY','UZ',
  'VA','VC','VE','VN','VU',
  'WF','WS',
  'YE','YT',
  'ZA','ZM','ZW',
];

const PROHIBITED_KEYWORDS = [
  "fuck","fuk","fck","fk","shit","shyt","sht","bitch","btch","ass","asshole","ashole","asahole",
  "bastard","bstard","dick","dik","dic","cock","kock","pussy","pusi","pusy","cunt","cnt",
  "whore","hore","slut","slvt","porn","prn","sex","seks","anal","anl","cum","cvm",
  "rape","rapist","nigger","nigga","negro","faggot","fagot","fag","retard","rtrd","gaysex",
  "kkk","nazi","hitler","isis","terror","kill","murder","murd","suicide","die",
  "drug","drugs","cocaine","coke","heroin","weed","admin","adm","moderator","mod",
  "gm","gamegm","system","official","staff","support","dev","developer","owner",
  "test","tester","bot","null","undefined","root","server","google","apple","facebook",
  "meta","line","kakao","naver","samsung","microsoft","sony","nintendo",
  "arse","arsehole","jackass","douche","douchebag","scumbag","dipshit","dumbass",
  "shithead","fuckhead","motherfucker","motherfuck","bullshit","horseshit","dogshit",
  "batshit","shitface","shitbag","shitass","asshat","assclown","asswipe","asslick",
  "butthead","butthole","bollocks","wanker","tosser","twat","prick","knobhead","bellend",
  "bloodyhell","bugger","arsewipe","skank","slapper","tramp","hoe","milf","gilf","nsfw",
  "xxx","hardcore","deepthroat","blowjob","blowjobs","handjob","handjobs","tit","tits",
  "boob","boobs","penis","vagina","clit","orgy","gangbang","cumshot","jizz","nutjob",
  "jerkoff","jackoff","edgelord","incel","soyboy","simp","loser","noob","nub","trash",
  "garbage","idiot","moron","stupid","dumb","killself","selfharm","hangself","overdose",
  "terrorist","extremist","bomb","gun","rifle","pistol","ak47","suicideby","meth","lsd",
  "opium","crack","cartel","mafia","yakuza","triad","adminteam","modteam","gamemaster",
  "sysadmin","rootadmin","officialgm","realadmin","realgm","staffteam","devteam","ownergm",
  "verified","realdev","realowner","testuser","debug","staging","production","localhost",
  "backend","frontend","database","sql","api","config","superuser",
];

export class ProfileScreen {
  constructor(container, { authService, leaderboardService, statsService, levelManager, onSave } = {}) {
    this._container        = container;
    this._authService      = authService;
    this._leaderboardService = leaderboardService;
    this._statsService     = statsService;
    this._levelManager     = levelManager;
    this._onSave           = onSave;

    this._wrapper     = null;
    this._inner       = null;
    this._renderer    = null;
    this._editInner   = null;
    this._editRenderer = null;

    this._pendingName  = '';
    this._pendingFlag  = 'US';
    this._currentName  = '';
    this._currentFlag  = 'US';
    this._nameInputEl  = null;
    this._checkEl      = null;
    this._flagGridEl   = null;

    this._resizeHandler     = () => this._onResize();
    this._editResizeHandler = () => this._onEditResize();
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  async load() {
    // ── Profile wrapper (z-3000) ──
    const frame = createScalePopupFrame({ dimOpacity: 0.65, zIndex: 3000 });
    this._wrapper = frame.wrapper;
    this._inner = frame.inner;

    this._renderer = new SceneRenderer(this._inner, { basePath: '' });
    await this._renderer.load('./js/profile.contract.json');
    this._renderer.show();

    const stage = this._renderer._el;
    stage.style.right  = '';
    stage.style.bottom = '';
    applyScale(stage, null, 390, 844, true);

    this._profileEvents();
    window.addEventListener('resize', this._resizeHandler);

    // ── Edit profile wrapper (z-4000) ──
    await this._loadEditPopup();
  }

  async _loadEditPopup() {
    // _inner 안에 배치 → profile 씬과 동일한 좌표계 공유 (PopupManager 방식)
    this._editInner = document.createElement('div');
    this._editInner.style.cssText = [
      'position:absolute','inset:0','z-index:10',
      'display:none',
      'transform:scale(0)','transform-origin:center center',
      'transition:transform 300ms cubic-bezier(0.34,1.56,0.64,1)',
    ].join(';');
    this._inner.appendChild(this._editInner);

    this._editRenderer = new SceneRenderer(this._editInner, { basePath: '' });
    await this._editRenderer.load('./js/edit_profile.contract.json');
    this._editRenderer.show();

    const stage = this._editRenderer._el;
    stage.style.right  = '';
    stage.style.bottom = '';
    applyScale(stage, null, 390, 844, true);

    this._editEvents();
    window.addEventListener('resize', this._editResizeHandler);

    // 국기 그리드 주입 (DOM이 show() 후 존재)
    const carrierEl = this._editRenderer.getElement('flag-carrier-499');
    if (carrierEl) this._injectFlagGrid(carrierEl);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async open() {
    const [name, code, stats] = await Promise.all([
      this._statsService.getName(),
      this._statsService.getFlag(),
      this._statsService.getStats(),
    ]);
    this._currentName = name;
    this._currentFlag = code;

    const levelDisplay = this._levelManager?.getCurrentLevelNumber?.() ?? 1;
    const currentLevel = this._levelManager?.getClearedLevelNumber?.() ?? 0;

    this._renderer.update({
      'player.name':    name,
      'player.flags':   `assets/ctry/${code}.webp`,
      level_display:    String(levelDisplay),
      current_level:    String(currentLevel),
      first_try:        String(stats.first_try),
      max_streak:       String(stats.max_streak),
      match_win:        '0',
      cup_top3:         '0',
    });

    openScalePopup(this._wrapper, this._inner);
  }

  close() {
    closeScalePopup(this._wrapper, this._inner);
  }

  hide() {
    if (this._wrapper) this._wrapper.style.display = 'none';
    // _editInner 은 _inner 안에 있으므로 _wrapper 숨김으로 자동 처리
  }

  // ── Profile events ─────────────────────────────────────────────────────────

  _profileEvents() {
    this._renderer.on('edit_profile',  () => this._openEditPopup());
    this._renderer.on('close_profile', () => this.close());
  }

  // ── Edit popup ─────────────────────────────────────────────────────────────

  async _openEditPopup() {
    this._pendingName = this._currentName;
    this._pendingFlag = this._currentFlag;

    this._editRenderer.update({
      'player.name':  this._pendingName,
      'player.flags': `assets/ctry/${this._pendingFlag}.webp`,
    });

    this._highlightCurrentFlag(this._pendingFlag);
    openScalePopup(this._editInner, this._editInner);
  }

  _closeEditPopup() {
    if (this._nameInputEl) {
      const carrier = this._editRenderer.getElement('play-name-carrier-501');
      const span = carrier?.querySelector('.text-0');
      if (span) span.style.visibility = '';
      this._nameInputEl.remove();
      this._nameInputEl = null;
    }
    closeScalePopup(this._editInner, this._editInner);
  }

  _editEvents() {
    this._editRenderer.on('edit_player.name',   () => this._activateNameInput());
    this._editRenderer.on('save_player.name',   () => this._commitNameInput());
    this._editRenderer.on('close_edit_profile', () => this._closeEditPopup());
    this._editRenderer.on('save_profile',       () => this._saveProfile());
  }

  // ── Name input ─────────────────────────────────────────────────────────────

  _activateNameInput() {
    if (this._nameInputEl) return;

    const wrap = this._editRenderer.getElement('play-name-carrier-501');
    const inner = wrap?.firstElementChild;
    if (!inner) return;

    const span = inner.querySelector('.text-0');
    if (span) span.style.visibility = 'hidden';

    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 10;
    input.value = this._pendingName;
    input.style.cssText = [
      'position:absolute','inset:0','width:100%','height:100%',
      'background:rgba(30,42,74,0.95)','border:none',
      'outline:2px solid #6bb5ff','border-radius:8px',
      'color:#e8eef8','font-size:16px','font-weight:900',
      'font-family:Arial,sans-serif','text-align:center',
      'padding:0 6px','box-sizing:border-box','z-index:10',
    ].join(';');

    input.addEventListener('input', e => {
      e.target.value = e.target.value.replace(/[^a-zA-Z]/g, '').slice(0, 10);
      this._pendingName = e.target.value;
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._commitNameInput();
    });

    inner.appendChild(input);
    this._nameInputEl = input;

    // 약간 딜레이 후 focus (모바일 키보드 대응)
    setTimeout(() => input.focus(), 50);
  }

  _commitNameInput() {
    const name = (this._nameInputEl?.value ?? this._pendingName).trim();
    if (!this._validateName(name)) {
      this._showToast('Invalid name: letters only (max 10), no prohibited words');
      return;
    }

    this._pendingName = name;

    const carrier = this._editRenderer.getElement('play-name-carrier-501');
    const span = carrier?.querySelector('.text-0');
    if (span) {
      span.textContent = name;
      span.style.visibility = '';
    }
    if (this._nameInputEl) {
      this._nameInputEl.remove();
      this._nameInputEl = null;
    }
  }

  _validateName(name) {
    if (!name || !/^[a-zA-Z]{1,10}$/.test(name)) return false;
    const lower = name.toLowerCase();
    return !PROHIBITED_KEYWORDS.some(kw => lower.includes(kw));
  }

  // ── Save ───────────────────────────────────────────────────────────────────

  async _saveProfile() {
    // 입력 중인 이름이 있으면 먼저 커밋
    if (this._nameInputEl) {
      const name = this._nameInputEl.value.trim();
      if (!this._validateName(name)) {
        this._showToast('Invalid name: letters only (max 10), no prohibited words');
        return;
      }
      this._pendingName = name;
    }

    await this._statsService.setName(this._pendingName);
    await this._statsService.setFlag(this._pendingFlag);

    this._currentName = this._pendingName;
    this._currentFlag = this._pendingFlag;

    this._renderer.update({
      'player.name':  this._currentName,
      'player.flags': `assets/ctry/${this._currentFlag}.webp`,
    });

    this._onSave?.(this._currentName, this._currentFlag);

    this._closeEditPopup();
  }

  // ── Flag grid ──────────────────────────────────────────────────────────────

  _injectFlagGrid(carrierEl) {
    // wrap 안의 inner(시각 도형)를 컨테이너로 사용해 도형을 보존
    const inner = carrierEl.firstElementChild || carrierEl;
    inner.style.overflow = 'hidden';
    inner.style.position = 'relative';

    const scroll = document.createElement('div');
    scroll.style.cssText = [
      'position:absolute','inset:0',
      'overflow-y:auto','overflow-x:hidden',
      '-webkit-overflow-scrolling:touch',
      'scrollbar-width:none',
      'padding:4px','box-sizing:border-box',
    ].join(';');
    // WebKit 스크롤바 숨김
    const styleEl = document.createElement('style');
    styleEl.textContent = '.flag-scroll::-webkit-scrollbar{display:none}';
    document.head.appendChild(styleEl);
    scroll.className = 'flag-scroll';

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:4px;';

    this._checkEl = this._makeCheckOverlay();
    this._flagGridEl = grid;

    COUNTRY_CODES.forEach(code => {
      const cell = document.createElement('div');
      cell.style.cssText = [
        'position:relative','cursor:pointer',
        'border-radius:6px','overflow:hidden',
        'aspect-ratio:1',
      ].join(';');
      cell.dataset.code = code;

      const img = document.createElement('img');
      img.src = `assets/ctry/${code}.webp`;
      img.alt = code;
      img.draggable = false;
      img.style.cssText = 'width:100%;height:auto;display:block;pointer-events:none;';

      cell.appendChild(img);
      cell.addEventListener('click', () => this._onFlagCellClick(code, cell));
      grid.appendChild(cell);
    });

    scroll.appendChild(grid);
    inner.appendChild(scroll);
  }

  _makeCheckOverlay() {
    const el = document.createElement('div');
    el.style.cssText = [
      'position:absolute','right:2px','bottom:2px',
      'width:20px','height:20px','border-radius:50%',
      'background:linear-gradient(180deg,#4cde6e,#1a9e3a)',
      'border:1.5px solid #a8f5be',
      'color:#fff','font-size:13px','font-weight:bold',
      'display:flex','align-items:center','justify-content:center',
      'pointer-events:none','z-index:5',
    ].join(';');
    el.textContent = '✓';
    return el;
  }

  _onFlagCellClick(code, cellEl) {
    cellEl.appendChild(this._checkEl);
    this._pendingFlag = code;
    const path = `assets/ctry/${code}.webp`;
    this._editRenderer.update({ 'player.flags': path });
    this._renderer.update({ 'player.flags': path });
  }

  _highlightCurrentFlag(code) {
    if (!this._flagGridEl || !this._checkEl) return;
    const cell = this._flagGridEl.querySelector(`[data-code="${code}"]`);
    if (cell) {
      cell.appendChild(this._checkEl);
      // 선택된 국기로 스크롤
      cell.scrollIntoView({ block: 'nearest' });
    }
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

  _onResize() {
    if (this._renderer?._el) applyScale(this._renderer._el, null, 390, 844, true);
  }

  _onEditResize() {
    if (this._editRenderer?._el) applyScale(this._editRenderer._el, null, 390, 844, true);
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  _showToast(msg) {
    showToast(msg, {
      top: '40%',
      fontFamily: 'Arial,sans-serif',
      fontSize: '13px',
      padding: '12px 20px',
      borderRadius: '10px',
      background: 'rgba(0,0,0,0.88)',
      duration: 2200,
      fadeMs: 200,
    });
  }
}
