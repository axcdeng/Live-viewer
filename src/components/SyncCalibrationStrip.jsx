import { Info, RotateCcw } from 'lucide-react';
import { SYNC_SCOPE_DAY, SYNC_SCOPE_DIVISION } from '../services/worldsSyncOffsets';

// Sync calibration controls shared by the Worlds page and the event Viewer's
// manual sync mode. Offsets use one convention on both pages: a jump lands at
// (computed position - offsetSeconds), so + moves every jump the same way.

export function formatOffsetInputValue(totalSeconds) {
    const absSeconds = Math.max(0, Math.round(totalSeconds));
    const minutes = Math.floor(absSeconds / 60);
    const seconds = absSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function parseOffsetInputValue(value) {
    const trimmed = value.trim();
    if (!trimmed) return 0;

    if (/^\d+$/.test(trimmed)) {
        return Number(trimmed);
    }

    const parts = trimmed.split(':');
    if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1])) {
        return null;
    }

    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (seconds >= 60) return null;

    return (minutes * 60) + seconds;
}

export function formatOffsetSummary(offsetSeconds) {
    if (!offsetSeconds) return '00:00';
    return `${offsetSeconds > 0 ? '+' : '-'}${formatOffsetInputValue(Math.abs(offsetSeconds))}`;
}

function truncateLabel(label, maxLength = 26) {
    if (!label) return '';
    return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}

export function HoverInfoCard({ title, body, className = '' }) {
    return (
        <div className={`relative group/info ${className}`}>
            <button
                type="button"
                className="rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-[#4FCEEC]"
                aria-label={title}
            >
                <Info className="w-3.5 h-3.5" />
            </button>
            <div className="pointer-events-none absolute right-0 bottom-full z-[120] mb-3 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-800 bg-[#0b1220] p-3 text-left shadow-2xl shadow-black/50 opacity-0 translate-y-1 transition-all duration-150 group-hover/info:pointer-events-auto group-hover/info:opacity-100 group-hover/info:translate-y-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#4FCEEC]">{title}</div>
                <div className="mt-1 text-xs leading-5 text-gray-300">{body}</div>
            </div>
        </div>
    );
}

export function SyncCalibrationStrip({
    disabled,
    offsetSeconds,
    offsetInput,
    offsetDirection,
    offsetInputInvalid,
    onOffsetInputChange,
    onOffsetInputCommit,
    onOffsetDirectionChange,
    onOffsetReset,
    canCalibrate,
    calibrationLabel,
    onUseCurrentFrame,
    scope,
    onScopeChange,
    // A one-day event has nothing to scope between, so the switch is hidden
    // and the rest fits on one row. The calibration status is left to the
    // caller then (e.g. in the card header), since it doesn't fit beside them.
    showScope = true,
}) {
    const isDivisionScope = scope === SYNC_SCOPE_DIVISION;

    const scopeControls = (
        <div className="flex items-center gap-1.5 shrink-0">
            <HoverInfoCard
                title="Scope"
                body="Choose whether the saved offset applies only to the day you calibrated, or to every day of this division. Per-day is more accurate since streams usually start at different times each day; all-days is easier if you just want one rough correction for the whole division."
            />
            <div className="flex items-center rounded-lg border border-gray-800 bg-black/50 p-0.5">
                <button
                    onClick={() => onScopeChange(SYNC_SCOPE_DAY)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${!isDivisionScope ? 'bg-[#4FCEEC] text-black' : 'text-gray-400 hover:text-white'}`}
                    title="Offset applies only to this day"
                >
                    This Day
                </button>
                <button
                    onClick={() => onScopeChange(SYNC_SCOPE_DIVISION)}
                    className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${isDivisionScope ? 'bg-[#4FCEEC] text-black' : 'text-gray-400 hover:text-white'}`}
                    title="Offset applies to every day of this division"
                >
                    All Days
                </button>
            </div>
        </div>
    );

    const offsetControls = (
        <div className="flex items-center gap-1.5 shrink-0">
            <HoverInfoCard
                title="Offset"
                body="Use this when every jump is consistently off by about the same amount. Pick + when the stream needs a positive correction (jumps land a bit later) and − when it needs a negative correction (jumps land a bit earlier)."
            />
            <div className="flex items-center rounded-lg border border-gray-800 bg-black/50 p-0.5">
                <button
                    onClick={() => onOffsetDirectionChange('later')}
                    className={`h-6 w-6 rounded-md text-sm font-bold transition-colors ${offsetDirection === 'later' ? 'bg-[#4FCEEC] text-black' : 'text-gray-400 hover:text-white'}`}
                    title="Later — jumps land a bit later in the video"
                >
                    +
                </button>
                <button
                    onClick={() => onOffsetDirectionChange('earlier')}
                    className={`h-6 w-6 rounded-md text-sm font-bold transition-colors ${offsetDirection === 'earlier' ? 'bg-[#4FCEEC] text-black' : 'text-gray-400 hover:text-white'}`}
                    title="Earlier — jumps land a bit earlier in the video"
                >
                    −
                </button>
            </div>
            <input
                type="text"
                value={offsetInput}
                onChange={(e) => onOffsetInputChange(e.target.value)}
                onBlur={onOffsetInputCommit}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                inputMode="numeric"
                placeholder="00:00"
                aria-label="Offset (mm:ss)"
                className={`h-7 w-16 rounded-md border px-1.5 text-[11px] font-semibold text-center outline-none transition-colors ${offsetInputInvalid ? 'border-red-500 bg-red-500/10 text-red-100' : 'border-gray-800 bg-black/50 text-white focus:border-[#4FCEEC]'}`}
            />
            <button
                onClick={onOffsetReset}
                className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${offsetSeconds ? 'text-gray-400 hover:bg-gray-800 hover:text-white' : 'text-gray-700 cursor-not-allowed'}`}
                title="Reset offset"
                aria-label="Reset offset"
                disabled={!offsetSeconds}
            >
                <RotateCcw className="h-3.5 w-3.5" />
            </button>
        </div>
    );

    const calibrationStatus = (
        <p className="text-[11px] text-gray-400 min-w-0 truncate">
            {canCalibrate ? `Ready: ${truncateLabel(calibrationLabel, 32)}` : calibrationLabel}
        </p>
    );

    const calibrateControls = (
        <div className="flex items-center gap-1.5 shrink-0">
            <HoverInfoCard
                title="How to Calibrate"
                body={`1. Jump to a match. 2. Scrub the video to where the match actually starts. 3. Press Use Current Frame.${showScope ? ' The correction is saved under the scope you picked (this day only, or every day of the division).' : ''}`}
            />
            <button
                onClick={onUseCurrentFrame}
                disabled={!canCalibrate}
                className={`rounded-md px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${canCalibrate ? 'bg-[#4FCEEC] text-black hover:bg-[#3db8d6]' : 'bg-gray-900 text-gray-600 cursor-not-allowed'}`}
            >
                Use Current Frame
            </button>
        </div>
    );

    const offsetError = offsetInputInvalid && (
        <p className="text-[10px] font-medium text-red-300">Use mm:ss format</p>
    );

    const containerClass = `transition-opacity duration-300 ${disabled ? 'opacity-40 pointer-events-none' : 'opacity-100'}`;

    if (!showScope) {
        return (
            <div className={`space-y-2 ${containerClass}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    {offsetControls}
                    {calibrateControls}
                </div>
                {offsetError}
            </div>
        );
    }

    return (
        <div className={`space-y-2.5 ${containerClass}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
                {scopeControls}
                {offsetControls}
            </div>

            {offsetError}

            <div className="flex items-center justify-between gap-3 border-t border-gray-800/70 pt-2.5">
                {calibrationStatus}
                {calibrateControls}
            </div>
        </div>
    );
}
