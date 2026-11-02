// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - Header, Album Art, Output Selector & MPRIS Player Widget

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {HorizontalSlider} from './volume-widget.js';
import {clamp, formatDuration, Logger} from '../utils/helpers.js';

export class PlayerWidget {
    /**
     * @param {import('../mpris/manager.js').MprisManager} mprisManager
     * @param {import('../audio/pipewire.js').SystemAudioController} audioController
     * @param {import('../utils/settings.js').SettingsManager} settings
     * @param {string} extensionPath
     */
    constructor(mprisManager, audioController, settings, extensionPath) {
        this._mpris = mprisManager;
        this._audio = audioController;
        this._settings = settings;
        this._extensionPath = extensionPath;

        this._cancellable = new Gio.Cancellable();
        this._currentArtUrl = '';
        this._positionTimerId = 0;
        this._popupOpen = false;
        this._destroyed = false;

        this._cacheDir = GLib.build_filenamev([
            GLib.get_user_cache_dir(),
            'music-control-equalizer',
            'covers',
        ]);
        GLib.mkdir_with_parents(this._cacheDir, 0o700);

        this.actor = new St.BoxLayout({
            style_class: 'mce-player-section',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        this._buildHeader();
        this._buildDropdownDrawers();
        this._buildProgressSection();
        this._buildTransportControls();

        this._bindSignals();
        this._syncPlayerState();
        this._syncOutputDevice();
    }

    _buildHeader() {
        this._headerRow = new St.BoxLayout({
            style_class: 'mce-header-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        // 1. Album Art Button (56x56 rounded square)
        this._artButton = new St.Button({
            style_class: 'mce-album-art-button',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._artBox = new St.Bin({
            style_class: 'mce-album-art',
            width: 56,
            height: 56,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._fallbackArtIcon = new St.Icon({
            gicon: Gio.icon_new_for_string(`${this._extensionPath}/assets/music-note-symbolic.svg`),
            style_class: 'mce-album-art-fallback-icon',
            icon_size: 24,
        });
        this._artBox.set_child(this._fallbackArtIcon);
        this._artButton.set_child(this._artBox);

        this._artButton.connect('clicked', () => {
            this._mpris.activePlayer?.raisePlayerApp();
        });

        // 2. Track Info Column (Title, Artist/Album, Player Selector badge)
        this._metaColumn = new St.BoxLayout({
            style_class: 'mce-meta-column',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._titleLabel = new St.Label({
            text: 'No Media Playing',
            style_class: 'mce-track-title',
            x_align: Clutter.ActorAlign.START,
        });
        this._titleLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._artistRow = new St.BoxLayout({
            style_class: 'mce-artist-row',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._artistLabel = new St.Label({
            text: 'Open a media player to start playback',
            style_class: 'mce-track-artist',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });
        this._artistLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        // Compact MPRIS Player switcher badge (shown when >= 2 players or active player)
        this._playerBadgeButton = new St.Button({
            style_class: 'mce-player-badge',
            can_focus: true,
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const playerBadgeBox = new St.BoxLayout({
            style_class: 'mce-player-badge-box',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._playerBadgeIcon = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: 11,
            style_class: 'mce-player-badge-icon',
        });
        this._playerBadgeLabel = new St.Label({
            text: 'Player',
            style_class: 'mce-player-badge-label',
        });
        this._playerBadgeArrow = new St.Icon({
            icon_name: 'pan-down-symbolic',
            icon_size: 10,
            style_class: 'mce-pill-arrow',
        });
        playerBadgeBox.add_child(this._playerBadgeIcon);
        playerBadgeBox.add_child(this._playerBadgeLabel);
        playerBadgeBox.add_child(this._playerBadgeArrow);
        this._playerBadgeButton.set_child(playerBadgeBox);

        this._playerBadgeButton.connect('clicked', () => {
            this._togglePlayerListDrawer();
        });

        this._artistRow.add_child(this._artistLabel);
        this._artistRow.add_child(this._playerBadgeButton);

        this._metaColumn.add_child(this._titleLabel);
        this._metaColumn.add_child(this._artistRow);

        // 3. Hardware Audio Output Device Dropdown Pill (Right side of Header)
        this._outputButton = new St.Button({
            style_class: 'mce-output-pill',
            can_focus: true,
            y_align: Clutter.ActorAlign.START,
        });

        const outputPillBox = new St.BoxLayout({
            style_class: 'mce-output-pill-box',
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._outputIcon = new St.Icon({
            icon_name: 'audio-headphones-symbolic',
            icon_size: 14,
            style_class: 'mce-output-pill-icon',
        });

        this._outputLabel = new St.Label({
            text: 'Headphones',
            style_class: 'mce-output-pill-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._outputLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        this._outputArrow = new St.Icon({
            icon_name: 'pan-down-symbolic',
            icon_size: 12,
            style_class: 'mce-pill-arrow',
            y_align: Clutter.ActorAlign.CENTER,
        });

        outputPillBox.add_child(this._outputIcon);
        outputPillBox.add_child(this._outputLabel);
        outputPillBox.add_child(this._outputArrow);
        this._outputButton.set_child(outputPillBox);

        this._outputButton.connect('clicked', () => {
            this._toggleOutputDrawer();
        });

        this._headerRow.add_child(this._artButton);
        this._headerRow.add_child(this._metaColumn);
        this._headerRow.add_child(this._outputButton);

        this.actor.add_child(this._headerRow);
    }

    _buildDropdownDrawers() {
        // Collapsible drawer for Audio Output Device selection
        this._outputDrawer = new St.BoxLayout({
            style_class: 'mce-dropdown-drawer',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            visible: false,
        });

        // Collapsible drawer for MPRIS Player selection
        this._playerDrawer = new St.BoxLayout({
            style_class: 'mce-dropdown-drawer',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            visible: false,
        });

        this.actor.add_child(this._outputDrawer);
        this.actor.add_child(this._playerDrawer);
    }

    _buildProgressSection() {
        this._progressContainer = new St.BoxLayout({
            style_class: 'mce-progress-container',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        this._progressSlider = new HorizontalSlider({
            min: 0.0,
            max: 1.0,
            value: 0.0,
            step: 0.02,
            precision: 0.0,
            height: 20,
            trackHeight: 4,
            handleRadius: 6,
            styleClass: 'mce-progress-slider',
        });

        this._progressSlider.connect('value-changed', (_slider, val, committed) => {
            const player = this._mpris.activePlayer;
            if (!player || player.lengthUs <= 0)
                return;

            const previewUs = val * player.lengthUs;
            this._updateTimeLabels(previewUs, player.lengthUs);

            if (committed)
                player.seekToFraction(val);
        });

        const timeRow = new St.BoxLayout({
            style_class: 'mce-time-row',
            x_expand: true,
        });

        this._elapsedLabel = new St.Label({
            text: '00:00',
            style_class: 'mce-time-label',
            x_align: Clutter.ActorAlign.START,
            x_expand: true,
        });

        this._durationButton = new St.Button({
            style_class: 'mce-time-toggle-button',
            can_focus: true,
            x_align: Clutter.ActorAlign.END,
        });
        this._durationLabel = new St.Label({
            text: '-00:00',
            style_class: 'mce-time-label',
        });
        this._durationButton.set_child(this._durationLabel);

        this._durationButton.connect('clicked', () => {
            this._settings.showRemainingTime = !this._settings.showRemainingTime;
            this._syncProgress();
        });

        timeRow.add_child(this._elapsedLabel);
        timeRow.add_child(this._durationButton);

        this._progressContainer.add_child(this._progressSlider);
        this._progressContainer.add_child(timeRow);

        this.actor.add_child(this._progressContainer);
    }

    _buildTransportControls() {
        this._controlsRow = new St.BoxLayout({
            style_class: 'mce-controls-row',
            x_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
        });

        this._shuffleBtn = this._createTransportButton(
            'media-playlist-shuffle-symbolic',
            'mce-control-button',
            18,
            () => this._mpris.activePlayer?.toggleShuffle()
        );

        this._prevBtn = this._createTransportButton(
            'media-skip-backward-symbolic',
            'mce-control-button',
            20,
            () => this._mpris.activePlayer?.previous()
        );

        this._playPauseBtn = new St.Button({
            style_class: 'mce-play-button',
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._playPauseIcon = new St.Icon({
            icon_name: 'media-playback-start-symbolic',
            style_class: 'mce-play-icon',
            icon_size: 20,
        });
        this._playPauseBtn.set_child(this._playPauseIcon);
        this._playPauseBtn.connect('clicked', () => {
            this._mpris.activePlayer?.playPause();
        });

        this._nextBtn = this._createTransportButton(
            'media-skip-forward-symbolic',
            'mce-control-button',
            20,
            () => this._mpris.activePlayer?.next()
        );

        this._repeatBtn = this._createTransportButton(
            'media-playlist-repeat-symbolic',
            'mce-control-button',
            18,
            () => this._mpris.activePlayer?.cycleLoopStatus()
        );

        // Wrap each button in an expanding bin so all 5 controls distribute evenly across the row
        const buttons = [
            this._shuffleBtn.button,
            this._prevBtn.button,
            this._playPauseBtn,
            this._nextBtn.button,
            this._repeatBtn.button,
        ];

        for (const btn of buttons) {
            const wrapper = new St.Bin({
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                child: btn,
            });
            this._controlsRow.add_child(wrapper);
        }

        this.actor.add_child(this._controlsRow);
    }

    _createTransportButton(iconName, styleClass, iconSize, onClick) {
        const button = new St.Button({
            style_class: styleClass,
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        const icon = new St.Icon({
            icon_name: iconName,
            icon_size: iconSize,
        });
        button.set_child(icon);
        button.connect('clicked', onClick);
        return {button, icon};
    }

    _bindSignals() {
        this._mprisSignalIds = [
            this._mpris.connect('active-player-changed', () => {
                if (this._destroyed || !this.actor)
                    return;
                this._syncPlayerState();
                this._updatePositionTimerState();
            }),
            this._mpris.connect('active-player-updated', () => {
                if (this._destroyed || !this.actor)
                    return;
                this._syncPlayerState();
                this._updatePositionTimerState();
            }),
            this._mpris.connect('active-position-changed', () => {
                if (this._destroyed || !this.actor)
                    return;
                this._syncProgress();
            }),
            this._mpris.connect('players-changed', () => {
                if (this._destroyed || !this.actor)
                    return;
                this._syncPlayerBadge();
                if (this._playerDrawer?.visible)
                    this._populatePlayerDrawer();
            }),
        ];

        this._audioSignalIds = [
            this._audio.connect('active-device-changed', () => {
                if (this._destroyed || !this.actor)
                    return;
                this._syncOutputDevice();
            }),
            this._audio.connect('devices-changed', () => {
                if (this._destroyed || !this.actor)
                    return;
                this._syncOutputDevice();
                if (this._outputDrawer?.visible)
                    this._populateOutputDrawer();
            }),
        ];
    }

    setPopupOpen(isOpen) {
        if (this._destroyed || !this.actor)
            return;
        this._popupOpen = Boolean(isOpen);
        if (!this._popupOpen) {
            this._outputDrawer.visible = false;
            this._playerDrawer.visible = false;
        } else {
            this._mpris.activePlayer?.refreshPosition();
            this._syncPlayerState();
        }
        this._updatePositionTimerState();
    }

    _updatePositionTimerState() {
        if (this._positionTimerId) {
            GLib.Source.remove(this._positionTimerId);
            this._positionTimerId = 0;
        }

        const player = this._mpris.activePlayer;
        if (!this._popupOpen || !player || !player.isPlaying)
            return;

        this._positionTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            if (!this._popupOpen || !this._mpris.activePlayer?.isPlaying) {
                this._positionTimerId = 0;
                return GLib.SOURCE_REMOVE;
            }
            this._syncProgress();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _toggleOutputDrawer() {
        this._playerDrawer.visible = false;
        this._outputDrawer.visible = !this._outputDrawer.visible;
        if (this._outputDrawer.visible)
            this._populateOutputDrawer();
    }

    _populateOutputDrawer() {
        this._outputDrawer.destroy_all_children();
        const devices = this._audio.getOutputDevices();

        if (devices.length === 0) {
            const emptyLabel = new St.Label({
                text: 'No hardware audio output devices found',
                style_class: 'mce-drawer-empty',
            });
            this._outputDrawer.add_child(emptyLabel);
            return;
        }

        for (const dev of devices) {
            const itemBtn = new St.Button({
                style_class: dev.isActive
                    ? 'mce-drawer-item mce-drawer-item-active'
                    : 'mce-drawer-item',
                x_expand: true,
                can_focus: true,
            });

            const row = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const icon = new St.Icon({
                icon_name: dev.iconName,
                icon_size: 14,
                style_class: 'mce-drawer-item-icon',
            });

            const label = new St.Label({
                text: dev.fullLabel,
                style_class: 'mce-drawer-item-label',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            row.add_child(icon);
            row.add_child(label);

            if (dev.isActive) {
                const check = new St.Icon({
                    icon_name: 'object-select-symbolic',
                    icon_size: 13,
                    style_class: 'mce-drawer-item-check',
                });
                row.add_child(check);
            }

            itemBtn.set_child(row);
            itemBtn.connect('clicked', () => {
                this._audio.setActiveDevice(dev.id);
                this._outputDrawer.visible = false;
            });

            this._outputDrawer.add_child(itemBtn);
        }
    }

    _togglePlayerListDrawer() {
        this._outputDrawer.visible = false;
        const players = this._mpris.players;
        if (players.length <= 1) {
            this._playerDrawer.visible = false;
            this._mpris.activePlayer?.raisePlayerApp();
            return;
        }

        this._playerDrawer.visible = !this._playerDrawer.visible;
        if (this._playerDrawer.visible)
            this._populatePlayerDrawer();
    }

    _populatePlayerDrawer() {
        this._playerDrawer.destroy_all_children();
        const players = this._mpris.players;
        const activeBus = this._mpris.activePlayer?.busName;

        for (const p of players) {
            const isActive = p.busName === activeBus;
            const itemBtn = new St.Button({
                style_class: isActive
                    ? 'mce-drawer-item mce-drawer-item-active'
                    : 'mce-drawer-item',
                x_expand: true,
                can_focus: true,
            });

            const row = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const icon = new St.Icon({
                icon_name: p.iconName,
                icon_size: 14,
                style_class: 'mce-drawer-item-icon',
            });

            const statusText = p.isPlaying ? 'Playing' : p.playbackStatus;
            const label = new St.Label({
                text: `${p.identity} — ${p.title} (${statusText})`,
                style_class: 'mce-drawer-item-label',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            row.add_child(icon);
            row.add_child(label);

            if (isActive) {
                const check = new St.Icon({
                    icon_name: 'object-select-symbolic',
                    icon_size: 13,
                    style_class: 'mce-drawer-item-check',
                });
                row.add_child(check);
            }

            itemBtn.set_child(row);
            itemBtn.connect('clicked', () => {
                this._mpris.setActivePlayer(p.busName);
                this._playerDrawer.visible = false;
            });

            this._playerDrawer.add_child(itemBtn);
        }
    }

    _syncOutputDevice() {
        if (this._destroyed || !this.actor || !this._outputIcon || !this._outputLabel)
            return;
        const active = this._audio.getActiveDevice();
        this._outputIcon.icon_name = active.iconName || 'audio-headphones-symbolic';
        this._outputLabel.text = active.shortLabel || 'Headphones';
    }

    _syncPlayerBadge() {
        if (this._destroyed || !this.actor || !this._playerBadgeButton)
            return;
        const players = this._mpris.players;
        const active = this._mpris.activePlayer;

        if (!active) {
            this._playerBadgeButton.visible = false;
            return;
        }

        this._playerBadgeButton.visible = true;
        this._playerBadgeIcon.icon_name = active.iconName;
        this._playerBadgeLabel.text = players.length > 1
            ? `${active.identity} (${players.length})`
            : active.identity;
        this._playerBadgeArrow.visible = players.length > 1;
    }

    _syncPlayerState() {
        if (this._destroyed || !this.actor)
            return;
        const player = this._mpris.activePlayer;
        this._syncPlayerBadge();

        if (!player) {
            this._titleLabel.text = 'No Active Media Player';
            this._artistLabel.text = 'Play music in Spotify, Brave, Firefox, or VLC';
            this._setAlbumArt('');
            this._playPauseIcon.icon_name = 'media-playback-start-symbolic';
            this._shuffleBtn.button.remove_style_class_name('active');
            this._repeatBtn.button.remove_style_class_name('active');
            this._repeatBtn.icon.icon_name = 'media-playlist-repeat-symbolic';
            this._progressSlider.setInteractive(false);
            this._progressSlider.value = 0;
            this._elapsedLabel.text = '00:00';
            this._durationLabel.text = '-00:00';
            this._setTransportSensitivity(false);
            return;
        }

        this._setTransportSensitivity(true);
        this._titleLabel.text = player.title;

        const artistText = player.artist;
        const albumText = player.album;
        this._artistLabel.text = albumText && albumText !== player.title
            ? `${artistText} • ${albumText}`
            : artistText;

        this._setAlbumArt(player.artUrl);

        this._playPauseIcon.icon_name = player.isPlaying
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';

        if (player.shuffle)
            this._shuffleBtn.button.add_style_class_name('active');
        else
            this._shuffleBtn.button.remove_style_class_name('active');

        const loop = player.loopStatus;
        if (loop === 'Track') {
            this._repeatBtn.icon.icon_name = 'media-playlist-repeat-song-symbolic';
            this._repeatBtn.button.add_style_class_name('active');
        } else if (loop === 'Playlist') {
            this._repeatBtn.icon.icon_name = 'media-playlist-repeat-symbolic';
            this._repeatBtn.button.add_style_class_name('active');
        } else {
            this._repeatBtn.icon.icon_name = 'media-playlist-repeat-symbolic';
            this._repeatBtn.button.remove_style_class_name('active');
        }

        this._syncProgress();
    }

    _setTransportSensitivity(hasPlayer) {
        const opacity = hasPlayer ? 255 : 110;
        this._shuffleBtn.button.reactive = hasPlayer;
        this._prevBtn.button.reactive = hasPlayer;
        this._playPauseBtn.reactive = hasPlayer;
        this._nextBtn.button.reactive = hasPlayer;
        this._repeatBtn.button.reactive = hasPlayer;

        this._shuffleBtn.button.opacity = opacity;
        this._prevBtn.button.opacity = opacity;
        this._playPauseBtn.opacity = opacity;
        this._nextBtn.button.opacity = opacity;
        this._repeatBtn.button.opacity = opacity;
    }

    _syncProgress() {
        if (this._destroyed || !this.actor || !this._progressSlider)
            return;
        const player = this._mpris.activePlayer;
        if (!player)
            return;

        const lenUs = player.lengthUs;
        const posUs = player.positionUs;

        if (lenUs > 0) {
            this._progressSlider.setInteractive(true);
            if (!this._progressSlider.isDragging)
                this._progressSlider.value = clamp(posUs / lenUs, 0.0, 1.0);
        } else {
            this._progressSlider.setInteractive(false);
            if (!this._progressSlider.isDragging)
                this._progressSlider.value = 0.0;
        }

        if (!this._progressSlider.isDragging)
            this._updateTimeLabels(posUs, lenUs);
    }

    _updateTimeLabels(posUs, lenUs) {
        this._elapsedLabel.text = formatDuration(posUs, false);
        if (lenUs <= 0) {
            this._durationLabel.text = '-00:00';
            return;
        }

        if (this._settings.showRemainingTime) {
            const remUs = Math.max(0, lenUs - posUs);
            this._durationLabel.text = formatDuration(remUs, true);
        } else {
            this._durationLabel.text = formatDuration(lenUs, false);
        }
    }

    _setAlbumArt(artUrl) {
        if (this._currentArtUrl === artUrl)
            return;
        this._currentArtUrl = artUrl;

        if (!artUrl) {
            this._applyFallbackArt();
            return;
        }

        if (artUrl.startsWith('file://')) {
            try {
                const file = Gio.File.new_for_uri(artUrl);
                if (file.query_exists(null)) {
                    this._applyCoverFileUri(artUrl);
                    return;
                }
            } catch (_e) {
                // Fallback below
            }
            this._applyFallbackArt();
            return;
        }

        if (artUrl.startsWith('/')) {
            const file = Gio.File.new_for_path(artUrl);
            if (file.query_exists(null)) {
                this._applyCoverFileUri(file.get_uri());
                return;
            }
            this._applyFallbackArt();
            return;
        }

        if (artUrl.startsWith('data:image/')) {
            try {
                const commaIdx = artUrl.indexOf(',');
                if (commaIdx > 0) {
                    const base64Data = artUrl.slice(commaIdx + 1);
                    const bytes = GLib.base64_decode(base64Data);
                    const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, artUrl, -1).slice(0, 16);
                    const destPath = GLib.build_filenamev([this._cacheDir, `${hash}.img`]);
                    GLib.file_set_contents(destPath, bytes);
                    const fileUri = Gio.File.new_for_path(destPath).get_uri();
                    this._applyCoverFileUri(fileUri);
                    return;
                }
            } catch (e) {
                Logger.warn('Failed to decode base64 album art', e);
            }
            this._applyFallbackArt();
            return;
        }

        if (artUrl.startsWith('http://') || artUrl.startsWith('https://')) {
            const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, artUrl, -1).slice(0, 20);
            const destPath = GLib.build_filenamev([this._cacheDir, `${hash}.img`]);
            const destFile = Gio.File.new_for_path(destPath);

            if (destFile.query_exists(null)) {
                this._applyCoverFileUri(destFile.get_uri());
                return;
            }

            this._applyFallbackArt();
            this._downloadCoverArt(artUrl, destPath, destFile);
            return;
        }

        this._applyFallbackArt();
    }

    _downloadCoverArt(url, destPath, destFile) {
        const curlPath = GLib.find_program_in_path('curl');
        if (!curlPath)
            return;

        try {
            const proc = Gio.Subprocess.new(
                [curlPath, '-s', '-L', '--max-time', '5', '-o', destPath, url],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            proc.wait_async(this._cancellable, (source, res) => {
                try {
                    source.wait_finish(res);
                    if (source.get_successful() &&
                        this._currentArtUrl === url &&
                        destFile.query_exists(null)) {
                        this._applyCoverFileUri(destFile.get_uri());
                    }
                } catch (_e) {
                    // Ignore cancelled download
                }
            });
        } catch (_e) {
            // Ignore
        }
    }

    _applyCoverFileUri(fileUri) {
        if (this._destroyed || !this._artBox)
            return;
        this._fallbackArtIcon.visible = false;
        this._artBox.style = `background-image: url("${fileUri}"); background-size: cover; background-position: center;`;
    }

    _applyFallbackArt() {
        if (this._destroyed || !this._artBox)
            return;
        this._artBox.style = null;
        this._fallbackArtIcon.visible = true;
    }

    destroy() {
        this._destroyed = true;
        this._popupOpen = false;

        if (this._positionTimerId) {
            GLib.Source.remove(this._positionTimerId);
            this._positionTimerId = 0;
        }

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._mpris && this._mprisSignalIds) {
            for (const id of this._mprisSignalIds)
                this._mpris.disconnect(id);
            this._mprisSignalIds = [];
        }

        if (this._audio && this._audioSignalIds) {
            for (const id of this._audioSignalIds)
                this._audio.disconnect(id);
            this._audioSignalIds = [];
        }

        this.actor?.destroy();
        this.actor = null;
    }
}
