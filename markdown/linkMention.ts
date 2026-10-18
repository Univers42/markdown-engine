/* ************************************************************************** */
/*                                                                            */
/*                                                        :::      ::::::::   */
/*   linkMention.ts                                     :+:      :+:    :+:   */
/*                                                    +:+ +:+         +:+     */
/*   By: dlesieur <dlesieur@student.42.fr>          +#+  +:+       +#+        */
/*                                                +#+#+#+#+#+   +#+           */
/*   Created: 2026/10/18 12:00:00 by dlesieur          #+#    #+#             */
/*   Updated: 2026/10/18 12:00:00 by dlesieur         ###   ########.fr       */
/*                                                                            */
/* ************************************************************************** */

// External link mentions: a markdown link whose reserved title is `osio:mention`
// renders as a chip (favicon + text). The marker lives in the link title so the
// source stays plain CommonMark: `[Page title](https://x.dev "osio:mention")`.

// The editor shows this as a tooltip on links without a title; it is chrome, not content,
// so the DOM reader must not serialize it back into the markdown title.
export const LINK_EDIT_TOOLTIP = "Ctrl/\u2318-click to edit \u00B7 click to open";

export const LINK_MENTION_TITLE = "osio:mention";

export function isLinkMention(title: string | undefined | null): boolean {
  return title === LINK_MENTION_TITLE;
}

/** The host shown as the chip's tooltip, or "" when `href` is not an http(s) URL. */
export function mentionHost(href: string): string {
  return parseHttpUrl(href)?.host ?? "";
}

/** `<origin>/favicon.ico` of an http(s) href, or "" otherwise. No third-party favicon
 *  service is involved: the browser asks the linked site itself.
 *
 *  Caveat: a site that serves its icon only through `<link rel="icon">` has no
 *  `/favicon.ico`; the image then fails to load and the chip shows no icon. */
export function mentionFaviconSrc(href: string): string {
  const url = parseHttpUrl(href);
  return url ? `${url.origin}/favicon.ico` : "";
}

function parseHttpUrl(href: string): URL | null {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return null;
  }
  const isHttp = url.protocol === "http:" || url.protocol === "https:";
  return isHttp && url.username === "" && url.password === "" ? url : null;
}
