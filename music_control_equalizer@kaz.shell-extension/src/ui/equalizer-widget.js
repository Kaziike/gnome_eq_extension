// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - 10-Band Vertical Equalizer & Bass/Treble Widget

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {BaseSlider, HorizontalSlider} from './volume-widget.js';
import {BackendStatus} from '../audio/pipewire.js';
import {roundToStep, formatDb, parseAccentColor} from '../utils/helpers.js';

const TAU = Math.PI * 2;

/**
 * Custom Cairo-rendered Vertical Equalizer Band Slider (-12dB to +12dB)
 * extending BaseSlider to share the unified drag, coordinate mapping, and
 * 0.1dB gain calculation logic.
 */
export const VerticalBandSlider = GObject.registerClass(
class VerticalBandSlider extends BaseSlider {
    _init(params = {}) {
        const {
            min = -12.0,
            max = 12.0,
            value = 0.0,
            step = 0.5,
            precision = 0.1,
            width = 28,
            height = 114,
            trackWidth = 6,
            handleRadius = 6,
        } = params;

        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            min,
            max,
            value,
            step,
            precision,
            width,
            height,
            trackThickness: trackWidth,
            handleRadius,
            trackPadding: 3,
            styleClass: 'mce-vertical-slider',
            xExpand: false,
            xAlign: Clutter.ActorAlign.CENTER,
            yAlign: Clutter.ActorAlign.CENTER,
        });
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();

        if (width <= 0 || height <= 0) {
            cr.$dispose();
            return;
        }

        this._allocatedWidth = width;
        this._allocatedHeight = height;

        const {coord: handleY, metrics: m} = this.mapValueToCoord(width, height);
        const centerX = width / 2;
        const trackRadius = this._trackThickness / 2;
        const zeroY = m.trackTop + m.trackHeight * 0.5;

        // 1. Subtle 0dB reference tick line
        cr.setLineWidth(1.0);
        cr.moveTo(centerX - 7, zeroY);
        cr.lineTo(centerX + 7, zeroY);
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.14);
        cr.stroke();

        // 2. Full vertical background track
        this._drawRoundedBar(
            cr,
            centerX - trackRadius,
            m.trackTop,
            this._trackThickness,
            m.trackHeight,
            trackRadius
        );
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.13);
        cr.fill();

        // 3. Dynamic Accent Active fill from bottom up to handleY
        const fillHeight = Math.max(0, m.trackBottom - handleY);
        if (fillHeight > 0.5) {
            this._drawRoundedBar(
                cr,
                centerX - trackRadius,
                handleY,
                this._trackThickness,
                fillHeight,
                trackRadius
            );
            cr.setSourceRGBA(this._accent.r, this._accent.g, this._accent.b, 1.0);
            cr.fill();
        }

        // 4. White circular thumb handle
        const radius = (this.hover || this._dragging)
            ? this._handleRadius + 0.8
            : this._handleRadius;

        if (this.hover || this._dragging) {
            cr.arc(centerX, handleY, radius + 3.0, 0, TAU);
            cr.setSourceRGBA(this._accent.r, this._accent.g, this._accent.b, 0.30);
            cr.fill();
        }

        // Subtle shadow
        cr.arc(centerX, handleY + 1.0, radius, 0, TAU);
        cr.setSourceRGBA(0.0, 0.0, 0.0, 0.45);
        cr.fill();

        // White thumb
        cr.arc(centerX, handleY, radius, 0, TAU);
        cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
        cr.fill();

        cr.$dispose();
    }
});

/**
 * Complete Equalizer & Bass/Treble Card Widget.
 */
export class EqualizerWidget {
    /**
     * @param {import('../audio/equalizer.js').EqualizerManager} equalizerManager
     * @param {string} extensionPath
     * @param {import('../utils/settings.js').SettingsManager} [settings=null]
     * @param {Function} [onOpenSettings=null]
     */
    constructor(equalizerManager, extensionPath, settings = null, onOpenSettings = null) {
        this._eq = equalizerManager;
        this._extensionPath = extensionPath;
        this._settings = settings;
        this._onOpenSettings = onOpenSettings;
        this._bandWidgets = [];
        this._destroyed = false;

        this.actor = new St.BoxLayout({
            style_class: 'mce-eq-card',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });

        this._buildHeaderRow();
        this._buildPresetDrawer();
        this._buildSavePresetRow();
        this._buildBackendStatusBanner();
        this._buildBandsSection();
        this._buildBassTrebleRow();

        this._bindSignals();
        this._syncAll();
        this.syncInterfaceSettings();
    }

    _buildHeaderRow() {
        this._headerRow = new St.BoxLayout({
            style_class: 'mce-eq-header',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // 0. Equalizer Section Title
        this._eqTitleLabel = new St.Label({
            text: 'Equalizer',
            style_class: 'mce-eq-title-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        // 1. Preset Dropdown Button ("Flat v")
        this._presetButton = new St.Button({
            style_class: 'mce-preset-dropdown',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const presetBox = new St.BoxLayout({
            style_class: 'mce-preset-dropdown-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._presetLabel = new St.Label({
            text: 'Flat',
            style_class: 'mce-preset-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const presetArrow = new St.Icon({
            icon_name: 'pan-down-symbolic',
            icon_size: 12,
            style_class: 'mce-pill-arrow',
            y_align: Clutter.ActorAlign.CENTER,
        });
        presetBox.add_child(this._presetLabel);
        presetBox.add_child(presetArrow);
        this._presetButton.set_child(presetBox);

        this._presetButton.connect('clicked', () => {
            this._saveRow.visible = false;
            this._presetDrawer.visible = !this._presetDrawer.visible;
            if (this._presetDrawer.visible)
                this._populatePresetDrawer();
        });

        // 2. Save Custom Preset Button ("+")
        this._savePresetToggleBtn = new St.Button({
            style_class: 'mce-eq-action-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._savePresetToggleBtn.set_child(new St.Icon({
            icon_name: 'list-add-symbolic',
            icon_size: 13,
        }));
        this._savePresetToggleBtn.connect('clicked', () => {
            this._presetDrawer.visible = false;
            this._saveRow.visible = !this._saveRow.visible;
            if (this._saveRow.visible) {
                this._presetEntry.text = '';
                this._presetEntry.grab_key_focus();
            }
        });

        // Spacer
        const spacer = new St.Widget({x_expand: true});

        // 3. Real-time DSP Active/Bypass Pill (EQ ON/OFF)
        this._dspToggleBtn = new St.Button({
            style_class: 'mce-dsp-badge active',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._dspToggleLabel = new St.Label({
            text: 'EQ ON',
            style_class: 'mce-dsp-badge-label',
        });
        this._dspToggleBtn.set_child(this._dspToggleLabel);
        this._dspToggleBtn.connect('clicked', () => {
            this._eq.enabled = !this._eq.enabled;
        });

        // 4. Reset Button
        this._resetButton = new St.Button({
            style_class: 'mce-eq-reset-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._resetButton.set_child(new St.Icon({
            icon_name: 'view-refresh-symbolic',
            icon_size: 14,
        }));
        this._resetButton.connect('clicked', () => {
            this._eq.reset();
        });

        // 5. Advanced Settings Button (opens Extension Preferences / Interface Customization)
        this._advancedSettingsButton = new St.Button({
            style_class: 'mce-eq-action-button mce-eq-settings-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._advancedSettingsButton.set_child(new St.Icon({
            icon_name: 'emblem-system-symbolic',
            icon_size: 13,
        }));
        this._advancedSettingsButton.connect('clicked', () => {
            if (typeof this._onOpenSettings === 'function')
                this._onOpenSettings();
        });

        this._headerRow.add_child(this._eqTitleLabel);
        this._headerRow.add_child(this._presetButton);
        this._headerRow.add_child(this._savePresetToggleBtn);
        this._headerRow.add_child(spacer);
        this._headerRow.add_child(this._dspToggleBtn);
        this._headerRow.add_child(this._resetButton);
        this._headerRow.add_child(this._advancedSettingsButton);

        this.actor.add_child(this._headerRow);
    }

    _buildPresetDrawer() {
        this._presetDrawer = new St.BoxLayout({
            style_class: 'mce-dropdown-drawer mce-preset-drawer',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            visible: false,
        });
        this.actor.add_child(this._presetDrawer);
    }

    _buildSavePresetRow() {
        this._saveRow = new St.BoxLayout({
            style_class: 'mce-save-preset-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });

        this._presetEntry = new St.Entry({
            hint_text: 'Custom preset name…',
            style_class: 'mce-preset-entry',
            x_expand: true,
            can_focus: true,
        });

        this._presetEntry.clutter_text.connect('activate', () => {
            this._commitCustomPreset();
        });

        const confirmBtn = new St.Button({
            label: 'Save',
            style_class: 'mce-save-confirm-button',
            can_focus: true,
        });
        confirmBtn.connect('clicked', () => this._commitCustomPreset());

        this._saveRow.add_child(this._presetEntry);
        this._saveRow.add_child(confirmBtn);

        this.actor.add_child(this._saveRow);
    }

    _commitCustomPreset() {
        const name = (this._presetEntry.text || '').trim();
        if (!name)
            return;
        this._eq.saveCustomPreset(name);
        this._saveRow.visible = false;
    }

    _buildBackendStatusBanner() {
        this._statusBanner = new St.BoxLayout({
            style_class: 'mce-status-banner',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });

        const warnIcon = new St.Icon({
            icon_name: 'dialog-warning-symbolic',
            icon_size: 14,
            style_class: 'mce-status-banner-icon',
        });

        this._statusBannerLabel = new St.Label({
            text: '',
            style_class: 'mce-status-banner-label',
            x_expand: true,
        });

        const retryBtn = new St.Button({
            label: 'Retry',
            style_class: 'mce-status-retry-button',
            can_focus: true,
        });
        retryBtn.connect('clicked', () => {
            this._eq.backend.start(
                this._eq.bandGains,
                this._eq.bassGain,
                this._eq.trebleGain
            );
        });

        this._statusBanner.add_child(warnIcon);
        this._statusBanner.add_child(this._statusBannerLabel);
        this._statusBanner.add_child(retryBtn);

        this.actor.add_child(this._statusBanner);
    }

    _buildBandsSection() {
        this._bandsContainer = new St.BoxLayout({
            style_class: 'mce-eq-bands-container',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // Left scale labels column (+12dB, 0dB, -12dB)
        const scaleColumn = new St.BoxLayout({
            style_class: 'mce-eq-scale-column',
            orientation: Clutter.Orientation.VERTICAL,
            y_expand: true,
            y_align: Clutter.ActorAlign.FILL,
        });

        const topScale = new St.Label({
            text: '+12dB',
            style_class: 'mce-eq-scale-label',
            x_align: Clutter.ActorAlign.START,
        });
        const midScale = new St.Label({
            text: '0dB',
            style_class: 'mce-eq-scale-label',
            x_align: Clutter.ActorAlign.START,
            y_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const botScale = new St.Label({
            text: '-12dB',
            style_class: 'mce-eq-scale-label',
            x_align: Clutter.ActorAlign.START,
        });

        scaleColumn.add_child(topScale);
        scaleColumn.add_child(midScale);
        scaleColumn.add_child(botScale);
        this._bandsContainer.add_child(scaleColumn);

        // 10 Frequency Band Columns
        const bandsRow = new St.BoxLayout({
            style_class: 'mce-eq-sliders-row',
            x_expand: true,
        });

        const bandsMeta = this._eq.bandsMetadata;
        const currentGains = this._eq.bandGains;

        for (let i = 0; i < bandsMeta.length; i++) {
            const meta = bandsMeta[i];
            const initialGain = currentGains[i] ?? 0.0;

            const col = new St.BoxLayout({
                style_class: 'mce-eq-band-column',
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            });

            // Live dB gain readout above each band slider
            const dbLabel = new St.Label({
                text: this._formatBandDbShort(initialGain),
                style_class: 'mce-eq-band-db-label',
                x_align: Clutter.ActorAlign.CENTER,
            });

            const slider = new VerticalBandSlider({
                min: -12.0,
                max: 12.0,
                value: initialGain,
                step: 0.5,
                precision: 0.1,
                width: 28,
                height: 112,
                trackWidth: 6,
                handleRadius: 6,
            });

            slider.connect('value-changed', (_s, val, committed) => {
                if (this._destroyed)
                    return;
                dbLabel.text = this._formatBandDbShort(val);
                if (Math.abs(val) >= 0.1) {
                    dbLabel.add_style_class_name('non-zero');
                    if (this._settings)
                        dbLabel.style = `color: ${this._settings.accentColor};`;
                } else {
                    dbLabel.remove_style_class_name('non-zero');
                    dbLabel.style = null;
                }

                this._eq.setBandGain(i, val, committed);
            });

            const freqLabel = new St.Label({
                text: meta.shortLabel,
                style_class: 'mce-eq-freq-label',
                x_align: Clutter.ActorAlign.CENTER,
            });

            col.add_child(dbLabel);
            col.add_child(slider);
            col.add_child(freqLabel);

            bandsRow.add_child(col);
            this._bandWidgets.push({slider, dbLabel, freqLabel});
        }

        this._bandsContainer.add_child(bandsRow);
        this.actor.add_child(this._bandsContainer);
    }

    _buildBassTrebleRow() {
        // Horizontal separator line above Bass & Treble
        this._toneDivider = new St.Widget({
            style_class: 'mce-eq-horizontal-divider',
            x_expand: true,
        });
        this.actor.add_child(this._toneDivider);

        this._toneRow = new St.BoxLayout({
            style_class: 'mce-tone-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // 1. Bass Control (Left half)
        const bassBox = new St.BoxLayout({
            style_class: 'mce-tone-group',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const bassIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${this._extensionPath}/assets/bass-knob-symbolic.svg`),
            icon_size: 15,
            style_class: 'mce-tone-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const bassTitle = new St.Label({
            text: 'Bass',
            style_class: 'mce-tone-title',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._bassSlider = new HorizontalSlider({
            min: -12.0,
            max: 12.0,
            value: this._eq.bassGain,
            step: 0.5,
            precision: 0.1,
            height: 20,
            trackHeight: 4,
            handleRadius: 5.5,
            styleClass: 'mce-tone-slider',
        });

        this._bassValueLabel = new St.Label({
            text: formatDb(this._eq.bassGain, true, 1),
            style_class: 'mce-tone-value-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._bassSlider.connect('value-changed', (_s, val, committed) => {
            if (this._destroyed)
                return;
            const rounded = roundToStep(val, 0.1);
            this._bassValueLabel.text = formatDb(rounded, true, 1);
            this._eq.setBassGain(rounded, committed);
        });

        bassBox.add_child(bassIcon);
        bassBox.add_child(bassTitle);
        bassBox.add_child(this._bassSlider);
        bassBox.add_child(this._bassValueLabel);

        // Vertical Divider Line
        const vertDivider = new St.Widget({
            style_class: 'mce-tone-vertical-divider',
            y_expand: true,
        });

        // 2. Treble Control (Right half)
        const trebleBox = new St.BoxLayout({
            style_class: 'mce-tone-group',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const trebleIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${this._extensionPath}/assets/treble-clef-symbolic.svg`),
            icon_size: 15,
            style_class: 'mce-tone-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });

        const trebleTitle = new St.Label({
            text: 'Treble',
            style_class: 'mce-tone-title',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._trebleSlider = new HorizontalSlider({
            min: -12.0,
            max: 12.0,
            value: this._eq.trebleGain,
            step: 0.5,
            precision: 0.1,
            height: 20,
            trackHeight: 4,
            handleRadius: 5.5,
            styleClass: 'mce-tone-slider',
        });

        this._trebleValueLabel = new St.Label({
            text: formatDb(this._eq.trebleGain, true, 1),
            style_class: 'mce-tone-value-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._trebleSlider.connect('value-changed', (_s, val, committed) => {
            if (this._destroyed)
                return;
            const rounded = roundToStep(val, 0.1);
            this._trebleValueLabel.text = formatDb(rounded, true, 1);
            this._eq.setTrebleGain(rounded, committed);
        });

        trebleBox.add_child(trebleIcon);
        trebleBox.add_child(trebleTitle);
        trebleBox.add_child(this._trebleSlider);
        trebleBox.add_child(this._trebleValueLabel);

        this._toneRow.add_child(bassBox);
        this._toneRow.add_child(vertDivider);
        this._toneRow.add_child(trebleBox);

        this.actor.add_child(this._toneRow);
    }

    _formatBandDbShort(db) {
        const val = Number.isFinite(db) ? db : 0.0;
        if (Math.abs(val) < 0.05)
            return '0';
        const sign = val > 0 ? '+' : '';
        return `${sign}${val.toFixed(1)}`;
    }

    _populatePresetDrawer() {
        this._presetDrawer.destroy_all_children();
        const presets = this._eq.getAllPresets();
        const activeId = this._eq.activePresetId;

        for (const preset of presets) {
            const isActive = preset.id === activeId;
            const rowBox = new St.BoxLayout({
                style_class: 'mce-preset-drawer-row',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const selectBtn = new St.Button({
                style_class: isActive
                    ? 'mce-drawer-item mce-drawer-item-active'
                    : 'mce-drawer-item',
                x_expand: true,
                can_focus: true,
            });

            const inner = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const nameLabel = new St.Label({
                text: preset.name,
                style_class: 'mce-drawer-item-label',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            });
            inner.add_child(nameLabel);

            if (isActive) {
                inner.add_child(new St.Icon({
                    icon_name: 'object-select-symbolic',
                    icon_size: 13,
                    style_class: 'mce-drawer-item-check',
                }));
            }

            selectBtn.set_child(inner);
            selectBtn.connect('clicked', () => {
                this._eq.applyPreset(preset.id);
                this._presetDrawer.visible = false;
            });

            rowBox.add_child(selectBtn);

            if (preset.isCustom) {
                const delBtn = new St.Button({
                    style_class: 'mce-preset-delete-button',
                    can_focus: true,
                    y_align: Clutter.ActorAlign.CENTER,
                });
                delBtn.set_child(new St.Icon({
                    icon_name: 'user-trash-symbolic',
                    icon_size: 13,
                }));
                delBtn.connect('clicked', () => {
                    this._eq.deleteCustomPreset(preset.id);
                    this._populatePresetDrawer();
                });
                rowBox.add_child(delBtn);
            }

            this._presetDrawer.add_child(rowBox);
        }
    }

    _bindSignals() {
        this._eqSignalIds = [
            this._eq.connect('state-changed', () => this._syncAll()),
            this._eq.connect('presets-changed', () => {
                if (this._destroyed || !this.actor)
                    return;
                this._presetLabel.text = this._eq.activePresetName;
                if (this._presetDrawer.visible)
                    this._populatePresetDrawer();
            }),
            this._eq.connect('backend-status-changed', () => this._syncBackendStatus()),
        ];
    }

    _syncBackendStatus() {
        if (this._destroyed || !this.actor)
            return;

        const status = this._eq.backendStatus;
        const err = this._eq.backendError;

        if (status === BackendStatus.UNAVAILABLE || status === BackendStatus.ERROR) {
            this._statusBanner.visible = true;
            this._statusBannerLabel.text = err || 'Audio equalizer backend unavailable';
        } else {
            this._statusBanner.visible = false;
        }

        if (this._eq.enabled) {
            this._dspToggleBtn.add_style_class_name('active');
            this._dspToggleLabel.text = status === BackendStatus.STARTING ? 'EQ…' : 'EQ ON';
        } else {
            this._dspToggleBtn.remove_style_class_name('active');
            this._dspToggleLabel.text = 'EQ OFF';
        }

        if (this._settings && this._dspToggleBtn) {
            const accent = parseAccentColor(this._settings.accentColor);
            if (this._eq.enabled) {
                this._dspToggleBtn.style = `background-color: ${accent.rgba(0.20)}; border-color: ${accent.rgba(0.45)};`;
                this._dspToggleLabel.style = `color: ${accent.hex};`;
            } else {
                this._dspToggleBtn.style = null;
                this._dspToggleLabel.style = null;
            }
        }
    }

    _syncAll() {
        if (this._destroyed || !this.actor)
            return;

        this._presetLabel.text = this._eq.activePresetName;
        this._syncBackendStatus();

        const gains = this._eq.bandGains;
        for (let i = 0; i < this._bandWidgets.length; i++) {
            const {slider, dbLabel} = this._bandWidgets[i];
            const val = gains[i] ?? 0.0;
            if (!slider.isDragging)
                slider.value = val;
            dbLabel.text = this._formatBandDbShort(val);
            if (Math.abs(val) >= 0.1) {
                dbLabel.add_style_class_name('non-zero');
                if (this._settings)
                    dbLabel.style = `color: ${this._settings.accentColor};`;
            } else {
                dbLabel.remove_style_class_name('non-zero');
                dbLabel.style = null;
            }
        }

        const bass = this._eq.bassGain;
        if (!this._bassSlider.isDragging)
            this._bassSlider.value = bass;
        this._bassValueLabel.text = formatDb(bass, true, 1);

        const treble = this._eq.trebleGain;
        if (!this._trebleSlider.isDragging)
            this._trebleSlider.value = treble;
        this._trebleValueLabel.text = formatDb(treble, true, 1);
    }

    closeDrawers() {
        if (this._destroyed || !this.actor)
            return;
        this._presetDrawer.visible = false;
        this._saveRow.visible = false;
    }

    syncInterfaceSettings() {
        if (this._destroyed || !this.actor || !this._settings)
            return;

        const showBassTreble = this._settings.showBassTreble;
        if (this._toneDivider)
            this._toneDivider.visible = showBassTreble;
        if (this._toneRow)
            this._toneRow.visible = showBassTreble;

        const hex = this._settings.accentColor;
        const accent = parseAccentColor(hex);

        for (const {slider, dbLabel} of this._bandWidgets) {
            slider.setAccentColor(hex);
            if (dbLabel.has_style_class_name('non-zero'))
                dbLabel.style = `color: ${accent.hex};`;
            else
                dbLabel.style = null;
        }

        this._bassSlider?.setAccentColor(hex);
        this._trebleSlider?.setAccentColor(hex);

        if (this._dspToggleBtn && this._eq.enabled) {
            this._dspToggleBtn.style = `background-color: ${accent.rgba(0.20)}; border-color: ${accent.rgba(0.45)};`;
            this._dspToggleLabel.style = `color: ${accent.hex};`;
        } else if (this._dspToggleBtn) {
            this._dspToggleBtn.style = null;
            this._dspToggleLabel.style = null;
        }
    }

    setCompactMode(isCompact) {
        if (this._destroyed || !this.actor)
            return;
        const targetHeight = isCompact ? 90 : 112;
        for (const {slider} of this._bandWidgets) {
            slider._preferredHeight = targetHeight;
            slider._allocatedHeight = targetHeight;
            slider.set_height(targetHeight);
            slider.queue_repaint();
        }
        if (this._eqTitleLabel)
            this._eqTitleLabel.visible = !isCompact;
    }

    destroy() {
        this._destroyed = true;
        if (this._eq && this._eqSignalIds) {
            for (const id of this._eqSignalIds)
                this._eq.disconnect(id);
            this._eqSignalIds = [];
        }
        this._bandWidgets = [];
        this.actor?.destroy();
        this.actor = null;
    }
}
