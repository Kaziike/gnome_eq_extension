// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - Equalizer State & Preset Controller

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import {
    EQ_BANDS,
    BUILTIN_PRESETS,
    BUILTIN_PRESET_ORDER,
    DEFAULT_BAND_COUNT,
} from './presets.js';
import {PipeWireEqBackend} from './pipewire.js';
import {clamp, roundToStep} from '../utils/helpers.js';

export class EqualizerManager extends EventEmitter {
    /**
     * @param {import('../utils/settings.js').SettingsManager} settings
     */
    constructor(settings) {
        super();

        this._settings = settings;
        this._backend = new PipeWireEqBackend();
        this._updatingInternal = false;

        this._bandGains = this._settings.bandGains;
        this._bassGain = this._settings.bassGain;
        this._trebleGain = this._settings.trebleGain;
        this._activePreset = this._settings.activePreset;
        this._enabled = this._settings.equalizerEnabled;

        this._backend.connect('status-changed', (_b, status, err) => {
            this.emit('backend-status-changed', status, err);
        });

        this._bindSettings();

        if (this._enabled)
            this._backend.start(this._bandGains, this._bassGain, this._trebleGain);
    }

    _bindSettings() {
        this._settings.connectChanged('equalizer-enabled', () => {
            if (this._updatingInternal)
                return;
            this._enabled = this._settings.equalizerEnabled;
            if (this._enabled)
                this._backend.start(this._bandGains, this._bassGain, this._trebleGain);
            else
                this._backend.stop();
            this.emit('state-changed');
        });

        this._settings.connectChanged('band-gains', () => {
            if (this._updatingInternal)
                return;
            this._bandGains = this._settings.bandGains;
            if (this._enabled)
                this._backend.applyGains(this._bandGains, this._bassGain, this._trebleGain, true);
            this.emit('state-changed');
        });

        this._settings.connectChanged('bass-gain', () => {
            if (this._updatingInternal)
                return;
            this._bassGain = this._settings.bassGain;
            if (this._enabled)
                this._backend.applyGains(this._bandGains, this._bassGain, this._trebleGain, true);
            this.emit('state-changed');
        });

        this._settings.connectChanged('treble-gain', () => {
            if (this._updatingInternal)
                return;
            this._trebleGain = this._settings.trebleGain;
            if (this._enabled)
                this._backend.applyGains(this._bandGains, this._bassGain, this._trebleGain, true);
            this.emit('state-changed');
        });

        this._settings.connectChanged('active-preset', () => {
            if (this._updatingInternal)
                return;
            this._activePreset = this._settings.activePreset;
            this.emit('state-changed');
        });

        this._settings.connectChanged('custom-presets', () => {
            this.emit('presets-changed');
        });
    }

    get backend() {
        return this._backend;
    }

    get backendStatus() {
        return this._backend.status;
    }

    get backendError() {
        return this._backend.errorMessage;
    }

    get missingDependencies() {
        return this._backend.missingDependencies;
    }

    get enabled() {
        return this._enabled;
    }

    set enabled(value) {
        const boolVal = Boolean(value);
        if (this._enabled === boolVal)
            return;

        this._updatingInternal = true;
        this._enabled = boolVal;
        this._settings.equalizerEnabled = boolVal;
        this._updatingInternal = false;

        if (this._enabled)
            this._backend.start(this._bandGains, this._bassGain, this._trebleGain);
        else
            this._backend.stop();

        this.emit('state-changed');
    }

    get bandGains() {
        return [...this._bandGains];
    }

    get bassGain() {
        return this._bassGain;
    }

    get trebleGain() {
        return this._trebleGain;
    }

    get activePresetId() {
        return this._activePreset;
    }

    get activePresetName() {
        if (this._activePreset in BUILTIN_PRESETS)
            return BUILTIN_PRESETS[this._activePreset].name;

        const custom = this._settings.getCustomPresets();
        if (this._activePreset in custom)
            return custom[this._activePreset].name;

        return 'Custom';
    }

    get bandsMetadata() {
        return EQ_BANDS;
    }

    /**
     * Get all built-in and user custom presets.
     *
     * @returns {Array<{id: string, name: string, isCustom: boolean, bands: number[], bass: number, treble: number}>}
     */
    getAllPresets() {
        const result = [];
        for (const id of BUILTIN_PRESET_ORDER) {
            const p = BUILTIN_PRESETS[id];
            result.push({
                id: p.id,
                name: p.name,
                isCustom: false,
                bands: [...p.bands],
                bass: p.bass,
                treble: p.treble,
            });
        }

        const customPresets = this._settings.getCustomPresets();
        for (const [id, data] of Object.entries(customPresets)) {
            result.push({
                id,
                name: data.name,
                isCustom: true,
                bands: [...data.bands],
                bass: data.bass,
                treble: data.treble,
            });
        }
        return result;
    }

    /**
     * Update a single frequency band gain in real time.
     *
     * @param {number} index 0..9
     * @param {number} gainDb -12.0..+12.0
     * @param {boolean} [commitToSettings=true]
     */
    setBandGain(index, gainDb, commitToSettings = true) {
        if (index < 0 || index >= DEFAULT_BAND_COUNT)
            return;

        const clean = roundToStep(clamp(Number(gainDb), -12.0, 12.0), 0.1);
        this._bandGains[index] = clean;
        this._activePreset = 'custom';

        if (!this._enabled)
            this.enabled = true;
        else
            this._backend.applyGains(this._bandGains, this._bassGain, this._trebleGain, commitToSettings);

        if (commitToSettings) {
            this._updatingInternal = true;
            this._settings.bandGains = this._bandGains;
            this._settings.activePreset = 'custom';
            this._updatingInternal = false;
        }

        this.emit('state-changed');
    }

    /**
     * Update Bass shelf gain in real time.
     *
     * @param {number} gainDb -12.0..+12.0
     * @param {boolean} [commitToSettings=true]
     */
    setBassGain(gainDb, commitToSettings = true) {
        const clean = roundToStep(clamp(Number(gainDb), -12.0, 12.0), 0.1);
        this._bassGain = clean;

        if (!this._enabled)
            this.enabled = true;
        else
            this._backend.applyGains(this._bandGains, this._bassGain, this._trebleGain, commitToSettings);

        if (commitToSettings) {
            this._updatingInternal = true;
            this._settings.bassGain = this._bassGain;
            this._updatingInternal = false;
        }

        this.emit('state-changed');
    }

    /**
     * Update Treble shelf gain in real time.
     *
     * @param {number} gainDb -12.0..+12.0
     * @param {boolean} [commitToSettings=true]
     */
    setTrebleGain(gainDb, commitToSettings = true) {
        const clean = roundToStep(clamp(Number(gainDb), -12.0, 12.0), 0.1);
        this._trebleGain = clean;

        if (!this._enabled)
            this.enabled = true;
        else
            this._backend.applyGains(this._bandGains, this._bassGain, this._trebleGain, commitToSettings);

        if (commitToSettings) {
            this._updatingInternal = true;
            this._settings.trebleGain = this._trebleGain;
            this._updatingInternal = false;
        }

        this.emit('state-changed');
    }

    /**
     * Apply a built-in or user-saved custom preset by ID.
     *
     * @param {string} presetId
     */
    applyPreset(presetId) {
        let target = null;
        if (presetId in BUILTIN_PRESETS) {
            target = BUILTIN_PRESETS[presetId];
        } else {
            const custom = this._settings.getCustomPresets();
            if (presetId in custom)
                target = custom[presetId];
        }

        if (!target)
            return;

        this._bandGains = target.bands.map(b => roundToStep(clamp(Number(b), -12.0, 12.0), 0.1));
        this._bassGain = roundToStep(clamp(Number(target.bass), -12.0, 12.0), 0.1);
        this._trebleGain = roundToStep(clamp(Number(target.treble), -12.0, 12.0), 0.1);
        this._activePreset = presetId;

        this._updatingInternal = true;
        this._settings.bandGains = this._bandGains;
        this._settings.bassGain = this._bassGain;
        this._settings.trebleGain = this._trebleGain;
        this._settings.activePreset = presetId;
        this._updatingInternal = false;

        if (!this._enabled)
            this.enabled = true;
        else
            this._backend.applyGains(this._bandGains, this._bassGain, this._trebleGain, true);

        this.emit('state-changed');
    }

    /**
     * Save current EQ state as a named custom preset.
     *
     * @param {string} name
     * @returns {string} New preset ID
     */
    saveCustomPreset(name) {
        this._updatingInternal = true;
        const id = this._settings.saveCustomPreset(
            name,
            this._bandGains,
            this._bassGain,
            this._trebleGain
        );
        this._activePreset = id;
        this._updatingInternal = false;

        this.emit('presets-changed');
        this.emit('state-changed');
        return id;
    }

    /**
     * Delete a user-saved custom preset.
     *
     * @param {string} presetId
     */
    deleteCustomPreset(presetId) {
        this._updatingInternal = true;
        const deleted = this._settings.deleteCustomPreset(presetId);
        this._activePreset = this._settings.activePreset;
        this._updatingInternal = false;

        if (deleted) {
            this.emit('presets-changed');
            this.emit('state-changed');
        }
    }

    /**
     * Reset all bands, Bass, and Treble to Flat (0.0 dB).
     */
    reset() {
        this.applyPreset('flat');
    }

    destroy() {
        if (this._backend) {
            this._backend.destroy();
            this._backend = null;
        }
        this.disconnectAll();
    }
}
