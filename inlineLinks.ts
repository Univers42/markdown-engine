/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   inlineLinks.ts                                     :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: rstancu <rstancu@student.42madrid.com>     +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/04/16 22:23:55 by rstancu           #+#    #+#             */
/*   Updated: 2026/04/16 22:23:56 by rstancu          ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

const LINE_TERMINATOR = /[\n\r\u2028\u2029]/;
const HOST_PREFIX = /^[^\s/]*/;

/**
 * Answers exactly what the regex it replaced answered (kept as the oracle in
 * tests/link-href-linear.test.cjs), in one pass: that regex was cubic on `.?`×N + `\r`
 * (osionos#240 S1). Its `.*` could not cross a line terminator, so one
 * rejects outright; otherwise the domain is the longest run without whitespace or `/`, its
 * first dot needs a character on each side, and what follows the domain must be nothing, a
 * `/`, or a `?`/`#` already inside the domain after that dot.
 */
function isSchemelessDomain(href: string) {
  if (LINE_TERMINATOR.test(href)) {
    return false;
  }
  const host = HOST_PREFIX.exec(href)?.[0] ?? "";
  const dot = host.indexOf(".", 1);
  if (dot === -1 || dot >= host.length - 1) {
    return false;
  }
  if (host.length === href.length || href[host.length] === "/") {
    return true;
  }
  return /[?#]/.test(host.slice(dot + 2));
}

/**
 * Normalizes inline link targets produced by editor UI inputs.
 * Bare domains become `https://...`, protocol-relative URLs become
 * explicit HTTPS, and already-qualified or custom-scheme URLs are preserved.
 */
export function normalizeInlineLinkHref(href: string) {
  const cleanHref = href.trim();
  if (!cleanHref) {
    return cleanHref;
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(cleanHref) || cleanHref.startsWith("//")) {
    return cleanHref.startsWith("//") ? `https:${cleanHref}` : cleanHref;
  }

  if (
    isSchemelessDomain(cleanHref) &&
    !cleanHref.startsWith("/") &&
    !cleanHref.startsWith("#")
  ) {
    return `https://${cleanHref}`;
  }

  return cleanHref;
}
