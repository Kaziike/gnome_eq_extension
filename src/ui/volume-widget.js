// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - Custom Horizontal Slider & Volume Control Widget

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import {clamp} from '../utils/helpers.js';

const TAU = Math.PI * 2;

/**
 * Custom Cairo-rendered Horizontal Slider matching the reference UI design
 * (electric blue active fill, dark rounded track, crisp white circular handle).
 * Built specifically for GNOME Shell 50/51 Clutter Gesture & ScrollController APIs.
 */
export const HorizontalSlider = GObject.registerClass({
    Signals: {
        'value-changed': {param_types: [GObject.TYPE_DOUBLE, GObject.TYPE_BOOLEAN]},
        'drag-begin': {},
        'drag-end': {param_types: [GObject.TYPE_DOUBLE]},
    },
}, class HorizontalSlider extends St.DrawingArea {
    _init(params = {}) {
        const {
            min = 0.0,
            max = 1.0,
            value = 0.0,
            step = 0.02,
            height = 22,
            trackHeight = 4,
            handleRadius = 6,
            styleClass = 'mce-horizontal-slider',
        } = params;

        super._init({
            style_class: styleClass,
            reactive: true,
            can_focus: true,
            track_hover: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._min = min;
        this._max = max;
        this._value = clamp(value, min, max);
        this._step = step;
        this._preferredHeight = height;
        this._trackHeight = trackHeight;
        this._handleRadius = handleRadius;
        this._dragging = false;
        this._interactive = true;

        this.set_height(this._preferredHeight);

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

    get isDragging() {
        return this._dragging;
    }

    get value() {
        return this._value;
    }

    set value(val) {
        const clamped = clamp(Number(val), this._min, this._max);
        if (Math.abs(this._value - clamped) < 1e-6)
            return;
        this._value = clamped;
        this.queue_repaint();
    }

    setInteractive(interactive) {
        this._interactive = Boolean(interactive);
        this.opacity = this._interactive ? 255 : 120;
        this.queue_repaint();
    }

    _xToValue(x) {
        const [width] = this.get_surface_size();
        const pad = this._handleRadius + 2;
        const usable = Math.max(1, width - pad * 2);
        const ratio = clamp((x - pad) / usable, 0.0, 1.0);
        return this._min + ratio * (this._max - this._min);
    }

    _setValueFromUser(nextVal, committed) {
        const clamped = clamp(nextVal, this._min, this._max);
        this._value = clamped;
        this.queue_repaint();
        this.emit('value-changed', this._value, Boolean(committed));
    }

    _onPanBegin() {
        if (!this._interactive)
            return Clutter.EVENT_PROPAGATE;

        this._dragging = true;
        this.emit('drag-begin');
        const coords = this._panGesture.get_centroid();
        this._setValueFromUser(this._xToValue(coords.x), false);
        return Clutter.EVENT_STOP;
    }

    _onPanUpdate() {
        if (!this._interactive || !this._dragging)
            return;

        const coords = this._panGesture.get_centroid();
        this._setValueFromUser(this._xToValue(coords.x), false);
    }

    _onPanEnd() {
        if (!this._dragging)
            return;

        this._dragging = false;
        this.queue_repaint();
        this.emit('value-changed', this._value, true);
        this.emit('drag-end', this._value);
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();

        if (width <= 0 || height <= 0) {
            cr.$dispose();
            return;
        }

        const pad = this._handleRadius + 2;
        const usableWidth = Math.max(1, width - pad * 2);
        const centerY = height / 2;
        const trackRadius = this._trackHeight / 2;

        const range = Math.max(1e-6, this._max - this._min);
        const fraction = clamp((this._value - this._min) / range, 0.0, 1.0);
        const handleX = pad + usableWidth * fraction;

        // 1. Background Track (Dark translucent pill)
        this._drawRoundedBar(
            cr,
            pad,
            centerY - trackRadius,
            usableWidth,
            this._trackHeight,
            trackRadius
        );
        cr.setSourceRGBA(1.0, 1.0, 1.0, 0.16);
        cr.fill();

        // 2. Active Track Fill (Electric Blue #257ef9)
        const activeWidth = Math.max(0, handleX - pad);
        if (activeWidth > 0.5) {
            this._drawRoundedBar(
                cr,
                pad,
                centerY - trackRadius,
                activeWidth,
                this._trackHeight,
                trackRadius
            );
            cr.setSourceRGBA(0.145, 0.494, 0.976, 1.0);
            cr.fill();
        }

        // 3. Circular Handle Thumb
        const radius = (this.hover || this._dragging)
            ? this._handleRadius + 1.0
            : this._handleRadius;

        if (this.hover || this._dragging) {
            cr.arc(handleX, centerY, radius + 3.0, 0, TAU);
            cr.setSourceRGBA(0.145, 0.494, 0.976, 0.28);
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
 * System Output Volume Row Widget (Speaker icon button + HorizontalSlider).
 */
export class VolumeWidget {
    /**
     * @param {import('../audio/pipewire.js').SystemAudioController} audioController
     */
    constructor(audioController) {
        this._audio = audioController;

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
            height: 22,
            trackHeight: 4,
            handleRadius: 6,
        });

        this._slider.connect('value-changed', (_slider, val) => {
            this._audio.setVolume(val);
            this._volumeIcon.icon_name = this._audio.getVolumeIconName();
        });

        this.actor.add_child(this._muteButton);
        this.actor.add_child(this._slider);

        this._audioSignalId = this._audio.connect('volume-changed', () => {
            this._syncFromAudio();
        });

        this._syncFromAudio();
    }

    _syncFromAudio() {
        this._volumeIcon.icon_name = this._audio.getVolumeIconName();
        if (!this._slider.isDragging)
            this._slider.value = clamp(this._audio.getVolume(), 0.0, 1.0);
    }

    destroy() {
        if (this._audio && this._audioSignalId) {
            this._audio.disconnect(this._audioSignalId);
            this._audioSignalId = 0;
        }
        this.actor?.destroy();
        this.actor = null;
    }
}
