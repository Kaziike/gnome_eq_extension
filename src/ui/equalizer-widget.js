// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - 10-Band Vertical Equalizer & Bass/Treble Widget

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {HorizontalSlider} from './volume-widget.js';
import {BackendStatus} from '../audio/pipewire.js';
import {clamp, roundToStep, formatDb} from '../utils/helpers.js';

const TAU = Math.PI * 2;

/**
 * Custom Cairo-rendered Vertical Equalizer Band Slider (-12dB to +12dB)
 * matching the reference UI (bottom-up electric blue bar fill + white circular thumb).
 */
export const VerticalBandSlider = GObject.registerClass({
    Signals: {
        'value-changed': {param_types: [GObject.TYPE_DOUBLE, GObject.TYPE_BOOLEAN]},
    },
}, class VerticalBandSlider extends St.DrawingArea {
    _init(params = {}) {
        const {
            min = -12.0,
            max = 12.0,
            value = 0.0,
            step = 0.5,
            width = 28,
            height = 114,
            trackWidth = 6,
            handleRadius = 6,
        } = params;

        super._init({
            style_class: 'mce-vertical-slider',
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._min = min;
        this._max = max;
        this._value = clamp(value, min, max);
        this._step = step;
        this._trackWidth = trackWidth;
        this._handleRadius = handleRadius;
        this._dragging = false;

        this.set_size(width, height);

        this._panGesture = new Clutter.PanGesture();
        this._panGesture.set_begin_threshold(0);
        this._panGesture.connect('recognize', () => this._onPanBegin());
        this._panGesture.connect('pan-update', () => this._onPanUpdate());
        this._panGesture.connect('end', () => this._onPanEnd());
        this._panGesture.connect('cancel', () => this._onPanEnd());
        this.add_action(this._panGesture);

        const scrollController = new Clutter.ScrollController({
            flags: Clutter.ScrollControllerFlags.DISCRETE |
                Clutter.ScrollControllerFlags.SCROLL_VERTICAL,
        });
        scrollController.connect('scroll', (_ctrl, _sprite, _src, _dx, dy) => {
            const next = roundToStep(this._value - dy * this._step, 0.1);
            this._setValueFromUser(next, true);
            return Clutter.EVENT_STOP;
        });
        this.add_action(scrollController);

        this.connect('notify::hover', () => this.queue_repaint());
    }

    get isDragging() {
        return this._dragging;
    }

    get value() {
        return this._value;
    }

    set value(val) {
        const clamped = roundToStep(clamp(Number(val), this._min, this._max), 0.1);
        if (Math.abs(this._value - clamped) < 0.01)
            return;
        this._value = clamped;
        this.queue_repaint();
    }

    _yToValue(y) {
        const [, height] = this.get_surface_size();
        const pad = this._handleRadius + 3;
        const usable = Math.max(1, height - pad * 2);
        // Top = +12dB, Bottom = -12dB
        const ratioFromBottom = 1.0 - clamp((y - pad) / usable, 0.0, 1.0);
        const raw = this._min + ratioFromBottom * (this._max - this._min);
        // Snap lightly to 0.0 dB when within 0.25 dB
        if (Math.abs(raw) < 0.25)
            return 0.0;
        return roundToStep(raw, 0.1);
    }

    _setValueFromUser(nextVal, committed) {
        const clamped = roundToStep(clamp(nextVal, this._min, this._max), 0.1);
        this._value = clamped;
        this.queue_repaint();
        this.emit('value-changed', this._value, Boolean(committed));
    }

    _onPanBegin() {
        this._dragging = true;
        const coords = this._panGesture.get_centroid();
        this._setValueFromUser(this._yToValue(coords.y), false);
        return Clutter.EVENT_STOP;
    }

    _onPanUpdate() {
        if (!this._dragging)
            return;
        const coords = this._panGesture.get_centroid();
        this._setValueFromUser(this._yToValue(coords.y), false);
    }

    _onPanEnd() {
        if (!this._dragging)
            return;
        this._dragging = false;
        this.queue_repaint();
        this.emit('value-changed', this._value, true);
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();

        if (width <= 0 || height <= 0) {
            cr.$dispose();
            return;
        }

        const pad = this._handleRadius + 3;
        const usableHeight = Math.max(1, height - pad * 2);
        const centerX = width / 2;
        const trackRadius = this._trackWidth / 2;
        const trackBottom = height - pad;
        const trackTop = pad;
        const zeroY = pad + usableHeight * 0.5;

        const range = Math.max(1e-6, this._max - this._min);
        const ratioFromBottom = clamp((this._value - this._min) / range, 0.0, 1.0);
        const handleY = trackBottom - usableHeight * ratioFromBottom;

        // 1. Subtle 0dB reference tick line
        cr.setLineWidth(1.0);
        cr.moveTo(centerX - 7, zeroY);
        cr.lineTo(centerX + 7, zeroY);
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.14);
        cr.stroke();

        // 2. Full vertical background track
        this._drawVerticalRoundedBar(
            cr,
            centerX - trackRadius,
            trackTop,
            this._trackWidth,
            usableHeight,
            trackRadius
        );
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.13);
        cr.fill();

        // 3. Electric blue active fill from bottom up to handleY (matching reference image)
        const fillHeight = Math.max(0, trackBottom - handleY);
        if (fillHeight > 0.5) {
            this._drawVerticalRoundedBar(
                cr,
                centerX - trackRadius,
                handleY,
                this._trackWidth,
                fillHeight,
                trackRadius
            );
            cr.setSourceRGBA(0.145, 0.494, 0.976, 1.0);
            cr.fill();
        }

        // 4. White circular thumb handle
        const radius = (this.hover || this._dragging)
            ? this._handleRadius + 0.8
            : this._handleRadius;

        if (this.hover || this._dragging) {
            cr.arc(centerX, handleY, radius + 3.0, 0, TAU);
            cr.setSourceRGBA(0.145, 0.494, 0.976, 0.30);
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

    _drawVerticalRoundedBar(cr, x, y, w, h, r) {
        const radius = Math.min(r, w / 2, h / 2);
        cr.newSubPath();
        cr.arc(x + w - radius, y + radius, radius, -Math.PI / 2, 0);
        cr.arc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2);
        cr.arc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI);
        cr.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
        cr.closePath();
    }
});

/**
 * Complete Equalizer & Bass/Treble Card Widget.
 */
export class EqualizerWidget {
    /**
     * @param {import('../audio/equalizer.js').EqualizerManager} equalizerManager
     * @param {string} extensionPath
     */
    constructor(equalizerManager, extensionPath) {
        this._eq = equalizerManager;
        this._extensionPath = extensionPath;
        this._bandWidgets = [];

        this.actor = new St.BoxLayout({
            style_class: 'mce-eq-card',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        this._buildHeaderRow();
        this._buildPresetDrawer();
        this._buildSavePresetRow();
        this._buildBackendStatusBanner();
        this._buildBandsSection();
        this._buildBassTrebleRow();

        this._bindSignals();
        this._syncAll();
    }

    _buildHeaderRow() {
        this._headerRow = new St.BoxLayout({
            style_class: 'mce-eq-header',
            x_expand: true,
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

        // 3. Real-time DSP Active/Bypass Pill
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

        // 4. Reset Button (Top-right circular/rounded-square refresh icon matching screenshot)
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

        this._headerRow.add_child(this._presetButton);
        this._headerRow.add_child(this._savePresetToggleBtn);
        this._headerRow.add_child(spacer);
        this._headerRow.add_child(this._dspToggleBtn);
        this._headerRow.add_child(this._resetButton);

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
                width: 28,
                height: 112,
                trackWidth: 6,
                handleRadius: 6,
            });

            slider.connect('value-changed', (_s, val, committed) => {
                dbLabel.text = this._formatBandDbShort(val);
                if (Math.abs(val) >= 0.1)
                    dbLabel.add_style_class_name('non-zero');
                else
                    dbLabel.remove_style_class_name('non-zero');

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
        const divider = new St.Widget({
            style_class: 'mce-eq-horizontal-divider',
            x_expand: true,
        });
        this.actor.add_child(divider);

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
                this._presetLabel.text = this._eq.activePresetName;
                if (this._presetDrawer.visible)
                    this._populatePresetDrawer();
            }),
            this._eq.connect('backend-status-changed', () => this._syncBackendStatus()),
        ];
    }

    _syncBackendStatus() {
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
            this._dspToggleLabel.text = 'BYPASS';
        }
    }

    _syncAll() {
        this._presetLabel.text = this._eq.activePresetName;
        this._syncBackendStatus();

        const gains = this._eq.bandGains;
        for (let i = 0; i < this._bandWidgets.length; i++) {
            const {slider, dbLabel} = this._bandWidgets[i];
            const val = gains[i] ?? 0.0;
            if (!slider.isDragging)
                slider.value = val;
            dbLabel.text = this._formatBandDbShort(val);
            if (Math.abs(val) >= 0.1)
                dbLabel.add_style_class_name('non-zero');
            else
                dbLabel.remove_style_class_name('non-zero');
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
        this._presetDrawer.visible = false;
        this._saveRow.visible = false;
    }

    destroy() {
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
