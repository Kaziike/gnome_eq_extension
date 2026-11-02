// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - Utility Helpers

import GLib from 'gi://GLib';

export const LOG_PREFIX = '[MusicControlEQ]';

export const Logger = {
    info(msg, ...args) {
        console.log(`${LOG_PREFIX} ${msg}`, ...args);
    },
    warn(msg, ...args) {
        console.warn(`${LOG_PREFIX} WARNING: ${msg}`, ...args);
    },
    error(msg, error = null) {
        if (error)
            console.error(`${LOG_PREFIX} ERROR: ${msg}:`, error);
        else
            console.error(`${LOG_PREFIX} ERROR: ${msg}`);
    },
};

/**
 * Clamp a numeric value between min and max.
 *
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
    if (!Number.isFinite(value))
        return min;
    return Math.max(min, Math.min(max, value));
}

/**
 * Round a value to the nearest step (e.g., 0.1 or 0.5 dB).
 *
 * @param {number} value
 * @param {number} step
 * @returns {number}
 */
export function roundToStep(value, step = 0.1) {
    if (!Number.isFinite(value))
        return 0;
    const inv = 1.0 / step;
    const rounded = Math.round(value * inv) / inv;
    return Object.is(rounded, -0) ? 0 : Number(rounded.toFixed(2));
}

/**
 * Format a gain value in dB for UI display (e.g. "+2.0 dB", "0.0 dB", "-3.5 dB").
 *
 * @param {number} db
 * @param {boolean} [withSpace=true]
 * @param {number} [decimals=1]
 * @returns {string}
 */
export function formatDb(db, withSpace = true, decimals = 1) {
    const val = Number.isFinite(db) ? db : 0;
    const abs = Math.abs(val) < 0.05 ? 0 : val;
    const sign = abs > 0 ? '+' : '';
    const unit = withSpace ? ' dB' : 'dB';
    return `${sign}${abs.toFixed(decimals)}${unit}`;
}

/**
 * Format microseconds from MPRIS into MM:SS or H:MM:SS.
 *
 * @param {number} microseconds
 * @param {boolean} [isNegative=false]
 * @returns {string}
 */
export function formatDuration(microseconds, isNegative = false) {
    if (!Number.isFinite(microseconds) || microseconds < 0)
        microseconds = 0;

    const totalSeconds = Math.floor(microseconds / 1000000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const prefix = isNegative && totalSeconds > 0 ? '-' : '';
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');

    if (hours > 0)
        return `${prefix}${hours}:${mm}:${ss}`;
    return `${prefix}${mm}:${ss}`;
}

/**
 * Extract a clean human-readable player name from MPRIS busName and Identity.
 *
 * @param {string} busName
 * @param {string} [identity]
 * @returns {string}
 */
export function formatPlayerName(busName, identity = '') {
    if (identity && identity.trim().length > 0)
        return identity.trim();

    const prefix = 'org.mpris.MediaPlayer2.';
    let raw = busName.startsWith(prefix) ? busName.slice(prefix.length) : busName;
    raw = raw.split('.')[0].replace(/[_-]+/g, ' ');
    if (!raw)
        return 'Media Player';

    return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Map a player bus name or identity to a symbolic icon name.
 *
 * @param {string} busName
 * @param {string} [desktopEntry]
 * @returns {string}
 */
export function getPlayerIconName(busName, desktopEntry = '') {
    const lower = `${busName} ${desktopEntry}`.toLowerCase();
    if (lower.includes('spotify'))
        return 'multimedia-player-symbolic';
    if (lower.includes('firefox') || lower.includes('brave') ||
        lower.includes('chrom') || lower.includes('edge') || lower.includes('zen'))
        return 'web-browser-symbolic';
    if (lower.includes('vlc') || lower.includes('mpv') || lower.includes('celluloid'))
        return 'applications-multimedia-symbolic';
    return 'audio-x-generic-symbolic';
}

/**
 * Shorten long hardware audio device names so they fit nicely in the Header pill.
 *
 * @param {string} description
 * @returns {string}
 */
export function shortenDeviceName(description) {
    if (!description)
        return 'Output';

    let text = description.trim();
    const replacements = [
        [/^Built-in Audio\s+/i, ''],
        [/\s*\(IEC958\)/i, ''],
        [/\s*Analog Stereo/i, ''],
        [/\s*Digital Stereo/i, 'Digital'],
        [/\s*Digital Output\s*\(S\/PDIF\)/i, 'S/PDIF'],
    ];

    for (const [pattern, replacement] of replacements)
        text = text.replace(pattern, replacement).trim();

    if (!text)
        text = description.trim();

    if (text.length > 18)
        return `${text.slice(0, 16)}…`;

    return text;
}

/**
 * Generate a safe slug ID for a custom preset name.
 *
 * @param {string} name
 * @returns {string}
 */
export function slugifyPresetName(name) {
    const base = (name || 'custom')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return `user_${base || 'preset'}_${GLib.get_monotonic_time().toString(36).slice(-4)}`;
}

/**
 * Convert a hex color string (e.g. '#257ef9') into normalized Cairo RGB [r, g, b] in [0..1]
 * and CSS rgba() helper.
 *
 * @param {string} hex
 * @returns {{hex: string, r: number, g: number, b: number, r255: number, g255: number, b255: number, rgba: (alpha: number) => string}}
 */
export function parseAccentColor(hex) {
    const clean = typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex.trim())
        ? hex.trim().toLowerCase()
        : '#257ef9';

    const r255 = parseInt(clean.slice(1, 3), 16);
    const g255 = parseInt(clean.slice(3, 5), 16);
    const b255 = parseInt(clean.slice(5, 7), 16);

    return {
        hex: clean,
        r: r255 / 255,
        g: g255 / 255,
        b: b255 / 255,
        r255,
        g255,
        b255,
        rgba: alpha => `rgba(${r255}, ${g255}, ${b255}, ${alpha})`,
    };
}
