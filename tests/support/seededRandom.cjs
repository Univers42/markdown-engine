"use strict";

// The one seeded generator for fuzz tests: an LCG, so a failing seed is a repro,
// never a flake. Not for anything that needs real randomness.
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

module.exports = { createRandom };
