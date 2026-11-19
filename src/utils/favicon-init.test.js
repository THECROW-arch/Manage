import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../../public/favicon-init.js', import.meta.url), 'utf8');

function setup({ loading = false, rounded = true, contextMissing = false, linkMissing = false } = {}) {
    let img;
    let listener;
    const calls = [];
    const ctx = Object.fromEntries(['beginPath', 'rect', 'fill', 'stroke', 'drawImage', ...(rounded ? ['roundRect'] : [])]
        .map(name => [name, (...args) => calls.push([name, ...args])]));
    const link = { href: '/favicon.png' };
    const canvas = { getContext: () => contextMissing ? null : ctx, toDataURL: type => {
        assert.equal(type, 'image/png');
        return 'data:image/png;base64,synthetic';
    } };
    runInNewContext(source, {
        Image: class { constructor() { img = this; this.width = 210; this.height = 105; } },
        document: {
            readyState: loading ? 'loading' : 'complete',
            createElement(tag) { assert.equal(tag, 'canvas'); return canvas; },
            getElementById(id) { assert.equal(id, 'dynamic-favicon'); return linkMissing ? null : link; }
        },
        window: { addEventListener(event, callback, options) {
            assert.equal(event, 'DOMContentLoaded');
            assert.equal(options.once, true);
            listener = callback;
        } }
    });
    return { get img() { return img; }, start: () => listener(), calls, canvas, link, ctx };
}

for (const rounded of [true, false]) {
    test(`favicon renders a centered crop with ${rounded ? 'rounded' : 'fallback rectangular'} badge`, () => {
        const fixture = setup({ rounded });
        assert.equal(fixture.img.src, '/favicon.png');
        assert.equal(fixture.link.href, '/favicon.png');
        fixture.img.onload();
        assert.equal(fixture.canvas.width, 64);
        assert.equal(fixture.canvas.height, 64);
        assert.equal(fixture.ctx.fillStyle, '#F8FAFC');
        assert.equal(fixture.ctx.strokeStyle, '#10B981');
        assert.deepEqual(fixture.calls.find(([name]) => name === (rounded ? 'roundRect' : 'rect')),
            rounded ? ['roundRect', 2, 2, 60, 60, 16] : ['rect', 2, 2, 60, 60]);
        assert.deepEqual(fixture.calls.find(([name]) => name === 'drawImage'),
            ['drawImage', fixture.img, 55, 27.5, 100, 50, 4, 4, 56, 56]);
        assert.equal(fixture.link.href, 'data:image/png;base64,synthetic');
    });
}

test('loading document waits for DOMContentLoaded before creating the image', () => {
    const fixture = setup({ loading: true });
    assert.equal(fixture.img, undefined);
    fixture.start();
    assert.equal(fixture.img.src, '/favicon.png');
});

test('missing canvas context preserves the static favicon', () => {
    const fixture = setup({ contextMissing: true });
    assert.doesNotThrow(() => fixture.img.onload());
    assert.equal(fixture.link.href, '/favicon.png');
    assert.equal(fixture.calls.length, 0);
});

test('missing favicon link is harmless', () => {
    const fixture = setup({ linkMissing: true });
    assert.doesNotThrow(() => fixture.img.onload());
});
