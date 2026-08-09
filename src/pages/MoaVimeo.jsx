import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    AlertCircle, ArrowLeft, CheckCircle2, ExternalLink, Loader, Lock, RefreshCw, Save, Tv, Video,
} from 'lucide-react';
import { getEventBySku, getMatchesForEvent } from '../services/robotevents';
import VimeoPlayer from '../components/VimeoPlayer';
import {
    eventLocalDate, fetchCurrentVimeoClip, fetchVimeoClipHash, formatTimestamp, matchTime,
    parseTimestamp, resolveVimeoStreamStart, vimeoWatchUrl,
} from '../services/vimeo';

// ---------------------------------------------------------------------------
// This event is a one-off. The Mall of America Signature streams on Vimeo rather
// than YouTube, and Vimeo's live API is a paid tier we do not have, so none of
// the usual auto-detection applies: there is no way to ask when the broadcast
// started. The workaround is a single human-supplied anchor per day — "the first
// match of the day happens at H:MM:SS in the video" — from which every other
// match on that day follows, because the recording runs in real time.
//
// Hence a bespoke page rather than a general feature. If Vimeo events become
// common this should grow into the Route Manager proper.
// ---------------------------------------------------------------------------

const MOA = {
    sku: 'RE-V5RC-26-4244',
    vimeoEventId: '5938928',
    // The two broadcast days. Aug 6 was practice only and was not streamed, so
    // it deliberately has no row.
    days: ['2026-08-07', '2026-08-08'],
    // Created on first save if the preset does not exist yet — OpenScout's play
    // button only lights up for events that are Jumper presets.
    route: {
        label: 'UND Signature @ Mall of America (HS)',
        path: 'moa26',
        divisionNames: { 1: 'UND' },
    },
};

const emptyDay = (date) => ({
    date,
    videoId: null,
    // The clip's embed hash. Without it the player can only fall back to the
    // event embed, which always serves whichever clip is featured right now, so
    // a past day would silently play the wrong recording.
    hash: null,
    anchorMatchId: null,
    anchorMatchName: null,
    anchorStartedAt: null,
    anchorSeconds: null,
});

const prettyDate = (date) =>
    new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
    });

// The UTC offset RobotEvents stamped onto a timestamp, in minutes. Null when the
// string carries none (a bare local time, or a trailing Z).
const offsetMinutes = (isoString) => {
    const match = /([+-])(\d{2}):(\d{2})$/.exec(String(isoString ?? ''));
    if (!match) return null;
    const [, sign, hours, minutes] = match;
    return (sign === '-' ? -1 : 1) * (Number(hours) * 60 + Number(minutes));
};

// Wall-clock time of a match in the venue's own timezone rather than the
// viewer's — the admin is cross-referencing against the RobotEvents schedule, so
// showing it in, say, Pacific would mean picking the wrong anchor match.
//
// Guessing is worse than admitting ignorance here: a missing offset used to be
// parsed as if it were one, silently shifting the displayed time by hours.
const venueTime = (isoString) => {
    if (!isoString) return '?';
    const parsed = new Date(isoString);
    if (Number.isNaN(parsed.getTime())) return '?';

    const offset = offsetMinutes(isoString);
    if (offset === null) return String(isoString).slice(11, 16) || '?';

    const shifted = new Date(parsed.getTime() + offset * 60 * 1000);
    return shifted.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
    });
};

// Today's date as the venue reckons it, derived from the offset RobotEvents uses
// for this event's own matches.
//
// `new Date().toISOString()` would be UTC, which rolls over at 7pm local — so an
// admin setting this up during Friday-evening eliminations would have the clip
// filed under Saturday.
const venueToday = (matches) => {
    const sample = matches.map(matchTime).find(Boolean);
    const offset = offsetMinutes(sample);
    if (offset === null) return null;
    return new Date(Date.now() + offset * 60 * 1000).toISOString().slice(0, 10);
};

function MoaVimeo() {
    const [routes, setRoutes] = useState(null);
    const [event, setEvent] = useState(null);
    const [matches, setMatches] = useState([]);
    const [days, setDays] = useState(MOA.days.map(emptyDay));
    // Timestamp inputs are kept as raw text so a half-typed "1:2" does not get
    // normalised out from under the cursor.
    const [timestampText, setTimestampText] = useState(() => Object.fromEntries(MOA.days.map((d) => [d, ''])));

    // Which day's scrub-along player is open, plus the player shims keyed by date.
    // Vimeo's live scrubber reads as a negative offset from the live edge, which
    // is not what we store — so rather than make anyone convert, read the
    // position straight out of the player.
    const [scrubDay, setScrubDay] = useState(null);
    const scrubPlayers = useRef({});

    // Why a hash lookup failed, per day. Vimeo can answer a scrape with a bot
    // wall, and without this the admin would stare at "looking up…" forever with
    // no way to intervene.
    const [hashError, setHashError] = useState({});

    const [currentClip, setCurrentClip] = useState(null);
    const [detecting, setDetecting] = useState(false);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');

    const authed = typeof window !== 'undefined' && sessionStorage.getItem('adminAuth') === 'true';

    const updateDay = (date, patch) =>
        setDays((prev) => prev.map((day) => (day.date === date ? { ...day, ...patch } : day)));

    // --- Load ---------------------------------------------------------------
    useEffect(() => {
        if (!authed) { setLoading(false); return; }

        let cancelled = false;

        (async () => {
            try {
                const [routeRes, foundEvent] = await Promise.all([
                    fetch('/api/get-all-routes').then((r) => (r.ok ? r.json() : [])),
                    getEventBySku(MOA.sku).catch(() => null),
                ]);
                if (cancelled) return;

                const routeList = Array.isArray(routeRes) ? routeRes : [];
                setRoutes(routeList);
                setEvent(foundEvent);

                const saved = routeList.find((r) => r.sku === MOA.sku)?.vimeo;
                if (saved?.days?.length) {
                    setDays(MOA.days.map((date) => saved.days.find((d) => d.date === date) ?? emptyDay(date)));
                    setTimestampText(Object.fromEntries(MOA.days.map((date) => {
                        const day = saved.days.find((d) => d.date === date);
                        return [date, day?.anchorSeconds != null ? formatTimestamp(day.anchorSeconds) : ''];
                    })));
                }

                if (foundEvent) {
                    const found = await getMatchesForEvent(foundEvent).catch(() => []);
                    if (!cancelled) setMatches(found ?? []);
                }
            } catch (err) {
                if (!cancelled) setError(err.message || 'Failed to load event data');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [authed]);

    // --- Clip detection -----------------------------------------------------
    const detect = useCallback(async ({ assignTo = null } = {}) => {
        setDetecting(true);
        setError('');
        try {
            const clip = await fetchCurrentVimeoClip(MOA.vimeoEventId);
            setCurrentClip(clip);

            // Vimeo only ever advertises one clip per event, so a day's clip has
            // to be captured while that day is the one streaming. Prefilling the
            // current day on load means opening this page at any point during the
            // broadcast is enough — no separate step to remember.
            if (assignTo && clip?.videoId) {
                setDays((prev) => prev.map((day) =>
                    day.date === assignTo && !day.videoId
                        ? { ...day, videoId: clip.videoId, hash: clip.hash ?? null }
                        : day));
            }
            return clip;
        } catch (err) {
            setError(err.message || 'Could not reach Vimeo');
            return null;
        } finally {
            setDetecting(false);
        }
    }, []);

    // Which day is "today" at the venue. Derived from the match list, so this
    // waits for the load effect rather than racing it — otherwise the prefill
    // would have nothing to attach the clip to.
    const today = useMemo(() => venueToday(matches), [matches]);

    const autoDetected = useRef(false);
    useEffect(() => {
        if (!authed || loading || autoDetected.current) return;
        autoDetected.current = true;
        detect({ assignTo: today });
    }, [authed, loading, today, detect]);

    // Backfill the embed hash for any day that has a clip id but no hash, which
    // covers days saved before hashes were stored and ids typed in by hand.
    useEffect(() => {
        let cancelled = false;
        for (const day of days) {
            if (!day.videoId || day.hash) continue;
            fetchVimeoClipHash(day.videoId)
                .then((hash) => {
                    if (cancelled) return;
                    if (hash) updateDay(day.date, { hash });
                    else setHashError((prev) => ({ ...prev, [day.date]: 'no hash found' }));
                })
                .catch((err) => {
                    if (!cancelled) setHashError((prev) => ({ ...prev, [day.date]: err.message || 'lookup failed' }));
                });
        }
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days.map((d) => `${d.date}:${d.videoId}:${d.hash}`).join('|')]);

    // --- Derived ------------------------------------------------------------
    const matchesByDate = useMemo(() => {
        const grouped = {};
        for (const match of matches) {
            const date = eventLocalDate(matchTime(match));
            if (!date) continue;
            (grouped[date] ??= []).push(match);
        }
        for (const list of Object.values(grouped)) {
            list.sort((a, b) => new Date(matchTime(a)) - new Date(matchTime(b)));
        }
        return grouped;
    }, [matches]);

    const captureFromPlayer = (date) => {
        const player = scrubPlayers.current[date];
        if (!player) {
            setError('The player is still loading.');
            return;
        }

        // getCurrentTime() is measured from the broadcast start even on a live
        // stream, which is exactly the number we store.
        const seconds = Math.max(0, Math.floor(player.getCurrentTime()));
        if (!seconds) {
            setError('The player is at 0:00. Scrub to the match start first.');
            return;
        }

        setError('');
        setTimestampText((prev) => ({ ...prev, [date]: formatTimestamp(seconds) }));

        const dayMatches = matchesByDate[date] ?? [];
        const day = days.find((d) => d.date === date);
        const anchor = dayMatches.find((m) => m.id === day?.anchorMatchId) ?? dayMatches[0] ?? null;
        updateDay(date, {
            anchorSeconds: seconds,
            anchorMatchId: day?.anchorMatchId ?? anchor?.id ?? null,
            anchorMatchName: day?.anchorMatchName ?? anchor?.name ?? null,
            anchorStartedAt: day?.anchorStartedAt ?? matchTime(anchor) ?? null,
        });
    };

    // --- Save ---------------------------------------------------------------
    const handleSave = async () => {
        setSaving(true);
        setError('');
        setNotice('');

        try {
            // Re-read rather than trusting the copy from page load: the Route
            // Manager may have been used in another tab, and this write replaces
            // the whole array.
            const res0 = await fetch('/api/get-all-routes');
            const latest = res0.ok ? await res0.json() : null;

            // Saving PATCHes the entire `routes` key, so a failed re-read must
            // abort rather than fall back to an empty list — that would replace
            // every other preset with just this one, irreversibly.
            if (!Array.isArray(latest) || latest.length === 0) {
                throw new Error(
                    'could not re-read the existing presets, so nothing was written. ' +
                    'Saving on top of an empty list would wipe every other event.',
                );
            }

            // This page only ever adds or edits one route, so the list shrinking
            // between load and save means the read was partial or stale. Writing
            // it back would delete the difference with no way to recover it.
            if (Array.isArray(routes) && latest.length < routes.length) {
                throw new Error(
                    `the preset list came back smaller than expected (${latest.length} vs ${routes.length}), ` +
                    'so nothing was written. Reload and try again.',
                );
            }

            const list = [...latest];

            const vimeo = { eventId: MOA.vimeoEventId, days };
            const index = list.findIndex((r) => r.sku === MOA.sku);

            if (index >= 0) {
                list[index] = { ...list[index], vimeo };
            } else {
                list.push({
                    ...MOA.route,
                    sku: MOA.sku,
                    // No YouTube streams for this event; the Vimeo block is the
                    // whole story. The key still has to exist — Viewer.jsx and
                    // match-timestamp.js both index into it.
                    streams: { 1: [] },
                    vimeo,
                });
            }

            const res = await fetch('/api/save-routes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(list),
            });

            if (!res.ok) throw new Error((await res.text()) || res.statusText);

            setRoutes(list);
            setNotice(index >= 0 ? 'Saved.' : 'Saved, and created the MOA preset.');
            setTimeout(() => setNotice(''), 4000);
        } catch (err) {
            setError('Could not save: ' + (err.message || 'unknown error'));
        } finally {
            setSaving(false);
        }
    };

    // --- Render -------------------------------------------------------------
    if (!authed) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
                <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
                    <Lock className="w-6 h-6 text-[#4FCEEC] mx-auto mb-4" />
                    <h2 className="text-xl font-bold mb-2">Admin access required</h2>
                    <p className="text-sm text-gray-400 mb-6">Log in on the Route Manager, then come back.</p>
                    <Link to="/admin" className="inline-block bg-[#4FCEEC] hover:bg-[#3db8d6] text-black font-bold px-5 py-2 rounded-lg transition-colors">
                        Go to /admin
                    </Link>
                </div>
            </div>
        );
    }

    // "Armed" has to mean playable, not merely filled in: a day with a timestamp
    // but no clip — or whose anchor match never got pinned because the schedule
    // had not loaded yet — resolves to nothing on both client and server.
    const armed = days.filter((day) => day.videoId && resolveVimeoStreamStart(day, matches) !== null);
    const ready = armed.length;

    return (
        <div className="min-h-screen bg-black text-white p-6 font-sans">
            <header className="max-w-4xl mx-auto flex justify-between items-center mb-8 border-b border-gray-800 pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-900 rounded-lg border border-gray-800">
                        <Video className="w-5 h-5 text-[#4FCEEC]" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold">MOA 26 Vimeo</h1>
                        <p className="text-xs text-gray-500">Mall of America Signature · Vimeo match sync</p>
                    </div>
                </div>
                <Link to="/admin" className="text-sm text-gray-400 hover:text-white flex items-center gap-2">
                    <ArrowLeft className="w-4 h-4" /> Route Manager
                </Link>
            </header>

            <main className="max-w-4xl mx-auto space-y-6">
                <section className="bg-gray-900/60 border border-gray-800 rounded-xl p-5 text-sm">
                    <p className="text-gray-300 leading-relaxed">
                        Vimeo won't tell us when a broadcast started without the paid API, so each day needs one
                        anchor: <strong className="text-white">how far into the video the day's first match begins</strong>.
                        Every other match that day is derived from it. Filling in one day is enough; the other stays
                        dormant until you get to it.
                    </p>
                    <p className="text-gray-500 leading-relaxed mt-3 text-xs">
                        <strong className="text-yellow-400">Jumping does not work while a broadcast is live.</strong>{' '}
                        Vimeo reports a duration of zero for a running event and refuses every seek against it, not
                        just old ones. Match jumps start working for a day once its session ends and Vimeo posts the
                        replay. You can fill this in at any point; it simply won't do anything until then, and viewers
                        are told where the match is so they can scrub there by hand in the meantime.
                    </p>
                </section>

                {error && (
                    <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg p-4 text-sm">
                        <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
                    </div>
                )}
                {notice && (
                    <div className="flex items-center gap-2 bg-green-500/10 border border-green-500/30 text-green-300 rounded-lg p-4 text-sm">
                        <CheckCircle2 className="w-4 h-4" /> {notice}
                    </div>
                )}

                {/* Event + Vimeo status */}
                <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                        <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-3">RobotEvents</h2>
                        {loading ? (
                            <p className="text-gray-500 text-sm flex items-center gap-2"><Loader className="w-4 h-4 animate-spin" /> Loading…</p>
                        ) : event ? (
                            <>
                                <p className="text-sm text-white font-semibold leading-snug">{event.name}</p>
                                <p className="text-xs text-gray-500 mt-2">{MOA.sku} · {matches.length} matches loaded</p>
                            </>
                        ) : (
                            <p className="text-sm text-yellow-400">Couldn't reach RobotEvents for {MOA.sku}.</p>
                        )}
                    </div>

                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                        <div className="flex items-center justify-between mb-3">
                            <h2 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Vimeo event {MOA.vimeoEventId}</h2>
                            <button
                                onClick={() => detect()}
                                disabled={detecting}
                                className="text-[10px] font-bold text-[#4FCEEC] hover:text-white flex items-center gap-1 disabled:opacity-50"
                            >
                                <RefreshCw className={`w-3 h-3 ${detecting ? 'animate-spin' : ''}`} /> REFRESH
                            </button>
                        </div>
                        {currentClip?.videoId ? (
                            <>
                                <p className="text-sm text-white">
                                    Currently featuring clip <span className="font-mono text-[#4FCEEC]">{currentClip.videoId}</span>
                                </p>
                                <p className="text-xs text-gray-500 mt-2">
                                    {currentClip.liveStatus === 'streaming' && 'Live now'}
                                    {currentClip.liveStatus === 'pending' && `Scheduled${currentClip.scheduledStart ? ` for ${new Date(currentClip.scheduledStart).toLocaleString()}` : ''}`}
                                    {currentClip.liveStatus === 'ended' && 'Broadcast ended'}
                                    {currentClip.duration ? ` · ${formatTimestamp(currentClip.duration)} long` : ''}
                                </p>
                            </>
                        ) : (
                            <p className="text-sm text-gray-500">{detecting ? 'Checking…' : 'No clip detected.'}</p>
                        )}
                    </div>
                </section>

                {/* Day rows */}
                {days.map((day) => {
                    const dayMatches = matchesByDate[day.date] ?? [];
                    const anchorMatch =
                        dayMatches.find((m) => m.id === day.anchorMatchId) ?? dayMatches[0] ?? null;
                    const streamStart = resolveVimeoStreamStart(
                        { ...day, anchorMatchId: anchorMatch?.id ?? day.anchorMatchId },
                        matches,
                    );
                    const isCurrent = currentClip?.videoId && currentClip.videoId === day.videoId;

                    return (
                        <section key={day.date} className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
                            <div className="flex items-center justify-between flex-wrap gap-2">
                                <h2 className="text-lg font-bold flex items-center gap-2">
                                    <Tv className="w-4 h-4 text-[#4FCEEC]" /> {prettyDate(day.date)}
                                </h2>
                                <span className="text-xs text-gray-500">
                                    {dayMatches.length ? `${dayMatches.length} matches` : 'No matches posted yet'}
                                </span>
                            </div>

                            {/* Clip */}
                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                                        Vimeo clip id
                                    </label>
                                    <input
                                        type="text"
                                        value={day.videoId ?? ''}
                                        onChange={(e) => updateDay(day.date, {
                                            videoId: e.target.value.trim() || null,
                                            // The hash belongs to the old clip; keeping it would
                                            // build a player URL Vimeo rejects, with nothing on
                                            // screen to say why.
                                            hash: null,
                                        })}
                                        placeholder="auto-filled while this day is streaming"
                                        className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2.5 text-white font-mono text-sm focus:border-[#4FCEEC] focus:outline-none"
                                    />
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={async () => {
                                            const clip = await detect();
                                            if (clip?.videoId) {
                                                updateDay(day.date, {
                                                    videoId: clip.videoId,
                                                    // Keep the known-good hash if this lookup came
                                                    // back without one, rather than demoting the
                                                    // day to the unpinned event embed.
                                                    hash: clip.hash ?? (clip.videoId === day.videoId ? day.hash : null),
                                                });
                                            }
                                        }}
                                        disabled={detecting}
                                        className="px-3 py-2.5 bg-[#4FCEEC]/10 hover:bg-[#4FCEEC]/20 text-[#4FCEEC] border border-[#4FCEEC]/20 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 whitespace-nowrap"
                                    >
                                        Use current
                                    </button>
                                    {day.videoId && (
                                        <a
                                            href={vimeoWatchUrl(MOA.vimeoEventId, day.videoId)}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="px-3 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors"
                                        >
                                            <ExternalLink className="w-3 h-3" /> Watch
                                        </a>
                                    )}
                                </div>
                            </div>
                            {isCurrent && (
                                <p className="text-[11px] text-green-400 -mt-3">This is the clip Vimeo is featuring right now.</p>
                            )}
                            {day.videoId && !day.hash && (
                                <div className="-mt-3">
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                                        Embed hash
                                    </label>
                                    <input
                                        type="text"
                                        value={day.hash ?? ''}
                                        onChange={(e) => updateDay(day.date, { hash: e.target.value.trim() || null })}
                                        placeholder="looked up automatically"
                                        className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2 text-white font-mono text-sm focus:border-[#4FCEEC] focus:outline-none"
                                    />
                                    <p className="text-[11px] text-yellow-400 mt-1.5">
                                        {hashError[day.date]
                                            ? `Couldn't look up the embed hash (${hashError[day.date]}). Open vimeo.com/${day.videoId}, copy the h= value from its share link, and paste it here.`
                                            : 'Looking up this clip\'s embed hash. Without it this day can only play while Vimeo is featuring it.'}
                                    </p>
                                </div>
                            )}
                            {day.videoId && day.hash && (
                                <p className="text-[11px] text-gray-500 -mt-3">
                                    Embed hash <span className="font-mono">{day.hash}</span>. Save to keep this day playable
                                    after the event moves on to another broadcast.
                                </p>
                            )}

                            {/* Anchor */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                                        First match of the day
                                    </label>
                                    <select
                                        value={anchorMatch?.id ?? ''}
                                        onChange={(e) => {
                                            const picked = dayMatches.find((m) => String(m.id) === e.target.value);
                                            updateDay(day.date, {
                                                anchorMatchId: picked?.id ?? null,
                                                anchorMatchName: picked?.name ?? null,
                                                anchorStartedAt: matchTime(picked) ?? null,
                                            });
                                        }}
                                        disabled={!dayMatches.length}
                                        className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2.5 text-white text-sm focus:border-[#4FCEEC] focus:outline-none disabled:opacity-40"
                                    >
                                        {!dayMatches.length && <option value="">No matches yet</option>}
                                        {dayMatches.map((m) => (
                                            <option key={m.id} value={m.id}>
                                                {m.name} · {venueTime(matchTime(m))}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">
                                        Where it starts in the video
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={timestampText[day.date] ?? ''}
                                        onChange={(e) => {
                                            const text = e.target.value;
                                            setTimestampText((prev) => ({ ...prev, [day.date]: text }));
                                            updateDay(day.date, {
                                                anchorSeconds: parseTimestamp(text),
                                                // Pin the anchor the moment a timestamp is typed, so a
                                                // dropdown left on its default still saves a match id.
                                                anchorMatchId: day.anchorMatchId ?? anchorMatch?.id ?? null,
                                                anchorMatchName: day.anchorMatchName ?? anchorMatch?.name ?? null,
                                                anchorStartedAt: day.anchorStartedAt ?? matchTime(anchorMatch) ?? null,
                                            });
                                        }}
                                        placeholder="1:23:45"
                                        className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2.5 text-white font-mono text-sm focus:border-[#4FCEEC] focus:outline-none"
                                    />
                                    <p className="text-[11px] text-gray-500 mt-1.5">
                                        {timestampText[day.date] && day.anchorSeconds === null
                                            ? <span className="text-yellow-400">Use H:MM:SS (or MM:SS).</span>
                                            : day.anchorSeconds !== null
                                                ? `${day.anchorSeconds.toLocaleString()} seconds in`
                                                : 'Measured from the start of the broadcast.'}
                                    </p>
                                    {day.videoId && (
                                        <button
                                            onClick={() => setScrubDay(scrubDay === day.date ? null : day.date)}
                                            className="mt-2 text-[11px] font-bold text-[#4FCEEC] hover:text-white transition-colors"
                                        >
                                            {scrubDay === day.date ? 'Hide player' : 'Find it in the player →'}
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Scrub-along player.
                                Vimeo's own scrubber reads as a negative offset from the
                                live edge ("-1:59:50"), which is neither what we store nor
                                stable — the live edge keeps moving. getCurrentTime() is
                                measured from the broadcast start even mid-stream, so let
                                the player answer instead of asking anyone to convert. */}
                            {scrubDay === day.date && day.videoId && (
                                <div className="space-y-3">
                                    <div className="aspect-video w-full bg-black rounded-lg overflow-hidden border border-gray-800">
                                        <VimeoPlayer
                                            eventId={MOA.vimeoEventId}
                                            videoId={day.videoId}
                                            hash={day.hash}
                                            onReady={(player) => { scrubPlayers.current[day.date] = player; }}
                                            onError={() => {}}
                                        />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-3">
                                        <button
                                            onClick={() => captureFromPlayer(day.date)}
                                            className="px-4 py-2 bg-[#4FCEEC] hover:bg-[#3db8d6] text-black text-xs font-bold rounded-lg transition-colors"
                                        >
                                            Use this position
                                        </button>
                                        <p className="text-[11px] text-gray-500">
                                            Scrub to the moment {anchorMatch?.name ?? "the day's first match"} starts, then
                                            click. Ignore the negative time Vimeo shows; it counts backwards from live.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {/* Readback — the sanity check that the anchor is sane */}
                            <div className="bg-black/50 border border-gray-800 rounded-lg px-4 py-3 text-xs space-y-1.5">
                                {streamStart ? (
                                    <>
                                        <p className="text-gray-300">
                                            Implies the broadcast began around{' '}
                                            <strong className="text-[#4FCEEC]">
                                                {new Date(streamStart).toLocaleString(undefined, { timeStyle: 'medium', dateStyle: 'medium' })}
                                            </strong>{' '}
                                            <span className="text-gray-500">(your local time)</span>
                                        </p>
                                        {!day.videoId && (
                                            <p className="text-yellow-400">
                                                No clip id for this day, so nothing will play. Hit "Use current" while this
                                                day is the one streaming.
                                            </p>
                                        )}
                                        {anchorMatch && !anchorMatch.started && (
                                            <p className="text-yellow-400">
                                                {anchorMatch.name} hasn't reported a real start time yet, so this is anchored
                                                to its <em>scheduled</em> time. Schedules drift, so re-save once it has actually run.
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-gray-500">
                                        {dayMatches.length
                                            ? 'Pick a match and enter its timestamp to arm this day.'
                                            : "Waiting on this day's schedule from RobotEvents."}
                                    </p>
                                )}
                            </div>
                        </section>
                    );
                })}

                <div className="flex items-center justify-between gap-4 pb-12">
                    <p className="text-xs text-gray-500">
                        {ready === 0 && 'Nothing configured yet.'}
                        {ready === 1 && '1 of 2 days armed; that day will work on its own.'}
                        {ready === 2 && 'Both days armed.'}
                    </p>
                    <button
                        onClick={handleSave}
                        disabled={saving || loading}
                        className="bg-[#4FCEEC] hover:bg-[#3db8d6] text-black font-bold px-6 py-3 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50"
                    >
                        {saving ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        {saving ? 'Saving…' : 'Save to Jumper'}
                    </button>
                </div>
            </main>
        </div>
    );
}

export default MoaVimeo;
