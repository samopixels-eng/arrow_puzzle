/**
 * SceneRenderer
 * Contract JSON을 읽어 게임 씬 DOM을 관리하는 클래스.
 *
 * Usage:
 *   import { SceneRenderer } from './scene-renderer.js';
 *   import contract from './scenes/main-menu.contract.json' assert { type: 'json' };
 *
 *   const renderer = new SceneRenderer(document.body);
 *   renderer.loadSync(contract);
 *   renderer.show();
 *   renderer.on('coin_btn_clicked', () => openShop());
 *   renderer.update({ player: { coins: 1500 } });
 */
function hexToRgba(hex, opacity) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${(opacity ?? 100) / 100})`;
}

// 텍스트 text-shadow 값(Y깊이 스택 + 소프트섀도우) 단일 소스.
function buildTextShadowValue(t) {
    const style = t.style || normalizeTextStyleModel(t);
    const depth = style.depth || {};
    const shadow = style.shadow || {};
    const layers = [];
    const ds = depth.size || 0;
    if (ds > 0) {
        const dc = depth.color || '#000000';
        for (let i = 1; i <= ds; i++) layers.push(`0 ${i}px 0 ${dc}`);
    }
    layers.push(`${shadow.x || 0}px ${shadow.y || 0}px ${shadow.blur || 0}px ${hexToRgba(shadow.color || '#000000', shadow.opacity ?? 0)}`);
    return layers.join(', ');
}

function depthGradientCss(hex, intensity) {
    intensity = (intensity === undefined ? 50 : intensity) / 100;
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    function adj(r,g,b,f) {
        const blended = 1 + (f - 1) * intensity;
        if (blended > 1) return [r+(255-r)*(blended-1), g+(255-g)*(blended-1), b+(255-b)*(blended-1)].map(v=>Math.min(255,Math.round(v)));
        return [r*blended, g*blended, b*blended].map(v=>Math.max(0,Math.round(v)));
    }
    function h(c) { return '#'+c.map(v=>v.toString(16).padStart(2,'0')).join(''); }
    return `linear-gradient(180deg,`+
        ` ${h(adj(r,g,b,0.72))} 0%,`+
        ` ${h(adj(r,g,b,1.30))} 38%,`+
        ` ${hex} 55%,`+
        ` ${h(adj(r,g,b,0.65))} 78%,`+
        ` ${h(adj(r,g,b,0.55))} 90%,`+
        ` ${h(adj(r,g,b,0.78))} 100%)`;
}

function conicRaysCss(bright, dim, count) {
    bright = bright || 'rgba(255,255,255,0.7)';
    dim = dim || 'rgba(215,215,215,0.48)';
    count = Math.max(2, count || 8);
    const seg = 360 / count;
    const stops = [];
    for (let i = 0; i < count; i++) {
        const b = i * seg;
        stops.push(
            `transparent ${b}deg`,
            `${bright} ${b + seg * 0.06}deg`,
            `${bright} ${b + seg * 0.28}deg`,
            `transparent ${b + seg * 0.33}deg`,
            `${dim} ${b + seg * 0.55}deg`,
            `${dim} ${b + seg * 0.78}deg`,
            `transparent ${b + seg * 0.83}deg`
        );
    }
    return `conic-gradient(${stops.join(',')})`;
}

function ringMaskCss(innerPct, outerPct) {
    const i = innerPct == null ? 28 : innerPct;
    const o = outerPct == null ? 76 : outerPct;
    const span = Math.max(1, o - i);
    return `radial-gradient(circle, transparent 0%, transparent ${Math.max(0, i - 8)}%, white ${i}%, rgba(255,255,255,0.75) ${i + span * 0.17}%, rgba(255,255,255,0.45) ${i + span * 0.38}%, rgba(255,255,255,0.18) ${i + span * 0.60}%, rgba(255,255,255,0.05) ${i + span * 0.81}%, transparent ${o}%)`;
}

function normalizePressEffect(source, target = 'self') {
    return {
        type: 'press',
        source: { provider: 'internal', name: 'press' },
        enabled: !!source.pressEnabled,
        target,
        trigger: 'pointer',
        params: {
            transitionMs: source.pressTransition || 100,
            brightness: source.pressBrightness ?? 95,
            scale: source.pressScale ?? 100,
            useDepthOffset: !!source.depthEnabled,
        },
    };
}

function normalizeSpinEffect(source, target = 'self') {
    const spin = source.spinAnimation || {};
    return {
        type: 'spin',
        source: { provider: 'internal', name: 'spin' },
        enabled: !!spin.enabled,
        target,
        timing: {
            durationMs: (spin.duration || 10) * 1000,
            easing: 'linear',
            iteration: 'infinite',
        },
        params: {
            direction: spin.direction === 'ccw' ? 'ccw' : 'cw',
        },
    };
}

const CSS_EFFECT_PROVIDER_STYLES = {
    'animate.css': 'https://cdn.jsdelivr.net/npm/animate.css@4.1.1/animate.min.css',
};

const EFFECT_PROVIDER_SCRIPTS = {
    'party.js': 'https://cdn.jsdelivr.net/npm/party-js@2.2.0/bundle/party.min.js',
};

const CSS_ANIMATION_PRESETS = [
    { id: 'fade-in', label: 'Fade In', group: 'Appear', provider: 'animate.css', className: 'animate__fadeIn', phase: 'enter', durationMs: 700 },
    { id: 'fade-in-up', label: 'Fade In Up', group: 'Appear', provider: 'animate.css', className: 'animate__fadeInUp', phase: 'enter', durationMs: 700 },
    { id: 'fade-in-down', label: 'Fade In Down', group: 'Appear', provider: 'animate.css', className: 'animate__fadeInDown', phase: 'enter', durationMs: 700 },
    { id: 'fade-in-left', label: 'Fade In Left', group: 'Appear', provider: 'animate.css', className: 'animate__fadeInLeft', phase: 'enter', durationMs: 700 },
    { id: 'fade-in-right', label: 'Fade In Right', group: 'Appear', provider: 'animate.css', className: 'animate__fadeInRight', phase: 'enter', durationMs: 700 },
    { id: 'zoom-in', label: 'Zoom In', group: 'Appear', provider: 'animate.css', className: 'animate__zoomIn', phase: 'enter', durationMs: 650 },
    { id: 'zoom-in-up', label: 'Zoom In Up', group: 'Appear', provider: 'animate.css', className: 'animate__zoomInUp', phase: 'enter', durationMs: 750 },
    { id: 'zoom-in-down', label: 'Zoom In Down', group: 'Appear', provider: 'animate.css', className: 'animate__zoomInDown', phase: 'enter', durationMs: 750 },
    { id: 'bounce-in', label: 'Bounce In', group: 'Appear', provider: 'animate.css', className: 'animate__bounceIn', phase: 'enter', durationMs: 850 },
    { id: 'bounce-in-up', label: 'Bounce In Up', group: 'Appear', provider: 'animate.css', className: 'animate__bounceInUp', phase: 'enter', durationMs: 850 },
    { id: 'back-in-down', label: 'Back In Down', group: 'Appear', provider: 'animate.css', className: 'animate__backInDown', phase: 'enter', durationMs: 800 },
    { id: 'back-in-up', label: 'Back In Up', group: 'Appear', provider: 'animate.css', className: 'animate__backInUp', phase: 'enter', durationMs: 800 },
    { id: 'flip-in-x', label: 'Flip In X', group: 'Appear', provider: 'animate.css', className: 'animate__flipInX', phase: 'enter', durationMs: 800 },
    { id: 'flip-in-y', label: 'Flip In Y', group: 'Appear', provider: 'animate.css', className: 'animate__flipInY', phase: 'enter', durationMs: 800 },
    { id: 'light-speed-in', label: 'Light Speed In', group: 'Appear', provider: 'animate.css', className: 'animate__lightSpeedInRight', phase: 'enter', durationMs: 750 },
    { id: 'rotate-in', label: 'Rotate In', group: 'Appear', provider: 'animate.css', className: 'animate__rotateIn', phase: 'enter', durationMs: 750 },
    { id: 'fade-out', label: 'Fade Out', group: 'Disappear', provider: 'animate.css', className: 'animate__fadeOut', phase: 'exit', durationMs: 600 },
    { id: 'fade-out-up', label: 'Fade Out Up', group: 'Disappear', provider: 'animate.css', className: 'animate__fadeOutUp', phase: 'exit', durationMs: 650 },
    { id: 'fade-out-down', label: 'Fade Out Down', group: 'Disappear', provider: 'animate.css', className: 'animate__fadeOutDown', phase: 'exit', durationMs: 650 },
    { id: 'zoom-out', label: 'Zoom Out', group: 'Disappear', provider: 'animate.css', className: 'animate__zoomOut', phase: 'exit', durationMs: 600 },
    { id: 'bounce-out', label: 'Bounce Out', group: 'Disappear', provider: 'animate.css', className: 'animate__bounceOut', phase: 'exit', durationMs: 750 },
    { id: 'back-out-down', label: 'Back Out Down', group: 'Disappear', provider: 'animate.css', className: 'animate__backOutDown', phase: 'exit', durationMs: 750 },
    { id: 'flip-out-x', label: 'Flip Out X', group: 'Disappear', provider: 'animate.css', className: 'animate__flipOutX', phase: 'exit', durationMs: 700 },
    { id: 'bounce', label: 'Bounce', group: 'Cute / Attention', provider: 'animate.css', className: 'animate__bounce', phase: 'attention', durationMs: 900 },
    { id: 'pulse', label: 'Pulse', group: 'Cute / Attention', provider: 'animate.css', className: 'animate__pulse', phase: 'attention', durationMs: 800 },
    { id: 'heart-beat', label: 'Heart Beat', group: 'Cute / Attention', provider: 'animate.css', className: 'animate__heartBeat', phase: 'attention', durationMs: 1000 },
    { id: 'tada', label: 'Tada', group: 'Cute / Attention', provider: 'animate.css', className: 'animate__tada', phase: 'attention', durationMs: 900 },
    { id: 'rubber-band', label: 'Rubber Band', group: 'Cute / Attention', provider: 'animate.css', className: 'animate__rubberBand', phase: 'attention', durationMs: 900 },
    { id: 'jello', label: 'Jello', group: 'Cute / Attention', provider: 'animate.css', className: 'animate__jello', phase: 'attention', durationMs: 900 },
    { id: 'wobble', label: 'Wobble', group: 'Cute / Attention', provider: 'animate.css', className: 'animate__wobble', phase: 'attention', durationMs: 900 },
    { id: 'swing', label: 'Swing', group: 'Cute / Attention', provider: 'animate.css', className: 'animate__swing', phase: 'attention', durationMs: 900 },
];

function getCssAnimationPreset(presetId) {
    return CSS_ANIMATION_PRESETS.find(p => p.id === presetId) || null;
}

function normalizeCssAnimationEffect(source, target = 'self') {
    const cfg = source.cssAnimation || {};
    const preset = getCssAnimationPreset(cfg.presetId || 'bounce-in');
    return {
        type: 'css-animation',
        source: {
            provider: preset?.provider || 'animate.css',
            name: preset?.id || '',
            className: preset?.className || '',
        },
        enabled: !!cfg.enabled && !!preset,
        target,
        trigger: cfg.trigger || 'mount',
        timing: {
            durationMs: Math.round((cfg.duration || ((preset?.durationMs || 800) / 1000)) * 1000),
            delayMs: Math.round((cfg.delay || 0) * 1000),
            iteration: cfg.loop ? 1 : Math.max(1, parseInt(cfg.repeat || 1, 10)),
            loopDelayMs: Math.round((cfg.loopDelay ?? 0.6) * 1000),
        },
        params: {
            presetId: preset?.id || '',
            group: preset?.group || '',
            phase: preset?.phase || 'attention',
            className: preset?.className || '',
            baseClass: 'animate__animated',
            loop: !!cfg.loop,
        },
    };
}

const PARTICLE_EFFECT_PRESETS = [
    { id: 'ambient-sparkle-aura', label: 'Ambient Sparkle Aura', group: 'Sparkle / Halo', provider: 'internal', template: 'ambient-aura', count: 18, auraWidth: 140, auraHeight: 140, speedMin: 0, speedMax: 0, sizeMin: 0.45, sizeMax: 0.9, spread: 360, loop: true },
    { id: 'sparkle-burst', label: 'Sparkle Burst', group: 'Sparkle / Halo', provider: 'party.js', template: 'sparkles', count: 36, speedMin: 80, speedMax: 260, sizeMin: 0.7, sizeMax: 1.4, spread: 70 },
    { id: 'sparkle-halo', label: 'Sparkle Halo', group: 'Sparkle / Halo', provider: 'party.js', template: 'sparkles', count: 24, speedMin: 35, speedMax: 120, sizeMin: 0.5, sizeMax: 1.1, spread: 360 },
    { id: 'reward-pop', label: 'Reward Pop', group: 'Sparkle / Halo', provider: 'party.js', template: 'confetti', count: 42, speedMin: 180, speedMax: 420, sizeMin: 0.7, sizeMax: 1.2, spread: 80 },
    { id: 'magic-trail', label: 'Magic Trail', group: 'Sparkle / Halo', provider: 'party.js', template: 'sparkles', count: 28, speedMin: 60, speedMax: 210, sizeMin: 0.45, sizeMax: 0.95, spread: 45 },
    { id: 'soft-glitter', label: 'Soft Glitter', group: 'Sparkle / Halo', provider: 'party.js', template: 'sparkles', count: 18, speedMin: 20, speedMax: 90, sizeMin: 0.35, sizeMax: 0.8, spread: 360 },
];

function getParticleEffectPreset(presetId) {
    return PARTICLE_EFFECT_PRESETS.find(p => p.id === presetId) || null;
}

function normalizeParticleEffect(source, target = 'self') {
    const cfg = source.particleEffect || {};
    const preset = getParticleEffectPreset(cfg.presetId || 'sparkle-burst');
    return {
        type: 'particle-effect',
        source: {
            provider: preset?.provider || 'party.js',
            name: preset?.id || '',
            template: preset?.template || 'sparkles',
        },
        enabled: !!cfg.enabled && !!preset,
        target,
        trigger: cfg.trigger || 'mount',
        params: {
            presetId: preset?.id || '',
            group: preset?.group || '',
            count: cfg.count ?? preset?.count ?? 30,
            speedMin: cfg.speedMin ?? preset?.speedMin ?? 50,
            speedMax: cfg.speedMax ?? preset?.speedMax ?? 260,
            sizeMin: cfg.sizeMin ?? preset?.sizeMin ?? 0.6,
            sizeMax: cfg.sizeMax ?? preset?.sizeMax ?? 1.2,
            spread: cfg.spread ?? preset?.spread ?? 70,
            auraWidth: cfg.auraWidth ?? preset?.auraWidth ?? 140,
            auraHeight: cfg.auraHeight ?? preset?.auraHeight ?? 140,
            loop: cfg.loop ?? !!preset?.loop,
        },
    };
}

function normalizeComponentVisualModel(visual) {
    const v = visual || {};
    return {
        visualModel: {
            shape: {
                type: v.shapeType || 'rectangle',
                width: v.width || 100,
                height: v.height || 40,
                radius: v.borderRadius || 0,
                notch: v.ribbonNotch ?? 20,
                hollowThickness: v.hollowThickness || 8,
            },
            fill: {
                type: v.bgType || 'linear-gradient',
                color1: v.bgColor1 || '#4a90d9',
                color2: v.bgColor2 || '#2e6ab4',
                angle: v.gradientAngle || 180,
                depthIntensity: v.depthIntensity ?? 50,
                rayCount: v.rayCount || 8,
            },
            border: {
                width: v.borderWidth || 0,
                color: v.borderColor || '#ffffff',
            },
            shadows: [
                {
                    type: 'depth-edge',
                    enabled: !!v.depthEnabled,
                    size: v.depthSize || 0,
                    color: v.depthColor || '#000000',
                },
                {
                    type: 'outer',
                    enabled: !!v.outerShadowEnabled,
                    x: v.outerShadowX || 0,
                    y: v.outerShadowY ?? 4,
                    blur: v.outerShadowBlur ?? 8,
                    color: v.outerShadowColor || '#000000',
                    opacity: v.outerShadowOpacity ?? 30,
                },
                {
                    type: 'inner',
                    enabled: !!v.innerShadowEnabled,
                    x: v.innerShadowX || 0,
                    y: v.innerShadowY ?? 2,
                    blur: v.innerShadowBlur ?? 4,
                    color: v.innerShadowColor || '#ffffff',
                    opacity: v.innerShadowOpacity ?? 20,
                },
            ],
            mask: {
                type: 'ring-fade',
                enabled: !!v.maskEnabled,
                innerPct: v.maskInnerPct ?? 28,
                outerPct: v.maskOuterPct ?? 76,
            },
        },
        effects: [
            normalizePressEffect(v),
            normalizeSpinEffect(v),
            normalizeCssAnimationEffect(v),
            normalizeParticleEffect(v),
        ],
    };
}

function normalizeTextStyleModel(text) {
    const t = text || {};
    return {
        stroke: {
            width: t.textStrokeWidth || 0,
            color: t.textStrokeColor || '#000000',
        },
        depth: {
            size: t.textDepthSize || 0,
            color: t.textDepthColor || '#000000',
        },
        shadow: {
            x: t.textShadowX || 0,
            y: t.textShadowY || 0,
            blur: t.textShadowBlur || 0,
            color: t.textShadowColor || '#000000',
            opacity: t.textShadowOpacity ?? 0,
        },
    };
}

function normalizeImageStyleModel(imageLike) {
    const im = imageLike || {};
    return {
        shadow: {
            enabled: !!im.shadowEnabled,
            x: im.shadowX || 0,
            y: im.shadowY ?? 4,
            blur: im.shadowBlur ?? 8,
            color: im.shadowColor || '#000000',
            opacity: im.shadowOpacity ?? 50,
        },
    };
}

function findEffect(effects, type) {
    return (effects || []).find(e => e && e.type === type) || null;
}

function imageShadowCss(style) {
    const sh = style?.shadow || {};
    if (!sh.enabled) return '';
    return `drop-shadow(${sh.x || 0}px ${sh.y ?? 4}px ${sh.blur ?? 8}px ${hexToRgba(sh.color || '#000000', sh.opacity ?? 50)})`;
}

function componentModelFromVisual(visual) {
    return visual?.model || normalizeComponentVisualModel(visual).visualModel;
}

function componentEffectsFromVisual(visual) {
    return visual?.effects || normalizeComponentVisualModel(visual).effects;
}

function modelShadow(model, type) {
    return (model?.shadows || []).find(s => s.type === type) || {};
}

function componentShadowCss(model, isClipped) {
    const shadows = [];
    const filterEffects = [];
    const depth = modelShadow(model, 'depth-edge');
    if (depth.enabled && depth.size > 0) {
        if (isClipped) filterEffects.push(`drop-shadow(0px ${depth.size}px 0px ${depth.color || '#000'})`);
        else shadows.push(`0 ${depth.size}px 0 0 ${depth.color || '#000'}`);
    }
    const outer = modelShadow(model, 'outer');
    if (outer.enabled) {
        const css = `${outer.x || 0}px ${outer.y ?? 4}px ${outer.blur ?? 8}px ${hexToRgba(outer.color || '#000000', outer.opacity ?? 30)}`;
        if (isClipped) filterEffects.push(`drop-shadow(${css})`);
        else shadows.push(css);
    }
    const inner = modelShadow(model, 'inner');
    if (inner.enabled) {
        const blur = inner.blur ?? 4;
        shadows.push(`inset ${inner.x || 0}px ${inner.y ?? 2}px ${blur * 2}px ${-blur}px ${hexToRgba(inner.color || '#ffffff', inner.opacity ?? 20)}`);
    }
    return { shadows, filterEffects };
}

function pressedComponentShadowCss(model) {
    const pressed = [];
    const outer = modelShadow(model, 'outer');
    if (outer.enabled) {
        pressed.push(`${outer.x || 0}px ${Math.round((outer.y ?? 4) * 0.3)}px ${Math.round((outer.blur ?? 8) * 0.5)}px ${hexToRgba(outer.color || '#000000', outer.opacity ?? 30)}`);
    }
    const inner = modelShadow(model, 'inner');
    if (inner.enabled) {
        const blur = inner.blur ?? 4;
        pressed.push(`inset ${inner.x || 0}px ${inner.y ?? 2}px ${blur * 2}px ${-blur}px ${hexToRgba(inner.color || '#ffffff', inner.opacity ?? 20)}`);
    }
    return pressed.length ? pressed.join(',') : 'none';
}

function applyPressEffect(el, effect, opts = {}) {
    if (el._uiPressHandlers && el.removeEventListener) {
        const h = el._uiPressHandlers;
        el.removeEventListener('mousedown', h.down); el.removeEventListener('mouseup', h.up); el.removeEventListener('mouseleave', h.up);
        el.removeEventListener('touchstart', h.down); el.removeEventListener('touchend', h.up);
        el._uiPressHandlers = null;
    }
    if (!effect?.enabled) {
        el.style.cursor = '';
        el.style.transition = '';
        return;
    }
    const params = effect.params || {};
    const dur = params.transitionMs || 100;
    const scale = (params.scale ?? 100) / 100;
    const bright = (params.brightness ?? 100) / 100;
    const depthPx = opts.depthPx || 0;
    const normalShadow = opts.normalShadow ?? el.style.boxShadow;
    const pressedShadow = opts.pressedShadow;
    const baseFilter = opts.baseFilter || '';
    el.style.cursor = 'pointer';
    el.style.transition = pressedShadow
        ? `transform ${dur}ms ease,filter ${dur}ms ease,box-shadow ${dur}ms ease`
        : `transform ${dur}ms ease,filter ${dur}ms ease`;
    const down = () => {
        el.style.transform = `${depthPx ? `translateY(${depthPx}px) ` : ''}scale(${scale})`;
        el.style.filter = baseFilter ? `${baseFilter} brightness(${bright})` : `brightness(${bright})`;
        if (pressedShadow) el.style.boxShadow = pressedShadow;
    };
    const up = () => {
        el.style.transform = '';
        el.style.filter = baseFilter;
        if (pressedShadow) el.style.boxShadow = normalShadow;
    };
    el.addEventListener('mousedown', down); el.addEventListener('mouseup', up); el.addEventListener('mouseleave', up);
    el.addEventListener('touchstart', down, { passive: true }); el.addEventListener('touchend', up);
    el._uiPressHandlers = { down, up };
}

function ensureCssEffectProvider(provider) {
    if (typeof document === 'undefined') return;
    const href = CSS_EFFECT_PROVIDER_STYLES[provider];
    if (!href) return;
    const id = 'ui-css-effect-provider-' + provider.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
}

function applyCssAnimationEffect(el, effect) {
    if (!el || !el.classList) return;
    if (el._uiCssAnimationLoopTimer) {
        clearTimeout(el._uiCssAnimationLoopTimer);
        el._uiCssAnimationLoopTimer = null;
    }
    if (el._uiCssAnimationEndHandler) {
        el.removeEventListener('animationend', el._uiCssAnimationEndHandler);
        el._uiCssAnimationEndHandler = null;
    }
    if (el._uiCssAnimationClasses) {
        el.classList.remove(...el._uiCssAnimationClasses);
        el._uiCssAnimationClasses = null;
    }
    if (!effect?.enabled) return;
    const params = effect.params || {};
    const className = params.className || effect.source?.className;
    if (!className) return;
    ensureCssEffectProvider(effect.source?.provider || 'animate.css');
    const baseClass = params.baseClass || 'animate__animated';
    const classes = [baseClass, className];
    const timing = effect.timing || {};
    el.style.setProperty('--animate-duration', (timing.durationMs || 800) + 'ms');
    el.style.setProperty('--animate-delay', (timing.delayMs || 0) + 'ms');
    el.style.setProperty('--animate-repeat', timing.iteration || 1);
    el.classList.add(...classes);
    el._uiCssAnimationClasses = classes;
    if (params.loop) {
        const loopDelay = Math.max(0, timing.loopDelayMs ?? 600);
        el._uiCssAnimationEndHandler = () => {
            el.classList.remove(...classes);
            el._uiCssAnimationLoopTimer = setTimeout(() => {
                if (!el.isConnected) return;
                el.classList.add(...classes);
            }, loopDelay);
        };
        el.addEventListener('animationend', el._uiCssAnimationEndHandler);
    }
}

function ensureEffectProviderScript(provider) {
    if (typeof document === 'undefined') return Promise.resolve(false);
    if (provider === 'party.js' && typeof window !== 'undefined' && window.party) return Promise.resolve(true);
    const src = EFFECT_PROVIDER_SCRIPTS[provider];
    if (!src) return Promise.resolve(false);
    const id = 'ui-effect-provider-script-' + provider.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const existing = document.getElementById(id);
    if (existing?._loadPromise) return existing._loadPromise;
    const script = existing || document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;
    script._loadPromise = new Promise(resolve => {
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
    });
    if (!existing) document.head.appendChild(script);
    return script._loadPromise;
}

function partyRange(min, max) {
    const party = typeof window !== 'undefined' ? window.party : null;
    return party?.variation?.range ? party.variation.range(min, max) : min;
}

function ensureAmbientAuraKeyframes() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('ui-ambient-aura-keyframes')) return;
    const st = document.createElement('style');
    st.id = 'ui-ambient-aura-keyframes';
    st.textContent =
        '@keyframes ui-ambient-aura{' +
        '0%{transform:translate(-50%,-50%) translate(var(--x0),var(--y0)) scale(.2);opacity:0}' +
        '18%{opacity:.95}' +
        '70%{opacity:.55}' +
        '100%{transform:translate(-50%,-50%) translate(var(--x1),var(--y1)) scale(1);opacity:0}' +
        '}' +
        '.ui-ambient-aura{position:absolute;inset:0;pointer-events:none;overflow:visible;z-index:20}' +
        '.ui-ambient-aura-star{position:absolute;left:50%;top:50%;width:var(--s);height:var(--s);animation:ui-ambient-aura var(--d) ease-out infinite;animation-delay:var(--delay);filter:drop-shadow(0 0 5px rgba(255,255,255,.85))}' +
        '.ui-ambient-aura-star::before,.ui-ambient-aura-star::after{content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(255,255,255,.95);border-radius:999px}' +
        '.ui-ambient-aura-star::before{width:100%;height:28%}' +
        '.ui-ambient-aura-star::after{width:28%;height:100%}';
    document.head.appendChild(st);
}

function applyAmbientSparkleAura(el, effect) {
    if (typeof document === 'undefined' || !el) return;
    const old = el.querySelector?.(':scope > .ui-ambient-aura');
    if (old) old.remove();
    if (!effect?.enabled) return;
    ensureAmbientAuraKeyframes();
    const params = effect.params || {};
    const count = Math.max(1, Math.min(96, params.count || 18));
    const auraWidth = Math.max(10, params.auraWidth || 140);
    const auraHeight = Math.max(10, params.auraHeight || 140);
    const aura = document.createElement('span');
    aura.className = 'ui-ambient-aura';
    for (let i = 0; i < count; i++) {
        const star = document.createElement('span');
        star.className = 'ui-ambient-aura-star';
        const angle = Math.round((360 / count) * i + (i % 3) * 9);
        const radians = angle * Math.PI / 180;
        const distance = 0.68 + (i % 5) * 0.08;
        const x1 = Math.round(Math.cos(radians) * auraWidth * 0.5 * distance);
        const y1 = Math.round(Math.sin(radians) * auraHeight * 0.5 * distance);
        const size = (params.sizeMin || 0.45) + ((params.sizeMax || 0.9) - (params.sizeMin || 0.45)) * ((i % 5) / 4);
        const duration = 2200 + (i % 6) * 320;
        star.style.setProperty('--x0', Math.round(x1 * 0.34) + 'px');
        star.style.setProperty('--y0', Math.round(y1 * 0.34) + 'px');
        star.style.setProperty('--x1', x1 + 'px');
        star.style.setProperty('--y1', y1 + 'px');
        star.style.setProperty('--s', Math.round(size * 10) + 'px');
        star.style.setProperty('--d', duration + 'ms');
        star.style.setProperty('--delay', -(i * 180 % duration) + 'ms');
        aura.appendChild(star);
    }
    el.appendChild(aura);
}

function playParticleEffect(el, effect) {
    if (!effect?.enabled || effect.trigger !== 'mount') return;
    if (effect.source?.template === 'ambient-aura') {
        applyAmbientSparkleAura(el, effect);
        return;
    }
    ensureEffectProviderScript(effect.source?.provider || 'party.js').then(ok => {
        const party = typeof window !== 'undefined' ? window.party : null;
        if (!ok || !party || !el.isConnected) return;
        const params = effect.params || {};
        const options = {
            count: params.count || 30,
            speed: partyRange(params.speedMin || 50, params.speedMax || 260),
            size: partyRange(params.sizeMin || 0.6, params.sizeMax || 1.2),
            spread: params.spread || 70,
        };
        if (effect.source?.template === 'confetti' && party.confetti) party.confetti(el, options);
        else if (party.sparkles) party.sparkles(el, options);
    });
}

function ensureSpinKeyframes() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('ui-spin-keyframes')) return;
    const st = document.createElement('style');
    st.id = 'ui-spin-keyframes';
    st.textContent = '@keyframes ui-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}@keyframes ui-spin-rev{from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}';
    document.head.appendChild(st);
}

// Confetti 키프레임 1회 주입. 두 패턴 공용 — 시작 좌표와 방향 벡터(--dx/--dy)만 다름.
function ensureConfettiKeyframes() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('ui-confetti-keyframes')) return;
    const st = document.createElement('style');
    st.id = 'ui-confetti-keyframes';
    st.textContent =
        '@keyframes ui-confetti-burst{' +
        '0%{transform:translate(0,0) rotate(0deg);opacity:1}' +
        '100%{transform:translate(var(--dx),var(--dy)) rotate(var(--rot));opacity:0}' +
        '}' +
        '@keyframes ui-confetti-orbit{' +
        '0%{transform:rotate(var(--a0)) translateX(0) scale(.9);opacity:1}' +
        '35%{opacity:1}' +
        '100%{transform:rotate(var(--a1)) translateX(var(--dist)) scale(.75);opacity:0}' +
        '}';
    document.head.appendChild(st);
}

// container 안에 파티클 div를 spawn 하고 CSS 애니메이션으로 재생.
// center-burst: 가운데에서 사방(또는 부채꼴)으로 터지며 페이드아웃.
// sides-launch: 좌하단/우하단 두 발사점에서 위쪽 사선(우상/좌상)으로 동시 발사.
function spawnConfettiParticles(container, opts) {
    if (!container) return;
    ensureConfettiKeyframes();
    const cw = opts.width || container.offsetWidth || 320;
    const ch = opts.height || container.offsetHeight || 240;
    const pattern = opts.confettiPattern || 'center-burst';
    const colors = (opts.colors && opts.colors.length) ? opts.colors
        : ['#ff3b3b','#ffd23b','#3bff7a','#3bb6ff','#c63bff','#ffffff'];
    const N = Math.max(1, Math.min(200, opts.particleCount || 40));
    const dur = opts.duration || 1800;
    const spread = opts.spread != null ? opts.spread : 360;
    const velocity = opts.velocity != null ? opts.velocity : 220;
    const sizeMin = opts.sizeMin || 6;
    const sizeMax = opts.sizeMax || 12;
    const shape = opts.shape || 'mixed';

    container.innerHTML = '';
    if (container._confettiCleanupId) { clearTimeout(container._confettiCleanupId); container._confettiCleanupId = null; }

    for (let i = 0; i < N; i++) {
        const p = document.createElement('span');
        const dist = velocity * (0.6 + Math.random() * 0.6);
        let startX, startY, ang;
        const orbitMode = pattern === 'clear-orbit';

        if (orbitMode) {
            startX = cw / 2;
            startY = ch / 2;
            ang = (i / N) * Math.PI * 2;
        } else if (pattern === 'sides-launch') {
            // 절반은 좌하단(우상단으로), 나머지 절반은 우하단(좌상단으로) 발사
            const fromLeft = i < N / 2;
            startX = fromLeft ? cw * 0.10 : cw * 0.90;
            startY = ch * 0.90;
            const baseDeg = fromLeft ? -45 : -135; // up-right vs up-left
            const angDeg = baseDeg + (Math.random() - 0.5) * Math.min(spread, 90);
            ang = angDeg * Math.PI / 180;
        } else {
            // center-burst: 가운데에서 발사. spread>=360 이면 전방향, 아니면 위쪽 부채꼴.
            startX = cw / 2;
            startY = ch / 2;
            if (spread >= 360) {
                ang = Math.random() * Math.PI * 2;
            } else {
                const angDeg = -90 + (Math.random() - 0.5) * spread;
                ang = angDeg * Math.PI / 180;
            }
        }
        const dx = Math.cos(ang) * dist;
        const dy = Math.sin(ang) * dist;

        const rotEnd = (Math.random() - 0.5) * 720;
        const sz = sizeMin + Math.random() * (sizeMax - sizeMin);
        const isCircle = orbitMode || shape === 'circle' || (shape === 'mixed' && Math.random() < 0.4);
        const aspect = isCircle ? 1 : 0.5;
        const color = colors[i % colors.length];
        const delay = orbitMode ? 0 : Math.random() * Math.min(120, dur * 0.06);
        const animName = orbitMode ? 'ui-confetti-orbit' : 'ui-confetti-burst';
        const timing = orbitMode ? 'ease-out' : 'cubic-bezier(.2,.7,.4,1)';

        p.style.cssText =
            'position:absolute;' +
            'left:' + startX + 'px;top:' + startY + 'px;' +
            (orbitMode ? 'margin-left:' + (-sz / 2) + 'px;margin-top:' + (-(sz * aspect) / 2) + 'px;' : '') +
            'width:' + sz + 'px;height:' + (sz * aspect) + 'px;' +
            'background:' + color + ';' +
            'border-radius:' + (isCircle ? '50%' : '1px') + ';' +
            'pointer-events:none;will-change:transform,opacity;' +
            'animation:' + animName + ' ' + dur + 'ms ' + timing + ' ' + delay + 'ms forwards;';
        p.style.setProperty('--dx', dx + 'px');
        p.style.setProperty('--dy', dy + 'px');
        p.style.setProperty('--rot', rotEnd + 'deg');
        p.style.setProperty('--a0', (ang * 180 / Math.PI) + 'deg');
        p.style.setProperty('--a1', ((ang * 180 / Math.PI) + 115 + (Math.random() - 0.5) * 24) + 'deg');
        p.style.setProperty('--dist', dist + 'px');
        container.appendChild(p);
    }

    container._confettiCleanupId = setTimeout(() => {
        container._confettiCleanupId = null;
        if (!container._confettiLoopId) container.innerHTML = '';
    }, dur + 400);
}

// 배경 무한 스크롤 keyframe (1회 주입). 단일 background layer 기준.
// from/to 의 background-position 픽셀 값을 keyframe 텍스트에 직접 박아 var() 보간 이슈를 피한다.
// 첫 호출 시 prefers-reduced-motion 글로벌 CSS 도 함께 1회 주입 (런타임/에디터 preview 양쪽 커버).
function ensureBgScrollKeyframes(dx, dy) {
    if (typeof document === 'undefined') return null;
    if (!document.getElementById('ui-bg-scroll-global')) {
        const gs = document.createElement('style');
        gs.id = 'ui-bg-scroll-global';
        gs.textContent = '@media (prefers-reduced-motion: reduce){.sr-bg-scroll{animation-play-state:paused !important;}}';
        document.head.appendChild(gs);
    }
    const id = `ui-bg-scroll-${dx}_${dy}`;
    if (document.getElementById(id)) return id;
    const st = document.createElement('style');
    st.id = id;
    st.textContent = `@keyframes ${id}{from{background-position:0 0}to{background-position:${dx}px ${dy}px}}`;
    document.head.appendChild(st);
    return id;
}

// 스크롤 방향 단위 벡터 (dx_unit, dy_unit) — +x 는 오른쪽, +y 는 아래.
// background-position 은 +x 가 이미지를 오른쪽으로 미는 효과 → 시각적으론 패턴이 오른쪽으로 흐름.
const BG_SCROLL_DIRS = {
    'right':      [ 1,  0],
    'down-right': [ 1,  1],
    'down':       [ 0,  1],
    'down-left':  [-1,  1],
    'left':       [-1,  0],
    'up-left':    [-1, -1],
    'up':         [ 0, -1],
    'up-right':   [ 1, -1],
};

// brick 합성 타일 캐시 — key: `${imageUrl}|${bh}` → { dataUrl, bw, bh } | Promise<...>
// 동일 (이미지, 높이) 조합은 1회만 canvas 합성, 이후 즉시 재사용 → 클라이언트 부하 최소화.
// brick 가로폭(bw)은 이미지 자연 비율(naturalWidth/naturalHeight)로 자동 계산.
const BRICK_TILE_CACHE = new Map();

// 사용자 이미지를 받아 (2bw × 2bh) 짜리 brick-staggered 합성 타일 dataURL 을 비동기 생성.
// bh 는 사용자 입력(brick 높이), bw 는 이미지 naturalAspect 로 결정.
// row 0: x=0, x=bw 두 장 / row 1: x=-bw/2, bw/2, 1.5bw 세 장 (캔버스 밖은 clip 되어 stagger 형성).
// onReady({ dataUrl, bw, bh }) 콜백 — 실패 시 호출되지 않음 (호출자는 fallback 단색 유지).
function buildBrickTileDataUrl(imageUrl, bh, onReady) {
    if (typeof document === 'undefined' || !imageUrl) return;
    const key = `${imageUrl}|${bh}`;
    const cached = BRICK_TILE_CACHE.get(key);
    if (cached && cached.dataUrl) { onReady(cached); return; }
    if (cached && typeof cached.then === 'function') { cached.then(onReady).catch(() => {}); return; }
    const promise = new Promise((resolve, reject) => {
        const img = new Image();
        if (!imageUrl.startsWith('data:')) img.crossOrigin = 'anonymous';
        img.onload = () => {
            try {
                const natW = img.naturalWidth || img.width || bh;
                const natH = img.naturalHeight || img.height || bh;
                const aspect = natW / natH;
                const bw = Math.max(1, Math.round(bh * aspect));
                const c = document.createElement('canvas');
                c.width = bw * 2;
                c.height = bh * 2;
                const ctx = c.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                // row 0: 두 장 나란히 (x=0, x=bw)
                ctx.drawImage(img, 0, 0, bw, bh);
                ctx.drawImage(img, bw, 0, bw, bh);
                // row 1: 세 장 (x=-bw/2, bw/2, 1.5bw) — 캔버스 밖은 clip 되어 stagger 형성
                ctx.drawImage(img, -bw / 2, bh, bw, bh);
                ctx.drawImage(img,  bw / 2, bh, bw, bh);
                ctx.drawImage(img,  bw * 1.5, bh, bw, bh);
                const result = { dataUrl: c.toDataURL('image/png'), bw, bh };
                BRICK_TILE_CACHE.set(key, result);
                resolve(result);
            } catch (e) {
                console.error('[brick] canvas 합성 실패 (CORS taint 가능성)', e);
                BRICK_TILE_CACHE.delete(key);
                reject(e);
            }
        };
        img.onerror = (e) => {
            console.error('[brick] 이미지 로드 실패:', imageUrl, e);
            BRICK_TILE_CACHE.delete(key);
            reject(e);
        };
        img.src = imageUrl;
    });
    BRICK_TILE_CACHE.set(key, promise);
    promise.then(onReady).catch(() => {});
}

// 에디터 공식 지원 폰트 (Google Fonts). 프로젝트가 별도 로드하지 않아도 되도록 단일 출처.
export const EDITOR_FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Lilita+One&family=Fredoka+One&family=Boogaloo&family=Righteous&family=Baloo+2:wght@800&family=Press+Start+2P&family=Orbitron:wght@700&display=swap';

function ensureEditorFontsLoaded() {
    if (typeof document === 'undefined') return;
    if (document.getElementById('scene-renderer-editor-fonts')) return;
    const head = document.head || document.getElementsByTagName('head')[0];
    if (!head) return;
    const pre1 = document.createElement('link');
    pre1.rel = 'preconnect';
    pre1.href = 'https://fonts.googleapis.com';
    head.appendChild(pre1);
    const pre2 = document.createElement('link');
    pre2.rel = 'preconnect';
    pre2.href = 'https://fonts.gstatic.com';
    pre2.crossOrigin = '';
    head.appendChild(pre2);
    const link = document.createElement('link');
    link.id = 'scene-renderer-editor-fonts';
    link.rel = 'stylesheet';
    link.href = EDITOR_FONTS_HREF;
    head.appendChild(link);
}

export class SceneRenderer {

    /** 에디터 공식 폰트 stylesheet URL (단일 출처). */
    static get EDITOR_FONTS_HREF() { return EDITOR_FONTS_HREF; }

    /** 에디터 공식 폰트를 <head>에 1회 주입. 프로젝트에서 명시적으로도 호출 가능. */
    static ensureFontsLoaded() { ensureEditorFontsLoaded(); }

    /**
     * @param {HTMLElement} container
     * @param {object} [options]
     * @param {string} [options.basePath] - 이미지 경로 앞에 붙일 prefix. 예) 'assets/'
     * @param {boolean} [options.autoLoadFonts=true] - 에디터 폰트 자동 로드. false로 끄면 프로젝트가 직접 로드해야 함.
     */
    constructor(container, options = {}) {
        if (options.autoLoadFonts !== false) ensureEditorFontsLoaded();
        this.container = container;
        this._basePath = (options && options.basePath) ? options.basePath : '';
        this._contract = null;
        this._el = null;
        this._styleEl = null;
        this._activeTab = null;
        this._handlers = {};       // eventName → Set<Function>
        this._boundElements = {};  // bindingKey → HTMLElement[]
        this._boundImages = {};    // imageKey → HTMLImageElement[]
        this._groupWrappers = {};  // groupName → HTMLElement
        // Navigation scene 전용
        this._sceneRegistry = (options && options.sceneRegistry) || null; // { sceneName: contract }
        this._sceneFetch    = (options && options.sceneFetch) || null;    // (sceneName) => Promise<contract>
        this._navHostEl     = null;
        this._navHostInner  = null; // 현재 활성 매칭 씬 렌더 컨테이너
        this._navHostRenderer = null; // SceneRenderer instance for matched scene
        // 네비바가 가리는 영역(px) — 스크롤시 콘텐츠가 가려지지 않게 viewport 에서 차감
        this._safeArea = (options && options.safeArea) || { top: 0, bottom: 0, left: 0, right: 0 };
    }

    /** 매칭 씬 contract 사전 등록 (Live preview / 인라인 임베드용). */
    setSceneRegistry(registry) { this._sceneRegistry = registry || {}; return this; }
    /** 매칭 씬 contract 를 비동기로 가져오는 콜백 등록 (서버 fetch 용). */
    setSceneFetch(fn) { this._sceneFetch = fn; return this; }

    /** 자신이 navigation scene 일 때, 자식 씬에 전달할 safeArea (가려진 영역 px). */
    _computeNavSafeArea() {
        const c = this._contract;
        if (c?.sceneType !== 'navigation') return { top:0, bottom:0, left:0, right:0 };
        const nh = c.navBarHeight || 80;
        const ox = c.navOffsetX || 0;
        const oy = c.navOffsetY || 0;
        switch (c.navAnchor || 'bottom') {
            case 'top':    return { top: nh + oy, bottom: 0, left: 0, right: 0 };
            case 'bottom': return { top: 0, bottom: nh + oy, left: 0, right: 0 };
            case 'left':   return { top: 0, bottom: 0, left: nh + ox, right: 0 };
            case 'right':  return { top: 0, bottom: 0, left: 0, right: nh + ox };
        }
        return { top:0, bottom:0, left:0, right:0 };
    }

    // ── Loading ───────────────────────────────────────────────────────────────

    /** URL에서 JSON을 fetch해서 로드. Promise 반환. */
    async load(url) {
        const resp = await fetch(url);
        this._contract = await resp.json();
        return this;
    }

    /** 이미 파싱된 계약 객체를 동기적으로 로드. */
    loadSync(contractObj) {
        this._contract = contractObj;
        return this;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    show() {
        if (!this._contract) throw new Error('SceneRenderer: load() 또는 loadSync()를 먼저 호출하세요.');
        this._buildDOM();
        this.container.appendChild(this._el);
        requestAnimationFrame(() => {
            this._rootEl.classList.add('visible');
            this._rootEl.style.opacity = '1';
            this._runSceneAnimations();
        });
        return this;
    }

    hide() {
        if (!this._el) return;
        this._rootEl.classList.remove('visible');
        const dur = this._contract?.transitionDuration || 300;
        setTimeout(() => {
            if (this._el?.parentNode) this._el.parentNode.removeChild(this._el);
            this._el = null;
            this._rootEl = null;
            this._boundElements = {};
            this._groupWrappers = {};
        }, dur);
        return this;
    }

    /**
     * 이벤트 핸들러를 유지하면서 비주얼(계약 JSON)만 교체 — Hot Reload.
     * url은 fetch URL 문자열 또는 파싱된 계약 객체.
     */
    async reload(contractOrUrl) {
        const wasVisible = !!this._el;
        await this.load(typeof contractOrUrl === 'string' ? contractOrUrl : '').catch(() => {});
        if (typeof contractOrUrl !== 'string') this._contract = contractOrUrl;
        if (wasVisible) {
            if (this._el?.parentNode) this._el.parentNode.removeChild(this._el);
            if (this._styleEl?.parentNode) this._styleEl.parentNode.removeChild(this._styleEl);
            this._el = null;
            this._rootEl = null;
            this._styleEl = null;
            this._boundElements = {};
            this._groupWrappers = {};
            this._buildDOM();
            this.container.appendChild(this._el);
            this._rootEl.classList.add('visible');
            this._rootEl.style.opacity = '1';
            this._runSceneAnimations();
        }
        return this;
    }

    // ── Tab Navigation (navigation sceneType 전용) ────────────────────────────

    switchTab(tabId) {
        const c = this._contract;
        if (c?.sceneType !== 'navigation') {
            console.warn('[SceneRenderer] switchTab called on non-navigation scene; ignored.');
            return;
        }
        if (tabId === this._activeTab) return;

        const tabs = c.tabs || [];
        const tabOrder = tabs.map(t => t.id);
        const prevIdx = tabOrder.indexOf(this._activeTab);
        const nextIdx = tabOrder.indexOf(tabId);
        if (nextIdx < 0) {
            console.warn('[SceneRenderer] switchTab: unknown tabId', tabId);
            return;
        }
        const goRight = nextIdx > prevIdx;
        const tab = tabs[nextIdx];
        const transitionType = c.transitionType || 'slide';
        const dur = c.transitionDuration || 300;

        // nav 버튼 active 상태 갱신
        this._el?.querySelectorAll('[data-nav-tab]').forEach(b => {
            b.classList.toggle('active', b.dataset.navTab === tabId);
        });

        // 매칭 씬 contract 를 가져와 host 안에 새 SceneRenderer 인스턴스로 마운트
        const mountMatched = (matchedContract) => {
            if (!this._navHostEl) return;
            const host = this._navHostEl;
            const prevInner = this._navHostInner;
            const nextInner = document.createElement('div');
            nextInner.className = 'sr-nav-host-inner';
            nextInner.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:hidden;';
            host.appendChild(nextInner);

            // 새 SceneRenderer 마운트
            if (matchedContract) {
                try {
                    const subRenderer = new SceneRenderer(nextInner, {
                        basePath: this._basePath,
                        safeArea: this._computeNavSafeArea(),
                    });
                    subRenderer.loadSync(matchedContract).show();
                    this._navHostRenderer = subRenderer;
                } catch (e) {
                    console.error('[SceneRenderer] matched scene mount failed:', e);
                    nextInner.textContent = '[scene load error: ' + (tab.sceneName || tabId) + ']';
                }
            } else {
                nextInner.style.cssText += 'display:flex;align-items:center;justify-content:center;color:#888;font-family:monospace;font-size:12px;';
                nextInner.textContent = '(no matched scene: ' + (tab.sceneName || '') + ')';
            }

            // 트랜지션 적용
            if (transitionType === 'fade') {
                nextInner.style.opacity = '0';
                nextInner.style.transition = `opacity ${dur}ms ease`;
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    nextInner.style.opacity = '1';
                    if (prevInner) {
                        prevInner.style.transition = `opacity ${dur}ms ease`;
                        prevInner.style.opacity = '0';
                    }
                }));
            } else {
                nextInner.style.transition = 'none';
                nextInner.style.transform = goRight ? 'translateX(100%)' : 'translateX(-100%)';
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    nextInner.style.transition = `transform ${dur}ms ease`;
                    nextInner.style.transform = 'translateX(0)';
                    if (prevInner) {
                        prevInner.style.transition = `transform ${dur}ms ease`;
                        prevInner.style.transform = goRight ? 'translateX(-100%)' : 'translateX(100%)';
                    }
                }));
            }

            // 트랜지션 종료 후 prev 제거
            setTimeout(() => {
                if (prevInner && prevInner.parentNode) prevInner.parentNode.removeChild(prevInner);
            }, dur + 50);

            this._navHostInner = nextInner;
            this._activeTab = tabId;
        };

        const matched = (this._sceneRegistry && tab.sceneName) ? this._sceneRegistry[tab.sceneName] : null;
        if (matched) {
            mountMatched(matched);
        } else if (this._sceneFetch && tab.sceneName) {
            Promise.resolve(this._sceneFetch(tab.sceneName))
                .then(c2 => mountMatched(c2))
                .catch(err => { console.error('[SceneRenderer] sceneFetch failed:', err); mountMatched(null); });
        } else {
            mountMatched(null);
        }
    }

    // ── Event System ──────────────────────────────────────────────────────────

    /**
     * 계약에서 선언된 이벤트를 구독.
     * 반환값은 구독 해제 함수: const off = renderer.on('...', fn); off();
     */
    on(eventName, handler) {
        if (!this._handlers[eventName]) this._handlers[eventName] = new Set();
        this._handlers[eventName].add(handler);
        return () => this._handlers[eventName]?.delete(handler);
    }

    off(eventName, handler) {
        this._handlers[eventName]?.delete(handler);
    }

    _emit(eventName, payload) {
        this._handlers[eventName]?.forEach(h => h(payload));
    }

    // ── Data Binding ──────────────────────────────────────────────────────────

    /**
     * 데이터 바인딩 업데이트. 변경된 노드만 DOM 업데이트.
     * renderer.update({ player: { coins: 500, name: '홍길동' } })
     */
    update(data) {
        const flat = this._flattenPaths(data);
        for (const [key, value] of Object.entries(flat)) {
            const els = this._boundElements[key];
            if (els) els.forEach(el => {
                const tpl = el.dataset.bindingTemplate;
                el.textContent = tpl ? tpl.replaceAll('{value}', String(value)) : String(value);
            });
            const imgs = this._boundImages[key];
            if (imgs) imgs.forEach(img => { img.src = this._resolveAssetPath(String(value)); });
        }
        return this;
    }

    /** stableId로 DOM 요소에 직접 접근 (고급 사용). */
    getElement(stableId) {
        return this._el?.querySelector(`[data-stable-id="${stableId}"]`) ?? null;
    }

    /** 그룹 이름으로 래퍼 div에 접근. show/hide/transform 등 그룹 전체 제어에 사용. */
    getGroup(name) {
        return this._groupWrappers[name] ?? null;
    }

    /** stableId의 특정 텍스트 슬롯 span 요소에 접근. */
    getTextElement(stableId, slotIndex = 0) {
        return this.getElement(stableId)?.querySelector(`.text-${slotIndex}`) ?? null;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    _runSceneAnimations() {
        const items = this._contract?.sceneAnimations;
        if (!Array.isArray(items) || !items.length || !this._el) return;

        let cursor = 0;
        let previousStart = 0;
        const scheduled = [];
        items.forEach((item, index) => {
            if (item.enabled === false) return;
            const mode = item.startMode || 'afterPrevious';
            const base = mode === 'withPrevious' ? previousStart : mode === 'atTime' ? (item.startTimeMs || 0) : cursor;
            const start = Math.max(0, base + (item.delayMs || 0));
            const duration = Math.max(0, item.durationMs || 0);
            cursor = Math.max(cursor, start + duration);
            previousStart = start;
            scheduled.push({ item, index, start, duration });
        });
        console.info('[SceneRenderer] scene animation schedule', scheduled.map(({ item, index, start, duration }) => ({
            index,
            type: item.type,
            presetId: item.cssPresetId || item.presetId,
            targetStableId: item.targetStableId || '',
            start,
            duration,
        })));

        scheduled.forEach(({ item, start, duration }) => {
            if (item.type !== 'object-animation' || !item.targetStableId) return;
            const target = this.getElement(item.targetStableId);
            if (!target) return;
            [target, ...target.querySelectorAll('*')].forEach(el => {
                if (el._uiCssAnimationClasses || el._uiCssAnimationEndHandler || el._uiCssAnimationLoopTimer) {
                    applyCssAnimationEffect(el, { enabled: false });
                }
            });
            const presetId = item.cssPresetId || item.presetId || 'fade-in';
            const effect = normalizeCssAnimationEffect({
                cssAnimation: {
                    enabled: true,
                    presetId,
                    duration: Math.max(0.001, duration / 1000),
                    delay: 0,
                    repeat: 1,
                    loop: false,
                },
            });
            if (effect.params?.phase === 'enter') {
                target.style.visibility = 'hidden';
            }
        });

        scheduled.forEach(({ item, start, duration }) => {
            if (item.type === 'screen-transition') {
                const overlay = document.createElement('div');
                overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:99999;background:' + (item.color || '#000000') + ';opacity:' + (item.fromOpacity ?? 0) + ';';
                this._el.appendChild(overlay);
                if (typeof overlay.animate !== 'function') {
                    overlay.style.opacity = item.toOpacity ?? 1;
                    return;
                }
                const anim = overlay.animate(
                    [{ opacity: item.fromOpacity ?? 0 }, { opacity: item.toOpacity ?? 1 }],
                    { delay: start, duration, easing: item.easing || 'ease', fill: 'forwards' }
                );
                anim.finished.then(() => {
                    if ((item.toOpacity ?? 1) <= 0 && overlay.parentNode) overlay.parentNode.removeChild(overlay);
                }).catch(() => {});
                return;
            }

            if (item.type !== 'object-animation' || !item.targetStableId) return;
            const target = this.getElement(item.targetStableId);
            if (!target) {
                console.warn('[SceneRenderer] scene animation target not found:', item.targetStableId, item);
                return;
            }
            const presetId = item.cssPresetId || item.presetId || 'fade-in';
            const effect = normalizeCssAnimationEffect({
                cssAnimation: {
                    enabled: true,
                    presetId,
                    duration: Math.max(0.001, duration / 1000),
                    delay: 0,
                    repeat: 1,
                    loop: false,
                },
            });
            setTimeout(() => {
                if (!target.isConnected) return;
                target.style.visibility = '';
                console.info('[SceneRenderer] apply scene css effect', {
                    targetStableId: item.targetStableId,
                    presetId,
                    start,
                    duration,
                });
                applyCssAnimationEffect(target, effect);
            }, start);
        });
    }

    _buildDOM() {
        const c = this._contract;
        this._groupWrappers = {};

        // ── Navigation Scene 모드 ────────────────────────────────────────────
        if (c.sceneType === 'navigation') {
            return this._buildNavigationDOM();
        }

        // ── 일반 Scene 모드 ─────────────────────────────────────────────────
        const w = c.canvas.width; const h = c.canvas.height;
        const vw = c.viewport ? c.viewport.width : w;
        const vh = c.viewport ? c.viewport.height : h;

        // safeArea: navigation host 가 차지하는 공간(가려진 영역) — 스크롤 시 콘텐츠가 그 뒤로 숨지 않게 차감
        const sa = this._safeArea || { top:0, bottom:0, left:0, right:0 };
        const safeTop = sa.top || 0;
        const safeBottom = sa.bottom || 0;
        const effViewH = Math.max(0, vh - safeTop - safeBottom);

        // 스마트 스크롤: 콘텐츠 높이 계산
        let maxBottom = 0;
        (c.layers || []).forEach(l => {
            if (l.visible === false) return;
            const baseH = l.visual?.height
                       || l.visual?.model?.shape?.height
                       || 0;
            const lh = baseH * (l.scale || 1) * (l.scaleY || 1);
            maxBottom = Math.max(maxBottom, (l.y || 0) + lh);
        });
        const contentH = Math.max(maxBottom || effViewH, effViewH);
        const isScrollable = contentH > effViewH;

        this._injectCSS(isScrollable);

        const root = document.createElement('div');
        root.id = c.sceneId;
        root.style.cssText = `position:relative;width:${w}px;height:${contentH}px;overflow:hidden;opacity:0;transition:opacity 0.3s ease;z-index:5;`;
        this._applyBackground(root, c.background);

        // 그룹 래퍼 생성
        const layerGroupMap = {};
        const groupList = [];
        (c.groups || []).forEach((g, idx) => {
            const memberLayers = c.layers.filter(l => g.layerStableIds.includes(l.stableId));
            const maxZ = memberLayers.reduce((mx, l) => Math.max(mx, l.zIndex || 0), 0);
            const gDiv = document.createElement('div');
            gDiv.dataset.group = g.name;
            gDiv.style.cssText = `position:absolute;top:0;left:0;width:${w}px;height:${contentH}px;pointer-events:none;z-index:${maxZ};transform-origin:center center;`;
            if (g.name) this._groupWrappers[g.name] = gDiv;
            groupList.push({ g, gDiv });
            g.layerStableIds.forEach(sid => { layerGroupMap[sid] = idx; });
        });

        const appendLayer = (l, target) => {
            const gIdx = layerGroupMap[l.stableId];
            const layerEl = this._buildLayerEl(l);
            if (gIdx !== undefined && groupList[gIdx]) {
                layerEl.style.pointerEvents = 'auto';
                groupList[gIdx].gDiv.appendChild(layerEl);
            } else {
                target.appendChild(layerEl);
            }
        };

        const sceneAnimationItems = Array.isArray(c.sceneAnimations) ? c.sceneAnimations : [];
        this._timelineAnimationTargets = new Set();
        this._timelineEnterTargets = new Set();
        sceneAnimationItems.forEach(item => {
            if (item?.type !== 'object-animation' || !item.targetStableId || item.enabled === false) return;
            this._timelineAnimationTargets.add(item.targetStableId);
            const preset = getCssAnimationPreset(item.cssPresetId || item.presetId || 'fade-in');
            if ((preset?.phase || 'attention') === 'enter') this._timelineEnterTargets.add(item.targetStableId);
        });

        const sorted = [...c.layers].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        sorted.forEach(l => appendLayer(l, root));

        // 그룹 래퍼 배치
        groupList.forEach(({ gDiv }) => {
            if (gDiv.children.length === 0) return;
            root.appendChild(gDiv);
        });

        this._rootEl = root;

        if (isScrollable) {
            const outerWrap = document.createElement('div');
            outerWrap.style.cssText = `position:absolute;inset:0;width:${vw}px;height:${vh}px;overflow:hidden;`;
            // 스크롤 영역은 safeArea(top/bottom) 만큼 밀어내어 nav 가 가리는 공간을 콘텐츠 노출 영역에서 제외
            const scrollInner = document.createElement('div');
            scrollInner.className = 'sr-scroll-inner';
            scrollInner.style.cssText = `position:absolute;top:${safeTop}px;left:0;width:${vw}px;height:${effViewH}px;overflow-y:scroll;overflow-x:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;-ms-overflow-style:none;`;
            scrollInner.appendChild(root);
            outerWrap.appendChild(scrollInner);
            this._el = outerWrap;
        } else {
            // 비스크롤이지만 safeArea 가 있으면 root 를 밀어내야 콘텐츠가 nav 와 겹치지 않음
            root.style.position = 'absolute';
            if (safeTop > 0)    root.style.top    = safeTop + 'px';
            if (safeBottom > 0) root.style.bottom = safeBottom + 'px';
            this._el = root;
        }
    }

    _buildNavigationDOM() {
        const c = this._contract;
        const vw = c.viewport?.width || 390;
        const vh = c.viewport?.height || 844;
        const anchor = c.navAnchor || 'bottom';
        const ox = c.navOffsetX || 0;
        const oy = c.navOffsetY || 0;
        const nw = c.navBarWidth || vw;
        const nh = c.navBarHeight || 80;

        this._injectCSS(false);

        // 외곽 컨테이너 (viewport 크기, position:relative 로 nav overlay 의 absolute 기준)
        const root = document.createElement('div');
        root.id = c.sceneId;
        root.style.cssText = `position:relative;width:${vw}px;height:${vh}px;overflow:hidden;opacity:0;transition:opacity 0.3s ease;z-index:5;background:transparent;`;

        // Scene Host: 매칭된 씬 contract 가 마운트될 영역 (viewport 전체)
        const host = document.createElement('div');
        host.className = 'sr-nav-host';
        host.style.cssText = `position:absolute;inset:0;width:${vw}px;height:${vh}px;overflow:hidden;`;
        root.appendChild(host);
        this._navHostEl = host;
        this._navHostInner = null;

        // 터치 스와이프로 탭 전환 (축 잠금 + 임계치). passive 로 스크롤은 방해하지 않음.
        {
            let sx = 0, sy = 0, locked = null, valid = false;
            const THRESHOLD = 50;
            host.addEventListener('touchstart', (e) => {
                const t = e.touches[0]; if (!t) return;
                sx = t.clientX; sy = t.clientY; locked = null; valid = true;
            }, { passive: true });
            host.addEventListener('touchmove', (e) => {
                if (!valid) return;
                const t = e.touches[0]; if (!t) return;
                const dx = t.clientX - sx, dy = t.clientY - sy;
                if (locked === null) {
                    const ax = Math.abs(dx), ay = Math.abs(dy);
                    if (ax < 10 && ay < 10) return;
                    const a = this._contract?.navAnchor || 'bottom';
                    const horiz = (a === 'top' || a === 'bottom');
                    const userAxis = ax > ay ? 'x' : 'y';
                    if ((horiz && userAxis !== 'x') || (!horiz && userAxis !== 'y')) {
                        valid = false; // 스크롤 의도 — 탭 전환 취소
                        return;
                    }
                    locked = userAxis;
                }
            }, { passive: true });
            host.addEventListener('touchend', (e) => {
                if (!valid || !locked) { valid = false; return; }
                const t = e.changedTouches && e.changedTouches[0];
                valid = false;
                if (!t) return;
                const delta = locked === 'x' ? (t.clientX - sx) : (t.clientY - sy);
                if (Math.abs(delta) < THRESHOLD) return;
                const tabs = this._contract?.tabs || [];
                if (!tabs.length) return;
                const order = tabs.map(tb => tb.id);
                const cur = order.indexOf(this._activeTab);
                if (cur < 0) return;
                // delta < 0 (왼쪽/위로 스와이프) → 다음 탭; > 0 → 이전 탭
                const next = delta < 0 ? cur + 1 : cur - 1;
                if (next < 0 || next >= order.length) return;
                this.switchTab(order[next]);
            });
        }

        // Nav Overlay (anchor + offset 으로 floating)
        const navOverlay = document.createElement('div');
        navOverlay.className = 'sr-nav-overlay';
        let navCss = `position:absolute;width:${nw}px;height:${nh}px;background:${c.navBgColor || 'rgba(22,33,62,0.95)'};z-index:1000;pointer-events:auto;`;
        switch (anchor) {
            case 'top':    navCss += `top:${oy}px;left:${ox}px;`; break;
            case 'bottom': navCss += `bottom:${oy}px;left:${ox}px;`; break;
            case 'left':   navCss += `top:${oy}px;left:${ox}px;`; break;
            case 'right':  navCss += `top:${oy}px;right:${ox}px;`; break;
        }
        navOverlay.style.cssText = navCss;

        // Nav 내부 layers — 각 layer 의 x,y 는 viewport 절대좌표이므로 nav rect 기준으로 변환
        const navRect = (() => {
            switch (anchor) {
                case 'top':    return { x: ox, y: oy };
                case 'bottom': return { x: ox, y: vh - nh - oy };
                case 'left':   return { x: ox, y: oy };
                case 'right':  return { x: vw - nh - ox, y: oy };
            }
            return { x: 0, y: 0 };
        })();

        const sceneAnimationItems = Array.isArray(c.sceneAnimations) ? c.sceneAnimations : [];
        this._timelineAnimationTargets = new Set();
        this._timelineEnterTargets = new Set();
        sceneAnimationItems.forEach(item => {
            if (item?.type !== 'object-animation' || !item.targetStableId || item.enabled === false) return;
            this._timelineAnimationTargets.add(item.targetStableId);
            const preset = getCssAnimationPreset(item.cssPresetId || item.presetId || 'fade-in');
            if ((preset?.phase || 'attention') === 'enter') this._timelineEnterTargets.add(item.targetStableId);
        });

        const sorted = [...(c.layers || [])].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        sorted.forEach(l => {
            const layerEl = this._buildLayerEl(l);
            // viewport 절대 좌표 → nav overlay 내부 좌표
            layerEl.style.left = `${(l.x || 0) - navRect.x}px`;
            layerEl.style.top  = `${(l.y || 0) - navRect.y}px`;
            navOverlay.appendChild(layerEl);
        });
        root.appendChild(navOverlay);

        this._rootEl = root;
        root.style.position = 'absolute';
        this._el = root;

        // 기본 탭 활성화 (matched scene 마운트)
        const defaultId = c.defaultTabId || (c.tabs && c.tabs[0] ? c.tabs[0].id : null);
        if (defaultId) {
            // _activeTab 을 null 로 두어 switchTab 이 실제로 동작하도록
            this._activeTab = null;
            this.switchTab(defaultId);
        }
    }

    /**
     * 레이어의 시각적 내부 컨텐츠 엘리먼트를 빌드해서 반환.
     * 에디터와 게임이 동일한 렌더링 코드를 공유하기 위한 단일 소스.
     *
     * @param {object} layer - contract 형식의 레이어 데이터
     * @returns {HTMLElement} 시각적 컨텐츠 엘리먼트 (component inner div 또는 image/wrapDiv)
     */
    buildVisual(layer) {
        const _sc = layer.scale || 1;
        const _sx = (layer.scaleX !== undefined ? layer.scaleX : 1) * _sc;
        const _sy = (layer.scaleY !== undefined ? layer.scaleY : 1) * _sc;
        const timelineControlsCss = !!(layer.stableId && this._timelineAnimationTargets?.has(layer.stableId));

        if (layer.layerType === 'confetti') {
            return this._buildConfettiVisual(layer, _sx, _sy);
        }

        if (layer.layerType === 'component' || layer.layerType === undefined) {
            const _v = { ...(layer.visual || {}) };
            if (layer.effects && !_v.effects) _v.effects = layer.effects;
            if (timelineControlsCss) {
                if (Array.isArray(_v.effects)) _v.effects = _v.effects.filter(e => e?.type !== 'css-animation');
                _v.cssAnimation = { ...(_v.cssAnimation || {}), enabled: false };
            }
            const _model = _v.model;
            const v = (_sx !== 1 || _sy !== 1)
                ? (_model
                    ? { ..._v, model: { ..._model, shape: { ...(_model.shape || {}), width: Math.round(((_model.shape?.width) || _v.width || 100) * _sx), height: Math.round(((_model.shape?.height) || _v.height || 40) * _sy) } } }
                    : { ..._v, width: Math.round((_v.width || 100) * _sx), height: Math.round((_v.height || 40) * _sy) })
                : _v;
            const inner = document.createElement('div');
            this._applyComponentVisual(inner, v);

            (layer.texts || []).forEach((t, i) => {
                const span = document.createElement('span');
                span.className = `text-${i}`;
                span.textContent = t.staticContent || '';
                span.style.cssText = this._textCss(t, _sx, _sy);
                if (t.bindingKey) {
                    if (t.staticContent && t.staticContent.includes('{value}')) span.dataset.bindingTemplate = t.staticContent;
                    if (!this._boundElements[t.bindingKey]) this._boundElements[t.bindingKey] = [];
                    this._boundElements[t.bindingKey].push(span);
                }
                inner.appendChild(span);
            });

            (v.images || []).forEach(im => {
                if (!im.exportPath) return;
                const filterStr = imageShadowCss(im.style || normalizeImageStyleModel(im));
                const _imZi = im.zIndex != null ? `z-index:${im.zIndex};` : '';
                const _imW = Math.round((im.width||32) * _sx);
                const _imH = Math.round((im.height||32) * _sy);
                const _imOx = Math.round((im.offsetX||0) * _sx);
                const _imOy = Math.round((im.offsetY||0) * _sy);
                const img = document.createElement('img');
                img.src = this._resolveAssetPath(im.exportPath);
                img.draggable = false;
                img.style.cssText = `position:absolute;pointer-events:none;object-fit:contain;width:${_imW}px;height:${_imH}px;left:calc(50% + ${_imOx}px);top:calc(50% + ${_imOy}px);transform:translate(-50%,-50%)${filterStr ? ';filter:'+filterStr : ''}${_imZi ? ';'+_imZi.slice(0,-1) : ''}`;
                if (im.imageKey) {
                    if (!this._boundImages[im.imageKey]) this._boundImages[im.imageKey] = [];
                    this._boundImages[im.imageKey].push(img);
                }
                inner.appendChild(img);
            });
            if (layer.image) {
                const img = document.createElement('img');
                img.src = this._resolveAssetPath(layer.image.exportPath || '');
                img.draggable = false;
                img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;pointer-events:none;';
                inner.appendChild(img);
            }
            return inner;

        } else if (layer.layerType === 'image') {
            const cssAnimation = timelineControlsCss
                ? { enabled: false }
                : (findEffect(layer.effects, 'css-animation') || normalizeCssAnimationEffect(layer));
            const particleEffect = findEffect(layer.effects, 'particle-effect') || normalizeParticleEffect(layer);
            const img = document.createElement('img');
            img.src = this._resolveAssetPath((layer.image?.exportPath) || (layer.visual?.exportPath) || '');
            img.draggable = false;
            if (layer.image?.imageKey) {
                if (!this._boundImages[layer.image.imageKey]) this._boundImages[layer.image.imageKey] = [];
                this._boundImages[layer.image.imageKey].push(img);
            }
            const iw = Math.round((layer.visual?.width || 64) * _sx) + 'px';
            const ih = Math.round((layer.visual?.height || 64) * _sy) + 'px';
            img.style.width = iw;
            img.style.height = ih;
            img.style.objectFit = 'contain';
            const imageStyle = layer.image?.style || layer.visual?.style || normalizeImageStyleModel(layer);
            img.style.filter = imageShadowCss(imageStyle);
            applyPressEffect(img, findEffect(layer.effects, 'press') || normalizePressEffect(layer), { baseFilter: img.style.filter || '' });
            if (layer.texts && layer.texts.length > 0) {
                const wrapDiv = document.createElement('div');
                wrapDiv.style.cssText = `position:relative;width:${iw};height:${ih};`;
                img.style.position = 'absolute'; img.style.top = '0'; img.style.left = '0';
                wrapDiv.appendChild(img);
                layer.texts.forEach(t => {
                    const span = document.createElement('span');
                    span.textContent = t.staticContent || '';
                    span.style.cssText = this._textCss(t, _sx, _sy);
                    if (t.bindingKey) {
                        if (t.staticContent && t.staticContent.includes('{value}')) span.dataset.bindingTemplate = t.staticContent;
                        if (!this._boundElements[t.bindingKey]) this._boundElements[t.bindingKey] = [];
                        this._boundElements[t.bindingKey].push(span);
                    }
                    wrapDiv.appendChild(span);
                });
                applyCssAnimationEffect(wrapDiv, cssAnimation);
                playParticleEffect(wrapDiv, particleEffect);
                return wrapDiv;
            }
            applyCssAnimationEffect(img, cssAnimation);
            playParticleEffect(img, particleEffect);
            return img;
        }
        return document.createElement('div');
    }

    // Confetti 레이어 시각화. 컨테이너 div 만 만들고, autoplay/loop 설정에 따라 파티클 재생.
    // triggerKey 가 있으면 data-confetti-trigger 부여 → playConfetti(key) 로 외부 트리거 가능.
    _buildConfettiVisual(layer, _sx, _sy) {
        const w = Math.round((layer.visual?.width || layer.width || 320) * (_sx || 1));
        const h = Math.round((layer.visual?.height || layer.height || 240) * (_sy || 1));
        const cfg = layer.confetti || layer.visual?.confetti || layer;
        const container = document.createElement('div');
        container.style.cssText = 'position:relative;width:' + w + 'px;height:' + h + 'px;overflow:visible;pointer-events:none;';
        if (cfg.triggerKey) container.dataset.confettiTrigger = cfg.triggerKey;
        const opts = {
            width: w, height: h,
            confettiPattern: cfg.confettiPattern || 'center-burst',
            particleCount: cfg.particleCount,
            duration: cfg.duration,
            spread: cfg.spread,
            velocity: cfg.velocity,
            colors: cfg.colors,
            sizeMin: cfg.sizeMin,
            sizeMax: cfg.sizeMax,
            shape: cfg.shape,
        };
        container._confettiOpts = opts;
        ensureConfettiKeyframes();
        const autoplay = cfg.autoplay !== false;
        if (autoplay || cfg.loop) {
            requestAnimationFrame(() => {
                spawnConfettiParticles(container, opts);
                if (cfg.loop) {
                    container._confettiLoopId = setInterval(() => {
                        spawnConfettiParticles(container, opts);
                    }, (opts.duration || 1800) + 200);
                }
            });
        }
        return container;
    }

    /** 외부에서 confetti 레이어를 트리거. triggerKey 일치하는 모든 컨테이너 재생. */
    playConfetti(triggerKey) {
        if (!this._rootEl) return;
        const sel = '[data-confetti-trigger="' + triggerKey + '"]';
        const els = this._rootEl.querySelectorAll(sel);
        els.forEach(c => {
            if (c._confettiOpts) spawnConfettiParticles(c, c._confettiOpts);
        });
    }

    _buildLayerEl(layer) {
        const wrap = document.createElement('div');
        wrap.dataset.stableId = layer.stableId;
        const _sc = layer.scale || 1;
        const _sx = (layer.scaleX !== undefined ? layer.scaleX : 1) * _sc;
        const _sy = (layer.scaleY !== undefined ? layer.scaleY : 1) * _sc;
        wrap.style.cssText = `position:absolute;left:${layer.x}px;top:${layer.y}px;z-index:${layer.zIndex};`;
        if (layer.visible === false) wrap.style.display = 'none';
        if (layer.stableId && this._timelineEnterTargets?.has(layer.stableId)) {
            wrap.style.visibility = 'hidden';
        }

        // Nav button role (navigation sceneType 의 layer 만 의미를 가짐)
        if (layer.navTabId) {
            const c = this._contract;
            const firstTabId = (c?.sceneType === 'navigation')
                ? (c.defaultTabId || (c.tabs && c.tabs[0] ? c.tabs[0].id : ''))
                : '';
            wrap.dataset.navTab = layer.navTabId;
            wrap.classList.toggle('active', layer.navTabId === firstTabId);
            wrap.style.cursor = 'pointer';
            wrap.addEventListener('click', () => this.switchTab(layer.navTabId));
        }

        const content = this.buildVisual(layer);
        // spinAnimation은 _applyComponentVisual 에서 visual 엘리먼트 자체에 적용된다 (단일 진입점).
        // 여기서는 layer.rotation (정적) 만 처리.
        if (layer.rotation) {
            const rotWrap = document.createElement('div');
            rotWrap.style.transform = `rotate(${layer.rotation}deg)`;
            rotWrap.style.transformOrigin = '50% 50%';
            rotWrap.appendChild(content);
            wrap.appendChild(rotWrap);
        } else {
            wrap.appendChild(content);
        }

        // Wire declared events
        (layer.events || []).forEach(ev => {
            wrap.addEventListener(ev.trigger || 'click', (e) => {
                const evtName = ev.eventName || (layer.stableId + ':' + (ev.trigger || 'click'));
                this._emit(evtName, { stableId: layer.stableId, originalEvent: e });
            });
        });

        return wrap;
    }

    _applyComponentVisual(el, v) {
        const model = componentModelFromVisual(v);
        const effects = componentEffectsFromVisual(v);
        const shape = model.shape || {};
        const fill = model.fill || {};
        const border = model.border || {};
        const mask = model.mask || {};
        const shapeType = shape.type || 'rectangle';
        const isCircle = shapeType === 'circle';
        const isPill = shapeType === 'pill';
        const isRibbon = shapeType === 'ribbon';
        const isNotch = shapeType === 'notch';
        const isRibbonL = shapeType === 'ribbon-left';
        const isNotchL = shapeType === 'notch-left';
        const isRing = shapeType === 'ring';
        const isHollowRect = shapeType === 'hollow-rect';
        const isHollow = isRing || isHollowRect;
        const w = (isCircle || isRing) ? Math.max(shape.width || 60, shape.height || 60) : (shape.width || 100);
        const h = (isCircle || isRing) ? Math.max(shape.width || 60, shape.height || 60) : (shape.height || 40);
        let radius = shape.radius || 0;
        if (isCircle || isRing) radius = w / 2;
        else if (isPill) radius = h / 2;
        else if (isRibbon || isRibbonL || isNotch || isNotchL) radius = 0;

        const bg = fill.type === 'none'           ? 'transparent'
            : fill.type === 'solid'               ? (fill.color1 || '#4a90d9')
            : fill.type === 'radial-gradient'     ? `radial-gradient(circle,${fill.color1},${fill.color2})`
            : fill.type === 'conic-gradient'      ? conicRaysCss(fill.color1, fill.color2, fill.rayCount)
            : fill.type === 'depth-gradient'      ? depthGradientCss(fill.color1 || '#4a90d9', fill.depthIntensity)
            : `linear-gradient(${fill.angle || 180}deg,${fill.color1 || '#4a90d9'},${fill.color2 || '#2e6ab4'})`;

        const isClipped = isRibbon || isNotch || isRibbonL || isNotchL;
        const { shadows, filterEffects } = componentShadowCss(model, isClipped);

        const ribbonNotch = shape.notch ?? 20;

        if (isHollow) {
            const oldBg = el.querySelector(':scope > .ribbon-bg-layer');
            if (oldBg) oldBg.remove();
            const thickness = shape.hollowThickness || 8;
            el.style.cssText = [
                `position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0;`,
                `width:${w}px;height:${h}px;border-radius:${radius}px;background:transparent;`,
                `border:${thickness}px solid ${fill.color1 || '#4a90d9'};`,
                shadows.length ? `box-shadow:${shadows.join(',')};` : '',
                border.width > 0 ? `outline:${border.width}px solid ${border.color || '#fff'};outline-offset:0;` : '',
            ].join('');
        } else if (isClipped) {
            // filter는 부모(el)에, clip-path는 자식(.ribbon-bg)에 분리
            // CSS 렌더링 순서: filter → clip-path 이므로 같은 엘리먼트에 두면 shadow가 잘림
            el.style.cssText = [
                `position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:visible;`,
                `width:${w}px;height:${h}px;`,
                filterEffects.length ? `filter:${filterEffects.join(' ')};` : '',
            ].join('');
            const clipPoly = isRibbon  ? `polygon(0% 0%,calc(100% - ${ribbonNotch}px) 0%,100% 50%,calc(100% - ${ribbonNotch}px) 100%,0% 100%)`
                : isRibbonL ? `polygon(${ribbonNotch}px 0%,100% 0%,100% 100%,${ribbonNotch}px 100%,0% 50%)`
                : isNotchL  ? `polygon(0% 0%,100% 0%,100% 100%,0% 100%,${ribbonNotch}px 50%)`
                :              `polygon(0% 0%,100% 0%,calc(100% - ${ribbonNotch}px) 50%,100% 100%,0% 100%)`;
            let bgEl = el.querySelector(':scope > .ribbon-bg-layer');
            if (!bgEl) { bgEl = document.createElement('div'); bgEl.className = 'ribbon-bg-layer'; el.insertBefore(bgEl, el.firstChild); }
            bgEl.style.cssText = [
                `position:absolute;inset:0;`,
                `background:${bg};`,
                shadows.length ? `box-shadow:${shadows.join(',')};` : '',
                border.width > 0 ? `border:${border.width}px solid ${border.color || '#fff'};` : '',
                `clip-path:${clipPoly};`,
            ].join('');
        } else {
            const oldBg = el.querySelector(':scope > .ribbon-bg-layer');
            if (oldBg) oldBg.remove();
            const maskCss = mask.enabled ? ringMaskCss(mask.innerPct, mask.outerPct) : '';
            el.style.cssText = [
                `position:relative;display:flex;align-items:center;justify-content:center;flex-shrink:0;`,
                `width:${w}px;height:${h}px;border-radius:${radius}px;background:${bg};`,
                `box-shadow:${shadows.join(',') || 'none'};`,
                border.width > 0 ? `border:${border.width}px solid ${border.color || '#fff'};` : '',
                maskCss ? `-webkit-mask-image:${maskCss};mask-image:${maskCss};` : '',
            ].join('');
        }

        // spin animation: 모든 shape branch 공통. cssText 이후에 추가하여 덮어씌움 방지.
        const cssAnimation = findEffect(effects, 'css-animation');
        const spin = findEffect(effects, 'spin');
        if (spin && spin.enabled && !cssAnimation?.enabled) {
            ensureSpinKeyframes();
            const dur = Math.max(0.001, (spin.timing?.durationMs || 10000) / 1000);
            const name = spin.params?.direction === 'ccw' ? 'ui-spin-rev' : 'ui-spin';
            el.style.animation = `${name} ${dur}s linear infinite`;
            el.style.transformOrigin = '50% 50%';
        } else {
            el.style.animation = '';
        }
        const press = findEffect(effects, 'press');
        const depth = modelShadow(model, 'depth-edge');
        applyPressEffect(el, press, {
            depthPx: press?.params?.useDepthOffset ? (depth.size || 0) : 0,
            normalShadow: el.style.boxShadow,
            pressedShadow: pressedComponentShadowCss(model),
        });
        applyCssAnimationEffect(el, cssAnimation);
        playParticleEffect(el, findEffect(effects, 'particle-effect'));
    }

    _textCss(t, sx = 1, sy = 1) {
        const style = t.style || normalizeTextStyleModel(t);
        const strokeStyle = style.stroke || {};
        const stroke = (strokeStyle.width || 0) > 0 ? `-webkit-text-stroke:${strokeStyle.width}px ${strokeStyle.color || '#000'};paint-order:stroke fill;` : '';
        const shadow = buildTextShadowValue(t);
        const zi = t.zIndex != null ? `z-index:${t.zIndex};` : '';
        const fs = Math.round((t.fontSize || 14) * sx);
        const ox = Math.round((t.offsetX || 0) * sx);
        const oy = Math.round((t.offsetY || 0) * sy);
        return `position:absolute;white-space:nowrap;pointer-events:none;line-height:1.2;font-size:${fs}px;font-weight:${t.fontWeight || 'bold'};font-family:${t.fontFamily || 'Arial,sans-serif'};color:${t.color || '#fff'};text-shadow:${shadow};left:calc(50% + ${ox}px);top:calc(50% + ${oy}px);transform:translate(-50%,-50%);${stroke}${zi}`;
    }

    _applyBackground(el, bg) {
        if (!bg) return;
        // 이전 호출 잔류 제거: scroll 클래스/animation 항상 초기화 후 필요시 다시 부여
        if (el.classList) el.classList.remove('sr-bg-scroll');
        el.style.animation = '';
        // brick async 합성 콜백의 stale-guard 용 stamp 매 호출 무효화 (brick 분기에서만 새 값으로 갱신)
        if (el.dataset) el.dataset.bgStamp = '';
        if (bg.type === 'none') { el.style.background = 'transparent'; el.style.backgroundImage = 'none'; return; }
        if (bg.type === 'solid') el.style.background = bg.color || '#16213e';
        else if (bg.type === 'linear-gradient') el.style.background = `linear-gradient(${bg.gradientAngle || 180}deg,${bg.color},${bg.color2})`;
        else if (bg.type === 'image-tile') {
            const ts = bg.tileSize || 64;
            el.style.background = `${bg.color} url('${this._resolveAssetPath(bg.imagePath)}') repeat`;
            el.style.backgroundSize = `${ts}px ${ts}px`;
            // tile: 1 cycle = 1 tile 이라 tilesPerCycle = 1
            this._applyBgScroll(el, bg, ts, ts, 1);
        }
        else if (bg.type === 'image-brick') {
            const bh = bg.tileSize || 64;
            const resolved = this._resolveAssetPath(bg.imagePath);
            // 합성 완료 전 fallback: 단색 + 잔류 multi-bg 흔적 제거
            el.style.backgroundColor = bg.color || '#16213e';
            el.style.backgroundImage = 'none';
            el.style.backgroundRepeat = '';
            el.style.backgroundPosition = '';
            el.style.backgroundSize = '';
            if (!resolved) return;
            // stale guard — 합성이 끝났을 때 사용자가 다른 type/이미지로 갱신했으면 무시
            const stamp = `${bg.type}|${resolved}|${bh}`;
            el.dataset.bgStamp = stamp;
            const self = this;
            // bw 는 이미지 자연 비율 기반으로 helper 안에서 결정되어 result.bw 로 전달됨
            buildBrickTileDataUrl(resolved, bh, ({ dataUrl, bw }) => {
                if (el.dataset.bgStamp !== stamp) return;
                el.style.backgroundColor = bg.color || '#16213e';
                el.style.backgroundImage = `url('${dataUrl}')`;
                el.style.backgroundSize = `${bw * 2}px ${bh * 2}px`;
                el.style.backgroundRepeat = 'repeat';
                el.style.backgroundPosition = '0 0';
                // 합성 타일 = 2 brick (가로) × 2 brick (세로) → tilesPerCycle = 2
                self._applyBgScroll(el, bg, bw * 2, bh * 2, 2);
            });
        }
        else if (bg.type === 'image-stretch') { el.style.background = `${bg.color} url('${this._resolveAssetPath(bg.imagePath)}') no-repeat center`; el.style.backgroundSize = bg.stretchMode || 'cover'; }
    }

    // 무한 스크롤 적용 (tile/brick 공용). cycleW/cycleH 는 1 cycle 당 background-position 변화 px.
    // tilesPerCycle: 1 cycle 이 시각적으로 몇 개의 "타일/벽돌"을 지나가는지 (tile=1, brick=2).
    // 사용자가 입력한 "초/타일" × tilesPerCycle = animation-duration.
    _applyBgScroll(el, bg, cycleW, cycleH, tilesPerCycle) {
        if (!bg.scrollEnabled) return;
        const dir = BG_SCROLL_DIRS[bg.scrollDirection];
        if (!dir) return;
        const [ux, uy] = dir;
        const dx = Math.round(ux * cycleW);
        const dy = Math.round(uy * cycleH);
        if (dx === 0 && dy === 0) return;
        const perTile = Math.max(0.5, Math.min(60, Number(bg.scrollDuration) || 4));
        const tpc = Math.max(1, tilesPerCycle | 0);
        const duration = perTile * tpc;
        const id = ensureBgScrollKeyframes(dx, dy);
        if (!id) return;
        if (el.classList) el.classList.add('sr-bg-scroll');
        el.style.animation = `${id} ${duration}s linear infinite`;
    }

    _injectCSS(_scrollMode = false) {
        if (this._styleEl) return;
        // 사일런스 스크롤바 (WebKit) — 일반/nav 양쪽 모두 적용
        const css = `.sr-scroll-inner::-webkit-scrollbar { display:none; }\n`;
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
        this._styleEl = style;
    }

    /** basePath를 이미지 경로에 붙임. data: URL이나 절대 URL은 건드리지 않음. */
    _resolveAssetPath(path) {
        if (!path || !this._basePath) return path;
        if (path.startsWith('data:') || path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) return path;
        return this._basePath.replace(/\/?$/, '/') + path;
    }

    _flattenPaths(obj, prefix = '') {
        const result = {};
        for (const [k, v] of Object.entries(obj)) {
            const path = prefix ? `${prefix}.${k}` : k;
            if (v !== null && v !== undefined && typeof v === 'object' && !Array.isArray(v)) {
                Object.assign(result, this._flattenPaths(v, path));
            } else {
                result[path] = v;
            }
        }
        return result;
    }
}

// ── Public Utils ──────────────────────────────────────────────────────────────
// ui-editor.html 에서 직접 참조할 수 있도록 렌더링 유틸리티를 공개 API로 노출.
// scene-renderer.js = 렌더링 로직의 단일 소스 (Single Source of Truth).
SceneRenderer.utils = {
    /** depth-gradient CSS 문자열 생성 */
    depthGradientCss,
    /** 회전 레이용 conic-gradient CSS */
    conicRaysCss,
    /** 링 형태 페이드 mask CSS */
    ringMaskCss,
    /** ui-spin keyframes 1회 주입 */
    ensureSpinKeyframes,
    /** confetti keyframes 1회 주입 */
    ensureConfettiKeyframes,
    /** confetti 파티클을 컨테이너에 spawn (에디터 미리보기 버튼에서 직접 호출) */
    spawnConfettiParticles,
    /** 컴포넌트 엘리먼트에 visual 스타일 적용 (texts/images 처리 제외) */
    applyComponentVisual(el, visual) {
        SceneRenderer.prototype._applyComponentVisual.call(null, el, visual);
    },
    /**
     * 씬 배경 스타일 적용 (contract bg 형식: type, color, color2, gradientAngle, imagePath, tileSize, stretchMode)
     * @param {function} [resolveAsset] - 이미지 경로 변환 함수 (기본값: 항등함수)
     */
    applyBackground(el, bg, resolveAsset) {
        const ctx = {
            _resolveAssetPath: resolveAsset || ((p) => p),
            _applyBgScroll: SceneRenderer.prototype._applyBgScroll,
        };
        SceneRenderer.prototype._applyBackground.call(ctx, el, bg);
    },
    /** 텍스트 슬롯 CSS 문자열 반환 */
    textCss(t) {
        return SceneRenderer.prototype._textCss.call(null, t);
    },
    /** 텍스트 text-shadow 값 단일 소스 (CSS export 등 외부 호출용) */
    textShadowValue: buildTextShadowValue,
    normalizeComponentVisualModel,
    normalizeTextStyleModel,
    normalizeImageStyleModel,
    imageShadowCss,
    findEffect,
    componentShadowCss,
    pressedComponentShadowCss,
    cssAnimationPresets: CSS_ANIMATION_PRESETS,
    particleEffectPresets: PARTICLE_EFFECT_PRESETS,
    cssEffectProviderStyles: CSS_EFFECT_PROVIDER_STYLES,
    effectProviderScripts: EFFECT_PROVIDER_SCRIPTS,
    normalizeCssAnimationEffect,
    applyCssAnimationEffect,
    normalizeParticleEffect,
    applyAmbientSparkleAura,
    playParticleEffect,
    /**
     * 저장된 컴포넌트/그룹 데이터 → 미리보기용 씬 객체 변환 (canvasWidth/canvasHeight/layers).
     * 그룹 템플릿(x_rel 포함)과 단일 컴포넌트 state를 모두 처리하며, 그룹 내부의 zIndex 순서를 보존한다.
     * @param {object} data - 그룹 템플릿({layers:[{x_rel,y_rel,zIndex,...}]}) 또는 단일 컴포넌트 state
     * @param {object} [opts] - { pad?: number }
     */
    componentDataToScene(data, opts) {
        const PAD = (opts && opts.pad != null) ? opts.pad : 16;
        if (Array.isArray(data.layers) && 'x_rel' in (data.layers[0] || {})) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const l of data.layers) {
                const cs = l.componentState;
                const w = cs ? (cs.shapeType === 'circle' ? Math.max(cs.width, cs.height) : cs.width) : (l.width || 60);
                const h = cs ? (cs.shapeType === 'circle' ? Math.max(cs.width, cs.height) : cs.height) : (l.height || 40);
                minX = Math.min(minX, l.x_rel || 0); minY = Math.min(minY, l.y_rel || 0);
                maxX = Math.max(maxX, (l.x_rel || 0) + w); maxY = Math.max(maxY, (l.y_rel || 0) + h);
            }
            return {
                canvasWidth: Math.max(maxX - minX + PAD * 2, 80),
                canvasHeight: Math.max(maxY - minY + PAD * 2, 40),
                bgType: 'none', name: data.name,
                layers: data.layers.map((l, i) => ({
                    ...l, id: i + 1,
                    x: (l.x_rel || 0) - minX + PAD,
                    y: (l.y_rel || 0) - minY + PAD,
                    zIndex: l.zIndex != null ? l.zIndex : (i + 1),
                    visible: true, tabIds: [], events: [],
                })),
            };
        }
        const cw = data.shapeType === 'circle' ? Math.max(data.width || 120, data.height || 48) : (data.width || 120);
        const ch = data.shapeType === 'circle' ? Math.max(data.width || 120, data.height || 48) : (data.height || 48);
        return {
            canvasWidth: cw + PAD * 2, canvasHeight: ch + PAD * 2, bgType: 'none', name: data.name,
            layers: [{
                id: 1, type: 'component', name: data.name || 'Component',
                componentState: data,
                x: PAD, y: PAD, scale: 1, scaleX: 1, scaleY: 1,
                zIndex: 1, visible: true, tabIds: [], events: [],
            }],
        };
    },

    /**
     * 에디터 레이어 + 해석된 컴포넌트 state → contract 레이어 변환
     * @param {object} layer  - 에디터 씬 레이어 객체
     * @param {object|null} cs - 해석된 componentState (호출자가 전달)
     */
    layerToContractLayer(layer, cs) {
        const slug = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layer';
        const stableId = layer.stableId || (slug(cs ? cs.name : (layer.name || 'layer')) + '-' + (layer.id || Math.random().toString(36).slice(2)));
        const visual = cs
            ? (({ texts: _t, selectedTextIndex: _i, selectedImageIndex: _ii, name: _n, ...v }) => v)(cs)
            : { exportPath: layer.exportPath || '', width: layer.width || 64, height: layer.height || 64 };
        const textSrc = layer.type === 'image' ? (layer.texts || []) : (cs ? cs.texts || [] : []);
        // confetti 레이어는 visual 에 width/height + confetti 옵션을 묶어 전달
        const isConfetti = layer.type === 'confetti';
        const normalizedComponent = layer.type === 'component' ? normalizeComponentVisualModel(visual) : null;
        const normalizedImageStyle = layer.type === 'image' ? normalizeImageStyleModel(layer) : null;
        const confettiVisual = isConfetti ? {
            width: layer.width || 320, height: layer.height || 240,
            confetti: {
                confettiPattern: layer.confettiPattern || 'center-burst',
                particleCount: layer.particleCount,
                duration: layer.duration,
                spread: layer.spread, velocity: layer.velocity,
                colors: layer.colors, sizeMin: layer.sizeMin, sizeMax: layer.sizeMax,
                shape: layer.shape,
                autoplay: layer.autoplay !== false,
                loop: !!layer.loop,
                triggerKey: layer.triggerKey || '',
            },
        } : null;
        const contractVisual = isConfetti ? confettiVisual
            : layer.type === 'component' ? {
                model: normalizedComponent.visualModel,
                images: (visual.images || []).map(im => ({
                    exportPath: im.exportPath || '',
                    imageKey: im.imageKey || '',
                    width: im.width || 32,
                    height: im.height || 32,
                    offsetX: im.offsetX || 0,
                    offsetY: im.offsetY || 0,
                    zIndex: im.zIndex,
                    style: normalizeImageStyleModel(im),
                })),
            }
            : {
                exportPath: layer.exportPath || '',
                width: layer.width || 64,
                height: layer.height || 64,
                style: normalizedImageStyle,
            };
        let effects = isConfetti ? [{
            type: 'confetti',
            source: { provider: 'internal', name: 'confetti' },
            enabled: true,
            target: 'self',
            trigger: layer.triggerKey ? 'manual' : 'mount',
            params: {
                pattern: layer.confettiPattern || 'center-burst',
                particleCount: layer.particleCount,
                durationMs: layer.duration,
                spread: layer.spread,
                velocity: layer.velocity,
                colors: layer.colors,
                sizeMin: layer.sizeMin,
                sizeMax: layer.sizeMax,
                shape: layer.shape,
                autoplay: layer.autoplay !== false,
                loop: !!layer.loop,
                triggerKey: layer.triggerKey || '',
            },
        }] : layer.type === 'component' ? normalizedComponent.effects
            : layer.type === 'image' ? [normalizePressEffect(layer), normalizeCssAnimationEffect(layer), normalizeParticleEffect(layer)]
            : [];
        if (!isConfetti) effects = effects.filter(effect => effect?.enabled !== false);
        const contractLayer = {
            stableId,
            layerType: layer.type,
            displayName: cs ? cs.name : (layer.name || ''),
            x: layer.x || 0, y: layer.y || 0,
            scale: layer.scale || 1, scaleX: layer.scaleX ?? 1, scaleY: layer.scaleY ?? 1,
            zIndex: layer.zIndex || 1, visible: layer.visible !== false,
            tabIds: layer.tabIds || [], navTabId: layer.navTabId || null, targetTabId: layer.targetTabId || null,
            visual: contractVisual,
            effects,
            texts: textSrc.map((t, i) => ({
                slotIndex: i, staticContent: t.content || '', bindingKey: t.bindingKey || '',
                fontSize: t.fontSize, fontWeight: t.fontWeight, fontFamily: t.fontFamily || 'inherit',
                color: t.color,
                offsetX: t.offsetX, offsetY: t.offsetY, zIndex: t.zIndex,
                style: normalizeTextStyleModel(t),
            })),
            image: layer.type === 'image' ? { exportPath: layer.exportPath || '', imageKey: layer.imageKey || '', style: normalizedImageStyle } : null,
            rotation: layer.rotation || 0,
            events: (layer.events || []).map(ev => ({
                trigger: ev.trigger,
                eventName: ev.eventName || (stableId + ':' + (ev.trigger || 'click')),
            })),
        };
        if (contractLayer.scale === 1) delete contractLayer.scale;
        if (contractLayer.scaleX === 1) delete contractLayer.scaleX;
        if (contractLayer.scaleY === 1) delete contractLayer.scaleY;
        if (contractLayer.visible === true) delete contractLayer.visible;
        if (!contractLayer.tabIds.length) delete contractLayer.tabIds;
        if (!contractLayer.navTabId) delete contractLayer.navTabId;
        if (!contractLayer.targetTabId) delete contractLayer.targetTabId;
        if (!contractLayer.effects.length) delete contractLayer.effects;
        if (!contractLayer.texts.length) delete contractLayer.texts;
        if (Array.isArray(contractLayer.visual?.images)) {
            contractLayer.visual.images.forEach(im => {
                if (!im.imageKey) delete im.imageKey;
                if (im.style?.shadow?.enabled === false) delete im.style;
            });
            if (!contractLayer.visual.images.length) delete contractLayer.visual.images;
        }
        if (contractLayer.visual?.style?.shadow?.enabled === false) delete contractLayer.visual.style;
        if (contractLayer.image?.style?.shadow?.enabled === false) delete contractLayer.image.style;
        if (contractLayer.image && !contractLayer.image.imageKey) delete contractLayer.image;
        if (contractLayer.image === null) delete contractLayer.image;
        if (contractLayer.rotation === 0) delete contractLayer.rotation;
        if (!contractLayer.events.length) delete contractLayer.events;
        return contractLayer;
    },
};

// <script type="module" src="scene-renderer.js"> 로 로드 시 전역 접근 가능하도록 노출
if (typeof window !== 'undefined') window.SceneRenderer = SceneRenderer;
