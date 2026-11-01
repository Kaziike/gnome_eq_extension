// SPDX-License-Identifier: GPL-3.0-or-later
// Music Control & Equalizer - Equalizer Frequency Bands & Presets

export const DEFAULT_BAND_COUNT = 10;

export const EQ_BANDS = [
    {index: 0, nodeName: 'eq_band_1',  freq: 32.0,    q: 1.414, label: 'bq_lowshelf',  shortLabel: '32',     fullLabel: '32Hz'},
    {index: 1, nodeName: 'eq_band_2',  freq: 64.0,    q: 1.414, label: 'bq_peaking',   shortLabel: '64',     fullLabel: '64Hz'},
    {index: 2, nodeName: 'eq_band_3',  freq: 125.0,   q: 1.414, label: 'bq_peaking',   shortLabel: '125',    fullLabel: '125Hz'},
    {index: 3, nodeName: 'eq_band_4',  freq: 250.0,   q: 1.414, label: 'bq_peaking',   shortLabel: '250',    fullLabel: '250Hz'},
    {index: 4, nodeName: 'eq_band_5',  freq: 500.0,   q: 1.414, label: 'bq_peaking',   shortLabel: '500',    fullLabel: '500Hz'},
    {index: 5, nodeName: 'eq_band_6',  freq: 1000.0,  q: 1.414, label: 'bq_peaking',   shortLabel: '1k',     fullLabel: '1kHz'},
    {index: 6, nodeName: 'eq_band_7',  freq: 2000.0,  q: 1.414, label: 'bq_peaking',   shortLabel: '2k',     fullLabel: '2kHz'},
    {index: 7, nodeName: 'eq_band_8',  freq: 4000.0,  q: 1.414, label: 'bq_peaking',   shortLabel: '4k',     fullLabel: '4kHz'},
    {index: 8, nodeName: 'eq_band_9',  freq: 8000.0,  q: 1.414, label: 'bq_peaking',   shortLabel: '8k',     fullLabel: '8kHz'},
    {index: 9, nodeName: 'eq_band_10', freq: 16000.0, q: 1.414, label: 'bq_highshelf', shortLabel: '16k Hz', fullLabel: '16kHz'},
];

export const BASS_NODE = {
    nodeName: 'eq_bass',
    freq: 100.0,
    q: 0.707,
    label: 'bq_lowshelf',
};

export const TREBLE_NODE = {
    nodeName: 'eq_treble',
    freq: 10000.0,
    q: 0.707,
    label: 'bq_highshelf',
};

/**
 * Built-in Equalizer Presets
 * Bands order: [32Hz, 64Hz, 125Hz, 250Hz, 500Hz, 1kHz, 2kHz, 4kHz, 8kHz, 16kHz]
 */
export const BUILTIN_PRESETS = {
    flat: {
        id: 'flat',
        name: 'Flat',
        bands: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        bass: 0.0,
        treble: 0.0,
    },
    rock: {
        id: 'rock',
        name: 'Rock',
        bands: [4.5, 3.8, 2.0, -1.0, -2.0, -0.5, 2.0, 3.5, 4.5, 4.5],
        bass: 2.5,
        treble: 2.0,
    },
    pop: {
        id: 'pop',
        name: 'Pop',
        bands: [-1.0, 1.5, 3.5, 4.5, 3.0, 0.5, -1.0, 1.5, 2.5, 2.0],
        bass: 1.5,
        treble: 1.5,
    },
    edm: {
        id: 'edm',
        name: 'EDM',
        bands: [6.0, 5.5, 3.5, 0.5, -1.5, -1.0, 1.5, 3.5, 5.0, 5.5],
        bass: 4.0,
        treble: 3.0,
    },
    nightcore: {
        id: 'nightcore',
        name: 'Nightcore',
        bands: [4.5, 4.0, 2.0, 0.0, -1.0, 1.0, 2.5, 4.0, 5.5, 4.5],
        bass: 3.0,
        treble: 2.5,
    },
    vocal: {
        id: 'vocal',
        name: 'Vocal',
        bands: [-2.5, -2.0, -1.0, 1.5, 4.0, 5.0, 4.5, 2.5, 0.5, -1.0],
        bass: -1.5,
        treble: 1.0,
    },
    bass_boost: {
        id: 'bass_boost',
        name: 'Bass Boost',
        bands: [7.0, 6.0, 4.5, 2.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0],
        bass: 5.5,
        treble: 0.0,
    },
    treble_boost: {
        id: 'treble_boost',
        name: 'Treble Boost',
        bands: [0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 2.5, 4.5, 6.0, 7.5],
        bass: 0.0,
        treble: 5.5,
    },
    classical: {
        id: 'classical',
        name: 'Classical',
        bands: [3.5, 3.0, 2.0, 1.0, -1.0, -1.0, 0.0, 2.0, 3.5, 4.0],
        bass: 1.0,
        treble: 2.0,
    },
};

export const BUILTIN_PRESET_ORDER = [
    'flat',
    'rock',
    'pop',
    'edm',
    'nightcore',
    'vocal',
    'bass_boost',
    'treble_boost',
    'classical',
];
