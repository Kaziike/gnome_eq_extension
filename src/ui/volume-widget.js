// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - Shared BaseSlider, HorizontalSlider & Volume Control Widget

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {clamp, roundToStep, parseAccentColor} from '../utils/helpers.js';

const TAU = Math.PI * 2;

/**
 * Shared Base Slider implementing unified Coordinate Mapping, Gain Mapping,
 * PanGesture Drag Lifecycle, and ScrollController handling for both Horizontal
 * and Vertical sliders in GNOME Shell 50/51.
 */
export const BaseSlider = GObject.registerClass({
    Signals: {
        'value-changed': {param_types: [GObject.TYPE_DOUBLE, GObject.TYPE_BOOLEAN]},
        'drag-begin': {},
        'drag-end': {param_types: [GObject.TYPE_DOUBLE]},
    },
}, class BaseSlider extends St.DrawingArea {
    _init(params = {}) {
        const {
            orientation = Clutter.Orientation.HORIZONTAL,
            min = 0.0,
            max = 1.0,
            value = 0.0,
            step = 0.02,
            precision = 0.0,
            width = 0,
            height = 22,
            trackThickness = 4,
            handleRadius = 6,
            trackPadding = 2,
            styleClass = 'mce-slider',
            xExpand = true,
            xAlign = Clutter.ActorAlign.FILL,
            yAlign = Clutter.ActorAlign.CENTER,
        } = params;

        super._init({
            style_class: styleClass,
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: xExpand,
            x_align: xAlign,
            y_align: yAlign,
        });

        this._orientation = orientation;
        this._min = min;
        this._max = max;
        this._step = step;
        this._precision = precision;
        this._preferredWidth = width;
        this._preferredHeight = height;
        this._trackThickness = trackThickness;
        this._handleRadius = handleRadius;
        this._trackPadding = trackPadding;

        this._allocatedWidth = width > 0 ? width : 0;
        this._allocatedHeight = height > 0 ? height : 0;
        this._dragMetrics = null;
        this._grab = null;
        this._dragging = false;
        this._interactive = true;
        this._accent = parseAccentColor('#257ef9');

        this._value = this._sanitizeValue(value);

        if (width > 0 && height > 0)
            this.set_size(width, height);
        else if (height > 0)
            this.set_height(height);
        else if (width > 0)
            this.set_width(width);

        this.connect('notify::allocation', () => {
            if (!this.allocation)
                return;
            const w = this.allocation.get_width();
            const h = this.allocation.get_height();
            if (w > 0)
                this._allocatedWidth = w;
            if (h > 0)
                this._allocatedHeight = h;
        });

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
            if (!this._interactive)
                return Clutter.EVENT_PROPAGATE;
            const delta = -dy * this._step;
            this._setValueFromUser(this._value + delta, true);
            return Clutter.EVENT_STOP;
        });
        this.add_action(scrollController);

        this.connect('notify::hover', () => this.queue_repaint());
    }

    _sanitizeValue(val) {
        const clamped = clamp(Number(val), this._min, this._max);
        if (this._precision > 0)
            return clamp(roundToStep(clamped, this._precision), this._min, this._max);
        return clamped;
    }

    get isDragging() {
        return this._dragging;
    }

    get value() {
        return this._value;
    }

    set value(val) {
        const sanitized = this._sanitizeValue(val);
        if (Math.abs(this._value - sanitized) < 1e-6)
            return;
        this._value = sanitized;
        this.queue_repaint();
    }

    setInteractive(interactive) {
        this._interactive = Boolean(interactive);
        this.opacity = this._interactive ? 255 : 120;
        this.queue_repaint();
    }

    setAccentColor(hex) {
        this._accent = parseAccentColor(hex);
        this.queue_repaint();
    }

    /**
     * Safely retrieve actor dimensions outside vfunc_repaint() without calling
     * st_drawing_area_get_surface_size() (which asserts priv->in_repaint).
     *
     * @returns {[number, number]}
     */
    _getActorDimensions() {
        let allocW = 0;
        let allocH = 0;
        if (this.allocation) {
            allocW = this.allocation.get_width();
            allocH = this.allocation.get_height();
        }

        const width = allocW > 0
            ? allocW
            : (this._allocatedWidth > 0
                ? this._allocatedWidth
                : Math.max(1, this.width || this._preferredWidth || 100));

        const height = allocH > 0
            ? allocH
            : (this._allocatedHeight > 0
                ? this._allocatedHeight
                : Math.max(1, this.height || this._preferredHeight || 100));

        return [width, height];
    }

    /**
     * Compute track bounds and usable drag length in actor-local coordinates.
     *
     * @param {number|null} [width=null]
     * @param {number|null} [height=null]
     */
    getTrackMetrics(width = null, height = null) {
        if (width === null || height === null || width <= 0 || height <= 0)
            [width, height] = this._getActorDimensions();

        const pad = this._handleRadius + this._trackPadding;

        if (this._orientation === Clutter.Orientation.VERTICAL) {
            const trackTop = pad;
            const trackBottom = Math.max(trackTop + 1, height - pad);
            const trackHeight = Math.max(1, trackBottom - trackTop);
            return {
                width,
                height,
                pad,
                trackTop,
                trackBottom,
                trackHeight,
                trackStart: trackTop,
                trackEnd: trackBottom,
                trackLength: trackHeight,
            };
        } else {
            const trackLeft = pad;
            const trackRight = Math.max(trackLeft + 1, width - pad);
            const trackWidth = Math.max(1, trackRight - trackLeft);
            return {
                width,
                height,
                pad,
                trackLeft,
                trackRight,
                trackWidth,
                trackStart: trackLeft,
                trackEnd: trackRight,
                trackLength: trackWidth,
            };
        }
    }

    /**
     * Unified mapping formula from local pointer coordinates to Slider Value/Gain:
     * Vertical:   normalized = clamp((trackBottom - pointerY) / trackHeight, 0, 1)
     * Horizontal: normalized = clamp((pointerX - trackLeft) / trackWidth, 0, 1)
     * value = min + normalized * (max - min)
     *
     * @param {number} pointerX
     * @param {number} pointerY
     * @param {object|null} [metrics=null]
     * @returns {number}
     */
    mapPointerToValue(pointerX, pointerY, metrics = null) {
        const m = metrics || this._dragMetrics || this.getTrackMetrics();
        let normalized;

        if (this._orientation === Clutter.Orientation.VERTICAL)
            normalized = clamp((m.trackBottom - pointerY) / m.trackHeight, 0.0, 1.0);
        else
            normalized = clamp((pointerX - m.trackLeft) / m.trackWidth, 0.0, 1.0);

        const raw = this._min + normalized * (this._max - this._min);
        return this._sanitizeValue(raw);
    }

    /**
     * Exact inverse of mapPointerToValue: maps current value to thumb center coordinate.
     *
     * @param {number} width
     * @param {number} height
     * @returns {{coord: number, metrics: object, normalized: number}}
     */
    mapValueToCoord(width, height) {
        const m = this.getTrackMetrics(width, height);
        const range = Math.max(1e-6, this._max - this._min);
        const normalized = clamp((this._value - this._min) / range, 0.0, 1.0);

        const coord = this._orientation === Clutter.Orientation.VERTICAL
            ? m.trackBottom - normalized * m.trackHeight
            : m.trackLeft + normalized * m.trackWidth;

        return {coord, metrics: m, normalized};
    }

    _setValueFromUser(nextVal, committed) {
        const sanitized = this._sanitizeValue(nextVal);
        this._value = sanitized;
        this.queue_repaint();
        this.emit('value-changed', this._value, Boolean(committed));
    }

    _releaseGrab() {
        if (this._grab) {
            try {
                this._grab.dismiss();
            } catch (_e) {
                // Ignore if already dismissed
            }
            this._grab = null;
        }
    }

    _onPanBegin() {
        if (!this._interactive)
            return Clutter.EVENT_PROPAGATE;

        this._releaseGrab();
        if (typeof global !== 'undefined' && global.stage?.grab) {
            try {
                this._grab = global.stage.grab(this);
            } catch (_e) {
                this._grab = null;
            }
        }

        // Lock track geometry at drag start so external layout updates cannot distort drag coordinates
        this._dragMetrics = this.getTrackMetrics();
        this._dragging = true;
        this.emit('drag-begin');

        const coords = this._panGesture.get_centroid();
        this._setValueFromUser(this.mapPointerToValue(coords.x, coords.y, this._dragMetrics), false);
        return Clutter.EVENT_STOP;
    }

    _onPanUpdate() {
        if (!this._interactive || !this._dragging)
            return;

        const coords = this._panGesture.get_centroid();
        this._setValueFromUser(this.mapPointerToValue(coords.x, coords.y, this._dragMetrics), false);
    }

    _onPanEnd() {
        this._releaseGrab();
        this._dragMetrics = null;

        if (!this._dragging)
            return;

        this._dragging = false;
        this.queue_repaint();
        this.emit('value-changed', this._value, true);
        this.emit('drag-end', this._value);
    }

    vfunc_unmap() {
        if (this._dragging || this._grab) {
            this._releaseGrab();
            this._dragMetrics = null;
            this._dragging = false;
        }
        super.vfunc_unmap();
    }

    _drawRoundedBar(cr, x, y, w, h, r) {
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
 * Custom Cairo-rendered Horizontal Slider matching the reference UI design
 * (electric blue active fill, dark rounded track, crisp white circular handle).
 */
export const HorizontalSlider = GObject.registerClass(
class HorizontalSlider extends BaseSlider {
    _init(params = {}) {
        const {
            min = 0.0,
            max = 1.0,
            value = 0.0,
            step = 0.02,
            precision = 0.0,
            height = 22,
            trackHeight = 4,
            handleRadius = 6,
            styleClass = 'mce-horizontal-slider',
        } = params;

        super._init({
            orientation: Clutter.Orientation.HORIZONTAL,
            min,
            max,
            value,
            step,
            precision,
            height,
            trackThickness: trackHeight,
            handleRadius,
            trackPadding: 2,
            styleClass,
            xExpand: true,
            xAlign: Clutter.ActorAlign.FILL,
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

        const {coord: handleX, metrics: m} = this.mapValueToCoord(width, height);
        const centerY = height / 2;
        const trackRadius = this._trackThickness / 2;

        // 1. Background Track (Dark translucent pill)
        this._drawRoundedBar(
            cr,
            m.trackLeft,
            centerY - trackRadius,
            m.trackWidth,
            this._trackThickness,
            trackRadius
        );
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.16);
        cr.fill();

        // 2. Active Track Fill (Dynamic Accent Color)
        const activeWidth = Math.max(0, handleX - m.trackLeft);
        if (activeWidth > 0.5) {
            this._drawRoundedBar(
                cr,
                m.trackLeft,
                centerY - trackRadius,
                activeWidth,
                this._trackThickness,
                trackRadius
            );
            cr.setSourceRGBA(this._accent.r, this._accent.g, this._accent.b, 1.0);
            cr.fill();
        }

        // 3. Circular Handle Thumb
        const radius = (this.hover || this._dragging)
            ? this._handleRadius + 1.0
            : this._handleRadius;

        if (this.hover || this._dragging) {
            cr.arc(handleX, centerY, radius + 3.0, 0, TAU);
            cr.setSourceRGBA(this._accent.r, this._accent.g, this._accent.b, 0.28);
            cr.fill();
        }

        // Subtle drop shadow around handle
        cr.arc(handleX, centerY + 1.0, radius, 0, TAU);
        cr.setSourceRGBA(0.0, 0.0, 0.0, 0.45);
        cr.fill();

        // Crisp white handle
        cr.arc(handleX, centerY, radius, 0, TAU);
        cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);
        cr.fill();

        cr.$dispose();
    }
});

/**
 * System Output Volume Row Widget (Speaker icon button + HorizontalSlider + Volume % label).
 */
export class VolumeWidget {
    /**
     * @param {import('../audio/pipewire.js').SystemAudioController} audioController
     * @param {import('../utils/settings.js').SettingsManager} [settings]
     */
    constructor(audioController, settings = null) {
        this._audio = audioController;
        this._settings = settings;
        this._destroyed = false;

        this.actor = new St.BoxLayout({
            style_class: 'mce-volume-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._muteButton = new St.Button({
            style_class: 'mce-icon-button mce-volume-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._volumeIcon = new St.Icon({
            icon_name: this._audio.getVolumeIconName(),
            style_class: 'mce-volume-icon',
            icon_size: 16,
        });
        this._muteButton.set_child(this._volumeIcon);

        this._muteButton.connect('clicked', () => {
            this._audio.toggleMute();
        });

        this._slider = new HorizontalSlider({
            min: 0.0,
            max: 1.0,
            value: clamp(this._audio.getVolume(), 0.0, 1.0),
            step: 0.03,
            precision: 0.0,
            height: 22,
            trackHeight: 4,
            handleRadius: 6,
        });

        if (this._settings)
            this._slider.setAccentColor(this._settings.accentColor);

        this._percentLabel = new St.Label({
            text: `${Math.round(clamp(this._audio.getVolume(), 0.0, 1.5) * 100)}%`,
            style_class: 'mce-volume-percent-label',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._slider.connect('value-changed', (_slider, val) => {
            if (this._destroyed)
                return;
            this._audio.setVolume(val);
            if (this._volumeIcon)
                this._volumeIcon.icon_name = this._audio.getVolumeIconName();
            if (this._percentLabel)
                this._percentLabel.text = `${Math.round(clamp(val, 0.0, 1.5) * 100)}%`;
        });

        this.actor.add_child(this._muteButton);
        this.actor.add_child(this._slider);
        this.actor.add_child(this._percentLabel);

        this._audioSignalId = this._audio.connect('volume-changed', () => {
            this._syncFromAudio();
        });

        this._syncFromAudio();
    }

    setAccentColor(hex) {
        if (this._destroyed || !this._slider)
            return;
        this._slider.setAccentColor(hex);
    }

    _syncFromAudio() {
        if (this._destroyed || !this.actor || !this._volumeIcon || !this._slider)
            return;
        this._volumeIcon.icon_name = this._audio.getVolumeIconName();
        const vol = clamp(this._audio.getVolume(), 0.0, 1.0);
        if (!this._slider.isDragging)
            this._slider.value = vol;
        if (this._percentLabel)
            this._percentLabel.text = `${Math.round(this._audio.getVolume() * 100)}%`;
    }

    destroy() {
        this._destroyed = true;
        if (this._audio && this._audioSignalId) {
            this._audio.disconnect(this._audioSignalId);
            this._audioSignalId = 0;
        }
        this._volumeIcon = null;
        this._slider = null;
        this._percentLabel = null;
        this.actor?.destroy();
        this.actor = null;
    }
}
