/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   scanEntry.ts                                        :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/11/20          by dlesieur          #+#    #+#             */
/*   Updated: 2026/11/20          by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

// ADR 0068 D6: one entry, one counter. index.ts and react.tsx are two package
// entries, so loading each as its own esbuild bundle made two copies of
// markdown/scanSteps.ts and split the steps between the two counters. This
// bench-only module is the single thing the guard loads: parse, render and
// the counter land in ONE bundle, so readSteps() sees every counted scan of
// one render. Not in package.json "exports", never to be added (D5): it
// re-exports the counter that no package entry may expose.
import { installCheckingCountSteps } from "../markdown/scanSteps";

installCheckingCountSteps();

export { parse } from "../index";
export { renderReact } from "../react";
export { readSteps, resetSteps } from "../markdown/scanSteps";
