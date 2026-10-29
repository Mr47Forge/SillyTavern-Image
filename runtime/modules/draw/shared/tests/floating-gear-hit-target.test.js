import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../providers/comfyui/floating-panel.js', import.meta.url), 'utf8');

test('floating menu opens at a stationary gear hit target with opacity-only animation', () => {
    const normal = /\.nd-floating-global \.nd-menu\s*\{([^}]+)\}/u.exec(source)?.[1];
    const expanded = /\.nd-floating-global\.expanded \.nd-menu\s*\{([^}]+)\}/u.exec(source)?.[1];
    assert.ok(normal, 'global menu styles exist');
    assert.ok(expanded, 'expanded menu styles exist');
    assert.match(normal, /transform:\s*none\s*;/u);
    assert.match(expanded, /transform:\s*none\s*;/u);
    assert.match(normal, /transition:\s*opacity\s+[\d.]+s/u);
    assert.doesNotMatch(normal, /translate|scale|transition:\s*all/u);
    assert.doesNotMatch(expanded, /translate|scale/u);
});
