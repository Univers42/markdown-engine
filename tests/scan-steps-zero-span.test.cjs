/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   scan-steps-zero-span.test.cjs                      :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/11/21          by dlesieur          #+#    #+#             */
/*   Updated: 2026/11/21          by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

// ADR 0068 D14 review S1: countSteps throws on a negative or fractional count, and
// it runs inside the production parse. Each construct below makes one counted span
// exactly 0 (parserInlineMatchers.ts: `(a)[]` :129, `[^]` :224, `[a][]` :398,
// `![]` :425, `![a][]` :432, `[color=]` :688, `<>` :918), so an off-by-one there
// would turn a miscount into a page that fails to render. This test fails first.
// The reference matchers (:398, :425, :432) run only when the document defines a
// reference, so each construct is also parsed above a definition.
// It loads bench/scanEntry.ts, the one bundle where parse, render and the counter
// share state (D6).

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadMarkengineInRealm } = require("./support/loadMarkengine.cjs");

const { parse, renderReact, readSteps, resetSteps } = loadMarkengineInRealm("bench/scanEntry.ts");

const ZERO_SPAN = ["(a)[]", "[^]", "[a][]", "![]", "![a][]", "[color=]x[/color]", "<>", "&lt;&gt;", "![]["];
const MODES = [
  { name: "plain", parseOptions: undefined, renderOptions: undefined },
  { name: "html subset", parseOptions: { htmlSubset: true }, renderOptions: { htmlSubset: { mediaPrefixes: [] } } },
];

function stepsOf(source, mode) {
  resetSteps();
  renderReact(parse(source, mode.parseOptions), mode.renderOptions);
  return readSteps();
}

for (const construct of ZERO_SPAN) {
  for (const mode of MODES) {
    test(`${JSON.stringify(construct)} parses and renders (${mode.name}) with steps >= 0`, () => {
      for (const source of [construct, `before ${construct} after`, `${construct}\n\n[a]: https://example.com/a`]) {
        let steps = -1;
        assert.doesNotThrow(() => {
          steps = stepsOf(source, mode);
        }, `parse+render threw on ${JSON.stringify(source)}`);
        assert.ok(Number.isInteger(steps) && steps >= 0, `steps ${steps} on ${JSON.stringify(source)}`);
      }
    });
  }
}
