// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - GSettings Wrapper

import GLib from 'gi://GLib';
import { clamp, roundToStep, slugifyPresetName, Logger } from './helpers.js';
import { BUILTIN_PRESETS, DEFAULT_BAND_COUNT } from '../audio/presets.js';

export const LayoutMode = {
    DUAL_PANEL: 'dual-panel',
    VERTICAL: 'vertical',
    COMPACT: 'compact',
    MUSIC_ONLY: 'music-only',
    EQ_ONLY: 'eq-only',
};

export const VALID_LAYOUT_MODES = [
    LayoutMode.DUAL_PANEL,
    LayoutMode.VERTICAL,
    LayoutMode.COMPACT,
    LayoutMode.MUSIC_ONLY,
    LayoutMode.EQ_ONLY,
];

export const VALID_POPUP_SCALES = ['small', 'medium', 'large'];

export const ACCENT_PRESETS = [
    { id: '#257ef9', name: 'Electric Blue (Default)' },
    { id: '#00c4cc', name: 'Cyan Glow' },
    { id: '#8b5cf6', name: 'Royal Purple' },
    { id: '#10b981', name: 'Emerald Green' },
    { id: '#f59e0b', name: 'Amber Gold' },
    { id: '#ec4899', name: 'Neon Rose' },
];

export const INTERFACE_SETTING_KEYS = [
    'layout-mode',
    'popup-scale',
    'left-panel-width',
    'right-panel-width',
    'show-album-art',
    'show-media-source',
    'show-bass-treble',
    'show-time-info',
    'accent-color',
    'popup-opacity',
];

export class SettingsManager {
    /**
     * @param {Gio.Settings} gsettings
     */
    constructor(gsettings) {
        this._settings = gsettings;
        this._signalIds = [];
    }

    get raw() {
        return this._settings;
    }

    get equalizerEnabled() {
        return this._settings.get_boolean('equalizer-enabled');
    }

    set equalizerEnabled(value) {
        this._settings.set_boolean('equalizer-enabled', Boolean(value));
    }

    get activePreset() {
        return this._settings.get_string('active-preset') || 'flat';
    }

    set activePreset(presetId) {
        this._settings.set_string('active-preset', String(presetId || 'flat'));
    }

    /**
     * @returns {number[]} Array of 10 band gains in dB (-12 to +12)
     */
    get bandGains() {
        const variant = this._settings.get_value('band-gains');
        const unpacked = variant.deepUnpack();
        const result = [];
        for (let i = 0; i < DEFAULT_BAND_COUNT; i++) {
            const val = Array.isArray(unpacked) && i < unpacked.length ? Number(unpacked[i]) : 0.0;
            result.push(roundToStep(clamp(val, -12.0, 12.0), 0.1));
        }
        return result;
    }

    /**
     * @param {number[]} gains
     */
    set bandGains(gains) {
        const sanitized = [];
        for (let i = 0; i < DEFAULT_BAND_COUNT; i++) {
            const val = Array.isArray(gains) && i < gains.length ? Number(gains[i]) : 0.0;
            sanitized.push(roundToStep(clamp(val, -12.0, 12.0), 0.1));
        }
        this._settings.set_value('band-gains', new GLib.Variant('ad', sanitized));
    }

    get bassGain() {
        return roundToStep(clamp(this._settings.get_double('bass-gain'), -12.0, 12.0), 0.1);
    }

    set bassGain(value) {
        this._settings.set_double('bass-gain', roundToStep(clamp(Number(value), -12.0, 12.0), 0.1));
    }

    get trebleGain() {
        return roundToStep(clamp(this._settings.get_double('treble-gain'), -12.0, 12.0), 0.1);
    }

    set trebleGain(value) {
        this._settings.set_double('treble-gain', roundToStep(clamp(Number(value), -12.0, 12.0), 0.1));
    }

    get preferredPlayer() {
        return this._settings.get_string('preferred-player') || '';
    }

    set preferredPlayer(busName) {
        this._settings.set_string('preferred-player', String(busName || ''));
    }

    get showRemainingTime() {
        return this._settings.get_boolean('show-remaining-time');
    }

    set showRemainingTime(value) {
        this._settings.set_boolean('show-remaining-time', Boolean(value));
    }

    get showTrackInPanel() {
        return this._settings.get_boolean('show-track-in-panel');
    }

    set showTrackInPanel(value) {
        this._settings.set_boolean('show-track-in-panel', Boolean(value));
    }

    get panelPosition() {
        return this._settings.get_string('panel-position') || 'right';
    }

    set panelPosition(value) {
        this._settings.set_string('panel-position', String(value || 'right'));
    }

    get layoutMode() {
        const raw = this._settings.get_string('layout-mode') || LayoutMode.DUAL_PANEL;
        return VALID_LAYOUT_MODES.includes(raw) ? raw : LayoutMode.DUAL_PANEL;
    }

    set layoutMode(mode) {
        const valid = VALID_LAYOUT_MODES.includes(mode) ? mode : LayoutMode.DUAL_PANEL;
        this._settings.set_string('layout-mode', valid);
    }

    get popupScale() {
        const raw = this._settings.get_string('popup-scale') || 'medium';
        return VALID_POPUP_SCALES.includes(raw) ? raw : 'medium';
    }

    set popupScale(scale) {
        const valid = VALID_POPUP_SCALES.includes(scale) ? scale : 'medium';
        this._settings.set_string('popup-scale', valid);
    }

    get popupScaleFactor() {
        const scale = this.popupScale;
        if (scale === 'small')
            return 0.90;
        if (scale === 'large')
            return 1.12;
        return 1.0;
    }

    get leftPanelWidth() {
        return clamp(this._settings.get_int('left-panel-width'), 240, 460);
    }

    set leftPanelWidth(width) {
        this._settings.set_int('left-panel-width', Math.round(clamp(Number(width), 240, 460)));
    }

    get rightPanelWidth() {
        return clamp(this._settings.get_int('right-panel-width'), 420, 780);
    }

    set rightPanelWidth(width) {
        this._settings.set_int('right-panel-width', Math.round(clamp(Number(width), 420, 780)));
    }

    get showAlbumArt() {
        return this._settings.get_boolean('show-album-art');
    }

    set showAlbumArt(value) {
        this._settings.set_boolean('show-album-art', Boolean(value));
    }

    get showMediaSource() {
        return this._settings.get_boolean('show-media-source');
    }

    set showMediaSource(value) {
        this._settings.set_boolean('show-media-source', Boolean(value));
    }

    get showBassTreble() {
        return this._settings.get_boolean('show-bass-treble');
    }

    set showBassTreble(value) {
        this._settings.set_boolean('show-bass-treble', Boolean(value));
    }

    get showTimeInfo() {
        return this._settings.get_boolean('show-time-info');
    }

    set showTimeInfo(value) {
        this._settings.set_boolean('show-time-info', Boolean(value));
    }

    get accentColor() {
        const raw = this._settings.get_string('accent-color') || '#257ef9';
        return /^#[0-9a-fA-F]{6}$/.test(raw.trim()) ? raw.trim().toLowerCase() : '#257ef9';
    }

    set accentColor(hex) {
        const valid = typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex.trim())
            ? hex.trim().toLowerCase()
            : '#257ef9';
        this._settings.set_string('accent-color', valid);
    }

    get popupOpacity() {
        return clamp(this._settings.get_int('popup-opacity'), 25, 100);
    }

    set popupOpacity(value) {
        this._settings.set_int('popup-opacity', Math.round(clamp(Number(value), 25, 100)));
    }

    /**
     * Reset only interface customization settings to defaults.
     */
    resetInterfaceToDefaults() {
        for (const key of INTERFACE_SETTING_KEYS)
            this._settings.reset(key);
    }

    /**
     * Load custom user-saved presets from GSettings JSON.
     *
     * @returns {Object.<string, {name: string, bands: number[], bass: number, treble: number}>}
     */
    getCustomPresets() {
        const raw = this._settings.get_string('custom-presets') || '{}';
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                return {};

            const valid = {};
            for (const [id, data] of Object.entries(parsed)) {
                if (!data || typeof data !== 'object' || typeof data.name !== 'string')
                    continue;
                const bands = [];
                for (let i = 0; i < DEFAULT_BAND_COUNT; i++) {
                    const b = Array.isArray(data.bands) && i < data.bands.length ? Number(data.bands[i]) : 0.0;
                    bands.push(roundToStep(clamp(b, -12.0, 12.0), 0.1));
                }
                valid[id] = {
                    name: data.name.trim().slice(0, 32) || 'Custom',
                    bands,
                    bass: roundToStep(clamp(Number(data.bass ?? 0.0), -12.0, 12.0), 0.1),
                    treble: roundToStep(clamp(Number(data.treble ?? 0.0), -12.0, 12.0), 0.1),
                };
            }
            return valid;
        } catch (e) {
            Logger.warn('Failed to parse custom-presets JSON, returning empty object', e);
            return {};
        }
    }

    /**
     * Save a new or updated custom preset and set it active.
     *
     * @param {string} name
     * @param {number[]} bands
     * @param {number} bass
     * @param {number} treble
     * @returns {string} The created/updated preset ID
     */
    saveCustomPreset(name, bands, bass, treble) {
        const trimmedName = (name || '').trim().slice(0, 32) || 'My Preset';
        const presets = this.getCustomPresets();

        // Check if a custom preset with the same name already exists
        let targetId = Object.keys(presets).find(
            id => presets[id].name.toLowerCase() === trimmedName.toLowerCase()
        );
        if (!targetId)
            targetId = slugifyPresetName(trimmedName);

        const cleanBands = [];
        for (let i = 0; i < DEFAULT_BAND_COUNT; i++) {
            const val = Array.isArray(bands) && i < bands.length ? Number(bands[i]) : 0.0;
            cleanBands.push(roundToStep(clamp(val, -12.0, 12.0), 0.1));
        }

        presets[targetId] = {
            name: trimmedName,
            bands: cleanBands,
            bass: roundToStep(clamp(Number(bass), -12.0, 12.0), 0.1),
            treble: roundToStep(clamp(Number(treble), -12.0, 12.0), 0.1),
        };

        this._settings.set_string('custom-presets', JSON.stringify(presets));
        this.activePreset = targetId;
        return targetId;
    }

    /**
     * Delete a user-saved custom preset by ID.
     *
     * @param {string} presetId
     * @returns {boolean}
     */
    deleteCustomPreset(presetId) {
        const presets = this.getCustomPresets();
        if (!(presetId in presets))
            return false;

        delete presets[presetId];
        this._settings.set_string('custom-presets', JSON.stringify(presets));
        if (this.activePreset === presetId)
            this.activePreset = 'custom';
        return true;
    }

    /**
     * Reset all equalizer parameters to Flat (0.0 dB).
     */
    resetEqualizerToFlat() {
        const flat = BUILTIN_PRESETS.flat;
        this.bandGains = [...flat.bands];
        this.bassGain = flat.bass;
        this.trebleGain = flat.treble;
        this.activePreset = 'flat';
    }

    /**
     * Reset all extension settings to schema defaults.
     */
    resetAllToDefaults() {
        const keys = [
            'equalizer-enabled',
            'active-preset',
            'band-gains',
            'bass-gain',
            'treble-gain',
            'custom-presets',
            'preferred-player',
            'show-remaining-time',
            'show-track-in-panel',
            'panel-position',
            ...INTERFACE_SETTING_KEYS,
        ];
        for (const key of keys)
            this._settings.reset(key);
    }

    /**
     * Connect to a GSettings changed signal and track it for cleanup.
     *
     * @param {string} key
     * @param {Function} callback
     * @returns {number}
     */
    connectChanged(key, callback) {
        const id = this._settings.connect(`changed::${key}`, callback);
        this._signalIds.push(id);
        return id;
    }

    destroy() {
        if (this._settings) {
            for (const id of this._signalIds)
                this._settings.disconnect(id);
        }
        this._signalIds = [];
        this._settings = null;
    }
}
