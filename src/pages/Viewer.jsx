import React, { useState, useEffect, useRef } from 'react';
import { Settings, Play, RefreshCw, Loader, History, AlertCircle, X, Tv, Zap, ChevronDown, ChevronUp, LayoutList, Star, Link, RotateCcw, Search, Globe, Github } from 'lucide-react';
import YouTube from 'react-youtube';
import { format } from 'date-fns';
import { useQueryState } from 'nuqs';
import SettingsModal from '../components/SettingsModal';
import WebcastSelector from '../components/WebcastSelector';
import EventHistory from '../components/EventHistory';
import StreamManager from '../components/StreamManager';
import TeamList from '../components/TeamList';
import WordPressHeader from '../components/WordPressHeader';
import {
    getEventBySku,
    getTeamByNumber,
    getMatchesForEventAndTeam,
    getTeamsForEvent,
    getMatchesForEvent, // Import the new function
    getRankingsForEvent,
    getSkillsForEvent,
    getEventsForTeam,
    getActiveSeasons
} from '../services/robotevents';
import { extractVideoId, getStreamStartTime } from '../services/youtube';
import { findWebcastCandidates } from '../services/webcastDetection';
import { getCachedWebcast, setCachedWebcast, saveEventToHistory } from '../services/eventCache';
import { calculateEventDays, getMatchDayIndex, findStreamForMatch, getGrayOutReason } from '../utils/streamMatching';
import { parseCalendarDate } from '../utils/dateUtils';
import { Analytics } from "@vercel/analytics/react";

function Viewer() {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [showEventHistory, setShowEventHistory] = useState(false);
    const [webcastCandidates, setWebcastCandidates] = useState([]);
    const [noWebcastsFound, setNoWebcastsFound] = useState(false);

    // URL search params for deep linking
    const [urlSku, setUrlSku] = useQueryState('sku');
    const [urlTeam, setUrlTeam] = useQueryState('team');
    const [urlMatch, setUrlMatch] = useQueryState('match'); // Selected match ID
    // Note: vid/live params will be dynamically managed based on stream count
    const [urlVid1, setUrlVid1] = useQueryState('vid1');
    const [urlVid2, setUrlVid2] = useQueryState('vid2');
    const [urlVid3, setUrlVid3] = useQueryState('vid3');
    const [urlLive1, setUrlLive1] = useQueryState('live1');
    const [urlLive2, setUrlLive2] = useQueryState('live2');
    const [urlLive3, setUrlLive3] = useQueryState('live3');
    const [urlVid, setUrlVid] = useQueryState('vid'); // Single day fallback
    const [urlLive, setUrlLive] = useQueryState('live'); // Single day fallback
    const [urlPreset, setUrlPreset] = useQueryState('preset'); // Short link support

    // Flag to prevent infinite loops during deep linking
    // Flag to prevent infinite loops during deep linking
    const [isDeepLinking, setIsDeepLinking] = useState(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            return !!params.get('sku') || !!params.get('preset');
        }
        return false;
    });
    const hasDeepLinked = useRef(false);
    const isInternalLoading = useRef(false);

    // Form inputs
    const [eventUrl, setEventUrl] = useState('');
    const [teamNumber, setTeamNumber] = useState('');

    // UI State
    /** @type {'search' | 'list' | 'matches'} */
    const [activeTab, setActiveTab] = useState('list');
    const [matchesTabState, setMatchesTabState] = useState({ filter: 'all', search: '' });

    // Global Team Search State (No Event Mode)
    const [globalTeamEvents, setGlobalTeamEvents] = useState([]);
    const [isGlobalSearchLoading, setIsGlobalSearchLoading] = useState(false);
    const [globalSearchQuery, setGlobalSearchQuery] = useState('');
    const [expandedMatchId, setExpandedMatchId] = useState(null);
    const [isEventSearchCollapsed, setIsEventSearchCollapsed] = useState(false);
    const [includePastSeasons, setIncludePastSeasons] = useState(false);



    // Data
    const [event, setEvent] = useState(null);
    const [team, setTeam] = useState(null);
    const [matches, setMatches] = useState([]);
    const [teams, setTeams] = useState([]); // For TeamList
    const [rankings, setRankings] = useState([]); // For TeamList
    const [skills, setSkills] = useState([]); // For TeamList

    // Multi-stream support
    const [streams, setStreams] = useState([]);
    const [activeStreamId, setActiveStreamId] = useState(null);
    const [players, setPlayers] = useState({});

    // Loading states
    const [eventLoading, setEventLoading] = useState(false);
    const [teamLoading, setTeamLoading] = useState(false);
    const [rankingsLoading, setRankingsLoading] = useState(false); // For TeamList
    const [error, setError] = useState('');

    // Sync state
    const [syncMode, setSyncMode] = useState(false);
    const [manualSyncConfirmed, setManualSyncConfirmed] = useState(false);
    const [selectedMatchId, setSelectedMatchId] = useState(null);

    // Matches Tab State
    const [allMatches, setAllMatches] = useState([]);
    const [allMatchesLoading, setAllMatchesLoading] = useState(false);

    // Event Presets (Admin-defined routes)
    const [presets, setPresets] = useState([]);
    const [presetsLoading, setPresetsLoading] = useState(true);
    const [selectedPresetSku, setSelectedPresetSku] = useState('');
    const urlPresetRef = useRef(null);

    // Multi-Division State
    const [multiDivisionMode, setMultiDivisionMode] = useState(false);
    const [activeDivisionId, setActiveDivisionId] = useState(null);

    // Logic to prevent scrolling when event search is collapsed is handled by layout
    useEffect(() => {
        if (event && !eventLoading && hasDeepLinked.current) {
            setIsEventSearchCollapsed(true);
        }
    }, [event, eventLoading]);

    // Auto-save to history whenever event or streams change
    useEffect(() => {
        if (event && streams.length > 0) {
            // Only save if at least one stream has a URL
            const hasUrls = streams.some(s => s.url);
            if (hasUrls) {
                saveEventToHistory(event, streams);
            }
        }
    }, [event, streams]);

    // Fetch Event Presets on mount
    useEffect(() => {
        const fetchPresets = async () => {
            // Already initialized to true
            try {
                const res = await fetch('/api/get-all-routes');
                if (res.ok) {
                    const data = await res.json();
                    setPresets(Array.isArray(data) ? data : []);
                }
            } catch (err) {
                console.error('Failed to fetch presets', err);
            } finally {
                setPresetsLoading(false);
            }
        };
        fetchPresets();
    }, []);

    // Deep linking: Load from URL params on mount
    // Reactive URL parameter detection (Mount + Back/Forward)
    useEffect(() => {
        const loadFromUrl = async () => {
            // Wait for presets to load if we have a preset param
            // This assumes fetchPresets will eventually finish and set loading=false
            if (urlPreset && presetsLoading) {
                return;
            }

            // Check if we have URL params to load
            if (!urlSku && !urlPreset) {
                if (isDeepLinking) setIsDeepLinking(false);
                // If we are undergoing a manual load, ignore empty URL params briefly
                if (isInternalLoading.current) return;

                // If we had a preset/event but URL is now empty (e.g. user hit back to home), clear it
                // BUT: Ensure we don't clear if we are just switching betweeen sku/preset modes or initial load
                if ((event || urlPresetRef.current) && !isInternalLoading.current) {
                    handleClearAll();
                }
                urlPresetRef.current = null;
                return;
            }

            // Check if URL matches current state to avoid redundant loads
            const currentSku = event?.sku;
            // Normalize refs to string to ensure safe comparison
            const isPresetChange = String(urlPreset) !== String(urlPresetRef.current);
            const isSkuChange = urlSku && urlSku !== currentSku;

            if (!isPresetChange && !isSkuChange) return;

            hasDeepLinked.current = true;
            urlPresetRef.current = urlPreset;

            try {
                if (urlPreset) {
                    // Try to find the preset in current list
                    const targetPreset = presets.find(p => p.path === urlPreset);

                    if (targetPreset) {
                        await handleLoadPreset(targetPreset);
                        // Team deep linking still applies even with preset
                        if (urlTeam) setTeamNumber(urlTeam);
                        return;
                    }
                    // If not found after loading finished, it's invalid. Fall through or log?
                    // We'll let it fall through to manual SKU check just in case, but likely it does nothing.
                }

                // Standard SKU deep linking
                if (urlSku) {
                    const foundEvent = await getEventBySku(urlSku);
                    setEvent(foundEvent);
                    setEventUrl(`https://www.robotevents.com/${urlSku}.html`);

                    // Initialize streams for the event
                    const days = calculateEventDays(foundEvent.start, foundEvent.end);
                    const newStreams = [];

                    for (let i = 0; i < days; i++) {
                        const eventStartDate = parseCalendarDate(foundEvent.start);
                        const dayDate = new Date(eventStartDate);
                        dayDate.setDate(eventStartDate.getDate() + i);
                        const dateLabel = format(dayDate, 'MMM d');

                        // Determine URL for this stream from URL params
                        let streamUrl = '';
                        let videoId = null;

                        if (days === 1) {
                            // Single day: check vid or live params
                            if (urlVid) {
                                streamUrl = `https://www.youtube.com/watch?v=${urlVid}`;
                                videoId = urlVid;
                            } else if (urlLive) {
                                streamUrl = `https://www.youtube.com/live/${urlLive}`;
                                videoId = urlLive;
                            }
                        } else {
                            // Multi-day: check indexed params (vid1, vid2, live1, live2, etc.)
                            const dayNum = i + 1;
                            const vidParam = [urlVid1, urlVid2, urlVid3][i];
                            const liveParam = [urlLive1, urlLive2, urlLive3][i];

                            if (vidParam) {
                                streamUrl = `https://www.youtube.com/watch?v=${vidParam}`;
                                videoId = vidParam;
                            } else if (liveParam) {
                                streamUrl = `https://www.youtube.com/live/${liveParam}`;
                                videoId = liveParam;
                            }
                        }

                        newStreams.push({
                            id: `stream - day - ${i} `,
                            url: streamUrl,
                            videoId: videoId,
                            streamStartTime: null,
                            dayIndex: i,
                            label: days > 1 ? `Day ${i + 1} - ${dateLabel} ` : 'Livestream',
                            date: dayDate.toISOString()
                        });
                    }

                    setStreams(newStreams);
                    if (newStreams.length > 0) {
                        setActiveStreamId(newStreams[0].id);
                    }

                    // Set team number if specified (search will be triggered by separate effect)
                    if (urlTeam) {
                        setTeamNumber(urlTeam);
                    }
                }
            } catch (err) {
                console.error('Error loading from URL:', err);
                setError(`Failed to load from URL: ${err.message}`);
            } finally {
                // Delay resetting isDeepLinking to prevent URL sync effects from running too early
                // Give enough time for stream start times to be fetched
                setTimeout(() => {
                    setIsDeepLinking(false);
                }, 1000);
            }
        };

        loadFromUrl();
    }, [urlSku, urlPreset, presets.length, presetsLoading]);

    // Sync URL params when event changes
    useEffect(() => {
        if (isDeepLinking || hasDeepLinked.current && !event) {
            return;
        }

        if (event && event.sku) {
            // Only sync SKU if NOT in preset mode to keep URL clean
            if (!urlPreset) setUrlSku(event.sku);
        } else {
            setUrlSku(null);
        }
    }, [event, setUrlSku, isDeepLinking, urlPreset]);

    // Sync URL params when streams change
    useEffect(() => {
        if (isDeepLinking || urlPreset) {
            return;
        }

        if (!event || streams.length === 0) {
            // Clear all video params
            setUrlVid(null);
            setUrlLive(null);
            setUrlVid1(null);
            setUrlVid2(null);
            setUrlVid3(null);
            setUrlLive1(null);
            setUrlLive2(null);
            setUrlLive3(null);
            return;
        }

        const days = streams.length;

        if (days === 1) {
            // Single day event
            const stream = streams[0];
            if (stream && stream.url) {
                const videoId = extractVideoId(stream.url);
                if (videoId) {
                    // Determine if it's a live URL or regular video URL
                    if (stream.url.includes('/live/')) {
                        setUrlLive(videoId);
                        setUrlVid(null);
                    } else {
                        setUrlVid(videoId);
                        setUrlLive(null);
                    }
                } else {
                    setUrlVid(null);
                    setUrlLive(null);
                }
            } else {
                setUrlVid(null);
                setUrlLive(null);
            }
            // Clear indexed params for single day
            setUrlVid1(null);
            setUrlVid2(null);
            setUrlVid3(null);
            setUrlLive1(null);
            setUrlLive2(null);
            setUrlLive3(null);
        } else {
            // Multi-day event - use indexed params
            // Clear single-day params
            setUrlVid(null);
            setUrlLive(null);

            // Set indexed params
            const setters = [
                { vid: setUrlVid1, live: setUrlLive1 },
                { vid: setUrlVid2, live: setUrlLive2 },
                { vid: setUrlVid3, live: setUrlLive3 }
            ];

            streams.forEach((stream, i) => {
                if (i >= 3) return; // Support up to 3 days for now

                const videoId = stream.url ? extractVideoId(stream.url) : null;
                const setter = setters[i];

                if (videoId) {
                    if (stream.url.includes('/live/')) {
                        setter.live(videoId);
                        setter.vid(null);
                    } else {
                        setter.vid(videoId);
                        setter.live(null);
                    }
                } else {
                    setter.vid(null);
                    setter.live(null);
                }
            });

            // Clear unused params
            for (let i = streams.length; i < 3; i++) {
                const setter = setters[i];
                setter.vid(null);
                setter.live(null);
            }
        }
    }, [streams, event, setUrlVid, setUrlLive, setUrlVid1, setUrlVid2, setUrlVid3, setUrlLive1, setUrlLive2, setUrlLive3, isDeepLinking]);

    // Sync URL params when team changes
    useEffect(() => {
        if (isDeepLinking) return;

        if (team && team.number) {
            setUrlTeam(team.number);
        } else if (!teamNumber) {
            setUrlTeam(null);
        }
    }, [team, teamNumber, setUrlTeam, isDeepLinking]);

    // Trigger team search after event loads from deep linking
    useEffect(() => {
        if (!isDeepLinking && hasDeepLinked.current && event && urlTeam && teamNumber && !team) {
            // Event has loaded from URL and we have a team to search for
            handleTeamSearch(urlTeam);
        }
    }, [event, urlTeam, teamNumber, team, isDeepLinking]);

    const hasJumpedToMatch = useRef(false);

    // Sync URL params when selected match changes
    useEffect(() => {
        if (isDeepLinking) return;

        // Prevent clearing the URL match param during initial load race conditions
        // If we have a URL param, no selected match yet, and haven't performed the initial jump,
        // we should leave the URL param alone so the auto-jump effect can use it.
        if (urlMatch && !selectedMatchId && !hasJumpedToMatch.current) {
            return;
        }

        if (selectedMatchId) {
            setUrlMatch(selectedMatchId.toString());
        } else {
            setUrlMatch(null);
        }
    }, [selectedMatchId, setUrlMatch, isDeepLinking, urlMatch]);

    // Webcast Detection Effect
    useEffect(() => {
        const detect = async () => {
            if (!event || streams.some(s => s.videoId) || noWebcastsFound) return;

            // Prevent running if we just ran it (rudimentary check, or rely on state)
            // Actually, just check if we have candidates or if we've already marked as not found
            if (webcastCandidates.length > 0) return;

            try {
                const candidates = await findWebcastCandidates(event);
                if (candidates.length > 0) {
                    setWebcastCandidates(candidates);
                    const directVideos = candidates.filter(c => c.type === 'direct-video');
                    if (directVideos.length === 1) {
                        handleWebcastSelect(directVideos[0].videoId, directVideos[0].url, 'auto');
                    }
                } else {
                    setNoWebcastsFound(true);
                    // Check cache
                    const cached = getCachedWebcast(event.id);
                    if (cached) {
                        setStreams(prev => prev.map((s, idx) =>
                            idx === 0 ? { ...s, url: cached.url, videoId: cached.videoId } : s
                        ));
                    }
                }
            } catch (err) {
                console.error("Auto-webcast detection failed:", err);
            }
        };

        detect();
    }, [event]); // Run when event object changes

    // Deep linking: Auto-jump to match
    useEffect(() => {
        if (isDeepLinking || !urlMatch || matches.length === 0 || hasJumpedToMatch.current) return;

        const matchToJump = matches.find(m => m.id.toString() === urlMatch);
        if (matchToJump) {
            // Find the appropriate stream for this match
            // We need to pass event start for findStreamForMatch, make sure it's available
            if (!event) return;

            const matchStream = findStreamForMatch(matchToJump, streams, event.start);

            // Check if stream is ready (has start time and player)
            if (matchStream && matchStream.streamStartTime && players[matchStream.id]) {
                jumpToMatch(matchToJump);
                hasJumpedToMatch.current = true;
            }
        }
    }, [isDeepLinking, urlMatch, matches, streams, players, event]);

    // Fallback: Ensure streams are initialized if event exists but streams are empty
    // This catches race conditions where event loads via deep-link/nuqs but streams fail to init
    useEffect(() => {
        if (event && streams.length === 0) {
            console.log("Fallback: Initializing streams for event", event.sku);
            initializeStreamsForEvent(event);
        }
    }, [event, streams]);

    // Helper: Get active stream object
    const getActiveStream = () => {
        return streams.find(s => s.id === activeStreamId) || streams[0] || null;
    };

    // Helper: Calculate event duration and initialize streams
    const initializeStreamsForEvent = (eventData) => {
        setNoWebcastsFound(false);
        setWebcastCandidates([]);
        const days = calculateEventDays(eventData.start, eventData.end);
        const divisions = eventData.divisions && eventData.divisions.length > 0
            ? eventData.divisions
            : [{ id: 1, name: 'Default Division' }];

        const newStreams = [];

        divisions.forEach(division => {
            for (let i = 0; i < days; i++) {
                const eventStartDate = parseCalendarDate(eventData.start);
                const dayDate = new Date(eventStartDate);
                dayDate.setDate(eventStartDate.getDate() + i);
                const dateLabel = format(dayDate, 'MMM d');

                newStreams.push({
                    id: `stream-div-${division.id}-day-${i}`,
                    url: '',
                    videoId: null,
                    streamStartTime: null,
                    divisionId: division.id,
                    dayIndex: i,
                    label: division.name ? `${division.name} - Day ${i + 1}` : `Day ${i + 1} - ${dateLabel}`,
                    date: dayDate.toISOString()
                });
            }
        });

        setStreams(newStreams);

        // Auto-enable multi-division mode if more than 1 division exists
        const isMultiDiv = divisions.length > 1;
        setMultiDivisionMode(isMultiDiv);
        setActiveDivisionId(divisions[0].id);

        if (newStreams.length > 0) {
            setActiveStreamId(newStreams[0].id);
        }
    };

    // Auto-switch active stream if current is empty and others have content
    useEffect(() => {
        const activeStream = getActiveStream();
        const hasVideo = activeStream?.videoId;

        if (!hasVideo) {
            // Find first stream with a video
            const firstWithVideo = streams.find(s => s.videoId);
            if (firstWithVideo) {
                setActiveStreamId(firstWithVideo.id);
            }
        }
    }, [streams, activeStreamId]);

    const handleEventSearch = async () => {
        if (!eventUrl.trim()) {
            setError('Please enter an event URL');
            return;
        }

        isInternalLoading.current = true;
        setEventLoading(true);
        setError('');
        setNoWebcastsFound(false);
        setUrlPreset(null); // Clear preset on manual search
        urlPresetRef.current = null; // Sync ref immediately

        try {
            const skuMatch = eventUrl.match(/(RE-[A-Z0-9]+-\d{2}-\d{4})/);
            if (!skuMatch) {
                throw new Error('Invalid RobotEvents URL. Could not find SKU.');
            }
            const sku = skuMatch[1];
            setUrlSku(sku); // Set SKU immediately
            const foundEvent = await getEventBySku(sku);

            // Only reinitialize streams if it's a different event or no streams exist
            const isDifferentEvent = !event || event.id !== foundEvent.id;
            const hasExistingStreams = streams.length > 0 && streams.some(s => s.url);

            if (isDifferentEvent || !hasExistingStreams) {
                setEvent(foundEvent);
                // Initialize streams based on event duration
                initializeStreamsForEvent(foundEvent);
            } else {
                // Same event, just update event data without touching streams
                setEvent(foundEvent);
            }

            // Webcast detection
            const candidates = await findWebcastCandidates(foundEvent);
            if (candidates.length > 0) {
                setWebcastCandidates(candidates);
                // Auto-select first if only one direct video
                const directVideos = candidates.filter(c => c.type === 'direct-video');
                if (directVideos.length === 1) {
                    handleWebcastSelect(directVideos[0].videoId, directVideos[0].url, 'auto');
                }
            } else {
                setNoWebcastsFound(true);
                // Check cache
                const cached = getCachedWebcast(foundEvent.id);
                if (cached) {
                    // Populate first stream with cached URL
                    setStreams(prev => prev.map((s, idx) =>
                        idx === 0 ? { ...s, url: cached.url, videoId: cached.videoId } : s
                    ));
                }
            }

        } catch (err) {
            setError(err.message);
        } finally {
            setEventLoading(false);
            if (!error) setIsEventSearchCollapsed(true);
            setTimeout(() => { isInternalLoading.current = false; }, 1000);
        }
    };

    const handleWebcastSelect = (selectedVideoId, selectedUrl, method) => {
        // Populate first stream with selected webcast
        setStreams(prev => prev.map((s, idx) =>
            idx === 0 ? { ...s, url: selectedUrl, videoId: selectedVideoId } : s
        ));
        if (event) {
            setCachedWebcast(event.id, selectedVideoId, selectedUrl, method);
        }
        setNoWebcastsFound(false);
        setWebcastCandidates([]);
    };

    const handleSeek = (seconds) => {
        const player = players[activeStreamId];
        if (player && typeof player.getCurrentTime === 'function') {
            const currentTime = player.getCurrentTime();
            player.seekTo(currentTime + seconds, true);
        }
    };

    // Reset manual sync confirmation when switching streams
    useEffect(() => {
        if (syncMode && activeStreamId) {
            setManualSyncConfirmed(false);
        }
    }, [activeStreamId, syncMode]);

    // Keyboard Shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ignore if typing in an input or textarea
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

            switch (e.key) {
                case 'j':
                case 'J':
                    handleSeek(-60);
                    break;
                case 'k':
                case 'K':
                    handleSeek(60);
                    break;
                case 'ArrowLeft':
                    handleSeek(-10);
                    break;
                case 'ArrowRight':
                    handleSeek(10);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeStreamId, players]);

    // Effect to fetch all matches when tab is 'matches'
    useEffect(() => {
        if (activeTab === 'matches' && event && allMatches.length === 0 && !allMatchesLoading) {
            const fetchAllMatches = async () => {
                setAllMatchesLoading(true);
                try {
                    const matches = await getMatchesForEvent(event);
                    setAllMatches(matches);
                } catch (err) {
                    console.error('Failed to fetch all matches:', err);
                    setError('Failed to load matches list: ' + err.message);
                } finally {
                    setAllMatchesLoading(false);
                }
            };
            fetchAllMatches();
        }
    }, [activeTab, event, allMatches.length, allMatchesLoading]);

    // Effect to fetch teams, rankings, and skills when event changes and tab is 'list'
    useEffect(() => {
        if (activeTab === 'list' && event && !rankingsLoading) {
            const fetchData = async () => {
                setRankingsLoading(true);
                try {
                    const [eventTeams, eventRankings, eventSkills] = await Promise.all([
                        getTeamsForEvent(event.id),
                        getRankingsForEvent(event.id, event.divisions),
                        getSkillsForEvent(event.id)
                    ]);
                    setTeams(eventTeams);
                    setRankings(eventRankings);
                    setSkills(eventSkills);
                } catch (err) {
                    console.error('Failed to fetch team list data:', err);
                    setError('Failed to load team list data: ' + err.message);
                } finally {
                    setRankingsLoading(false);
                }
            };
            fetchData();
        }
    }, [activeTab, event]);


    const handleLoadFromHistory = async (historyEntry) => {
        isInternalLoading.current = true;
        // Reconstruct event object
        let reconstructedEvent = {
            id: historyEntry.eventId,
            name: historyEntry.eventName,
            start: historyEntry.eventStart,
            end: historyEntry.eventEnd,
            sku: historyEntry.eventSku,
            program: historyEntry.eventProgram,
            season: historyEntry.eventSeason,
            divisions: historyEntry.eventDivisions
        };

        setUrlPreset(null);
        urlPresetRef.current = null; // Sync ref immediately
        setUrlSku(historyEntry.eventSku); // Set SKU immediately
        setSelectedPresetSku('');

        // If program, season, or divisions is missing (legacy history), fetch full event details
        if ((!reconstructedEvent.program || !reconstructedEvent.season || !reconstructedEvent.divisions) && reconstructedEvent.sku) {
            try {
                const fullEvent = await getEventBySku(reconstructedEvent.sku);
                reconstructedEvent = fullEvent;
                // Update history with full details
                saveEventToHistory(fullEvent, historyEntry.streams.map(s => ({
                    label: s.label,
                    url: s.url,
                    videoId: s.videoId,
                    dayIndex: s.dayIndex,
                    streamStartTime: s.streamStartTime
                })));
            } catch (err) {
                console.error('Failed to fetch full event details:', err);
            }
        }

        setEvent(reconstructedEvent);
        setEventUrl(`https://www.robotevents.com/${historyEntry.eventSku}.html`);

        // If history has streams, restore them. Otherwise, initialize fresh ones.
        if (historyEntry.streams && historyEntry.streams.length > 0) {
            const restoredStreams = historyEntry.streams.map((s, idx) => ({
                id: s.id || `stream-day-${idx}`,
                url: s.url || '',
                videoId: s.videoId || null,
                streamStartTime: s.streamStartTime || null,
                divisionId: s.divisionId || 1, // Fallback for legacy
                dayIndex: s.dayIndex,
                label: s.label,
                date: s.date
            }));

            setStreams(restoredStreams);
            if (restoredStreams.length > 0) {
                setActiveStreamId(restoredStreams[0].id);
            }

            // Sync multi-division state
            const divisions = reconstructedEvent.divisions && reconstructedEvent.divisions.length > 0
                ? reconstructedEvent.divisions
                : [{ id: 1, name: 'Default Division' }];
            const isMultiDiv = divisions.length > 1;
            setMultiDivisionMode(isMultiDiv);
            setActiveDivisionId(divisions[0].id);
        } else {
            // No streams in history? Initialize them fresh for the event
            initializeStreamsForEvent(reconstructedEvent);
        }

        // Reset internal loading flag after a brief delay
        setTimeout(() => { isInternalLoading.current = false; }, 1000);
    };

    const handleLoadPreset = async (preset) => {
        isInternalLoading.current = true;
        setEventLoading(true);
        setError('');
        setNoWebcastsFound(false);
        setWebcastCandidates([]);

        // Clear previous team/match data when switching events via preset
        setTeam(null);
        setTeamNumber('');
        setMatches([]);
        setUrlTeam(null);
        setUrlMatch(null);

        setSelectedPresetSku(preset.sku);
        setUrlPreset(preset.path); // Set preset mode in URL
        urlPresetRef.current = preset.path; // Prevent reactive effect from re-loading
        setUrlSku(null); // Clear SKU as it's redundant with preset

        // Clear all stream-related params to keep URL clean for sharing
        setUrlVid(null);
        setUrlLive(null);
        setUrlVid1(null);
        setUrlVid2(null);
        setUrlVid3(null);
        setUrlLive1(null);
        setUrlLive2(null);
        setUrlLive3(null);
        try {
            const foundEvent = await getEventBySku(preset.sku);
            setEvent(foundEvent);
            // Correct the robotevents URL format
            setEventUrl(`https://www.robotevents.com/robot-competitions/vex-robotics-competition/${preset.sku}.html`);

            const days = calculateEventDays(foundEvent.start, foundEvent.end);
            const divisions = foundEvent.divisions && foundEvent.divisions.length > 0
                ? foundEvent.divisions
                : [{ id: 1, name: 'Default Division' }];

            const newStreams = [];

            divisions.forEach(division => {
                for (let i = 0; i < days; i++) {
                    const eventStartDate = parseCalendarDate(foundEvent.start);
                    const dayDate = new Date(eventStartDate);
                    dayDate.setDate(eventStartDate.getDate() + i);
                    const dateLabel = format(dayDate, 'MMM d');

                    // Support both legacy (array) and multi-division (object) stream formats
                    let presetVideoId = null;
                    if (Array.isArray(preset.streams)) {
                        const isFirstDivision = division.id === (foundEvent.divisions?.[0]?.id || 1);
                        presetVideoId = (isFirstDivision) ? (preset.streams[i] || null) : null;
                    } else if (preset.streams && typeof preset.streams === 'object') {
                        const divStreams = preset.streams[division.id];
                        presetVideoId = divStreams ? (divStreams[i] || null) : null;
                    }

                    const streamUrl = presetVideoId ? `https://www.youtube.com/watch?v=${presetVideoId}` : '';

                    newStreams.push({
                        id: `stream-div-${division.id}-day-${i}`,
                        url: streamUrl,
                        videoId: presetVideoId,
                        streamStartTime: null,
                        divisionId: division.id,
                        dayIndex: i,
                        label: days > 1 ? `Day ${i + 1} - ${dateLabel}` : 'Livestream',
                        date: dayDate.toISOString()
                    });
                }
            });

            setStreams(newStreams);

            const isMultiDiv = divisions.length > 1;
            setMultiDivisionMode(isMultiDiv);
            setActiveDivisionId(divisions[0].id);

            if (newStreams.length > 0) {
                // If we have preset streams, find the first one that has a videoId
                const firstWithVideo = newStreams.find(s => s.videoId);
                setActiveStreamId(firstWithVideo ? firstWithVideo.id : newStreams[0].id);
            }

            setIsEventSearchCollapsed(true);
        } catch (err) {
            console.error('Failed to load preset:', err);
            setError('Failed to load preset: ' + err.message);
        } finally {
            setEventLoading(false);
            setTimeout(() => { isInternalLoading.current = false; }, 1000);
        }
    };

    // Searching Team Logic
    const handleTeamSearch = async (overrideTeamNum) => {
        const teamNumToSearch = overrideTeamNum || teamNumber;
        if (!teamNumToSearch.trim()) return;

        // Mode A: Global Search (No Event Loaded)
        if (!event) {
            setIsGlobalSearchLoading(true);
            setGlobalTeamEvents([]);
            setError('');

            try {
                // 1. Get Team ID first
                const teamData = await getTeamByNumber(teamNumToSearch);
                if (teamData) {
                    let events = [];

                    if (includePastSeasons) {
                        // User requested ALL history -> fetch without season filter
                        events = await getEventsForTeam(teamData.id);
                        // Reset the toggle after search so next search defaults to active only (per user request)
                        setIncludePastSeasons(false);
                    } else {
                        // Default: Filter by ACTIVE seasons only
                        const activeSeasons = await getActiveSeasons();
                        // Extract IDs (e.g. [181, 182, 190])
                        const activeSeasonIds = activeSeasons.map(s => s.id);

                        if (activeSeasonIds.length > 0) {
                            events = await getEventsForTeam(teamData.id, activeSeasonIds);
                        } else {
                            // Fallback if no active seasons found (shouldn't happen, but safe default)
                            console.warn("No active seasons found, falling back to recent date filter.");
                            const allEvents = await getEventsForTeam(teamData.id);
                            events = allEvents.filter(e => new Date(e.start) > new Date('2024-05-01'));
                        }
                    }

                    setGlobalTeamEvents(events);
                } else {
                    setError(`Team ${teamNumToSearch} not found.`);
                }
            } catch (err) {
                console.error("Global search failed:", err);
                setError(`Could not find team or events for ${teamNumToSearch}`);
            } finally {
                setIsGlobalSearchLoading(false);
            }
            return;
        }

        // Mode B: Event-Specific Search (Existing Logic)
        setActiveTab('search'); // Switch to search tab when searching
        setTeamLoading(true);
        setError('');
        setTeam(null);
        setMatches([]);

        setUrlTeam(teamNumToSearch); // Update URL params

        if (!event) {
            // Only show error if not during deep linking
            if (!isDeepLinking) {
                setError('Please find an event first');
            }
            return;
        }

        if (!teamNumToSearch.trim()) {
            setError('Please enter a team number');
            return;
        }

        setTeamLoading(true);
        setError('');
        // Update the input field if searching via click
        if (overrideTeamNum) {
            setTeamNumber(overrideTeamNum);
        }

        try {
            setTeamLoading(true);
            setError('');

            // Use the searchNumber determined above (supports both specificTeamNumber and state)
            const term = teamNumToSearch.trim();

            // First, get all teams for this event
            const eventTeams = await getTeamsForEvent(event.id);

            // Find the team in the event (case-insensitive)
            const foundTeam = eventTeams.find(t => t.number.toUpperCase() === term.toUpperCase());

            if (!foundTeam) {
                throw new Error(`Team ${term} is not registered for this event.`);
            }

            setTeam(foundTeam);

            let foundMatches = await getMatchesForEventAndTeam(event.id, foundTeam.id);
            if (foundMatches.length === 0) {
                throw new Error('No matches found for this team at this event.');
            }

            // Sort: played matches first (oldest to newest), then unplayed matches
            foundMatches = foundMatches.sort((a, b) => {
                const aStarted = a.started ? new Date(a.started).getTime() : null;
                const bStarted = b.started ? new Date(b.started).getTime() : null;

                if (aStarted && bStarted) return aStarted - bStarted;
                if (aStarted && !bStarted) return -1;
                if (!aStarted && bStarted) return 1;
                return 0;
            });

            console.warn('DEBUG: Match Data Loaded', {
                firstMatch: foundMatches[0],
                teamSearchingFor: foundTeam,
                alliancesOfFirstMatch: foundMatches[0]?.alliances
            });

            setMatches(foundMatches);
            // Reset expanded match when searching new team
            setExpandedMatchId(null);
        } catch (err) {
            console.error('DEBUG: Error in handleTeamSearch', err);
            setError(err.message);
        } finally {
            setTeamLoading(false);
        }
    };

    const handleManualSync = (match) => {
        // Find the appropriate stream for this match
        const matchStream = findStreamForMatch(match, streams, event?.start);

        if (!matchStream) {
            alert('No stream available for this match.');
            return;
        }

        const player = players[matchStream.id];
        if (!player) {
            alert('No player found. Load the stream first.');
            return;
        }

        const currentVideoTimeSec = player.getCurrentTime();
        const matchStartTimeMs = new Date(match.started).getTime();
        const calculatedStreamStart = matchStartTimeMs - (currentVideoTimeSec * 1000);

        // Update the stream's start time
        setStreams(prev => prev.map(s =>
            s.id === matchStream.id ? { ...s, streamStartTime: calculatedStreamStart } : s
        ));
        setSyncMode(false);
    };

    const jumpToMatch = async (match) => {
        // Find the appropriate stream for this match
        const matchStream = findStreamForMatch(match, streams, event?.start);

        if (!matchStream) {
            alert('No stream available for this match.');
            return;
        }

        // Always update UI (division tabs) even if we block the actual jump
        // This keeps the UI in sync with what the user is trying to view
        if (matchStream.id !== activeStreamId) {
            // Pause the currently active player if switching streams
            if (activeStreamId) {
                const currentPlayer = players[activeStreamId];
                if (currentPlayer && typeof currentPlayer.pauseVideo === 'function') {
                    currentPlayer.pauseVideo();
                }
            }

            setActiveStreamId(matchStream.id);
            // Also switch division view if applicable to keep UI in sync
            if (matchStream.divisionId) {
                setActiveDivisionId(matchStream.divisionId);
            }
        }

        const player = players[matchStream.id];
        if (!player) {
            alert('No player found for this stream. Please wait for it to load.');
            return;
        }

        if (!matchStream.streamStartTime) {
            alert('Please sync this stream first!');
            return;
        }

        const matchStartMs = new Date(match.started).getTime();
        const seekTimeSec = (matchStartMs - matchStream.streamStartTime) / 1000;

        if (seekTimeSec < 0) {
            alert("This match happened before the stream started!");
            return;
        }

        try {
            if (typeof player.seekTo === 'function') {
                player.seekTo(seekTimeSec, true);
                player.playVideo();
            } else {
                console.warn("Player seekTo is not a function", player);
            }
        } catch (err) {
            console.error("Error seeking video:", err);
            // It's likely the player isn't fully ready or the iframe is gone.
            // We can treat this as a non-fatal error for now.
        }
        setSelectedMatchId(match.id);
    };

    const handleClearAll = () => {
        // Reset Data
        setEvent(null);
        setTeam(null);
        setMatches([]);
        setTeams([]);
        setRankings([]);
        setSkills([]);
        setStreams([]);
        setAllMatches([]);
        setActiveStreamId(null);
        setPlayers({});

        // Reset Form/UI Inputs
        setEventUrl('');
        setTeamNumber('');
        setSelectedMatchId(null);
        setExpandedMatchId(null);
        setError('');
        setIsEventSearchCollapsed(false);
        setNoWebcastsFound(false);
        setWebcastCandidates([]);
        setSelectedPresetSku('');
        setMultiDivisionMode(false);
        setActiveDivisionId(null);
        setGlobalTeamEvents([]); // Clear global search results
        setIsGlobalSearchLoading(false);
        setGlobalSearchQuery('');

        // Reset URL Parameters
        setUrlPreset(null);
        setUrlSku(null);
        setUrlTeam(null);
        setUrlMatch(null);
        setUrlVid(null);
        setUrlLive(null);
        setUrlVid1(null);
        setUrlVid2(null);
        setUrlVid3(null);
        setUrlLive1(null);
        setUrlLive2(null);
        setUrlLive3(null);

        // Reset Internal Refs/Flags
        hasJumpedToMatch.current = false;
        hasDeepLinked.current = false;
    };





    // Helper to render score
    const renderScore = (match, userAlliance, opponentAlliance) => {
        if (!match.started) return null;

        const isVIQC = event?.program?.code === 'VIQC' || event?.program?.code === 'VIQRC';

        if (isVIQC) {
            return <span className="font-bold text-[#4FCEEC]">{userAlliance.score}</span>;
        }

        // V5RC / VRC
        const userScore = userAlliance.score;
        const opponentScore = opponentAlliance.score;
        const userWon = userScore > opponentScore;
        const tie = userScore === opponentScore;

        return (
            <div className="flex gap-2 text-sm font-mono">
                <span className={`font-bold ${userAlliance.color === 'red' ? 'text-red-400' : 'text-blue-400'} ${userWon ? 'underline decoration-2' : ''}`}>
                    {userScore}
                </span>
                <span className="text-gray-600">-</span>
                <span className={`font-bold ${opponentAlliance.color === 'red' ? 'text-red-400' : 'text-blue-400'} ${!userWon && !tie ? 'underline decoration-2' : ''}`}>
                    {opponentScore}
                </span>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-black text-white font-sans selection:bg-[#4FCEEC] selection:text-black flex flex-col">
            {/* WordPress Header */}
            <header className="bg-gray-900 border-b border-gray-800 z-50 backdrop-blur-md bg-opacity-80 flex-shrink-0">
                <WordPressHeader />
            </header>

            {/* Floating Controls (Bottom Left) */}
            <div className="fixed bottom-4 left-4 z-40 flex gap-2">
                <button
                    onClick={() => setShowEventHistory(true)}
                    className="p-3 bg-gray-900/90 hover:bg-gray-800 border border-gray-700 rounded-full transition-all shadow-lg hover:shadow-xl backdrop-blur-sm"
                    title="Event History"
                >
                    <History className="w-5 h-5 text-gray-300 hover:text-white" />
                </button>
                <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-3 bg-gray-900/90 hover:bg-gray-800 border border-gray-700 rounded-full transition-all shadow-lg hover:shadow-xl backdrop-blur-sm"
                    title="Settings"
                >
                    <Settings className="w-5 h-5 text-gray-300 hover:text-white" />
                </button>
                <a
                    href="https://github.com/axcdeng/Live-viewer"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-3 bg-gray-900/90 hover:bg-gray-800 border border-gray-700 rounded-full transition-all shadow-lg hover:shadow-xl backdrop-blur-sm"
                    title="View on GitHub"
                >
                    <Github className="w-5 h-5 text-gray-300 hover:text-white" />
                </a>
                <div className="w-px h-8 bg-gray-800 self-center mx-1"></div>
                <button
                    onClick={handleClearAll}
                    className="p-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-full transition-all shadow-lg hover:shadow-xl backdrop-blur-sm group"
                    title="Clear All"
                >
                    <RotateCcw className="w-5 h-5 text-red-400 group-hover:text-red-300" />
                </button>
            </div>

            {/* Error Display */}
            {error && (
                <div className="max-w-[1600px] mx-auto mt-4 px-4 w-full flex-shrink-0">
                    <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg shadow-red-900/20">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <p className="font-medium">{error}</p>
                        <button onClick={() => setError('')} className="ml-auto hover:text-white">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            <main className="flex-1 w-full p-2 sm:p-4 sm:max-w-[1600px] sm:mx-auto">
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 h-full">
                    {/* Left Column: Stream & Stream Manager */}
                    <div className="xl:col-span-8 flex flex-col gap-6">
                        {/* Stream Player */}
                        <div className="bg-gray-900 border border-gray-800 p-1 rounded-xl overflow-hidden flex-shrink-0">
                            <div className="bg-black rounded-lg overflow-hidden aspect-video relative group">
                                {event && streams.length > 0 ? (
                                    streams.map((stream) => (
                                        <div
                                            key={stream.id}
                                            style={{ display: stream.id === activeStreamId ? 'block' : 'none' }}
                                            className="w-full h-full"
                                        >
                                            {stream.videoId ? (
                                                <YouTube
                                                    videoId={stream.videoId}
                                                    opts={{
                                                        height: '100%',
                                                        width: '100%',
                                                        playerVars: {
                                                            autoplay: 0,
                                                            modestbranding: 1,
                                                        },
                                                    }}
                                                    onReady={(event) => {
                                                        setPlayers(prev => ({ ...prev, [stream.id]: event.target }));
                                                    }}
                                                    className="w-full h-full"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-600">
                                                    <div className="text-center">
                                                        <Tv className="w-12 h-12 mx-auto mb-3 opacity-20" />
                                                        <p>Enter a stream URL for {stream.label} below</p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-600">
                                        <div className="text-center">
                                            <Tv className="w-12 h-12 mx-auto mb-3 opacity-20" />
                                            {event ? (
                                                <p>No stream loaded. Use the controls below.</p>
                                            ) : (
                                                <p>Load an event first to watch streams</p>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Stream Switcher Overlay */}
                                {streams.length > 1 && (
                                    <div className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${getActiveStream()?.videoId ? 'opacity-0 group-hover:opacity-100' : ''}`}>

                                        {/* Division Switcher (Top Left) */}
                                        {multiDivisionMode && event?.divisions?.length > 1 && (
                                            <div className="absolute top-4 left-4 flex gap-1.5 pointer-events-auto">
                                                {event.divisions.map((div) => {
                                                    const hasAnyVideo = streams.some(s => s.divisionId === div.id && s.videoId);
                                                    return (
                                                        <button
                                                            key={div.id}
                                                            onClick={() => {
                                                                const currentStream = getActiveStream();
                                                                const targetDayIndex = currentStream?.dayIndex || 0;
                                                                const targetStream = streams.find(s => s.divisionId === div.id && s.dayIndex === targetDayIndex) || streams.find(s => s.divisionId === div.id);
                                                                if (targetStream) {
                                                                    setActiveDivisionId(div.id);
                                                                    setActiveStreamId(targetStream.id);
                                                                }
                                                            }}
                                                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all backdrop-blur-md border ${activeDivisionId === div.id
                                                                ? 'bg-[#4FCEEC] text-black border-[#4FCEEC] shadow-lg shadow-[#4FCEEC]/20'
                                                                : 'bg-black/60 text-gray-400 border-gray-800 hover:text-white hover:bg-black/80'
                                                                } ${!hasAnyVideo ? 'opacity-50' : ''}`}
                                                        >
                                                            {div.name}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        {/* Day Switcher (Top Right) */}
                                        <div className="absolute top-4 right-4 flex gap-2 pointer-events-auto">
                                            {(multiDivisionMode
                                                ? streams.filter(s => s.divisionId === activeDivisionId && s.videoId)
                                                : streams.filter(s => s.divisionId === (event?.divisions?.[0]?.id || 1) && s.videoId)
                                            ).map((stream) => (
                                                <button
                                                    key={stream.id}
                                                    onClick={() => setActiveStreamId(stream.id)}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors backdrop-blur-md ${activeStreamId === stream.id
                                                        ? 'bg-[#4FCEEC]/90 text-black'
                                                        : 'bg-black/60 text-white hover:bg-black/80'
                                                        }`}
                                                >
                                                    {stream.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Stream Manager (Livestream URLs) */}
                        {/* Stream Manager Controls - Always visible, disabled if no event */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                            {event ? (
                                <>
                                    {webcastCandidates.length > 0 ? (
                                        <>
                                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                                <Tv className="w-5 h-5 text-[#4FCEEC]" />
                                                Livestream URL (Auto-detected)
                                            </h2>
                                            <WebcastSelector
                                                candidates={webcastCandidates}
                                                onSelect={handleWebcastSelect}
                                                event={event}
                                            />
                                        </>
                                    ) : (
                                        <StreamManager
                                            event={event}
                                            streams={streams}
                                            onStreamsChange={setStreams}
                                            onWebcastSelect={handleWebcastSelect}
                                            multiDivisionMode={multiDivisionMode}
                                            onMultiDivisionModeChange={setMultiDivisionMode}
                                            activeDivisionId={activeDivisionId}
                                            onActiveDivisionIdChange={setActiveDivisionId}
                                            onSeek={handleSeek}
                                            onJumpToSyncedStart={() => {
                                                const match = matches.find(m => m.id === selectedMatchId);
                                                if (match) {
                                                    jumpToMatch(match);
                                                } else {
                                                    alert("No match selected to sync back to.");
                                                }
                                            }}
                                            canControl={!!players[activeStreamId]}
                                        />
                                    )}
                                    {noWebcastsFound && (
                                        <p className="text-yellow-500 text-xs">
                                            No webcasts found automatically. Please paste the URL manually.
                                            Check <a href={`https://www.robotevents.com/robot-competitions/vex-robotics-competition/${event.sku}.html#webcast`} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">here</a>.
                                        </p>
                                    )}
                                </>
                            ) : (
                                // Empty State for Stream Manager
                                <div className="space-y-4 opacity-50 pointer-events-none grayscale">
                                    <div className="flex justify-between items-center">
                                        <h3 className="text-white font-bold flex items-center gap-2">
                                            <Tv className="w-5 h-5 text-[#4FCEEC]" />
                                            Livestream URLs
                                        </h3>
                                    </div>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-400 mb-1.5">Livestream URL</label>
                                            <input type="text" disabled placeholder="https://youtube.com/..." className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-white" />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Right Column: Controls */}
                    <div className="xl:col-span-4 flex flex-col gap-4">
                        {/* Event Search Section */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex-shrink-0">
                            <button
                                onClick={() => setIsEventSearchCollapsed(!isEventSearchCollapsed)}
                                className="w-full p-4 flex justify-between items-center hover:bg-gray-800/50 transition-colors"
                            >
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                                    <LayoutList className="w-4 h-4" />
                                    Find Event
                                </h2>
                                <div className="flex items-center gap-3">
                                    {event && isEventSearchCollapsed && (
                                        <span className="text-xs text-[#4FCEEC] font-semibold truncate max-w-[150px] sm:max-w-[200px]">
                                            {event.name}
                                        </span>
                                    )}
                                    {isEventSearchCollapsed ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronUp className="w-4 h-4 text-gray-500" />}
                                </div>
                            </button>

                            <div className={`transition-all duration-300 ${isEventSearchCollapsed ? 'max-h-0 opacity-0 pointer-events-none' : 'max-h-[600px] opacity-100'}`}>
                                <div className="p-5 pt-0 space-y-4">
                                    {/* Presets Dropdown */}
                                    {presets.length > 0 && (
                                        <div className="space-y-2">
                                            <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
                                                <Star className="w-3 h-3 text-yellow-500" />
                                                Featured Events
                                            </label>
                                            <div className="relative group">
                                                <select
                                                    onChange={(e) => {
                                                        const preset = presets.find(p => p.sku === e.target.value);
                                                        if (preset) handleLoadPreset(preset);
                                                    }}
                                                    value={selectedPresetSku}
                                                    className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all appearance-none cursor-pointer hover:border-gray-600 shadow-inner"
                                                >
                                                    <option value="">Select an event...</option>
                                                    {presets.map((p, idx) => (
                                                        <option key={idx} value={p.sku}>{p.label}</option>
                                                    ))}
                                                </select>
                                                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 group-hover:text-[#4FCEEC] transition-colors">
                                                    <ChevronDown className="w-4 h-4" />
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="space-y-2">
                                        <label className="flex items-center gap-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">
                                            <Link className="w-3 h-3 text-gray-500" />
                                            Search by URL
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={eventUrl}
                                                onChange={(e) => {
                                                    const newUrl = e.target.value;
                                                    setEventUrl(newUrl);
                                                    // If input changes, we are no longer strictly following the preset
                                                    if (urlPreset) setUrlPreset(null);
                                                    if (selectedPresetSku) setSelectedPresetSku('');
                                                }}
                                                placeholder="Paste RobotEvents URL..."
                                                className="flex-1 bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all"
                                                onKeyDown={(e) => e.key === 'Enter' && handleEventSearch()}
                                            />
                                            <button
                                                onClick={handleEventSearch}
                                                disabled={eventLoading}
                                                className="bg-[#4FCEEC] hover:bg-[#3db8d6] disabled:opacity-50 text-black px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2"
                                            >
                                                {eventLoading ? <Loader className="w-4 h-4 animate-spin" /> : 'Search'}
                                            </button>
                                        </div>
                                    </div>

                                    {event && (
                                        <div className="p-3 bg-black border border-gray-700 rounded-lg mt-2">
                                            <p className="text-white font-semibold text-sm line-clamp-1" title={event.name}>{event.name}</p>
                                            <p className="text-xs text-gray-400 mt-1">{event.location?.venue}, {event.location?.city}</p>
                                        </div>
                                    )}
                                </div>
                            </div>

                        </div>

                        {/* Sync Control Bar */}
                        {event && streams.length > 0 && (
                            <div className="bg-black/30 border-y border-gray-800 py-1.5 px-3 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Sync Mode</span>
                                    <div className="flex bg-gray-900 rounded-lg p-0.5">
                                        <button
                                            onClick={() => setSyncMode(false)}
                                            className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all ${!syncMode
                                                ? 'bg-gray-700 text-white shadow-sm'
                                                : 'text-gray-500 hover:text-gray-300'
                                                }`}
                                        >
                                            AUTO
                                        </button>
                                        <button
                                            disabled
                                            title="Coming Soon"
                                            className="px-2 py-0.5 text-[10px] font-bold rounded-md transition-all text-gray-600 opacity-50 cursor-not-allowed"
                                        >
                                            MANUAL
                                        </button>
                                    </div>
                                </div>

                                {syncMode && (
                                    (() => {
                                        // Find first match dynamically for the button label
                                        const getFirstMatch = () => {
                                            const activeStream = getActiveStream();
                                            if (!activeStream) return null;
                                            const targetDivId = activeStream.divisionId;
                                            const targetDayIndex = activeStream.dayIndex;

                                            // Use allMatches (entire event) instead of matches (filtered by selected team)
                                            let relevantMatches = allMatches.length > 0 ? allMatches : matches;
                                            if (targetDivId && event.divisions && event.divisions.length > 1) {
                                                relevantMatches = relevantMatches.filter(m => m.division.id === targetDivId);
                                            }

                                            if (relevantMatches.length === 0) return null;

                                            const eventStart = new Date(event.start);
                                            const streamDate = new Date(eventStart);
                                            streamDate.setDate(eventStart.getDate() + targetDayIndex);
                                            const streamDateStr = streamDate.toISOString().split('T')[0];

                                            return relevantMatches
                                                .filter(m => m.started && m.started.startsWith(streamDateStr))
                                                .sort((a, b) => new Date(a.started) - new Date(b.started))[0];
                                        };

                                        const firstMatch = getFirstMatch();

                                        const handleManualSync = () => {
                                            const activeStream = getActiveStream();
                                            const firstMatch = getFirstMatch();

                                            if (activeStream && firstMatch) {
                                                const player = players[activeStream.id];
                                                if (player && typeof player.getCurrentTime === 'function') {
                                                    const currentVidTime = player.getCurrentTime();
                                                    const matchStartTimeMs = new Date(firstMatch.started).getTime();
                                                    const calculatedStartTime = matchStartTimeMs - (currentVidTime * 1000);

                                                    console.log("Manual Sync:", {
                                                        firstMatch: firstMatch.name,
                                                        matchStart: firstMatch.started,
                                                        vidTime: currentVidTime,
                                                        calcStart: new Date(calculatedStartTime).toISOString()
                                                    });

                                                    const updatedStreams = streams.map(s => {
                                                        if (s.id === activeStream.id) {
                                                            return { ...s, streamStartTime: calculatedStartTime };
                                                        }
                                                        return s;
                                                    });
                                                    setStreams(updatedStreams);
                                                    setManualSyncConfirmed(true); // Enable jumping
                                                    alert(`Synced to ${firstMatch.name}! All matches are now aligned.`);
                                                } else {
                                                    alert("Video player not ready.");
                                                }
                                            } else {
                                                alert("Could not find a match to sync with.");
                                            }
                                        };

                                        return (
                                            <button
                                                onClick={handleManualSync}
                                                disabled={!firstMatch}
                                                className="text-[10px] font-bold bg-[#4FCEEC] hover:bg-[#3db8d6] disabled:opacity-50 disabled:cursor-not-allowed text-black px-2 py-1 rounded transition-colors"
                                            >
                                                {firstMatch ? `SYNC TO ${firstMatch.name.toUpperCase()}` : 'NO MATCHES FOUND'}
                                            </button>
                                        );
                                    })()
                                )}
                            </div>
                        )}
                        <div className="flex gap-1 bg-gray-900/50 p-1 rounded-lg flex-shrink-0">
                            {/* Only show 'Find Team' tab if event is loaded OR it's been explicitly selected (though deprecated in no-event mode) */}
                            {event && (
                                <button
                                    onClick={() => setActiveTab('search')}
                                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'search'
                                        ? 'bg-gray-800 text-white shadow-sm'
                                        : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                                        }`}
                                >
                                    Find Team
                                </button>
                            )}
                            <button
                                onClick={() => setActiveTab('list')}
                                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'list'
                                    ? 'bg-gray-800 text-white shadow-sm'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                                    }`}
                            >
                                {event ? 'Team List' : 'Search by Team'}
                            </button>
                            {event && (
                                <button
                                    onClick={() => setActiveTab('matches')}
                                    className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'matches'
                                        ? 'bg-gray-800 text-white shadow-sm'
                                        : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                                        }`}
                                >
                                    Matches
                                </button>
                            )}
                        </div>

                        {/* Tab Content Panel */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl flex flex-col">
                            {activeTab === 'search' ? (
                                <>
                                    {/* Search Header */}
                                    <div className="p-5 border-b border-gray-800 space-y-3 flex-shrink-0 bg-gray-900 z-10 rounded-t-xl">
                                        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Find Team</h2>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={teamNumber}
                                                onChange={(e) => setTeamNumber(e.target.value)}
                                                placeholder="Team number (e.g., 11574A)"
                                                className="flex-1 bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all"
                                                onKeyDown={(e) => e.key === 'Enter' && handleTeamSearch()}
                                            />
                                            <button
                                                onClick={() => handleTeamSearch()}
                                                disabled={teamLoading || !event}
                                                className="bg-[#4FCEEC] hover:bg-[#3db8d6] disabled:opacity-50 text-black px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2"
                                            >
                                                {teamLoading ? <Loader className="w-4 h-4 animate-spin" /> : 'Search'}
                                            </button>
                                        </div>
                                        {team && (
                                            <div className="p-3 bg-black border border-gray-700 rounded-lg">
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <p className="text-white font-semibold text-sm">{team.number} - {team.team_name}</p>
                                                        <p className="text-xs text-gray-400">{team.organization}</p>
                                                    </div>
                                                    {matches.length > 0 && matches[0].division && multiDivisionMode && (
                                                        <span className="text-[10px] font-bold px-2 py-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase tracking-wider">
                                                            {matches[0].division.name}
                                                        </span>
                                                    )}
                                                </div>
                                                {team.grade && (
                                                    <p className="text-xs text-cyan-400 mt-1">
                                                        {team.grade} {team.program?.code && `• ${team.program.code}`}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Matches List */}
                                    <div className="overflow-y-auto px-4 pb-4 h-[600px]">
                                        {matches.length > 0 ? (
                                            <div className="space-y-4">
                                                <div className="flex justify-between items-center sticky top-0 bg-gray-900 pb-2 z-10 pt-4">
                                                    <h2 className="text-sm font-bold text-white">Matches</h2>
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex items-center gap-2 text-[10px]">
                                                            {(() => {
                                                                const syncedStreams = streams.filter(s => s.streamStartTime);
                                                                // If manual mode but not confirmed, treat as NOT synced
                                                                const isSynced = (syncMode && !manualSyncConfirmed) ? false : syncedStreams.length > 0;
                                                                return (
                                                                    <>
                                                                        <div className={`w-1.5 h-1.5 rounded-full ${isSynced ? 'bg-[#4FCEEC] shadow-[0_0_8px_rgba(79,206,236,0.6)]' : 'bg-red-500'}`} />
                                                                        <span className="text-gray-400">
                                                                            {isSynced ? 'Synced' : 'Not Synced'}
                                                                        </span>
                                                                    </>
                                                                );
                                                            })()}
                                                        </div>
                                                    </div>
                                                </div>

                                                {(() => {
                                                    // Group matches by day
                                                    const matchesByDay = {};
                                                    matches.forEach(match => {
                                                        // Use started date or scheduled date or fallback to event start
                                                        const dateToUse = match.started || match.scheduled || event?.start;
                                                        const dayIndex = getMatchDayIndex(dateToUse, event?.start);
                                                        if (!matchesByDay[dayIndex]) {
                                                            matchesByDay[dayIndex] = [];
                                                        }
                                                        matchesByDay[dayIndex].push(match);
                                                    });

                                                    return Object.keys(matchesByDay).sort().map((dayIndex) => {
                                                        const dayMatches = matchesByDay[dayIndex];
                                                        const dayStream = streams.find(s => s.dayIndex === parseInt(dayIndex));
                                                        const dayLabel = dayStream?.label || `Day ${parseInt(dayIndex) + 1}`;

                                                        return (
                                                            <div key={dayIndex}>
                                                                {/* Day Header */}
                                                                <div className="flex items-center gap-2 mb-2 sticky top-0 bg-gray-900/95 backdrop-blur py-2 z-10 -mx-4 px-4">
                                                                    <div className="flex-1 h-px bg-gray-700"></div>
                                                                    <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
                                                                        {dayLabel}
                                                                    </span>
                                                                    <div className="flex-1 h-px bg-gray-700"></div>
                                                                </div>

                                                                {/* Matches for this day */}
                                                                <div className="space-y-2 mb-4">
                                                                    {dayMatches.map((match, index) => {
                                                                        const hasStarted = !!match.started;
                                                                        // Fix: Ensure ID comparison is robust, check both ID and Number, and fallback to Name
                                                                        const alliance = match.alliances?.find(a => a.teams?.some(t =>
                                                                            String(t.team?.id) === String(team?.id) ||
                                                                            t.team?.number === team?.number ||
                                                                            t.team?.name === team?.number // Fallback if name holds the number
                                                                        ));

                                                                        const opponentAlliance = match.alliances?.find(a => a !== alliance);
                                                                        const matchName = match.name?.replace(/teamwork/gi, 'Qual') || match.name;

                                                                        // Check if match is available
                                                                        const grayOutReason = getGrayOutReason(match, streams, event?.start);
                                                                        const isGrayedOut = !!grayOutReason;
                                                                        const matchStream = findStreamForMatch(match, streams, event?.start);
                                                                        const canJump = matchStream && matchStream.streamStartTime;
                                                                        const isExpanded = expandedMatchId === match.id;

                                                                        // W/L Indicator Logic
                                                                        const isVIQC = event?.program?.code === 'VIQC' || event?.program?.code === 'VIQRC';
                                                                        let resultIndicator = null;
                                                                        if (hasStarted && alliance && opponentAlliance && !isVIQC) {
                                                                            const userScore = alliance.score;
                                                                            const opponentScore = opponentAlliance.score;
                                                                            if (userScore > opponentScore) {
                                                                                resultIndicator = <span className="text-[10px] font-bold text-green-400 ml-1">W</span>;
                                                                            } else if (userScore < opponentScore) {
                                                                                resultIndicator = <span className="text-[10px] font-bold text-red-400 ml-1">L</span>;
                                                                            } else {
                                                                                resultIndicator = <span className="text-[10px] font-bold text-gray-400 ml-1">T</span>;
                                                                            }
                                                                        }

                                                                        return (
                                                                            <div
                                                                                key={match.id}
                                                                                className={`rounded-lg border transition-all overflow-hidden ${selectedMatchId === match.id
                                                                                    ? 'bg-[#4FCEEC]/20 border-[#4FCEEC]'
                                                                                    : isGrayedOut
                                                                                        ? 'bg-black border-gray-800 opacity-50'
                                                                                        : 'bg-black border-gray-800 hover:border-gray-700'
                                                                                    }`}
                                                                                title={isGrayedOut ? grayOutReason : ''}
                                                                            >
                                                                                <div className="p-3 flex justify-between items-center gap-2">
                                                                                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedMatchId(isExpanded ? null : match.id)}>
                                                                                        <div className="flex items-center gap-2">
                                                                                            <h4 className="font-bold text-white text-sm truncate">{matchName}</h4>
                                                                                            {alliance && (
                                                                                                <div className="flex items-center">
                                                                                                    <div className={`w-2 h-2 rounded-full ${alliance.color === 'red' ? 'bg-red-500' : 'bg-blue-500'}`} title={`${alliance.color} alliance`} />
                                                                                                    {resultIndicator}
                                                                                                </div>
                                                                                            )}
                                                                                            {isExpanded ? <ChevronUp className="w-3 h-3 text-gray-500" /> : <ChevronDown className="w-3 h-3 text-gray-500" />}
                                                                                        </div>
                                                                                        <div className="flex items-center gap-2 mt-1">
                                                                                            <p className="text-xs text-gray-400">
                                                                                                {hasStarted ? format(new Date(match.started), 'h:mm a') : (match.scheduled ? format(new Date(match.scheduled), 'h:mm a') : 'TBD')}
                                                                                            </p>
                                                                                            {hasStarted && alliance && opponentAlliance && renderScore(match, alliance, opponentAlliance)}
                                                                                        </div>
                                                                                    </div>

                                                                                    {canJump ? (
                                                                                        <button
                                                                                            onClick={() => jumpToMatch(match)}
                                                                                            disabled={!hasStarted || isGrayedOut}
                                                                                            className="bg-[#4FCEEC] hover:bg-[#3db8d6] disabled:opacity-50 text-black p-2 rounded-lg flex-shrink-0 transition-colors"
                                                                                            title="Jump to match"
                                                                                        >
                                                                                            <Play className="w-3 h-3 fill-current" />
                                                                                        </button>
                                                                                    ) : (
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                setSelectedMatchId(match.id);
                                                                                                setSyncMode(true);
                                                                                            }}
                                                                                            disabled={!hasStarted || isGrayedOut}
                                                                                            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white p-2 rounded-lg flex-shrink-0 transition-colors"
                                                                                            title="Sync match"
                                                                                        >
                                                                                            <RefreshCw className="w-3 h-3" />
                                                                                        </button>
                                                                                    )}
                                                                                </div>

                                                                                {/* Expanded Team Details */}
                                                                                {isExpanded && (
                                                                                    <div className="bg-gray-900/50 border-t border-gray-800 p-3 text-xs space-y-2">
                                                                                        {/* Alliance Teams (or All Teams for VIQC) */}
                                                                                        {(isVIQC ? (match.alliances || []) : (alliance ? [alliance] : [])).length > 0 && (
                                                                                            <div>
                                                                                                <p className="text-gray-500 font-semibold mb-1">{isVIQC ? 'Teams' : 'Alliance'}</p>
                                                                                                <div className="flex flex-wrap gap-2">
                                                                                                    {(isVIQC ? match.alliances.flatMap(a => a.teams) : alliance?.teams)?.map(t => {
                                                                                                        if (!t?.team) return null;
                                                                                                        const teamLabel = t.team.number || t.team.name;
                                                                                                        return (
                                                                                                            <button
                                                                                                                key={t.team.id || Math.random()}
                                                                                                                onClick={() => handleTeamSearch(teamLabel)}
                                                                                                                className={`px-2 py-1 rounded border ${String(t.team.id) === String(team?.id)
                                                                                                                    ? 'bg-[#4FCEEC]/20 border-[#4FCEEC] text-[#4FCEEC]'
                                                                                                                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
                                                                                                            >
                                                                                                                {teamLabel}
                                                                                                            </button>
                                                                                                        );
                                                                                                    })}
                                                                                                </div>
                                                                                            </div>
                                                                                        )}

                                                                                        {/* Opponent Teams (only if not VIQC) */}
                                                                                        {!isVIQC && opponentAlliance && (
                                                                                            <div>
                                                                                                <p className="text-gray-500 font-semibold mb-1">Opponents</p>
                                                                                                <div className="flex flex-wrap gap-2">
                                                                                                    {opponentAlliance.teams?.map(t => {
                                                                                                        if (!t?.team) return null;
                                                                                                        const teamLabel = t.team.number || t.team.name;
                                                                                                        return (
                                                                                                            <button
                                                                                                                key={t.team.id || Math.random()}
                                                                                                                onClick={() => handleTeamSearch(teamLabel)}
                                                                                                                className="px-2 py-1 rounded border bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                                                                                                            >
                                                                                                                {teamLabel}
                                                                                                            </button>
                                                                                                        );
                                                                                                    })}
                                                                                                </div>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                    });
                                                })()}
                                            </div>
                                        ) : (
                                            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-2">
                                                <div className="p-3 bg-gray-800/50 rounded-full">
                                                    <Zap className="w-6 h-6 opacity-50" />
                                                </div>
                                                <p className="text-sm">Search for a team to see matches</p>
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : activeTab === 'matches' ? (
                                <>
                                    {/* Matches Tab Header */}
                                    <div className="p-4 border-b border-gray-800 space-y-3 flex-shrink-0 bg-gray-900 z-10 rounded-t-xl">
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={matchesTabState.search}
                                                onChange={(e) => setMatchesTabState(prev => ({ ...prev, search: e.target.value }))}
                                                placeholder="Search matches (e.g. #10, R16, 1698, 11101B)"
                                                className="flex-1 bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all"
                                            />
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            {/* Match Type Filters */}
                                            {['all', 'quals', 'elim'].map((filterType) => (
                                                <button
                                                    key={filterType}
                                                    onClick={() => setMatchesTabState(prev => ({ ...prev, filter: filterType }))}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${matchesTabState.filter === filterType
                                                        ? 'bg-[#4FCEEC] text-black'
                                                        : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                                        }`}
                                                >
                                                    {filterType === 'quals' ? 'Quals' : filterType === 'elim' ? 'Elims' : 'All Matches'}
                                                </button>
                                            ))}

                                            {/* Division Switcher in Matches Tab - Integrated into same row */}
                                            {multiDivisionMode && event?.divisions?.length > 1 && (
                                                <div className="flex flex-wrap gap-1">
                                                    {event.divisions.map((div) => (
                                                        <button
                                                            key={div.id}
                                                            onClick={() => setActiveDivisionId(div.id)}
                                                            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all uppercase whitespace-nowrap ${activeDivisionId === div.id
                                                                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                                                : 'bg-gray-800/50 text-gray-500 border border-transparent hover:bg-gray-700'
                                                                }`}
                                                        >
                                                            {div.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Full Matches List */}
                                    <div className="overflow-y-auto px-4 pb-4 h-[600px]">
                                        {allMatchesLoading ? (
                                            <div className="flex justify-center py-8">
                                                <Loader className="w-8 h-8 animate-spin text-[#4FCEEC]" />
                                            </div>
                                        ) : allMatches.length > 0 ? (
                                            (() => {
                                                // Filter logic
                                                const filteredMatches = allMatches.filter(match => {
                                                    // Filter by division
                                                    if (multiDivisionMode) {
                                                        if (activeDivisionId && match.division?.id !== activeDivisionId) return false;
                                                    } else if (event?.divisions?.length > 1) {
                                                        // If multi-division event but mode is OFF, default to first division
                                                        if (match.division?.id !== event.divisions[0].id) return false;
                                                    }

                                                    // Filter by type
                                                    if (matchesTabState.filter === 'quals' && !match.name.toLowerCase().includes('qual')) return false;
                                                    if (matchesTabState.filter === 'elim' && match.name.toLowerCase().includes('qual')) return false;

                                                    // Search logic
                                                    if (matchesTabState.search) {
                                                        const term = matchesTabState.search.toLowerCase();
                                                        const matchNameMatch = match.name.toLowerCase().includes(term);
                                                        const teamMatch = match.alliances.some(a =>
                                                            a.teams.some(t => {
                                                                if (!t.team) return false;
                                                                return (t.team.number || '').toLowerCase().includes(term) ||
                                                                    (t.team.name || '').toLowerCase().includes(term);
                                                            })
                                                        );
                                                        return matchNameMatch || teamMatch;
                                                    }
                                                    return true;
                                                });

                                                if (filteredMatches.length === 0) {
                                                    return (
                                                        <div className="text-center py-8 text-gray-500">
                                                            <p>No matches found matching your filters.</p>
                                                        </div>
                                                    );
                                                }

                                                // Group by day (reuse logic)
                                                const matchesByDay = {};
                                                filteredMatches.forEach(match => {
                                                    const dateToUse = match.started || match.scheduled || event?.start;
                                                    const dayIndex = getMatchDayIndex(dateToUse, event?.start);
                                                    if (!matchesByDay[dayIndex]) matchesByDay[dayIndex] = [];
                                                    matchesByDay[dayIndex].push(match);
                                                });

                                                return (
                                                    <div className="space-y-6 pt-4">
                                                        {Object.keys(matchesByDay).sort().map((dayIndex) => {
                                                            const dayMatches = matchesByDay[dayIndex];
                                                            const dayStream = streams.find(s => s.dayIndex === parseInt(dayIndex));
                                                            const dayLabel = dayStream?.label || `Day ${parseInt(dayIndex) + 1}`;

                                                            return (
                                                                <div key={dayIndex}>
                                                                    <div className="flex items-center gap-2 mb-2 sticky top-0 bg-gray-900/95 backdrop-blur py-2 z-10 -mx-4 px-4">
                                                                        <div className="flex-1 h-px bg-gray-700"></div>
                                                                        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
                                                                            {dayLabel}
                                                                        </span>
                                                                        <div className="flex-1 h-px bg-gray-700"></div>
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        {dayMatches.map((match) => {
                                                                            const matchName = match.name?.replace(/teamwork/gi, 'Qual') || match.name;
                                                                            const grayOutReason = getGrayOutReason(match, streams, event?.start);

                                                                            // Helper to check if a specific team is in this match (for highlighting)
                                                                            const isSearchedTeam = (t) => {
                                                                                if (!matchesTabState.search) return false;
                                                                                const term = matchesTabState.search.toLowerCase();
                                                                                if (!/\d/.test(term)) return false;
                                                                                if (!t.team) return false;
                                                                                return (t.team.number || '').toLowerCase().includes(term) ||
                                                                                    (t.team.name || '').toLowerCase().includes(term);
                                                                            };

                                                                            return (
                                                                                <div
                                                                                    key={match.id}
                                                                                    className={`bg-black border rounded-lg p-3 transition-colors ${grayOutReason ? 'border-gray-800 opacity-60' :
                                                                                        selectedMatchId === match.id ? 'border-[#4FCEEC] bg-slate-900' : 'border-gray-800 hover:border-gray-600'
                                                                                        }`}
                                                                                >
                                                                                    <div className="flex justify-between items-start mb-2">
                                                                                        <div>
                                                                                            <span className="font-bold text-[#4FCEEC]">{matchName}</span>
                                                                                            <span className="text-gray-500 text-xs ml-2">
                                                                                                {match.started ? format(new Date(match.started), 'h:mm a') :
                                                                                                    match.scheduled ? format(new Date(match.scheduled), 'h:mm a') : 'Scheduled'}
                                                                                            </span>
                                                                                        </div>
                                                                                        <div className="flex gap-2">
                                                                                            <button
                                                                                                onClick={() => jumpToMatch(match)}
                                                                                                disabled={!!grayOutReason}
                                                                                                className={`p-1.5 rounded-md transition-colors ${grayOutReason
                                                                                                    ? 'text-gray-600 cursor-not-allowed'
                                                                                                    : 'bg-[#4FCEEC]/10 text-[#4FCEEC] hover:bg-[#4FCEEC]/20'
                                                                                                    }`}
                                                                                                title={grayOutReason || "Jump to match"}
                                                                                            >
                                                                                                <Play className="w-3 h-3 fill-current" />
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>

                                                                                    <div className="grid grid-cols-2 gap-4 text-xs">
                                                                                        {match.alliances.map((alliance) => (
                                                                                            <div key={alliance.color} className={`flex flex-col ${alliance.color === 'red' ? 'text-red-400' : 'text-blue-400'}`}>
                                                                                                {/* Score at top of column */}
                                                                                                <div className="flex justify-between items-end border-b border-gray-800 pb-1 mb-1">
                                                                                                    <span className="font-mono text-lg font-bold opacity-90">{alliance.score}</span>
                                                                                                </div>
                                                                                                {/* Teams list */}
                                                                                                <div className="flex flex-col gap-1">
                                                                                                    {alliance.teams.map((t) => (
                                                                                                        <button
                                                                                                            key={t.team.id || Math.random()}
                                                                                                            onClick={(e) => {
                                                                                                                e.stopPropagation();
                                                                                                                const teamNum = t.team.number || t.team.name;
                                                                                                                setActiveTab('search');
                                                                                                                setTeamNumber(teamNum);
                                                                                                                handleTeamSearch(teamNum);
                                                                                                            }}
                                                                                                            className={`text-left hover:underline cursor-pointer transition-all ${isSearchedTeam(t) ? 'bg-white/10 rounded px-1 -mx-1 font-bold text-white' : 'hover:text-white'}`}
                                                                                                        >
                                                                                                            {/* Fallback to name if number is missing */}
                                                                                                            {t.team.number || t.team.name}
                                                                                                        </button>
                                                                                                    ))}
                                                                                                </div>
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })()
                                        ) : (
                                            <div className="text-center py-8 text-gray-500">
                                                <p>No matches found for this event.</p>
                                            </div>
                                        )}
                                    </div>
                                </>
                            ) : activeTab === 'list' ? (
                                event ? (
                                    <TeamList
                                        event={event}
                                        onTeamSelect={handleTeamSearch}
                                        multiDivisionMode={multiDivisionMode}
                                        teams={teams}
                                        rankings={rankings}
                                        skills={skills}
                                        loading={rankingsLoading}
                                    />
                                ) : (
                                    // Global Team Search View (No Event Loaded)
                                    <div className="flex flex-col h-full">
                                        <div className="p-4 border-b border-gray-800 space-y-4">
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    value={teamNumber}
                                                    onChange={(e) => setTeamNumber(e.target.value)}
                                                    placeholder="Team Number (e.g. 1698V)"
                                                    className="flex-1 bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none"
                                                    onKeyDown={(e) => e.key === 'Enter' && handleTeamSearch()}
                                                />
                                                <button
                                                    onClick={() => handleTeamSearch()}
                                                    disabled={isGlobalSearchLoading}
                                                    className="bg-[#4FCEEC] hover:bg-[#3db8d6] disabled:opacity-50 text-black px-4 py-2 rounded-lg font-bold text-sm"
                                                >
                                                    {isGlobalSearchLoading ? <Loader className="w-4 h-4 animate-spin" /> : 'Search'}
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="checkbox"
                                                    id="includePastSeasons"
                                                    checked={includePastSeasons}
                                                    onChange={(e) => setIncludePastSeasons(e.target.checked)}
                                                    className="w-4 h-4 rounded border-gray-700 bg-gray-900 text-[#4FCEEC] focus:ring-[#4FCEEC] focus:ring-offset-gray-900"
                                                />
                                                <label htmlFor="includePastSeasons" className="text-xs text-gray-400 select-none cursor-pointer">
                                                    Show all seasons
                                                </label>
                                            </div>
                                        </div>

                                        <div className="flex-1 overflow-y-auto p-2 space-y-2 max-h-[600px]">
                                            {isGlobalSearchLoading ? (
                                                <div className="flex justify-center py-8">
                                                    <Loader className="w-8 h-8 animate-spin text-[#4FCEEC]" />
                                                </div>
                                            ) : globalTeamEvents.length > 0 ? (
                                                globalTeamEvents.map(evt => (
                                                    <button
                                                        key={evt.id}
                                                        onClick={async () => {
                                                            setEventUrl(`https://www.robotevents.com/${evt.sku}.html`);
                                                            // Trigger search logic manually or leverage existing effect
                                                            // For direct action:
                                                            setEventLoading(true);
                                                            try {
                                                                const fullEvent = await getEventBySku(evt.sku);
                                                                setEvent(fullEvent);
                                                                setEventUrl(`https://www.robotevents.com/${evt.sku}.html`);
                                                                initializeStreamsForEvent(fullEvent);
                                                                setUrlSku(evt.sku);
                                                                setIsEventSearchCollapsed(true); // Collapse event search after loading
                                                            } catch (err) {
                                                                setError(err.message);
                                                            } finally {
                                                                setEventLoading(false);
                                                            }
                                                        }}
                                                        className="w-full bg-gray-800/50 hover:bg-gray-800 border border-gray-800 hover:border-[#4FCEEC]/50 rounded-lg p-3 text-left group transition-all"
                                                    >
                                                        <div className="flex justify-between items-start mb-1">
                                                            <span className="font-bold text-white group-hover:text-[#4FCEEC] line-clamp-1 text-sm">{evt.name}</span>
                                                            <span className="text-[10px] font-bold bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded uppercase">{evt.program?.code || 'VRC'}</span>
                                                        </div>
                                                        <div className="flex flex-col gap-0.5 mt-2">
                                                            <span className="text-xs text-gray-400 flex items-center gap-1">
                                                                <Globe className="w-3 h-3" /> {evt.location?.city}, {evt.location?.region}
                                                            </span>
                                                            <span className="text-xs text-gray-500">
                                                                {new Date(evt.start).toLocaleDateString()} - {new Date(evt.end).toLocaleDateString()}
                                                            </span>
                                                        </div>
                                                    </button>
                                                ))
                                            ) : (
                                                !isGlobalSearchLoading && (
                                                    <div className="flex flex-col items-center justify-center h-48 text-gray-500 opacity-50">
                                                        <Search className="w-12 h-12 mb-2" />
                                                        <p className="text-xs">Search for a team to view all their events</p>
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    </div>
                                )
                            ) : null}
                        </div>
                    </div>
                </div>

                {/* Sync Modal */}
                {syncMode && selectedMatchId && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-8">
                        <div className="bg-gray-900 border-2 border-[#4FCEEC] p-8 rounded-2xl max-w-md text-center shadow-2xl shadow-[#4FCEEC]/20">
                            <h3 className="text-2xl font-bold text-[#4FCEEC] mb-4">Manual Sync</h3>
                            <p className="text-gray-300 mb-6">
                                Find the exact moment <strong className="text-white">{matches.find(m => m.id === selectedMatchId)?.name}</strong> starts in the video, then click SYNC NOW.
                            </p>
                            <div className="flex gap-3 justify-center">
                                <button
                                    onClick={() => handleManualSync(matches.find(m => m.id === selectedMatchId))}
                                    className="bg-[#4FCEEC] hover:bg-[#3db8d6] text-black px-8 py-3 rounded-lg font-bold transition-colors"
                                >
                                    SYNC NOW
                                </button>
                                <button
                                    onClick={() => setSyncMode(false)}
                                    className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Settings Modal */}
                <SettingsModal
                    isOpen={isSettingsOpen}
                    onClose={() => setIsSettingsOpen(false)}
                />

                {/* Event History Modal */}
                <EventHistory
                    isOpen={showEventHistory}
                    onClose={() => setShowEventHistory(false)}
                    onSelectEvent={handleLoadFromHistory}
                />

                {/* Copyright Footer */}
                <footer className="fixed bottom-4 right-4 text-xs text-slate-400 text-center sm:text-right max-w-xs sm:max-w-2xl">
                    <p className="bg-slate-900/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-slate-700/50">
                        © 2025 RoboSTEM Foundation |{' '}
                        <a
                            href="https://forms.gle/R3XS6nXymbLc57RSA"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                            Report Bugs
                        </a>
                        {' '}| Made with <span className="text-red-500">❤</span> by{' '}
                        <a
                            href="https://www.linkedin.com/in/axcdeng/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:opacity-80 transition-opacity"
                        >
                            Alexander Deng
                        </a>
                    </p>
                </footer>
            </main>
            <Analytics debug={true} />
        </div>
    );
}

export default Viewer;
