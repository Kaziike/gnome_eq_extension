// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - MPRIS v2.2 Player Controller

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import {
    clamp,
    formatPlayerName,
    getPlayerIconName,
    Logger,
} from '../utils/helpers.js';

const MPRIS_OBJECT_PATH = '/org/mpris/MediaPlayer2';

const MPRIS_ROOT_IFACE_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <method name="Raise"/>
    <method name="Quit"/>
    <property name="CanQuit" type="b" access="read"/>
    <property name="CanRaise" type="b" access="read"/>
    <property name="HasTrackList" type="b" access="read"/>
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
  </interface>
</node>`;

const MPRIS_PLAYER_IFACE_XML = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Pause"/>
    <method name="PlayPause"/>
    <method name="Stop"/>
    <method name="Play"/>
    <method name="Seek">
      <arg direction="in" name="Offset" type="x"/>
    </method>
    <method name="SetPosition">
      <arg direction="in" name="TrackId" type="o"/>
      <arg direction="in" name="Position" type="x"/>
    </method>
    <method name="OpenUri">
      <arg direction="in" name="Uri" type="s"/>
    </method>
    <signal name="Seeked">
      <arg name="Position" type="x"/>
    </signal>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="LoopStatus" type="s" access="readwrite"/>
    <property name="Rate" type="d" access="readwrite"/>
    <property name="Shuffle" type="b" access="readwrite"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="Volume" type="d" access="readwrite"/>
    <property name="Position" type="x" access="read"/>
    <property name="MinimumRate" type="d" access="read"/>
    <property name="MaximumRate" type="d" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanPlay" type="b" access="read"/>
    <property name="CanPause" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
    <property name="CanControl" type="b" access="read"/>
  </interface>
</node>`;

const MprisRootProxy = Gio.DBusProxy.makeProxyWrapper(MPRIS_ROOT_IFACE_XML);
const MprisPlayerProxy = Gio.DBusProxy.makeProxyWrapper(MPRIS_PLAYER_IFACE_XML);

export class MprisPlayerController extends EventEmitter {
    /**
     * @param {string} busName
     */
    constructor(busName) {
        super();

        this._busName = busName;
        this._destroyed = false;
        this._cancellable = new Gio.Cancellable();

        this._rootProxy = null;
        this._playerProxy = null;
        this._rootSignalIds = [];
        this._playerSignalIds = [];
        this._seekedSignalId = 0;

        this._identity = formatPlayerName(busName);
        this._desktopEntry = '';
        this._iconName = getPlayerIconName(busName);

        this._playbackStatus = 'Stopped';
        this._loopStatus = 'None';
        this._shuffle = false;
        this._shuffleSupported = false;
        this._loopSupported = false;
        this._rate = 1.0;

        this._canPlay = false;
        this._canPause = false;
        this._canGoNext = false;
        this._canGoPrevious = false;
        this._canSeek = false;
        this._canControl = true;

        this._trackId = null;
        this._title = '';
        this._artist = '';
        this._album = '';
        this._artUrl = '';
        this._url = '';
        this._lengthUs = 0;

        this._positionUs = 0;
        this._positionTimestampUs = GLib.get_monotonic_time();

        this._initProxies();
    }

    _initProxies() {
        try {
            this._rootProxy = new MprisRootProxy(
                Gio.DBus.session,
                this._busName,
                MPRIS_OBJECT_PATH,
                (proxy, error) => {
                    if (this._destroyed)
                        return;
                    if (error) {
                        Logger.warn(`Failed to initialize MPRIS root proxy for ${this._busName}`, error);
                        return;
                    }
                    this._onRootProxyReady();
                },
                this._cancellable
            );

            this._playerProxy = new MprisPlayerProxy(
                Gio.DBus.session,
                this._busName,
                MPRIS_OBJECT_PATH,
                (proxy, error) => {
                    if (this._destroyed)
                        return;
                    if (error) {
                        Logger.warn(`Failed to initialize MPRIS player proxy for ${this._busName}`, error);
                        return;
                    }
                    this._onPlayerProxyReady();
                },
                this._cancellable
            );
        } catch (e) {
            Logger.error(`Error creating proxies for ${this._busName}`, e);
        }
    }

    _onRootProxyReady() {
        if (this._destroyed || !this._rootProxy)
            return;

        this._rootSignalIds.push(
            this._rootProxy.connect('g-properties-changed', () => this._syncRootProperties()),
            this._rootProxy.connect('notify::g-name-owner', () => {
                if (!this._rootProxy?.g_name_owner)
                    this.emit('closed');
            })
        );

        this._syncRootProperties();
    }

    _onPlayerProxyReady() {
        if (this._destroyed || !this._playerProxy)
            return;

        this._playerSignalIds.push(
            this._playerProxy.connect('g-properties-changed', (_proxy, changed) => {
                this._syncPlayerProperties(changed);
            })
        );

        this._seekedSignalId = this._playerProxy.connectSignal('Seeked', (_proxy, _sender, [pos]) => {
            if (this._destroyed)
                return;
            const newPos = Number(pos);
            if (Number.isFinite(newPos) && newPos >= 0) {
                this._positionUs = newPos;
                this._positionTimestampUs = GLib.get_monotonic_time();
                this.emit('position-changed', this.positionUs);
            }
        });

        this._syncPlayerProperties(null);
        this.refreshPosition();
        this.emit('ready');
    }

    _syncRootProperties() {
        if (!this._rootProxy)
            return;

        const identity = this._rootProxy.Identity;
        const desktopEntry = this._rootProxy.DesktopEntry || '';
        this._desktopEntry = desktopEntry;
        this._identity = formatPlayerName(this._busName, identity || '');
        this._iconName = getPlayerIconName(this._busName, desktopEntry);

        if (desktopEntry && typeof global !== 'undefined' && global.stage) {
            try {
                const appSys = Shell.AppSystem.get_default();
                const app = appSys?.lookup_app(`${desktopEntry}.desktop`);
                if (app && app.get_name())
                    this._identity = app.get_name();
            } catch (_e) {
                // Fallback to Identity property
            }
        }

        this.emit('changed');
    }

    _syncPlayerProperties(changedVariant = null) {
        if (!this._playerProxy)
            return;

        const prevTrackId = this._trackId;
        const prevTitle = this._title;
        const prevStatus = this._playbackStatus;

        this._playbackStatus = this._playerProxy.PlaybackStatus || 'Stopped';
        this._canPlay = Boolean(this._playerProxy.CanPlay ?? true);
        this._canPause = Boolean(this._playerProxy.CanPause ?? true);
        this._canGoNext = Boolean(this._playerProxy.CanGoNext ?? false);
        this._canGoPrevious = Boolean(this._playerProxy.CanGoPrevious ?? false);
        this._canSeek = Boolean(this._playerProxy.CanSeek ?? false);
        this._canControl = Boolean(this._playerProxy.CanControl ?? true);

        const rate = Number(this._playerProxy.Rate);
        this._rate = Number.isFinite(rate) && rate > 0 ? rate : 1.0;

        const loopVar = this._playerProxy.get_cached_property('LoopStatus');
        this._loopSupported = loopVar !== null;
        this._loopStatus = loopVar ? loopVar.unpack() : 'None';

        const shuffleVar = this._playerProxy.get_cached_property('Shuffle');
        this._shuffleSupported = shuffleVar !== null;
        this._shuffle = shuffleVar ? Boolean(shuffleVar.unpack()) : false;

        const posVar = this._playerProxy.get_cached_property('Position');
        if (posVar !== null) {
            const rawPos = Number(posVar.deepUnpack());
            if (Number.isFinite(rawPos) && rawPos >= 0) {
                this._positionUs = rawPos;
                this._positionTimestampUs = GLib.get_monotonic_time();
            }
        }

        this._parseMetadata(this._playerProxy.Metadata);

        const trackChanged = this._trackId !== prevTrackId || this._title !== prevTitle;
        const statusChanged = this._playbackStatus !== prevStatus;

        if (trackChanged || statusChanged || changedVariant)
            this.refreshPosition();

        this.emit('changed');
    }

    _parseMetadata(rawMeta) {
        if (!rawMeta || typeof rawMeta !== 'object') {
            this._trackId = null;
            this._title = '';
            this._artist = '';
            this._album = '';
            this._artUrl = '';
            this._url = '';
            this._lengthUs = 0;
            return;
        }

        const unpacked = {};
        for (const [key, variant] of Object.entries(rawMeta)) {
            try {
                unpacked[key] = variant?.deepUnpack ? variant.deepUnpack() : variant;
            } catch (_e) {
                // Skip malformed entry
            }
        }

        this._trackId = typeof unpacked['mpris:trackid'] === 'string'
            ? unpacked['mpris:trackid']
            : null;

        this._title = typeof unpacked['xesam:title'] === 'string'
            ? unpacked['xesam:title'].trim()
            : '';

        const rawArtists = unpacked['xesam:artist'] ?? unpacked['xesam:albumArtist'];
        if (Array.isArray(rawArtists)) {
            this._artist = rawArtists
                .filter(a => typeof a === 'string' && a.trim().length > 0)
                .join(', ');
        } else if (typeof rawArtists === 'string') {
            this._artist = rawArtists.trim();
        } else {
            this._artist = '';
        }

        this._album = typeof unpacked['xesam:album'] === 'string'
            ? unpacked['xesam:album'].trim()
            : '';

        this._artUrl = typeof unpacked['mpris:artUrl'] === 'string'
            ? unpacked['mpris:artUrl'].trim()
            : '';

        this._url = typeof unpacked['xesam:url'] === 'string'
            ? unpacked['xesam:url'].trim()
            : '';

        const rawLen = Number(unpacked['mpris:length']);
        this._lengthUs = Number.isFinite(rawLen) && rawLen > 0 ? rawLen : 0;
    }

    /**
     * Query the authoritative Position property over D-Bus without blocking.
     */
    refreshPosition() {
        if (this._destroyed || !this._playerProxy)
            return;

        Gio.DBus.session.call(
            this._busName,
            MPRIS_OBJECT_PATH,
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
            new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE,
            1500,
            this._cancellable,
            (conn, res) => {
                if (this._destroyed)
                    return;
                try {
                    const reply = conn.call_finish(res);
                    const [innerVariant] = reply.deepUnpack();
                    const pos = Number(innerVariant?.deepUnpack ? innerVariant.deepUnpack() : innerVariant);
                    if (Number.isFinite(pos) && pos >= 0) {
                        this._positionUs = pos;
                        this._positionTimestampUs = GLib.get_monotonic_time();
                        this.emit('position-changed', this.positionUs);
                    }
                } catch (_e) {
                    // Some players don't implement Position property; ignore silently
                }
            }
        );
    }

    get busName() {
        return this._busName;
    }

    get identity() {
        return this._identity || 'Media Player';
    }

    get iconName() {
        return this._iconName;
    }

    get playbackStatus() {
        return this._playbackStatus;
    }

    get isPlaying() {
        return this._playbackStatus === 'Playing';
    }

    get loopStatus() {
        return this._loopStatus;
    }

    get loopSupported() {
        return this._loopSupported;
    }

    get shuffle() {
        return this._shuffle;
    }

    get shuffleSupported() {
        return this._shuffleSupported;
    }

    get canPlay() {
        return this._canPlay || this._canControl;
    }

    get canPause() {
        return this._canPause || this._canControl;
    }

    get canGoNext() {
        return this._canGoNext;
    }

    get canGoPrevious() {
        return this._canGoPrevious;
    }

    get canSeek() {
        return this._canSeek && this._lengthUs > 0;
    }

    get title() {
        return this._title || 'Unknown Title';
    }

    get hasMetadata() {
        return Boolean(this._title || this._artist || this._playbackStatus !== 'Stopped');
    }

    get artist() {
        return this._artist || 'Unknown Artist';
    }

    get album() {
        return this._album || '';
    }

    get artUrl() {
        return this._artUrl || '';
    }

    get url() {
        return this._url || '';
    }

    /**
     * Detect whether the active MPRIS stream is likely a video stream and return
     * real source metadata without faking thumbnails or embedding video.
     *
     * @returns {{isVideo: boolean, sourceLabel: string, detailLabel: string, iconName: string}}
     */
    get mediaSourceInfo() {
        const lowerBus = `${this._busName} ${this._desktopEntry} ${this._identity}`.toLowerCase();
        const lowerUrl = (this._url || '').toLowerCase();
        const lowerTitle = (this._title || '').toLowerCase();
        const lowerAlbum = (this._album || '').toLowerCase();

        const isVideoApp =
            lowerBus.includes('vlc') ||
            lowerBus.includes('mpv') ||
            lowerBus.includes('celluloid') ||
            lowerBus.includes('totem') ||
            lowerBus.includes('clapper') ||
            lowerBus.includes('haruna') ||
            lowerBus.includes('smplayer');

        const isVideoFile = /\.(mp4|mkv|webm|avi|mov|flv|m4v|ts)(\?|$)/i.test(lowerUrl);
        const isYouTube =
            lowerUrl.includes('youtube.com') ||
            lowerUrl.includes('youtu.be') ||
            lowerTitle.includes('youtube') ||
            lowerAlbum.includes('youtube');
        const isTwitchOrVimeo =
            lowerUrl.includes('twitch.tv') ||
            lowerUrl.includes('vimeo.com') ||
            lowerUrl.includes('bilibili.com');

        const isBrowser =
            lowerBus.includes('firefox') ||
            lowerBus.includes('brave') ||
            lowerBus.includes('chrom') ||
            lowerBus.includes('edge') ||
            lowerBus.includes('zen') ||
            lowerBus.includes('vivaldi') ||
            lowerBus.includes('opera');

        const isVideo = isVideoApp || isVideoFile || isYouTube || isTwitchOrVimeo;

        if (isYouTube) {
            return {
                isVideo: true,
                sourceLabel: 'Playing as Audio – YouTube',
                detailLabel: `${this.identity} • Video Stream`,
                iconName: 'video-x-generic-symbolic',
            };
        }

        if (isTwitchOrVimeo) {
            return {
                isVideo: true,
                sourceLabel: `Playing as Audio – ${this.identity}`,
                detailLabel: 'Web Video Stream',
                iconName: 'video-x-generic-symbolic',
            };
        }

        if (isVideoApp || isVideoFile) {
            return {
                isVideo: true,
                sourceLabel: `Playing Video from ${this.identity}`,
                detailLabel: this._album || 'Video Media Player',
                iconName: 'video-x-generic-symbolic',
            };
        }

        if (isBrowser) {
            return {
                isVideo: false,
                sourceLabel: `Playing from ${this.identity}`,
                detailLabel: this._album || 'Web Media Playback',
                iconName: this.iconName,
            };
        }

        return {
            isVideo: false,
            sourceLabel: `Playing from ${this.identity}`,
            detailLabel: this._album || 'MPRIS Audio Source',
            iconName: this.iconName,
        };
    }

    get lengthUs() {
        return this._lengthUs;
    }

    /**
     * Calculate smooth current position in microseconds.
     *
     * @returns {number}
     */
    get positionUs() {
        let pos = this._positionUs;
        if (this.isPlaying) {
            const elapsedUs = GLib.get_monotonic_time() - this._positionTimestampUs;
            if (elapsedUs > 0)
                pos += elapsedUs * this._rate;
        }
        if (this._lengthUs > 0)
            return clamp(pos, 0, this._lengthUs);
        return Math.max(0, pos);
    }

    playPause() {
        if (!this._playerProxy)
            return;
        this._playerProxy.PlayPauseAsync().catch(e => {
            Logger.warn(`PlayPause failed on ${this._busName}`, e);
        });
    }

    next() {
        if (!this._playerProxy)
            return;
        this._playerProxy.NextAsync().catch(e => {
            Logger.warn(`Next failed on ${this._busName}`, e);
        });
    }

    previous() {
        if (!this._playerProxy)
            return;
        this._playerProxy.PreviousAsync().catch(e => {
            Logger.warn(`Previous failed on ${this._busName}`, e);
        });
    }

    toggleShuffle() {
        if (!this._playerProxy)
            return;
        const target = !this._shuffle;
        this._shuffle = target;
        this.emit('changed');

        Gio.DBus.session.call(
            this._busName,
            MPRIS_OBJECT_PATH,
            'org.freedesktop.DBus.Properties',
            'Set',
            new GLib.Variant('(ssv)', [
                'org.mpris.MediaPlayer2.Player',
                'Shuffle',
                GLib.Variant.new_boolean(target),
            ]),
            null,
            Gio.DBusCallFlags.NONE,
            1500,
            this._cancellable,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (_e) {
                    // Revert if unsupported by player
                    if (!this._destroyed)
                        this._syncPlayerProperties();
                }
            }
        );
    }

    cycleLoopStatus() {
        if (!this._playerProxy)
            return;

        const order = ['None', 'Playlist', 'Track'];
        const idx = order.indexOf(this._loopStatus);
        const nextStatus = order[(idx + 1) % order.length];
        this._loopStatus = nextStatus;
        this.emit('changed');

        Gio.DBus.session.call(
            this._busName,
            MPRIS_OBJECT_PATH,
            'org.freedesktop.DBus.Properties',
            'Set',
            new GLib.Variant('(ssv)', [
                'org.mpris.MediaPlayer2.Player',
                'LoopStatus',
                GLib.Variant.new_string(nextStatus),
            ]),
            null,
            Gio.DBusCallFlags.NONE,
            1500,
            this._cancellable,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (_e) {
                    if (!this._destroyed)
                        this._syncPlayerProperties();
                }
            }
        );
    }

    /**
     * Seek to a normalized fraction [0.0..1.0] of the current track.
     *
     * @param {number} fraction
     */
    seekToFraction(fraction) {
        if (!this._playerProxy || this._lengthUs <= 0)
            return;

        const targetUs = Math.round(clamp(fraction, 0, 1) * this._lengthUs);
        const deltaUs = targetUs - this.positionUs;

        this._positionUs = targetUs;
        this._positionTimestampUs = GLib.get_monotonic_time();
        this.emit('position-changed', this._positionUs);

        if (this._trackId && this._trackId.startsWith('/')) {
            this._playerProxy.SetPositionAsync(this._trackId, targetUs).catch(() => {
                this._playerProxy?.SeekAsync(deltaUs).catch(e => {
                    Logger.warn(`Seek failed on ${this._busName}`, e);
                });
            });
        } else {
            this._playerProxy.SeekAsync(deltaUs).catch(e => {
                Logger.warn(`Seek failed on ${this._busName}`, e);
            });
        }
    }

    raisePlayerApp() {
        if (this._desktopEntry && typeof global !== 'undefined' && global.stage) {
            try {
                const app = Shell.AppSystem.get_default()?.lookup_app(`${this._desktopEntry}.desktop`);
                if (app) {
                    app.activate();
                    return;
                }
            } catch (_e) {
                // Fallback to MPRIS Raise()
            }
        }
        if (this._rootProxy?.CanRaise) {
            this._rootProxy.RaiseAsync().catch(e => {
                Logger.warn(`Raise failed on ${this._busName}`, e);
            });
        }
    }

    destroy() {
        this._destroyed = true;

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._rootProxy) {
            for (const id of this._rootSignalIds)
                this._rootProxy.disconnect(id);
            this._rootSignalIds = [];
            this._rootProxy = null;
        }

        if (this._playerProxy) {
            if (this._seekedSignalId) {
                this._playerProxy.disconnectSignal(this._seekedSignalId);
                this._seekedSignalId = 0;
            }
            for (const id of this._playerSignalIds)
                this._playerProxy.disconnect(id);
            this._playerSignalIds = [];
            this._playerProxy = null;
        }

        this.disconnectAll();
    }
}
