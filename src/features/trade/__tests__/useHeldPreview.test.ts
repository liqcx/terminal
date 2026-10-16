// @vitest-environment jsdom
import { Margin, Price, Usd } from '@liq/sdk';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useHeldPreview } from '../useHeldPreview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FRESH = { r1: Margin(Usd.parse("3500")), liq: Price.parse('66750') };

let container: HTMLDivElement;
let root: Root;

function Probe(props: { refreshing: boolean }) {
	const shown = useHeldPreview('k', FRESH, false, props.refreshing);
	return createElement('span', { id: 'out' }, shown.stale ? 'stale' : 'bright');
}

const out = () => container.querySelector('#out')?.textContent;
const render = (refreshing: boolean) =>
	act(() => root.render(createElement(Probe, { refreshing })));

beforeEach(() => {
	container = document.createElement('div');
	root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

describe('useHeldPreview: флаг `refreshing` из SDK доходит до строк', () => {
	it('плановый опрос (refreshing=false) — цифры яркие', () => {
		render(false);
		expect(out()).toBe('bright');
	});

	it('перечитывание после события счёта (refreshing=true) — строки stale, по окончании снова яркие', () => {
		render(true);
		expect(out()).toBe('stale');
		render(false);
		expect(out()).toBe('bright');
	});
});
