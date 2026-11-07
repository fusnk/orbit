/*
 * Orbit website: the liquid glass lens. A glass surface reads the page behind it through a slab of glass whose top
 * curves into a rounded rim, so the page bends and splits into colour along the edge. CSS (styles.css) gives each
 * surface its strength through --glass-lens-* tokens; this writes --glass-lens (an SVG filter for backdrop-filter)
 * and data-glass-lens="on". Only Chromium renders an SVG filter in backdrop-filter; Safari and Firefox keep the
 * frosted glass in styles.css.
 *
 * The optics are Glassy UI's (lib/refraction-map.ts and lib/use-refraction-filter.tsx), ported from React.
 * Copyright (c) 2026 Glassy UI contributors, MIT License: https://github.com/alexburlis/glassyui
 *
 * Full licence text: LICENSE-glassyui.txt
 */
(() => {
'use strict';
const LENS_SURFACES = '.top-bar, .btn, .looks button, .pane, .sources, .paste, .trust > div, .glass-panel, .sun';
const AIR_GAP = 8;
const MIN_RISE = 0.3;
const RISE_SPAN = 0.7;
const MAX_SLOPE = 12;
const REACH = 0.7;
const FOLD = 0.75;
const STEPS = 512;
const RIM_LIGHT = 0.8;
const RIM_LIGHT_SURFACE = 0.16;
const RIM_LIGHT_FALLOFF = 0.45;
const MAX_MAP_PIXELS = 420000;
const MAX_LENS_AREA = 720000;
const BEVEL = 36;
const THICKNESS_RATIO = 1.4;
const MIN_FROST = 0.5;
const clamp = (value, min, max)=>Math.min(Math.max(value, min), max);
function smoothstep(from, to, value) {
    const t = clamp((value - from) / Math.max(to - from, 0.0001), 0, 1);
    return t * t * (3 - 2 * t);
}
function slabOffset(s, bevel, thickness, ior) {
    const u = s / bevel;
    const v = 1 - Math.max(u, 0.002);
    let rise = 1;
    let steepness = 0;
    if (u < 1) {
        const v4 = v ** 4;
        rise = (1 - v4) ** 0.25;
        steepness = v ** 3 * Math.max(1 - v4, 1e-6) ** -0.75;
    }
    const slope = Math.min(RISE_SPAN * thickness / bevel * steepness, MAX_SLOPE);
    const height = thickness * (MIN_RISE + RISE_SPAN * rise);
    const tilt = Math.hypot(slope, 1);
    const sinTilt = slope / tilt;
    const cosTilt = 1 / tilt;
    const eta = 1 / ior;
    const root = Math.sqrt(Math.max(1 - eta * eta * sinTilt * sinTilt, 0));
    const bend = eta * cosTilt - root;
    const along = bend * sinTilt;
    const down = Math.max(eta - bend * cosTilt, 0.05);
    const sinOut = ior * Math.abs(along);
    const cosOut = Math.sqrt(Math.max(1 - sinOut * sinOut, 0));
    const leaving = ior * along / Math.max(sinOut, 1);
    return -(along * (height / down) + leaving * (AIR_GAP / Math.max(cosOut, 0.1)));
}
function profile(bevel, thickness, ior, depth) {
    const cap = REACH * bevel;
    const step = bevel / STEPS;
    const offsets = new Float32Array(STEPS + 1);
    for(let index = 0; index < STEPS; index += 1){
        offsets[index] = cap * Math.tanh(depth * slabOffset(index * step, bevel, thickness, ior) / cap);
    }
    for(let index = STEPS - 1; index >= 0; index -= 1){
        offsets[index] = Math.min(offsets[index] ?? 0, (offsets[index + 1] ?? 0) + FOLD * step);
    }
    let reach = 0.01;
    for (const offset of offsets)reach = Math.max(reach, offset);
    return {
        offsets,
        reach
    };
}
function lensField(shape) {
    const width = Math.max(1, shape.width);
    const height = Math.max(1, shape.height);
    const bevel = clamp(shape.bevel, 1, Math.min(width, height) / 2);
    const ratio = clamp(shape.ratio, 1, 2);
    let mapWidth = clamp(Math.round(width * ratio), 32, 1800);
    let mapHeight = clamp(Math.round(height * ratio), 32, 1200);
    if (mapWidth * mapHeight > MAX_MAP_PIXELS) {
        const shrink = Math.sqrt(MAX_MAP_PIXELS / (mapWidth * mapHeight));
        mapWidth = Math.max(32, Math.floor(mapWidth * shrink));
        mapHeight = Math.max(32, Math.floor(mapHeight * shrink));
    }
    const { offsets, reach } = profile(bevel, shape.thickness, shape.ior, shape.depth);
    const litTo = Math.min(RIM_LIGHT, RIM_LIGHT_SURFACE * Math.min(width, height) / bevel);
    const litFrom = litTo * RIM_LIGHT_FALLOFF;
    const data = new Uint8ClampedArray(mapWidth * mapHeight * 4);
    const [topLeft, topRight, bottomRight, bottomLeft] = shape.radii;
    for(let row = 0; row < mapHeight; row += 1){
        const y = (row + 0.5) / mapHeight * height;
        for(let column = 0; column < mapWidth; column += 1){
            const x = (column + 0.5) / mapWidth * width;
            const px = x - width / 2;
            const py = y - height / 2;
            const radius = px < 0 ? py < 0 ? topLeft : bottomLeft : py < 0 ? topRight : bottomRight;
            const qx = Math.abs(px) - (width / 2 - radius);
            const qy = Math.abs(py) - (height / 2 - radius);
            const signX = px < 0 ? -1 : 1;
            const signY = py < 0 ? -1 : 1;
            let distance;
            let normalX = 0;
            let normalY = 0;
            if (qx > 0 && qy > 0) {
                const length = Math.hypot(qx, qy);
                distance = length - radius;
                normalX = signX * qx / length;
                normalY = signY * qy / length;
            } else if (qx > qy) {
                distance = qx - radius;
                normalX = signX;
            } else {
                distance = qy - radius;
                normalY = signY;
            }
            const inset = Math.max(-distance, 0);
            let offset = 0;
            if (inset < bevel) {
                const position = inset / bevel * STEPS;
                const lower = Math.floor(position);
                const fraction = position - lower;
                offset = (offsets[lower] ?? 0) * (1 - fraction) + (offsets[lower + 1] ?? 0) * fraction;
            }
            const index = (row * mapWidth + column) * 4;
            data[index] = Math.round(clamp(0.5 - offset * normalX / (2 * reach), 0, 1) * 255);
            data[index + 1] = Math.round(clamp(0.5 - offset * normalY / (2 * reach), 0, 1) * 255);
            data[index + 2] = Math.round((1 - smoothstep(litFrom, litTo, inset / bevel)) * 255);
            data[index + 3] = 255;
        }
    }
    return {
        data,
        mapWidth,
        mapHeight,
        reach
    };
}
const SVG = 'http://www.w3.org/2000/svg';
const lenses = new Map();
const used = new Map();
let holder = null;
let serial = 0;
function svg(tag, attrs) {
    const node = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attrs))node.setAttribute(name, String(value));
    return node;
}
function buildFilter(id, field, width, height, look) {
    const canvas = document.createElement('canvas');
    canvas.width = field.mapWidth;
    canvas.height = field.mapHeight;
    const pen = canvas.getContext('2d');
    if (!pen) throw new Error('No 2D canvas for the glass lens.');
    pen.putImageData(new ImageData(field.data, field.mapWidth, field.mapHeight), 0, 0);
    const frost = Math.max(look.blur, MIN_FROST);
    const pad = Math.ceil(frost * 3) + 2;
    const scale = Math.round(2 * field.reach * 100) / 100;
    const filter = svg('filter', {
        id,
        x: -pad,
        y: -pad,
        width: width + pad * 2,
        height: height + pad * 2,
        filterUnits: 'userSpaceOnUse',
        primitiveUnits: 'userSpaceOnUse',
        'color-interpolation-filters': 'sRGB'
    });
    filter.append(svg('feGaussianBlur', {
        in: 'SourceGraphic',
        stdDeviation: frost,
        result: 'frost'
    }), svg('feImage', {
        href: canvas.toDataURL('image/png'),
        x: 0,
        y: 0,
        width,
        height,
        preserveAspectRatio: 'none',
        result: 'lens'
    }));
    const bend = (result, factor)=>svg('feDisplacementMap', {
            in: 'frost',
            in2: 'lens',
            scale: Math.round(scale * factor * 100) / 100,
            xChannelSelector: 'R',
            yChannelSelector: 'G',
            result
        });
    if (look.dispersion <= 0.005) {
        filter.append(bend('bent', 1));
    } else {
        const keep = (from, values, result)=>svg('feColorMatrix', {
                in: from,
                type: 'matrix',
                values,
                result
            });
        filter.append(bend('red-scene', 1 - look.dispersion / 2), keep('red-scene', '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1', 'red'), bend('green-scene', 1), keep('green-scene', '0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 1', 'green'), bend('blue-scene', 1 + look.dispersion / 2), keep('blue-scene', '0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 0 1', 'blue'), svg('feBlend', {
            in: 'red',
            in2: 'green',
            mode: 'screen',
            result: 'red-green'
        }), svg('feBlend', {
            in: 'red-green',
            in2: 'blue',
            mode: 'screen',
            result: 'rgb'
        }), svg('feComposite', {
            in: 'rgb',
            in2: 'green-scene',
            operator: 'in',
            result: 'bent'
        }));
    }
    let glass = 'bent';
    if (look.rim > 0) {
        const lift = 1 + look.rim * 0.6;
        const lit = svg('feComponentTransfer', {
            in: 'bent',
            result: 'lit'
        });
        for (const channel of [
            'feFuncR',
            'feFuncG',
            'feFuncB'
        ])lit.append(svg(channel, {
            type: 'linear',
            slope: lift
        }));
        filter.append(lit, svg('feColorMatrix', {
            in: 'lens',
            type: 'matrix',
            values: '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0',
            result: 'rim'
        }), svg('feComposite', {
            in: 'lit',
            in2: 'rim',
            operator: 'in',
            result: 'rim-glass'
        }), svg('feComposite', {
            in: 'rim-glass',
            in2: 'bent',
            operator: 'over',
            result: 'glass'
        }));
        glass = 'glass';
    }
    if (look.saturation !== 1) filter.append(svg('feColorMatrix', {
        in: glass,
        type: 'saturate',
        values: look.saturation
    }));
    return filter;
}
function number(style, name, fallback) {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
}
function radius(value, width, height) {
    const most = Math.min(width, height) / 2;
    const first = value.trim().split(/\s+/)[0] ?? '0';
    const parsed = Number.parseFloat(first);
    if (!Number.isFinite(parsed)) return 0;
    return clamp(first.endsWith('%') ? parsed / 100 * Math.min(width, height) : parsed, 0, most);
}
function release(element) {
    const key = used.get(element);
    if (key === undefined) return;
    used.delete(element);
    if (element instanceof HTMLElement) {
        element.style.removeProperty('--glass-lens');
        delete element.dataset.glassLens;
    }
    const lens = lenses.get(key);
    if (lens && --lens.users <= 0) {
        lens.node.remove();
        lenses.delete(key);
    }
}
function fit(element) {
    const own = getComputedStyle(element);
    const depth = number(own, '--glass-lens-depth', 0);
    const pseudo = own.getPropertyValue('--glass-lens-box').trim() === 'before';
    const box = pseudo ? getComputedStyle(element, '::before') : own;
    const width = pseudo ? number(box, 'width', 0) : element.clientWidth;
    const height = pseudo ? number(box, 'height', 0) : element.clientHeight;
    if (depth <= 0 || width < 8 || height < 8 || width * height > MAX_LENS_AREA) return release(element);
    const radii = [
        radius(box.borderTopLeftRadius, width, height),
        radius(box.borderTopRightRadius, width, height),
        radius(box.borderBottomRightRadius, width, height),
        radius(box.borderBottomLeftRadius, width, height)
    ];
    const roundest = Math.max(...radii);
    const bevelToken = number(own, '--glass-lens-bevel', 0);
    const bevel = clamp(bevelToken > 0 ? bevelToken : clamp(roundest, 6, BEVEL), 4, Math.min(width, height) / 2);
    const look = {
        blur: Math.max(0, number(own, '--glass-lens-blur', 6)),
        saturation: number(own, '--glass-lens-saturation', 1.5),
        dispersion: clamp(number(own, '--glass-lens-dispersion', 0), 0, 1),
        rim: clamp(number(own, '--glass-lens-rim', 0), 0, 1)
    };
    const shape = {
        width,
        height,
        radii,
        bevel,
        thickness: bevel * THICKNESS_RATIO,
        ior: Math.max(1, number(own, '--glass-lens-ior', 1.5)),
        depth,
        ratio: window.devicePixelRatio || 1
    };
    const key = [
        Math.round(width),
        Math.round(height),
        ...radii.map(Math.round),
        Math.round(bevel),
        shape.ior,
        depth,
        look.blur,
        look.saturation,
        look.dispersion,
        look.rim
    ].join(':');
    if (used.get(element) === key) return;
    release(element);
    let lens = lenses.get(key);
    if (!lens) {
        if (!holder) {
            holder = svg('svg', {
                width: 0,
                height: 0,
                'aria-hidden': 'true',
                style: 'position:absolute;width:0;height:0;pointer-events:none'
            });
            document.body.append(holder);
        }
        const id = `glass-lens-${++serial}`;
        try {
            lens = {
                id,
                node: buildFilter(id, lensField(shape), width, height, look),
                users: 0
            };
        } catch  {
            return;
        }
        holder.append(lens.node);
        lenses.set(key, lens);
    }
    lens.users += 1;
    used.set(element, key);
    element.style.setProperty('--glass-lens', `url(#${lens.id})`);
    element.dataset.glassLens = 'on';
}
function lensSupported(userAgent = navigator.userAgent) {
    return /Chrom(e|ium)\//.test(userAgent) && !/\bAndroid\b/.test(userAgent);
}
function startGlassLenses() {
    if (!lensSupported() || typeof ResizeObserver !== 'function' || typeof MutationObserver !== 'function') return;
    const root = document.documentElement;
    const watched = new Set();
    const dirty = new Set();
    let frame = 0;
    let sweep = false;
    const flush = ()=>{
        frame = 0;
        if (sweep) {
            sweep = false;
            const on = true;
            for (const element of watched){
                if (!element.isConnected || !on) {
                    resizes.unobserve(element);
                    watched.delete(element);
                    release(element);
                } else {
                    dirty.add(element);
                }
            }
            if (on) {
                for (const element of document.querySelectorAll(LENS_SURFACES)){
                    if (watched.has(element)) continue;
                    watched.add(element);
                    resizes.observe(element);
                    dirty.add(element);
                }
            }
        }
        for (const element of dirty)if (element.isConnected) fit(element);
        dirty.clear();
    };
    const schedule = ()=>{
        frame ||= requestAnimationFrame(flush);
    };
    const resizes = new ResizeObserver((entries)=>{
        for (const entry of entries)if (entry.target instanceof HTMLElement) dirty.add(entry.target);
        schedule();
    });
    const changes = new MutationObserver(()=>{
        sweep = true;
        schedule();
    });
    changes.observe(document.body, {
        childList: true,
        subtree: true
    });
    sweep = true;
    schedule();
}

if (!matchMedia('(prefers-reduced-transparency: reduce)').matches) startGlassLenses();
})();
